-- Allow admins and staff to edit the items of a marketplace order before it is
-- delivered: remove lines or reduce quantities. Delivered and cancelled orders
-- are excluded because inventory has already been deducted and an immutable ERP
-- sales order was created from delivered orders.

CREATE OR REPLACE FUNCTION public.edit_marketplace_order_items(order_id uuid, items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_incoming jsonb;
  v_original jsonb;
  v_key text;
  v_seen text[] := ARRAY[]::text[];
  v_original_qty integer;
  v_qty integer;
  v_qty_text text;
  v_unit_price numeric;
  v_line_total numeric;
  v_new_items jsonb := '[]'::jsonb;
  v_new_subtotal numeric := 0;
  v_found_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_workspace_id() IS NULL THEN
    RAISE EXCEPTION 'Workspace context is missing';
  END IF;

  IF public.current_user_role() NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Only admins and staff can edit marketplace orders';
  END IF;

  IF items IS NULL OR jsonb_typeof(items) <> 'array' THEN
    RAISE EXCEPTION 'Updated order items must be a JSON array';
  END IF;

  IF jsonb_array_length(items) = 0 THEN
    RAISE EXCEPTION 'A marketplace order must keep at least one item';
  END IF;

  SELECT *
  INTO v_order
  FROM public.marketplace_orders
  WHERE id = order_id
    AND workspace_id = public.current_workspace_id()
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketplace order not found';
  END IF;

  IF v_order.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Delivered and cancelled marketplace orders cannot be edited';
  END IF;

  FOR v_incoming IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    IF jsonb_typeof(v_incoming) <> 'object' THEN
      RAISE EXCEPTION 'Each updated item must be a JSON object';
    END IF;

    v_key := COALESCE(v_incoming->>'product_id', '')
      || '::' || COALESCE(v_incoming->>'storage_id', '')
      || '::' || COALESCE(v_incoming->>'allocation_group_id', '');

    IF v_seen @> ARRAY[v_key] THEN
      RAISE EXCEPTION 'Duplicate item in the updated order';
    END IF;
    v_seen := v_seen || ARRAY[v_key];

    v_qty_text := v_incoming->>'quantity';
    IF v_qty_text IS NULL OR v_qty_text !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Quantity must be a positive integer';
    END IF;
    v_qty := v_qty_text::integer;

    v_found_count := 0;
    FOR v_original IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb))
    LOOP
      IF (v_original->>'product_id') IS NOT DISTINCT FROM (v_incoming->>'product_id')
         AND (v_original->>'storage_id') IS NOT DISTINCT FROM (v_incoming->>'storage_id')
         AND (v_original->>'allocation_group_id') IS NOT DISTINCT FROM (v_incoming->>'allocation_group_id')
      THEN
        v_found_count := v_found_count + 1;

        IF v_found_count = 1 THEN
          v_original_qty := COALESCE(NULLIF(v_original->>'quantity', '')::integer, 0);

          IF v_qty > v_original_qty THEN
            RAISE EXCEPTION 'Quantity for %s cannot exceed the originally ordered quantity', COALESCE(NULLIF(v_original->>'name', ''), 'Item');
          END IF;

          v_unit_price := COALESCE(NULLIF(v_incoming->>'unit_price', '')::numeric, -1);
          IF v_unit_price IS DISTINCT FROM COALESCE(NULLIF(v_original->>'unit_price', '')::numeric, -1) THEN
            RAISE EXCEPTION 'The unit price for %s cannot be changed', COALESCE(NULLIF(v_original->>'name', ''), 'Item');
          END IF;
          v_unit_price := COALESCE(NULLIF(v_original->>'unit_price', '')::numeric, 0);

          v_line_total := round((v_unit_price * v_qty)::numeric, 2);
          v_new_items := v_new_items || jsonb_build_array(
            (v_original - 'quantity' - 'line_total')
            || jsonb_build_object('quantity', to_jsonb(v_qty), 'line_total', to_jsonb(v_line_total))
          );
          v_new_subtotal := v_new_subtotal + v_line_total;
        END IF;
      END IF;
    END LOOP;

    IF v_found_count = 0 THEN
      RAISE EXCEPTION 'Product %s is not part of this marketplace order', COALESCE(NULLIF(v_incoming->>'name', ''), v_incoming->>'product_id', 'Item');
    END IF;

    IF v_found_count > 1 THEN
      RAISE EXCEPTION 'Product %s appears multiple times in the marketplace order and cannot be updated safely', COALESCE(NULLIF(v_incoming->>'name', ''), 'Item');
    END IF;
  END LOOP;

  IF jsonb_array_length(v_new_items) = 0 THEN
    RAISE EXCEPTION 'A marketplace order must keep at least one item';
  END IF;

  UPDATE public.marketplace_orders
  SET
    items = v_new_items,
    subtotal = v_new_subtotal,
    total = v_new_subtotal,
    version = COALESCE(version, 0) + 1
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'items', v_new_items,
    'subtotal', v_new_subtotal,
    'total', v_new_subtotal,
    'version', COALESCE(v_order.version, 0) + 1
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.edit_marketplace_order_items(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_marketplace_order_items(uuid, jsonb) TO authenticated, service_role;