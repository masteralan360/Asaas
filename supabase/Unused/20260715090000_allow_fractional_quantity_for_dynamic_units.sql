-- Allow fractional quantities for dynamic units (m², Kg)
-- Changes quantity columns from integer to numeric for sale_items,
-- inventory, and stock_batches to support decimal quantities
-- for products measured in m² and Kg.

-- sale_items
ALTER TABLE public.sale_items
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

ALTER TABLE public.sale_items
  ALTER COLUMN returned_quantity TYPE numeric USING returned_quantity::numeric;

ALTER TABLE public.sale_items
  ALTER COLUMN inventory_snapshot TYPE numeric USING inventory_snapshot::numeric;

-- inventory
ALTER TABLE public.inventory
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

-- stock_batches (drop and recreate check constraint since the type changed)
ALTER TABLE public.stock_batches
  DROP CONSTRAINT IF EXISTS stock_batches_quantity_check;

ALTER TABLE public.stock_batches
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

ALTER TABLE public.stock_batches
  ADD CONSTRAINT stock_batches_quantity_check CHECK (
    (
      COALESCE(is_deleted, false) = false
      AND quantity > 0
    )
    OR (
      COALESCE(is_deleted, false) = true
      AND quantity >= 0
    )
  );

-- sale_return_items
ALTER TABLE public.sale_return_items
  DROP CONSTRAINT IF EXISTS sale_return_items_quantity_check;

ALTER TABLE public.sale_return_items
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

ALTER TABLE public.sale_return_items
  ADD CONSTRAINT sale_return_items_quantity_check CHECK (quantity > 0);

-- Update process_sale_return function with NUMERIC quantities
CREATE OR REPLACE FUNCTION public.process_sale_return(
  p_return_id uuid,
  p_sale_id uuid,
  p_items jsonb,
  p_return_reason text,
  p_refund_method text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sale_record RECORD;
  v_existing_return RECORD;
  v_item_record RECORD;
  v_item_payload jsonb;
  v_batch_allocation jsonb;
  v_target_batch_record RECORD;
  v_workspace_id uuid;
  v_user_role text;
  v_plan text;
  v_pos boolean;
  v_requested_quantity numeric;
  v_return_quantity numeric;
  v_storage_id uuid;
  v_primary_storage_id uuid;
  v_original_storage_missing boolean := false;
  v_total_return_value numeric := 0;
  v_unit_refund_amount numeric := 0;
  v_line_refund_amount numeric := 0;
  v_sale_fully_returned boolean := false;
  v_processed_items integer := 0;
  v_existing_batch_allocations jsonb := '[]'::jsonb;
  v_remaining_batch_allocations jsonb := '[]'::jsonb;
  v_restored_batch_allocations jsonb := '[]'::jsonb;
  v_remaining_to_restore numeric := 0;
  v_batch_quantity numeric := 0;
  v_restore_quantity numeric := 0;
  v_leftover_batch_quantity numeric := 0;
  v_batch_id uuid;
  v_restored_batch_id uuid;
  v_batch_number text;
  v_batch_price numeric;
  v_batch_cost_price numeric;
  v_batch_currency text;
  v_batch_expiry_date date;
  v_batch_manufacturing_date date;
  v_new_batch_id uuid;
  v_line_id uuid;
  v_return_lines jsonb := '[]'::jsonb;
BEGIN
  IF p_return_id IS NULL THEN
    RAISE EXCEPTION 'Return ID is required';
  END IF;

  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale ID is required';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one return item is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT value->>'sale_item_id' AS sale_item_id, COUNT(*) AS item_count
      FROM jsonb_array_elements(p_items)
      GROUP BY value->>'sale_item_id'
    ) duplicate_items
    WHERE duplicate_items.sale_item_id IS NULL
       OR duplicate_items.item_count > 1
  ) THEN
    RAISE EXCEPTION 'Return items must contain unique sale item IDs';
  END IF;

  SELECT *
  INTO v_sale_record
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  v_workspace_id := v_sale_record.workspace_id;

  SELECT role
  INTO v_user_role
  FROM public.profiles
  WHERE id = auth.uid()
    AND workspace_id = v_workspace_id;

  IF v_user_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized: Only admins and staff can return items';
  END IF;

  SELECT plan
  INTO v_plan
  FROM public.workspaces
  WHERE id = v_workspace_id;

  v_pos := public.workspace_module_allowed(v_workspace_id, v_plan, 'pos');

  IF NOT COALESCE(v_pos, false) THEN
    RAISE EXCEPTION 'POS feature is not enabled for this workspace';
  END IF;

  SELECT *
  INTO v_existing_return
  FROM public.sale_returns
  WHERE id = p_return_id;

  IF FOUND THEN
    IF v_existing_return.sale_id IS DISTINCT FROM p_sale_id
       OR v_existing_return.workspace_id IS DISTINCT FROM v_workspace_id THEN
      RAISE EXCEPTION 'Return ID is already assigned to another sale';
    END IF;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', sri.id,
          'sale_item_id', sri.sale_item_id,
          'quantity', sri.quantity,
          'refund_amount', sri.refund_amount,
          'restored_storage_id', sri.restored_storage_id,
          'restored_batch_allocations', sri.restored_batch_allocations
        )
        ORDER BY sri.created_at, sri.id
      ),
      '[]'::jsonb
    )
    INTO v_return_lines
    FROM public.sale_return_items sri
    WHERE sri.return_id = p_return_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Return already processed',
      'return_id', p_return_id,
      'return_value', v_existing_return.refund_amount,
      'items', v_return_lines,
      'idempotent_replay', true
    );
  END IF;

  v_primary_storage_id := public.ensure_primary_storage(v_workspace_id);

  INSERT INTO public.sale_returns (
    id,
    workspace_id,
    sale_id,
    reason,
    status,
    refund_method,
    refund_amount,
    returned_by,
    returned_at,
    source,
    created_at,
    updated_at
  )
  VALUES (
    p_return_id,
    v_workspace_id,
    p_sale_id,
    COALESCE(NULLIF(BTRIM(p_return_reason), ''), 'Return'),
    'posted',
    NULLIF(BTRIM(p_refund_method), ''),
    0,
    auth.uid(),
    now(),
    'app',
    now(),
    timezone('utc', now())
  );

  FOR v_item_payload IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    SELECT si.*
    INTO v_item_record
    FROM public.sale_items si
    WHERE si.id = NULLIF(v_item_payload->>'sale_item_id', '')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale item not found';
    END IF;

    IF v_item_record.sale_id IS DISTINCT FROM p_sale_id THEN
      RAISE EXCEPTION 'Selected sale items must belong to the requested sale';
    END IF;

    v_requested_quantity := COALESCE((v_item_payload->>'quantity')::numeric, 0);

    IF v_requested_quantity <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be greater than zero';
    END IF;

    IF v_requested_quantity > (
      v_item_record.quantity - COALESCE(v_item_record.returned_quantity, 0)
    ) THEN
      RAISE EXCEPTION 'Return quantity exceeds the remaining quantity for sale item %', v_item_record.id;
    END IF;

    v_return_quantity := v_requested_quantity;
    v_storage_id := v_item_record.storage_id;
    v_original_storage_missing := false;

    IF v_storage_id IS NOT NULL THEN
      PERFORM 1
      FROM public.storages
      WHERE id = v_storage_id
        AND workspace_id = v_workspace_id
        AND COALESCE(is_deleted, false) = false;

      IF NOT FOUND THEN
        v_original_storage_missing := true;
        v_storage_id := v_primary_storage_id;
      END IF;
    END IF;

    IF v_storage_id IS NULL THEN
      SELECT CASE WHEN COUNT(*) = 1 THEN MIN(i.storage_id::text)::uuid ELSE NULL END
      INTO v_storage_id
      FROM public.inventory i
      JOIN public.storages st
        ON st.id = i.storage_id
       AND st.workspace_id = v_workspace_id
       AND COALESCE(st.is_deleted, false) = false
      WHERE i.workspace_id = v_workspace_id
        AND i.product_id = v_item_record.product_id
        AND COALESCE(i.is_deleted, false) = false;
    END IF;

    IF v_storage_id IS NULL THEN
      SELECT p.storage_id
      INTO v_storage_id
      FROM public.products p
      JOIN public.storages st
        ON st.id = p.storage_id
       AND st.workspace_id = v_workspace_id
       AND COALESCE(st.is_deleted, false) = false
      WHERE p.id = v_item_record.product_id
        AND p.workspace_id = v_workspace_id;
    END IF;

    IF v_storage_id IS NULL THEN
      v_storage_id := v_primary_storage_id;
    END IF;

    IF v_storage_id IS NULL THEN
      RAISE EXCEPTION 'Storage not found for returned product %', v_item_record.product_id;
    END IF;

    INSERT INTO public.inventory (
      id,
      workspace_id,
      product_id,
      storage_id,
      quantity,
      created_at,
      updated_at,
      version,
      is_deleted
    )
    VALUES (
      gen_random_uuid(),
      v_workspace_id,
      v_item_record.product_id,
      v_storage_id,
      v_return_quantity,
      now(),
      now(),
      1,
      false
    )
    ON CONFLICT (workspace_id, product_id, storage_id) DO UPDATE
    SET
      quantity = public.inventory.quantity + EXCLUDED.quantity,
      updated_at = now(),
      version = COALESCE(public.inventory.version, 0) + 1,
      is_deleted = false;

    v_existing_batch_allocations := CASE
      WHEN jsonb_typeof(v_item_record.batch_allocations) = 'array'
        THEN v_item_record.batch_allocations
      ELSE '[]'::jsonb
    END;
    v_remaining_batch_allocations := '[]'::jsonb;
    v_restored_batch_allocations := '[]'::jsonb;

    IF jsonb_array_length(v_existing_batch_allocations) > 0 THEN
      v_remaining_to_restore := v_return_quantity;

      FOR v_batch_allocation IN
        SELECT value
        FROM jsonb_array_elements(v_existing_batch_allocations)
      LOOP
        v_batch_quantity := COALESCE((v_batch_allocation->>'quantity')::numeric, 0);
        v_restore_quantity := LEAST(v_remaining_to_restore, v_batch_quantity);
        v_leftover_batch_quantity := GREATEST(v_batch_quantity - v_restore_quantity, 0);
        v_batch_id := NULLIF(v_batch_allocation->>'batch_id', '')::uuid;
        v_batch_number := COALESCE(
          NULLIF(v_batch_allocation->>'batch_number', ''),
          'Restored Batch'
        );
        v_batch_price := NULLIF(v_batch_allocation->>'price', '')::numeric;
        v_batch_cost_price := NULLIF(v_batch_allocation->>'cost_price', '')::numeric;
        v_batch_currency := lower(
          COALESCE(NULLIF(v_batch_allocation->>'currency', ''), 'usd')
        );
        v_batch_expiry_date := NULLIF(v_batch_allocation->>'expiry_date', '')::date;
        v_batch_manufacturing_date := NULLIF(
          v_batch_allocation->>'manufacturing_date',
          ''
        )::date;
        v_target_batch_record := NULL;
        v_restored_batch_id := NULL;

        IF v_restore_quantity > 0 THEN
          IF v_batch_id IS NOT NULL THEN
            SELECT *
            INTO v_target_batch_record
            FROM public.stock_batches
            WHERE id = v_batch_id
              AND workspace_id = v_workspace_id
              AND product_id = v_item_record.product_id
              AND storage_id = v_storage_id
            FOR UPDATE;
          END IF;

          IF v_target_batch_record IS NULL THEN
            SELECT *
            INTO v_target_batch_record
            FROM public.stock_batches
            WHERE workspace_id = v_workspace_id
              AND product_id = v_item_record.product_id
              AND storage_id = v_storage_id
              AND lower(batch_number) = lower(v_batch_number)
            ORDER BY COALESCE(is_deleted, false) ASC, created_at ASC NULLS LAST, id ASC
            LIMIT 1
            FOR UPDATE;
          END IF;

          IF v_target_batch_record IS NOT NULL THEN
            v_restored_batch_id := v_target_batch_record.id;

            UPDATE public.stock_batches
            SET
              quantity = COALESCE(v_target_batch_record.quantity, 0) + v_restore_quantity,
              price = COALESCE(v_target_batch_record.price, v_batch_price),
              cost_price = COALESCE(v_target_batch_record.cost_price, v_batch_cost_price),
              currency = lower(COALESCE(v_target_batch_record.currency, v_batch_currency, 'usd')),
              expiry_date = COALESCE(v_target_batch_record.expiry_date, v_batch_expiry_date),
              manufacturing_date = COALESCE(
                v_target_batch_record.manufacturing_date,
                v_batch_manufacturing_date
              ),
              updated_at = now(),
              version = COALESCE(version, 0) + 1,
              is_deleted = false
            WHERE id = v_target_batch_record.id;
          ELSE
            v_new_batch_id := CASE
              WHEN v_batch_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM public.stock_batches
                 WHERE id = v_batch_id
               )
                THEN v_batch_id
              ELSE gen_random_uuid()
            END;
            v_restored_batch_id := v_new_batch_id;

            INSERT INTO public.stock_batches (
              id,
              workspace_id,
              product_id,
              storage_id,
              batch_number,
              quantity,
              price,
              cost_price,
              currency,
              expiry_date,
              manufacturing_date,
              created_at,
              updated_at,
              version,
              is_deleted
            )
            VALUES (
              v_new_batch_id,
              v_workspace_id,
              v_item_record.product_id,
              v_storage_id,
              v_batch_number,
              v_restore_quantity,
              v_batch_price,
              v_batch_cost_price,
              v_batch_currency,
              v_batch_expiry_date,
              v_batch_manufacturing_date,
              now(),
              now(),
              1,
              false
            );
          END IF;

          v_restored_batch_allocations := v_restored_batch_allocations || jsonb_build_array(
            jsonb_build_object(
              'batch_id', v_restored_batch_id,
              'batch_number', v_batch_number,
              'quantity', v_restore_quantity,
              'price', v_batch_price,
              'cost_price', v_batch_cost_price,
              'currency', v_batch_currency,
              'expiry_date', v_batch_expiry_date,
              'manufacturing_date', v_batch_manufacturing_date
            )
          );
        END IF;

        IF v_leftover_batch_quantity > 0 THEN
          v_remaining_batch_allocations := v_remaining_batch_allocations || jsonb_build_array(
            jsonb_build_object(
              'batch_id', v_batch_id,
              'batch_number', v_batch_number,
              'quantity', v_leftover_batch_quantity,
              'price', v_batch_price,
              'cost_price', v_batch_cost_price,
              'currency', v_batch_currency,
              'expiry_date', v_batch_expiry_date,
              'manufacturing_date', v_batch_manufacturing_date
            )
          );
        END IF;

        v_remaining_to_restore := v_remaining_to_restore - v_restore_quantity;
      END LOOP;

      IF v_remaining_to_restore > 0 THEN
        RAISE EXCEPTION 'Return quantity exceeds stored batch allocations for sale item %', v_item_record.id;
      END IF;
    END IF;

    v_unit_refund_amount := COALESCE(
      v_item_record.converted_unit_price,
      v_item_record.unit_price,
      0
    );
    v_line_refund_amount := v_return_quantity * v_unit_refund_amount;
    v_line_id := COALESCE(
      NULLIF(v_item_payload->>'id', '')::uuid,
      gen_random_uuid()
    );

    INSERT INTO public.sale_return_items (
      id,
      workspace_id,
      return_id,
      sale_id,
      sale_item_id,
      quantity,
      unit_refund_amount,
      refund_amount,
      restored_storage_id,
      restored_batch_allocations,
      created_at,
      updated_at
    )
    VALUES (
      v_line_id,
      v_workspace_id,
      p_return_id,
      p_sale_id,
      v_item_record.id,
      v_return_quantity,
      v_unit_refund_amount,
      v_line_refund_amount,
      v_storage_id,
      CASE
        WHEN jsonb_array_length(v_restored_batch_allocations) > 0
          THEN v_restored_batch_allocations
        ELSE NULL
      END,
      now(),
      timezone('utc', now())
    );

    UPDATE public.sale_items
    SET
      storage_id = CASE
        WHEN storage_id IS NULL OR v_original_storage_missing THEN v_storage_id
        ELSE storage_id
      END,
      original_batch_allocations = COALESCE(
        original_batch_allocations,
        v_item_record.batch_allocations
      ),
      returned_quantity = COALESCE(returned_quantity, 0) + v_return_quantity,
      is_returned = (
        COALESCE(returned_quantity, 0) + v_return_quantity
      ) >= quantity,
      return_reason = COALESCE(NULLIF(BTRIM(p_return_reason), ''), 'Return'),
      returned_at = now(),
      returned_by = auth.uid(),
      batch_allocations = CASE
        WHEN jsonb_array_length(v_remaining_batch_allocations) > 0
          THEN v_remaining_batch_allocations
        ELSE NULL
      END
    WHERE id = v_item_record.id;

    v_total_return_value := v_total_return_value + v_line_refund_amount;
    v_processed_items := v_processed_items + 1;
    v_return_lines := v_return_lines || jsonb_build_array(
      jsonb_build_object(
        'id', v_line_id,
        'sale_item_id', v_item_record.id,
        'quantity', v_return_quantity,
        'unit_refund_amount', v_unit_refund_amount,
        'refund_amount', v_line_refund_amount,
        'restored_storage_id', v_storage_id,
        'restored_batch_allocations', CASE
          WHEN jsonb_array_length(v_restored_batch_allocations) > 0
            THEN v_restored_batch_allocations
          ELSE NULL
        END
      )
    );
  END LOOP;

  IF v_processed_items = 0 THEN
    RAISE EXCEPTION 'No returnable items were processed';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.sale_items
    WHERE sale_id = p_sale_id
      AND COALESCE(returned_quantity, 0) < quantity
  )
  INTO v_sale_fully_returned;

  UPDATE public.sales
  SET
    original_total_amount = COALESCE(original_total_amount, total_amount, 0),
    total_amount = GREATEST(0, COALESCE(total_amount, 0) - v_total_return_value),
    returned_amount = COALESCE(returned_amount, 0) + v_total_return_value,
    return_status = CASE WHEN v_sale_fully_returned THEN 'full' ELSE 'partial' END,
    is_returned = v_sale_fully_returned,
    return_reason = CASE
      WHEN v_sale_fully_returned
        THEN COALESCE(NULLIF(BTRIM(p_return_reason), ''), 'Return')
      ELSE return_reason
    END,
    returned_at = CASE WHEN v_sale_fully_returned THEN now() ELSE returned_at END,
    returned_by = CASE WHEN v_sale_fully_returned THEN auth.uid() ELSE returned_by END,
    updated_at = timezone('utc', now())
  WHERE id = p_sale_id;

  UPDATE public.sale_returns
  SET
    refund_amount = v_total_return_value,
    updated_at = timezone('utc', now())
  WHERE id = p_return_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Items returned successfully',
    'return_id', p_return_id,
    'return_value', v_total_return_value,
    'items', v_return_lines,
    'idempotent_replay', false
  );
END;
$function$;

-- Update return_sale_items function with NUMERIC quantities
CREATE OR REPLACE FUNCTION public.return_sale_items(
  p_sale_item_ids uuid[],
  p_return_quantities numeric[],
  p_return_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item_index integer;
  v_sale_item_id uuid;
  v_return_quantity numeric;
  v_return_id uuid;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  IF array_length(p_sale_item_ids, 1) IS DISTINCT FROM array_length(p_return_quantities, 1) THEN
    RAISE EXCEPTION 'Sale item IDs and return quantities must have the same length';
  END IF;

  v_return_id := gen_random_uuid();
  v_payload := '[]'::jsonb;

  FOR v_item_index IN 1 .. array_length(p_sale_item_ids, 1)
  LOOP
    v_sale_item_id := p_sale_item_ids[v_item_index];
    v_return_quantity := p_return_quantities[v_item_index];

    IF v_return_quantity > 0 THEN
      v_payload := v_payload || jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid(),
          'sale_item_id', v_sale_item_id,
          'quantity', v_return_quantity
        )
      );
    END IF;
  END LOOP;

  v_result := public.process_sale_return(v_return_id, NULL, v_payload, p_return_reason);

  RETURN v_result;
END;
$function$;

-- Update complete_sale function with NUMERIC quantities
CREATE OR REPLACE FUNCTION public.complete_sale(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    new_sale_id UUID;
    v_sequence_id BIGINT;
    item JSONB;
    snapshot JSONB;
    v_batch_record RECORD;
    p_workspace_id UUID;
    total_sale_amount NUMERIC := 0;
    v_pos BOOLEAN;
    v_max_discount_percent INTEGER := 100;
    v_product_id UUID;
    v_storage_id UUID;
    v_quantity NUMERIC;
    v_item_index INTEGER := 0;
    v_sales_exchange JSONB;
    v_original_currency TEXT;
    v_item_settlement_currency TEXT;
    v_original_unit_price NUMERIC;
    v_negotiated_price NUMERIC;
    v_discount_percent NUMERIC;
    v_converted_unit_price NUMERIC;
    v_inventory_snapshot NUMERIC;
    v_items_total NUMERIC := 0;
    v_flags TEXT[] := ARRAY[]::TEXT[];
    v_has_mixed_currency BOOLEAN := false;
    v_has_exchange_snapshot BOOLEAN := false;
    v_system_verified BOOLEAN := true;
    v_system_review_status TEXT := 'approved';
    v_system_review_reason TEXT := NULL;
    v_has_active_batches BOOLEAN := false;
    v_batch_remaining NUMERIC := 0;
    v_allocated_quantity NUMERIC := 0;
    v_batch_allocations JSONB := '[]'::jsonb;
    v_plan TEXT;
BEGIN
    SELECT current_workspace INTO p_workspace_id
    FROM public.profiles
    WHERE id = auth.uid();

    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'User does not belong to a workspace';
    END IF;

    SELECT plan, COALESCE(max_discount_percent, 100)
    INTO v_plan, v_max_discount_percent
    FROM public.workspaces
    WHERE id = p_workspace_id;

    v_pos := public.workspace_module_allowed(p_workspace_id, v_plan, 'pos');

    IF NOT COALESCE(v_pos, false) THEN
        RAISE EXCEPTION 'POS feature is not enabled for this workspace';
    END IF;

    total_sale_amount := COALESCE((payload->>'total_amount')::NUMERIC, 0);
    v_sales_exchange := CASE
        WHEN jsonb_typeof(payload->'sales_exchange') = 'array'
            THEN payload->'sales_exchange'
        ELSE '[]'::jsonb
    END;

    FOR snapshot IN SELECT * FROM jsonb_array_elements(v_sales_exchange)
    LOOP
        IF lower(COALESCE(snapshot->>'base_currency', '')) IN ('usd', 'eur', 'iqd', 'try')
            AND lower(COALESCE(snapshot->>'quote_currency', '')) IN ('usd', 'eur', 'iqd', 'try')
            AND lower(snapshot->>'base_currency') <> lower(snapshot->>'quote_currency')
            AND COALESCE((snapshot->>'base_amount')::NUMERIC, 0) > 0
            AND COALESCE((snapshot->>'quote_amount')::NUMERIC, 0) > 0
            AND NULLIF(snapshot->>'source', '') IS NOT NULL
            AND NULLIF(snapshot->>'captured_at', '') IS NOT NULL
            AND COALESCE(NULLIF(snapshot->>'rate_side', ''), 'mid')
                IN ('buy', 'sell', 'mid')
        THEN
            v_has_exchange_snapshot := true;
        ELSE
            RAISE EXCEPTION 'Invalid sales exchange snapshot';
        END IF;
    END LOOP;

    FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
    LOOP
        v_item_index := v_item_index + 1;
        v_quantity := COALESCE((item->>'quantity')::NUMERIC, 0);
        v_converted_unit_price := COALESCE((item->>'converted_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC, 0);
        v_items_total := v_items_total + (v_converted_unit_price * v_quantity);

        IF v_quantity <= 0 THEN
            v_flags := array_append(v_flags, format('Item %s: Invalid quantity (%s)', v_item_index, v_quantity));
        END IF;

        IF item->>'negotiated_price' IS NOT NULL THEN
            v_negotiated_price := (item->>'negotiated_price')::NUMERIC;

            IF v_negotiated_price < 0 THEN
                v_flags := array_append(v_flags, format('Item %s: Negative negotiated price', v_item_index));
            ELSE
                v_original_unit_price := COALESCE((item->>'original_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC, 0);

                IF v_original_unit_price > 0 THEN
                    v_discount_percent := ((v_original_unit_price - v_negotiated_price) / v_original_unit_price) * 100;
                    IF v_discount_percent > v_max_discount_percent THEN
                        v_flags := array_append(
                            v_flags,
                            format(
                                'Item %s: Discount %s%% exceeds limit of %s%%',
                                v_item_index,
                                trim(to_char(v_discount_percent, 'FM999999990.0')),
                                v_max_discount_percent
                            )
                        );
                    END IF;
                END IF;
            END IF;
        END IF;

        v_original_currency := COALESCE(item->>'original_currency', 'usd');
        v_item_settlement_currency := COALESCE(item->>'settlement_currency', COALESCE(payload->>'settlement_currency', 'usd'));
        IF v_original_currency IS DISTINCT FROM v_item_settlement_currency THEN
            v_has_mixed_currency := true;
        END IF;

        v_inventory_snapshot := COALESCE((item->>'inventory_snapshot')::NUMERIC, 0);
        IF v_quantity > v_inventory_snapshot THEN
            v_flags := array_append(
                v_flags,
                format(
                    'Item %s: Quantity %s exceeds inventory snapshot %s',
                    v_item_index,
                    v_quantity,
                    v_inventory_snapshot
                )
            );
        END IF;
    END LOOP;

    IF ABS(v_items_total - total_sale_amount) > 0.01 THEN
        v_flags := array_append(
            v_flags,
            format(
                'Total mismatch: items sum to %s, sale total is %s',
                trim(to_char(v_items_total, 'FM999999990.00')),
                trim(to_char(total_sale_amount, 'FM999999990.00'))
            )
        );
    END IF;

    IF v_has_mixed_currency THEN
        IF NOT v_has_exchange_snapshot THEN
            v_flags := array_append(v_flags, 'Missing exchange rate for multi-currency sale');
        END IF;
    END IF;

    IF COALESCE(array_length(v_flags, 1), 0) > 0 THEN
        v_system_verified := false;
        v_system_review_status := 'flagged';
        v_system_review_reason := array_to_string(v_flags, '; ');
    END IF;

    INSERT INTO public.sales (
        id,
        workspace_id,
        cashier_id,
        total_amount,
        original_total_amount,
        currency,
        settlement_currency,
        origin,
        payment_method,
        system_verified,
        system_review_status,
        system_review_reason,
        notes
    )
    VALUES (
        COALESCE((payload->>'id')::UUID, gen_random_uuid()),
        p_workspace_id,
        auth.uid(),
        total_sale_amount,
        total_sale_amount,
        lower(COALESCE(payload->>'settlement_currency', payload->>'currency', 'usd')),
        lower(COALESCE(payload->>'settlement_currency', payload->>'currency', 'usd')),
        COALESCE(payload->>'origin', 'pos'),
        COALESCE(payload->>'payment_method', 'cash'),
        v_system_verified,
        v_system_review_status,
        v_system_review_reason,
        payload->>'notes'
    )
    RETURNING id, sequence_id INTO new_sale_id, v_sequence_id;

    FOR snapshot IN SELECT * FROM jsonb_array_elements(v_sales_exchange)
    LOOP
        INSERT INTO public.sales_exchange (
            sale_id,
            workspace_id,
            base_currency,
            quote_currency,
            base_amount,
            quote_amount,
            source,
            captured_at,
            rate_side,
            source_price_id,
            source_price_updated_at
        )
        VALUES (
            new_sale_id,
            p_workspace_id,
            lower(snapshot->>'base_currency'),
            lower(snapshot->>'quote_currency'),
            (snapshot->>'base_amount')::NUMERIC,
            (snapshot->>'quote_amount')::NUMERIC,
            snapshot->>'source',
            (snapshot->>'captured_at')::TIMESTAMPTZ,
            COALESCE(NULLIF(snapshot->>'rate_side', ''), 'mid'),
            NULLIF(snapshot->>'source_price_id', '')::UUID,
            NULLIF(snapshot->>'source_price_updated_at', '')::TIMESTAMPTZ
        );
    END LOOP;

    FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
    LOOP
        v_product_id := (item->>'product_id')::UUID;
        v_quantity := COALESCE((item->>'quantity')::NUMERIC, 0);
        v_storage_id := NULLIF(item->>'storage_id', '')::UUID;
        v_has_active_batches := false;
        v_batch_remaining := v_quantity;
        v_batch_allocations := '[]'::jsonb;

        IF v_product_id IS NULL OR v_quantity <= 0 THEN
            RAISE EXCEPTION 'Invalid sale item payload';
        END IF;

        IF v_storage_id IS NULL THEN
            SELECT CASE WHEN COUNT(*) = 1 THEN MIN(storage_id::text)::uuid ELSE NULL END
            INTO v_storage_id
            FROM public.inventory
            WHERE workspace_id = p_workspace_id
              AND product_id = v_product_id
              AND COALESCE(is_deleted, false) = false;
        END IF;

        IF v_storage_id IS NULL THEN
            SELECT storage_id
            INTO v_storage_id
            FROM public.products
            WHERE id = v_product_id
              AND workspace_id = p_workspace_id;
        END IF;

        IF v_storage_id IS NULL THEN
            RAISE EXCEPTION 'Storage not found for product %', v_product_id;
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM public.stock_batches
            WHERE workspace_id = p_workspace_id
              AND product_id = v_product_id
              AND storage_id = v_storage_id
              AND COALESCE(is_deleted, false) = false
        )
        INTO v_has_active_batches;

        IF v_has_active_batches THEN
            FOR v_batch_record IN
                SELECT *
                FROM public.stock_batches
                WHERE workspace_id = p_workspace_id
                  AND product_id = v_product_id
                  AND storage_id = v_storage_id
                  AND COALESCE(is_deleted, false) = false
                ORDER BY expiry_date ASC NULLS LAST, manufacturing_date ASC NULLS LAST, created_at ASC, batch_number ASC
                FOR UPDATE
            LOOP
                EXIT WHEN v_batch_remaining <= 0;

                v_allocated_quantity := LEAST(v_batch_remaining, COALESCE(v_batch_record.quantity, 0));
                IF v_allocated_quantity <= 0 THEN
                    CONTINUE;
                END IF;

                UPDATE public.stock_batches
                SET
                    quantity = v_batch_record.quantity - v_allocated_quantity,
                    updated_at = NOW(),
                    version = COALESCE(version, 0) + 1,
                    is_deleted = (v_batch_record.quantity - v_allocated_quantity) <= 0
                WHERE id = v_batch_record.id;

                v_batch_allocations := v_batch_allocations || jsonb_build_array(
                    jsonb_build_object(
                        'batch_id', v_batch_record.id,
                        'batch_number', v_batch_record.batch_number,
                        'quantity', v_allocated_quantity,
                        'price', v_batch_record.price,
                        'cost_price', v_batch_record.cost_price,
                        'currency', lower(v_batch_record.currency),
                        'expiry_date', v_batch_record.expiry_date,
                        'manufacturing_date', v_batch_record.manufacturing_date
                    )
                );
                v_batch_remaining := v_batch_remaining - v_allocated_quantity;
            END LOOP;

        END IF;

        INSERT INTO public.sale_items (
            sale_id,
            product_id,
            storage_id,
            quantity,
            unit_price,
            total_price,
            cost_price,
            converted_cost_price,
            original_currency,
            original_unit_price,
            converted_unit_price,
            settlement_currency,
            negotiated_price,
            inventory_snapshot,
            batch_allocations,
            original_batch_allocations
        )
        VALUES (
            new_sale_id,
            v_product_id,
            v_storage_id,
            v_quantity,
            (item->>'unit_price')::NUMERIC,
            (item->>'total_price')::NUMERIC,
            COALESCE((item->>'cost_price')::NUMERIC, 0),
            COALESCE((item->>'converted_cost_price')::NUMERIC, 0),
            COALESCE(item->>'original_currency', 'usd'),
            COALESCE((item->>'original_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE((item->>'converted_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE(item->>'settlement_currency', 'usd'),
            (item->>'negotiated_price')::NUMERIC,
            COALESCE((item->>'inventory_snapshot')::NUMERIC, 0),
            CASE
                WHEN v_has_active_batches AND jsonb_array_length(v_batch_allocations) > 0 THEN v_batch_allocations
                ELSE NULL
            END,
            CASE
                WHEN v_has_active_batches AND jsonb_array_length(v_batch_allocations) > 0 THEN v_batch_allocations
                ELSE NULL
            END
        );

        UPDATE public.inventory
        SET
            quantity = quantity - v_quantity,
            updated_at = NOW(),
            version = COALESCE(version, 0) + 1,
            is_deleted = (quantity - v_quantity) <= 0
        WHERE workspace_id = p_workspace_id
          AND product_id = v_product_id
          AND storage_id = v_storage_id
          AND COALESCE(is_deleted, false) = false
          AND quantity >= v_quantity;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Insufficient inventory for product % in storage %', v_product_id, v_storage_id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', new_sale_id,
        'sequence_id', v_sequence_id,
        'system_verified', v_system_verified,
        'system_review_status', v_system_review_status,
        'system_review_reason', v_system_review_reason
    );
END;
$function$;
