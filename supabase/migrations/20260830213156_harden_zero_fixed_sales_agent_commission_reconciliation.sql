-- A fixed commission of zero is a valid no-payout plan. It must not require
-- an exchange-rate path, and reconciliation must never write NULL snapshots
-- when it converges a historical commission entry.
CREATE OR REPLACE FUNCTION private.convert_sales_agent_commission_amount(
  p_amount numeric,
  p_from_currency text,
  p_to_currency text,
  p_exchange_rates jsonb
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  WITH RECURSIVE raw_rates AS (
    SELECT
      lower(split_part(rate.item->>'pair', '/', 1)) AS from_currency,
      lower(split_part(rate.item->>'pair', '/', 2)) AS to_currency,
      CASE
        WHEN COALESCE(rate.item->>'rate', '') ~ '^[0-9]+([.][0-9]+)?$'
          AND COALESCE(rate.item->>'priceBasisAmount', rate.item->>'price_basis_amount', '100') ~ '^[0-9]+([.][0-9]+)?$'
          AND (rate.item->>'rate')::numeric > 0
          AND COALESCE(rate.item->>'priceBasisAmount', rate.item->>'price_basis_amount', '100')::numeric > 0
        THEN (rate.item->>'rate')::numeric
          / COALESCE(rate.item->>'priceBasisAmount', rate.item->>'price_basis_amount', '100')::numeric
        ELSE NULL
      END AS factor
    FROM jsonb_array_elements(COALESCE(p_exchange_rates, '[]'::jsonb)) AS rate(item)
    WHERE jsonb_typeof(rate.item) = 'object'
  ), edges AS (
    SELECT from_currency, to_currency, factor
    FROM raw_rates
    WHERE from_currency IN ('usd', 'eur', 'iqd', 'try')
      AND to_currency IN ('usd', 'eur', 'iqd', 'try')
      AND factor IS NOT NULL
    UNION ALL
    SELECT to_currency, from_currency, 1 / factor
    FROM raw_rates
    WHERE from_currency IN ('usd', 'eur', 'iqd', 'try')
      AND to_currency IN ('usd', 'eur', 'iqd', 'try')
      AND factor IS NOT NULL
  ), paths(currency, factor, visited) AS (
    SELECT lower(p_from_currency), 1::numeric, ARRAY[lower(p_from_currency)]::text[]
    UNION ALL
    SELECT edge.to_currency, path.factor * edge.factor, path.visited || edge.to_currency
    FROM paths AS path
    JOIN edges AS edge ON edge.from_currency = path.currency
    WHERE NOT edge.to_currency = ANY(path.visited)
      AND cardinality(path.visited) < 4
  )
  SELECT CASE
    WHEN p_amount = 0
      AND lower(p_from_currency) IN ('usd', 'eur', 'iqd', 'try')
      AND lower(p_to_currency) IN ('usd', 'eur', 'iqd', 'try')
      THEN 0
    ELSE (
      SELECT round(p_amount * paths.factor, 6)
      FROM paths
      WHERE paths.currency = lower(p_to_currency)
      ORDER BY cardinality(paths.visited)
      LIMIT 1
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION private.calculate_sales_agent_commission_plan_target(
  p_workspace_id uuid,
  p_order_id uuid,
  p_assignment_id uuid,
  p_plan_id uuid,
  p_calculation_basis text,
  p_include_tax boolean,
  p_include_delivery_charge boolean,
  p_rate_percent numeric
)
RETURNS TABLE(
  currency text,
  revenue_amount numeric,
  cost_amount numeric,
  tax_amount numeric,
  delivery_charge_amount numeric,
  basis_amount numeric,
  commission_amount numeric,
  eligible boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_plan crm.agent_commission_plans%ROWTYPE;
  v_calculation record;
  v_exchange_rates jsonb;
  v_fixed_commission numeric;
BEGIN
  SELECT *
  INTO v_plan
  FROM crm.agent_commission_plans AS plan
  WHERE plan.id = p_plan_id
    AND plan.workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_calculation
  FROM private.calculate_sales_agent_commission_order_target(
    p_workspace_id,
    p_order_id,
    p_assignment_id,
    p_calculation_basis,
    p_include_tax,
    p_include_delivery_charge,
    p_rate_percent
  );
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_plan.commission_type = 'fixed_amount'
    AND COALESCE(v_calculation.eligible, false)
  THEN
    -- Zero remains zero in every currency. Avoid requiring a conversion path
    -- that has no effect on the value and could otherwise leave the target
    -- calculation incomplete.
    IF COALESCE(v_plan.fixed_amount, 0) = 0 THEN
      v_fixed_commission := 0;
    ELSIF lower(v_plan.fixed_currency) = lower(v_calculation.currency) THEN
      v_fixed_commission := v_plan.fixed_amount;
    ELSE
      SELECT sales_order.exchange_rates
      INTO v_exchange_rates
      FROM crm.sales_orders AS sales_order
      WHERE sales_order.id = p_order_id
        AND sales_order.workspace_id = p_workspace_id;
      v_fixed_commission := private.convert_sales_agent_commission_amount(
        v_plan.fixed_amount,
        v_plan.fixed_currency,
        v_calculation.currency,
        v_exchange_rates
      );
    END IF;

    IF v_fixed_commission IS NULL THEN
      RAISE EXCEPTION 'Exchange rate unavailable for the commission plan currency on this sales order'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_calculation.currency,
    COALESCE(v_calculation.revenue_amount, 0),
    COALESCE(v_calculation.cost_amount, 0),
    COALESCE(v_calculation.tax_amount, 0),
    COALESCE(v_calculation.delivery_charge_amount, 0),
    COALESCE(v_calculation.basis_amount, 0),
    round(CASE
      WHEN COALESCE(v_calculation.eligible, false)
        AND v_plan.commission_type = 'fixed_amount'
        THEN COALESCE(v_fixed_commission, 0)
      ELSE COALESCE(v_calculation.commission_amount, 0)
    END, 6),
    COALESCE(v_calculation.eligible, false);
END;
$function$;

-- Reconciliation creates the immutable ledger entries. Older target routines
-- could return an empty snapshot during a state transition; normalize every
-- numeric snapshot at the final write boundary so valid zero commissions do
-- not fail on a NOT NULL constraint.
DO $block$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_sales_agent_commission_core(uuid, uuid)'::regprocedure)
  INTO v_definition;

  IF position('COALESCE(v_calculation.basis_amount, 0)' IN v_definition) = 0 THEN
    v_definition := replace(
      v_definition,
      'v_calculation.basis_amount,',
      'COALESCE(v_calculation.basis_amount, 0),'
    );
    v_definition := replace(
      v_definition,
      'v_calculation.revenue_amount,',
      'COALESCE(v_calculation.revenue_amount, 0),'
    );
    v_definition := replace(
      v_definition,
      'v_calculation.cost_amount,',
      'COALESCE(v_calculation.cost_amount, 0),'
    );
    v_definition := replace(
      v_definition,
      'v_calculation.tax_amount,',
      'COALESCE(v_calculation.tax_amount, 0),'
    );
    v_definition := replace(
      v_definition,
      'v_calculation.delivery_charge_amount,',
      'COALESCE(v_calculation.delivery_charge_amount, 0),'
    );
    v_definition := replace(
      v_definition,
      'v_calculation.commission_amount, v_event_at',
      'COALESCE(v_calculation.commission_amount, 0), v_event_at'
    );

    EXECUTE v_definition;
  END IF;
END;
$block$;

REVOKE ALL ON FUNCTION private.calculate_sales_agent_commission_plan_target(uuid, uuid, uuid, uuid, text, boolean, boolean, numeric) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
