ALTER TABLE public.stock_batches
  ADD COLUMN IF NOT EXISTS source_purchase_order_id uuid NULL,
  ADD COLUMN IF NOT EXISTS source_purchase_order_item_id text NULL;

CREATE INDEX IF NOT EXISTS idx_stock_batches_purchase_order
  ON public.stock_batches (source_purchase_order_id)
  WHERE source_purchase_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_batches_purchase_order_item
  ON public.stock_batches (source_purchase_order_id, source_purchase_order_item_id)
  WHERE source_purchase_order_id IS NOT NULL
    AND source_purchase_order_item_id IS NOT NULL;

DO $$
DECLARE
  v_definition text;
  v_updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.complete_sale(jsonb)'::regprocedure)
  INTO v_definition;

  v_updated_definition := regexp_replace(
    v_definition,
    'IF v_batch_remaining > 0 THEN\s+RAISE EXCEPTION ''Insufficient batched inventory for product % in storage %'', v_product_id, v_storage_id;\s+END IF;',
    '',
    'g'
  );

  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'Could not update complete_sale for mixed batched and unbatched inventory';
  END IF;

  EXECUTE v_updated_definition;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sale_item_batch_cost()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_allocation_count integer := 0;
  v_cost_count integer := 0;
  v_allocated_quantity numeric := 0;
  v_total_cost numeric := 0;
  v_distinct_currency_count integer := 0;
  v_allocation_currency text := NULL;
  v_previous_cost numeric := 0;
  v_conversion_factor numeric := 1;
BEGIN
  IF jsonb_typeof(NEW.batch_allocations) <> 'array'
    OR jsonb_array_length(NEW.batch_allocations) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE allocation->>'cost_price' IS NOT NULL),
    COALESCE(SUM((allocation->>'quantity')::numeric), 0),
    COALESCE(SUM(
      (allocation->>'quantity')::numeric
      * (allocation->>'cost_price')::numeric
    ) FILTER (WHERE allocation->>'cost_price' IS NOT NULL), 0),
    COUNT(DISTINCT lower(NULLIF(allocation->>'currency', ''))),
    MIN(lower(NULLIF(allocation->>'currency', '')))
  INTO
    v_allocation_count,
    v_cost_count,
    v_allocated_quantity,
    v_total_cost,
    v_distinct_currency_count,
    v_allocation_currency
  FROM jsonb_array_elements(NEW.batch_allocations) AS allocation
  WHERE COALESCE((allocation->>'quantity')::numeric, 0) > 0;

  IF v_allocation_count = 0
    OR v_cost_count <> v_allocation_count
    OR v_allocated_quantity <= 0
    OR v_allocated_quantity <> NEW.quantity
    OR v_distinct_currency_count > 1
    OR (
      v_allocation_currency IS NOT NULL
      AND v_allocation_currency <> lower(COALESCE(NEW.original_currency, v_allocation_currency))
    ) THEN
    RETURN NEW;
  END IF;

  v_previous_cost := COALESCE(NEW.cost_price, 0);
  IF v_previous_cost > 0 THEN
    v_conversion_factor := COALESCE(NEW.converted_cost_price, v_previous_cost) / v_previous_cost;
  ELSIF lower(COALESCE(NEW.original_currency, '')) = lower(COALESCE(NEW.settlement_currency, '')) THEN
    v_conversion_factor := 1;
  ELSE
    RETURN NEW;
  END IF;

  NEW.cost_price := v_total_cost / v_allocated_quantity;
  NEW.converted_cost_price := NEW.cost_price * v_conversion_factor;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sale_items_apply_batch_cost ON public.sale_items;

CREATE TRIGGER sale_items_apply_batch_cost
BEFORE INSERT OR UPDATE OF batch_allocations
ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.apply_sale_item_batch_cost();

CREATE OR REPLACE FUNCTION public.get_net_revenue(
  p_workspace_id uuid DEFAULT NULL::uuid,
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS TABLE(
  total_revenue numeric,
  total_cost numeric,
  net_profit numeric,
  total_sales_count bigint,
  total_items_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF p_workspace_id IS NULL THEN
    SELECT workspace_id
    INTO p_workspace_id
    FROM public.profiles
    WHERE id = auth.uid();
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM((si.quantity - si.returned_quantity) * COALESCE(si.converted_unit_price, si.unit_price)), 0),
    COALESCE(SUM((si.quantity - si.returned_quantity) * COALESCE(si.converted_cost_price, si.cost_price)), 0),
    COALESCE(SUM(
      ((si.quantity - si.returned_quantity) * COALESCE(si.converted_unit_price, si.unit_price))
      - ((si.quantity - si.returned_quantity) * COALESCE(si.converted_cost_price, si.cost_price))
    ), 0),
    COUNT(DISTINCT s.id),
    SUM(si.quantity - si.returned_quantity)
  FROM public.sales AS s
  INNER JOIN public.sale_items AS si ON s.id = si.sale_id
  WHERE s.workspace_id = p_workspace_id
    AND COALESCE(s.is_returned, false) = false
    AND (p_start_date IS NULL OR s.created_at >= p_start_date)
    AND (p_end_date IS NULL OR s.created_at <= p_end_date);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_summary(
  p_workspace_id uuid DEFAULT NULL::uuid,
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF p_workspace_id IS NULL THEN
    SELECT workspace_id
    INTO p_workspace_id
    FROM public.profiles
    WHERE id = auth.uid();
  END IF;

  SELECT jsonb_build_object(
    'totalRevenue', COALESCE(SUM(CASE WHEN COALESCE(s.is_returned, false) = false THEN (si.quantity - si.returned_quantity) * COALESCE(si.converted_unit_price, si.unit_price) ELSE 0 END), 0),
    'totalCost', COALESCE(SUM(CASE WHEN COALESCE(s.is_returned, false) = false THEN (si.quantity - si.returned_quantity) * COALESCE(si.converted_cost_price, si.cost_price) ELSE 0 END), 0),
    'netProfit', COALESCE(SUM(CASE WHEN COALESCE(s.is_returned, false) = false THEN ((si.quantity - si.returned_quantity) * COALESCE(si.converted_unit_price, si.unit_price)) - ((si.quantity - si.returned_quantity) * COALESCE(si.converted_cost_price, si.cost_price)) ELSE 0 END), 0),
    'totalSales', COUNT(DISTINCT CASE WHEN COALESCE(s.is_returned, false) = false THEN s.id END),
    'totalItems', SUM(CASE WHEN COALESCE(s.is_returned, false) = false THEN si.quantity - si.returned_quantity ELSE 0 END),
    'averageSaleValue', COALESCE(AVG(CASE WHEN COALESCE(s.is_returned, false) = false THEN s.total_amount END), 0),
    'returnedSales', COUNT(DISTINCT CASE WHEN s.is_returned = true THEN s.id END),
    'returnedItems', SUM(si.returned_quantity)
  )
  INTO result
  FROM public.sales AS s
  INNER JOIN public.sale_items AS si ON s.id = si.sale_id
  WHERE s.workspace_id = p_workspace_id
    AND (p_start_date IS NULL OR s.created_at >= p_start_date)
    AND (p_end_date IS NULL OR s.created_at <= p_end_date);

  RETURN result;
END;
$function$;
