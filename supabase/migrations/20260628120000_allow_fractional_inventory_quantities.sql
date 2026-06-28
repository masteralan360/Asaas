-- Forward-only widening migration for fractional stock quantities.
-- Existing whole-number data is preserved exactly by integer -> numeric casts.

ALTER TABLE public.sale_items
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric,
  ALTER COLUMN returned_quantity TYPE numeric USING returned_quantity::numeric,
  ALTER COLUMN inventory_snapshot TYPE numeric USING inventory_snapshot::numeric;

ALTER TABLE public.sale_return_items
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

ALTER TABLE public.inventory
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

ALTER TABLE public.products
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric,
  ALTER COLUMN min_stock_level TYPE numeric USING min_stock_level::numeric;

ALTER TABLE public.stock_batches
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

ALTER TABLE public.inventory_transactions
  ALTER COLUMN quantity_delta TYPE numeric USING quantity_delta::numeric,
  ALTER COLUMN previous_quantity TYPE numeric USING previous_quantity::numeric,
  ALTER COLUMN new_quantity TYPE numeric USING new_quantity::numeric;

ALTER TABLE public.inventory_transfer_transactions
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

ALTER TABLE public.reorder_transfer_rules
  ALTER COLUMN min_stock_level TYPE numeric USING min_stock_level::numeric,
  ALTER COLUMN transfer_quantity TYPE numeric USING transfer_quantity::numeric;

DO $$
BEGIN
  IF to_regclass('public.stock_adjustments') IS NOT NULL THEN
    ALTER TABLE public.stock_adjustments
      ALTER COLUMN quantity TYPE numeric USING quantity::numeric,
      ALTER COLUMN previous_quantity TYPE numeric USING previous_quantity::numeric,
      ALTER COLUMN new_quantity TYPE numeric USING new_quantity::numeric;
  END IF;
END $$;

DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef('public.complete_sale(jsonb)'::regprocedure)
    INTO function_sql;

  function_sql := replace(function_sql, 'v_quantity INTEGER;', 'v_quantity NUMERIC;');
  function_sql := replace(function_sql, 'v_quantity integer;', 'v_quantity numeric;');
  function_sql := replace(function_sql, 'v_inventory_snapshot INTEGER;', 'v_inventory_snapshot NUMERIC;');
  function_sql := replace(function_sql, 'v_inventory_snapshot integer;', 'v_inventory_snapshot numeric;');
  function_sql := replace(function_sql, 'v_batch_remaining INTEGER := 0;', 'v_batch_remaining NUMERIC := 0;');
  function_sql := replace(function_sql, 'v_batch_remaining integer := 0;', 'v_batch_remaining numeric := 0;');
  function_sql := replace(function_sql, 'v_allocated_quantity INTEGER := 0;', 'v_allocated_quantity NUMERIC := 0;');
  function_sql := replace(function_sql, 'v_allocated_quantity integer := 0;', 'v_allocated_quantity numeric := 0;');
  function_sql := replace(function_sql, '(item->>''quantity'')::INTEGER', '(item->>''quantity'')::NUMERIC');
  function_sql := replace(function_sql, '(item->>''quantity'')::integer', '(item->>''quantity'')::numeric');
  function_sql := replace(function_sql, '(item->>''inventory_snapshot'')::INTEGER', '(item->>''inventory_snapshot'')::NUMERIC');
  function_sql := replace(function_sql, '(item->>''inventory_snapshot'')::integer', '(item->>''inventory_snapshot'')::numeric');

  EXECUTE function_sql;
END $$;

DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef('public.process_sale_return(uuid, uuid, jsonb, text, text)'::regprocedure)
    INTO function_sql;

  function_sql := replace(function_sql, 'v_requested_quantity integer;', 'v_requested_quantity numeric;');
  function_sql := replace(function_sql, 'v_return_quantity integer;', 'v_return_quantity numeric;');
  function_sql := replace(function_sql, 'v_batch_quantity integer := 0;', 'v_batch_quantity numeric := 0;');
  function_sql := replace(function_sql, 'v_restore_quantity integer := 0;', 'v_restore_quantity numeric := 0;');
  function_sql := replace(function_sql, 'v_leftover_batch_quantity integer := 0;', 'v_leftover_batch_quantity numeric := 0;');
  function_sql := replace(function_sql, '(v_item_payload->>''quantity'')::integer', '(v_item_payload->>''quantity'')::numeric');
  function_sql := replace(function_sql, '(v_batch_allocation->>''quantity'')::integer', '(v_batch_allocation->>''quantity'')::numeric');

  EXECUTE function_sql;
END $$;

DROP FUNCTION IF EXISTS public.return_sale_items(uuid[], integer[], text);
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
  v_sale_id uuid;
  v_items jsonb;
BEGIN
  IF p_sale_item_ids IS NULL
     OR array_length(p_sale_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No items selected for return';
  END IF;

  IF p_return_quantities IS NULL
     OR array_length(p_return_quantities, 1)
        IS DISTINCT FROM array_length(p_sale_item_ids, 1) THEN
    RAISE EXCEPTION 'Return quantities must match selected sale items';
  END IF;

  SELECT sale_id
  INTO v_sale_id
  FROM public.sale_items
  WHERE id = p_sale_item_ids[1];

  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale items not found';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', gen_random_uuid(),
      'sale_item_id', item_id,
      'quantity', return_quantity
    )
  )
  INTO v_items
  FROM unnest(p_sale_item_ids, p_return_quantities)
    AS requested_items(item_id, return_quantity);

  RETURN public.process_sale_return(
    gen_random_uuid(),
    v_sale_id,
    v_items,
    p_return_reason,
    NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_product_inventory_snapshot(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_total_quantity numeric := 0;
    v_storage_count integer := 0;
    v_single_storage_id uuid := null;
BEGIN
    SELECT
        COALESCE(SUM(quantity), 0)::numeric,
        COUNT(*)::integer,
        CASE WHEN COUNT(*) = 1 THEN MIN(storage_id::text)::uuid ELSE NULL END
    INTO v_total_quantity, v_storage_count, v_single_storage_id
    FROM public.inventory
    WHERE product_id = p_product_id
      AND COALESCE(is_deleted, false) = false;

    UPDATE public.products
    SET
        quantity = v_total_quantity,
        storage_id = CASE WHEN v_storage_count = 1 THEN v_single_storage_id ELSE NULL END,
        updated_at = timezone('utc', now()),
        version = COALESCE(version, 0) + 1
    WHERE id = p_product_id
      AND (
        quantity IS DISTINCT FROM v_total_quantity
        OR storage_id IS DISTINCT FROM CASE WHEN v_storage_count = 1 THEN v_single_storage_id ELSE NULL END
      );
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_marketplace_pending_order_notifications(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, notifications
AS $function$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_due_date date;
  v_item_count numeric := 0;
BEGIN
  SELECT *
  INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_order_id
    AND status = 'pending'
    AND COALESCE(is_deleted, false) = false;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_due_date := timezone('utc', v_order.created_at)::date;

  SELECT COALESCE(SUM(GREATEST(COALESCE((item.value ->> 'quantity')::numeric, 1), 1)), 0)
  INTO v_item_count
  FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) AS item(value);

  PERFORM public.upsert_notification_event(
    v_order.workspace_id,
    p.id,
    'marketplace_order_pending',
    v_order.id::text,
    v_due_date,
    jsonb_build_object(
      'entity_type', 'marketplace_order_pending',
      'title', format('Pending marketplace order %s', v_order.order_number),
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'customer_name', v_order.customer_name,
      'customer_phone', v_order.customer_phone,
      'customer_city', v_order.customer_city,
      'amount', v_order.total,
      'currency', COALESCE(NULLIF(v_order.currency, ''), 'iqd'),
      'created_at', v_order.created_at,
      'due_date', v_due_date,
      'item_count', v_item_count
    )
  )
  FROM public.profiles p
  WHERE p.workspace_id = v_order.workspace_id
    AND LOWER(BTRIM(COALESCE(p.role, ''))) IN ('admin', 'staff');
END;
$function$;

DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef('public.dispatch_notification_events()'::regprocedure)
    INTO function_sql;

  function_sql := replace(function_sql, 'v_item_count integer;', 'v_item_count numeric;');
  function_sql := replace(function_sql, 'v_item_count INTEGER;', 'v_item_count NUMERIC;');
  function_sql := replace(
    function_sql,
    'WHEN COALESCE(v_payload ->> ''item_count'', '''') ~ ''^-?\d+$'' THEN (v_payload ->> ''item_count'')::integer',
    'WHEN COALESCE(v_payload ->> ''item_count'', '''') ~ ''^-?\d+(\.\d+)?$'' THEN (v_payload ->> ''item_count'')::numeric'
  );
  function_sql := replace(
    function_sql,
    'WHEN COALESCE(v_payload ->> ''item_count'', '''') ~ ''^-?\d+$'' THEN (v_payload ->> ''item_count'')::INTEGER',
    'WHEN COALESCE(v_payload ->> ''item_count'', '''') ~ ''^-?\d+(\.\d+)?$'' THEN (v_payload ->> ''item_count'')::NUMERIC'
  );

  EXECUTE function_sql;
END $$;

DROP FUNCTION IF EXISTS public.get_top_products(uuid, timestamp with time zone, timestamp with time zone, integer);
CREATE OR REPLACE FUNCTION public.get_top_products(
  p_workspace_id uuid DEFAULT NULL::uuid,
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(product_id uuid, product_name text, product_sku text, total_quantity_sold numeric, total_revenue numeric, total_sales_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    IF p_workspace_id IS NULL THEN
        SELECT current_workspace INTO p_workspace_id FROM public.profiles WHERE id = auth.uid();
    END IF;

    RETURN QUERY
    SELECT
        pr.id as product_id,
        pr.name as product_name,
        pr.sku as product_sku,
        COALESCE(SUM(si.quantity - COALESCE(si.returned_quantity, 0)), 0) as total_quantity_sold,
        COALESCE(SUM((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_unit_price, si.unit_price)), 0) as total_revenue,
        COUNT(DISTINCT si.sale_id) as total_sales_count
    FROM public.sale_items si
    INNER JOIN public.sales s ON si.sale_id = s.id
    INNER JOIN public.products pr ON si.product_id = pr.id
    WHERE s.workspace_id = p_workspace_id
      AND COALESCE(s.is_returned, FALSE) = FALSE
      AND (p_start_date IS NULL OR s.created_at >= p_start_date)
      AND (p_end_date IS NULL OR s.created_at <= p_end_date)
    GROUP BY pr.id, pr.name, pr.sku
    ORDER BY total_quantity_sold DESC
    LIMIT p_limit;
END;
$function$;

DROP FUNCTION IF EXISTS public.get_team_performance(uuid, timestamp with time zone, timestamp with time zone);
CREATE OR REPLACE FUNCTION public.get_team_performance(
  p_workspace_id uuid DEFAULT NULL::uuid,
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS TABLE(cashier_id uuid, cashier_name text, total_sales_count bigint, total_revenue numeric, total_items_count numeric, average_sale_value numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    IF p_workspace_id IS NULL THEN
        SELECT current_workspace INTO p_workspace_id FROM public.profiles WHERE id = auth.uid();
    END IF;

    RETURN QUERY
    SELECT
        s.cashier_id,
        COALESCE(p.name, 'Unknown') as cashier_name,
        COUNT(DISTINCT s.id) as total_sales_count,
        COALESCE(SUM((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_unit_price, si.unit_price)), 0) as total_revenue,
        COALESCE(SUM(si.quantity - COALESCE(si.returned_quantity, 0)), 0) as total_items_count,
        COALESCE(AVG(s.total_amount), 0) as average_sale_value
    FROM public.sales s
    INNER JOIN public.sale_items si ON s.id = si.sale_id
    LEFT JOIN public.profiles p ON s.cashier_id = p.id
    WHERE s.workspace_id = p_workspace_id
      AND COALESCE(s.is_returned, FALSE) = FALSE
      AND (p_start_date IS NULL OR s.created_at >= p_start_date)
      AND (p_end_date IS NULL OR s.created_at <= p_end_date)
    GROUP BY s.cashier_id, p.name
    ORDER BY total_revenue DESC;
END;
$function$;

DROP FUNCTION IF EXISTS public.get_net_revenue(uuid, timestamp with time zone, timestamp with time zone);
CREATE OR REPLACE FUNCTION public.get_net_revenue(
  p_workspace_id uuid DEFAULT NULL::uuid,
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS TABLE(total_revenue numeric, total_cost numeric, net_profit numeric, total_sales_count bigint, total_items_count numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    IF p_workspace_id IS NULL THEN
        SELECT current_workspace INTO p_workspace_id FROM public.profiles WHERE id = auth.uid();
    END IF;

    RETURN QUERY
    SELECT
        COALESCE(SUM((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_unit_price, si.unit_price)), 0) as total_revenue,
        COALESCE(SUM((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_cost_price, si.cost_price)), 0) as total_cost,
        COALESCE(SUM(((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_unit_price, si.unit_price)) - ((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_cost_price, si.cost_price))), 0) as net_profit,
        COUNT(DISTINCT s.id) as total_sales_count,
        COALESCE(SUM(si.quantity - COALESCE(si.returned_quantity, 0)), 0) as total_items_count
    FROM public.sales s
    INNER JOIN public.sale_items si ON s.id = si.sale_id
    WHERE s.workspace_id = p_workspace_id
      AND COALESCE(s.is_returned, FALSE) = FALSE
      AND (p_start_date IS NULL OR s.created_at >= p_start_date)
      AND (p_end_date IS NULL OR s.created_at <= p_end_date);
END;
$function$;
