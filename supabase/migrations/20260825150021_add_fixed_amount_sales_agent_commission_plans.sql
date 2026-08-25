-- Commission plans can pay either a percentage of their selected basis or a
-- fixed amount in a selected supported currency. Existing plans preserve their
-- percentage behavior; new plans default to fixed amounts.
ALTER TABLE crm.agent_commission_plans
  ADD COLUMN IF NOT EXISTS commission_type text,
  ADD COLUMN IF NOT EXISTS fixed_amount numeric(18, 6) NULL,
  ADD COLUMN IF NOT EXISTS fixed_currency text NULL;

UPDATE crm.agent_commission_plans
SET commission_type = 'percentage'
WHERE commission_type IS NULL;

ALTER TABLE crm.agent_commission_plans
  ALTER COLUMN commission_type SET DEFAULT 'fixed_amount',
  ALTER COLUMN commission_type SET NOT NULL;

ALTER TABLE crm.agent_commission_plans
  DROP CONSTRAINT IF EXISTS agent_commission_plans_commission_type_check,
  DROP CONSTRAINT IF EXISTS agent_commission_plans_fixed_currency_check,
  DROP CONSTRAINT IF EXISTS agent_commission_plans_commission_shape_check,
  ADD CONSTRAINT agent_commission_plans_commission_type_check CHECK (
    commission_type IN ('fixed_amount', 'percentage')
  ),
  ADD CONSTRAINT agent_commission_plans_fixed_currency_check CHECK (
    fixed_currency IS NULL OR fixed_currency IN ('usd', 'eur', 'iqd', 'try')
  ),
  ADD CONSTRAINT agent_commission_plans_commission_shape_check CHECK (
    (commission_type = 'percentage'
      AND fixed_amount IS NULL
      AND fixed_currency IS NULL)
    OR (commission_type = 'fixed_amount'
      AND rate_percent = 0
      AND fixed_amount > 0
      AND fixed_currency IS NOT NULL)
  );

COMMENT ON COLUMN crm.agent_commission_plans.commission_type IS
  'Whether the plan calculates a percentage or pays a fixed source-currency amount per eligible sales order.';
COMMENT ON COLUMN crm.agent_commission_plans.fixed_amount IS
  'Fixed commission source amount. Required only when commission_type is fixed_amount.';
COMMENT ON COLUMN crm.agent_commission_plans.fixed_currency IS
  'Currency of fixed_amount. The amount is converted through the sales order rate snapshot when needed.';

-- The existing percentage calculator remains available for historical callers.
-- This wrapper resolves a fixed plan by its immutable plan id and converts its
-- amount through the order's locked rate snapshot.
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

  IF v_plan.commission_type = 'fixed_amount' AND v_calculation.eligible THEN
    IF lower(v_plan.fixed_currency) = lower(v_calculation.currency) THEN
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
    v_calculation.revenue_amount,
    v_calculation.cost_amount,
    v_calculation.tax_amount,
    v_calculation.delivery_charge_amount,
    v_calculation.basis_amount,
    round(CASE
      WHEN v_calculation.eligible AND v_plan.commission_type = 'fixed_amount'
        THEN v_fixed_commission
      ELSE v_calculation.commission_amount
    END, 6),
    v_calculation.eligible;
END;
$function$;

-- Repoint reconciliation and ledger validation to the plan-aware calculator.
-- This preserves the original effective-dated plan id on every accrued entry,
-- so a later plan revision cannot change a historical fixed commission.
DO $do$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_sales_agent_commission(uuid, uuid)'::regprocedure)
  INTO function_definition;
  IF position('private.calculate_sales_agent_commission_plan_target(' IN function_definition) = 0 THEN
    function_definition := replace(
      function_definition,
      'private.calculate_sales_agent_commission_order_target(',
      'private.calculate_sales_agent_commission_plan_target('
    );
    function_definition := regexp_replace(
      function_definition,
      'v_assignment\.id,([[:space:]]*)v_calculation_basis',
      E'v_assignment.id,\\1v_plan.id,\\1v_calculation_basis',
      'g'
    );
    function_definition := regexp_replace(
      function_definition,
      'v_assignment\.id,([[:space:]]*)v_accrual\.calculation_basis',
      E'v_assignment.id,\\1v_accrual.plan_id,\\1v_accrual.calculation_basis',
      'g'
    );
    EXECUTE function_definition;
  END IF;

  SELECT pg_get_functiondef('private.enforce_agent_commission_entry_row()'::regprocedure)
  INTO function_definition;
  IF position('private.calculate_sales_agent_commission_plan_target(' IN function_definition) = 0 THEN
    function_definition := replace(
      function_definition,
      'private.calculate_sales_agent_commission_order_target(',
      'private.calculate_sales_agent_commission_plan_target('
    );
    function_definition := regexp_replace(
      function_definition,
      'v_related\.assignment_id,([[:space:]]*)v_related\.calculation_basis',
      E'v_related.assignment_id,\\1v_related.plan_id,\\1v_related.calculation_basis',
      'g'
    );
    function_definition := regexp_replace(
      function_definition,
      'NEW\.assignment_id,([[:space:]]*)NEW\.calculation_basis',
      E'NEW.assignment_id,\\1NEW.plan_id,\\1NEW.calculation_basis',
      'g'
    );
    EXECUTE function_definition;
  END IF;

  SELECT pg_get_functiondef('private.enforce_agent_commission_plan_row()'::regprocedure)
  INTO function_definition;
  IF position('NEW.commission_type IS DISTINCT FROM OLD.commission_type' IN function_definition) = 0 THEN
    function_definition := replace(
      function_definition,
      '    OR NEW.rate_percent IS DISTINCT FROM OLD.rate_percent',
      E'    OR NEW.rate_percent IS DISTINCT FROM OLD.rate_percent\n    OR NEW.commission_type IS DISTINCT FROM OLD.commission_type\n    OR NEW.fixed_amount IS DISTINCT FROM OLD.fixed_amount\n    OR NEW.fixed_currency IS DISTINCT FROM OLD.fixed_currency'
    );
    EXECUTE function_definition;
  END IF;
END;
$do$;

DO $do$
DECLARE
  reconcile_definition text;
  entry_definition text;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_sales_agent_commission(uuid, uuid)'::regprocedure)
  INTO reconcile_definition;
  SELECT pg_get_functiondef('private.enforce_agent_commission_entry_row()'::regprocedure)
  INTO entry_definition;

  IF position('private.calculate_sales_agent_commission_order_target(' IN reconcile_definition) > 0
    OR position('private.calculate_sales_agent_commission_plan_target(' IN reconcile_definition) = 0
    OR position('private.calculate_sales_agent_commission_order_target(' IN entry_definition) > 0
    OR position('private.calculate_sales_agent_commission_plan_target(' IN entry_definition) = 0
  THEN
    RAISE EXCEPTION 'Sales Agent Commission reconciliation was not updated for fixed commission plans';
  END IF;
END;
$do$;

REVOKE ALL ON FUNCTION private.calculate_sales_agent_commission_plan_target(uuid, uuid, uuid, uuid, text, boolean, boolean, numeric) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
