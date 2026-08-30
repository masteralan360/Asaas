-- An order may override a fixed plan amount without changing the workspace's
-- effective-dated commission plan. The snapshot remains immutable once saved.
ALTER TABLE crm.sales_order_agent_assignments
  DROP CONSTRAINT IF EXISTS sales_order_agent_assignments_manual_commission_shape_check,
  ADD CONSTRAINT sales_order_agent_assignments_manual_commission_shape_check CHECK (
    (manual_commission_type IS NULL
      AND manual_commission_source_amount IS NULL
      AND manual_commission_source_currency IS NULL
      AND manual_commission_converted_amount IS NULL
      AND manual_commission_exchange_rate IS NULL
      AND manual_commission_exchange_rate_source IS NULL
      AND manual_commission_exchange_rate_timestamp IS NULL
      AND manual_commission_exchange_rates IS NULL)
    OR (manual_commission_type = 'fixed_amount'
      AND manual_commission_source_amount >= 0
      AND manual_commission_source_currency IS NOT NULL
      AND manual_commission_converted_amount >= 0
      AND manual_commission_exchange_rate > 0
      AND NULLIF(btrim(manual_commission_exchange_rate_source), '') IS NOT NULL
      AND manual_commission_exchange_rate_timestamp IS NOT NULL
      AND jsonb_typeof(COALESCE(manual_commission_exchange_rates, '[]'::jsonb)) = 'array')
    OR (manual_commission_type = 'percentage'
      AND manual_commission_source_amount >= 0
      AND manual_commission_source_amount <= 100
      AND manual_commission_source_currency IS NOT NULL
      AND manual_commission_converted_amount >= 0
      AND manual_commission_exchange_rate = 1
      AND manual_commission_exchange_rate_source = 'native'
      AND manual_commission_exchange_rate_timestamp IS NOT NULL
      AND jsonb_typeof(COALESCE(manual_commission_exchange_rates, '[]'::jsonb)) = 'array')
  );

CREATE OR REPLACE FUNCTION private.enforce_sales_order_agent_assignment_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order_currency text;
  v_order_total numeric;
  v_expected_manual_amount numeric;
  v_plan_type text;
  v_plan_fixed_currency text;
BEGIN
  IF TG_OP = 'INSERT' AND (SELECT auth.uid()) IS NOT NULL THEN
    NEW.assigned_by := (SELECT auth.uid());
  ELSIF TG_OP = 'UPDATE'
    AND OLD.unassigned_at IS NULL
    AND NEW.unassigned_at IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
  THEN
    NEW.unassigned_by := (SELECT auth.uid());
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
    OR NEW.previous_assignment_id IS DISTINCT FROM OLD.previous_assignment_id
    OR NEW.customer_city_snapshot IS DISTINCT FROM OLD.customer_city_snapshot
    OR NEW.delivery_charge_amount IS DISTINCT FROM OLD.delivery_charge_amount
    OR NEW.internal_delivery_cost_amount IS DISTINCT FROM OLD.internal_delivery_cost_amount
    OR NEW.manual_commission_type IS DISTINCT FROM OLD.manual_commission_type
    OR NEW.manual_commission_source_amount IS DISTINCT FROM OLD.manual_commission_source_amount
    OR NEW.manual_commission_source_currency IS DISTINCT FROM OLD.manual_commission_source_currency
    OR NEW.manual_commission_converted_amount IS DISTINCT FROM OLD.manual_commission_converted_amount
    OR NEW.manual_commission_exchange_rate IS DISTINCT FROM OLD.manual_commission_exchange_rate
    OR NEW.manual_commission_exchange_rate_source IS DISTINCT FROM OLD.manual_commission_exchange_rate_source
    OR NEW.manual_commission_exchange_rate_timestamp IS DISTINCT FROM OLD.manual_commission_exchange_rate_timestamp
    OR NEW.manual_commission_exchange_rates IS DISTINCT FROM OLD.manual_commission_exchange_rates
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
  ) THEN
    RAISE EXCEPTION 'Sales order agent assignment snapshots are immutable; close and reassign instead'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.unassigned_at IS NOT NULL AND (
    NEW.unassigned_at IS DISTINCT FROM OLD.unassigned_at
    OR NEW.unassigned_by IS DISTINCT FROM OLD.unassigned_by
    OR NEW.reassignment_reason IS DISTINCT FROM OLD.reassignment_reason
  ) THEN
    RAISE EXCEPTION 'Closed sales order assignments cannot be reopened or edited'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.unassigned_at IS NULL
    AND NEW.unassigned_at IS NULL
    AND (
      NEW.unassigned_by IS DISTINCT FROM OLD.unassigned_by
      OR NEW.reassignment_reason IS DISTINCT FROM OLD.reassignment_reason
    )
  THEN
    RAISE EXCEPTION 'Assignment closure metadata requires an unassignment timestamp'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces AS workspace
    WHERE workspace.id = NEW.workspace_id
      AND workspace.deleted_at IS NULL
      AND public.workspace_module_allowed(
        workspace.id,
        workspace.plan::text,
        'sales_agent_commissions'
      )
  ) THEN
    RAISE EXCEPTION 'Sales Agent Commissions is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM crm.sales_orders AS sales_order
    WHERE sales_order.id = NEW.order_id
      AND sales_order.workspace_id = NEW.workspace_id
      AND COALESCE(sales_order.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Sales order must belong to the assignment workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM crm.agents AS agent
    WHERE agent.id = NEW.agent_id
      AND agent.workspace_id = NEW.workspace_id
      AND agent.agent_type = 'field_agent'
      AND COALESCE(agent.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Sales order assignments require a field agent in the same workspace'
      USING ERRCODE = '23514';
  END IF;

  SELECT lower(sales_order.currency::text), GREATEST(COALESCE(sales_order.total, 0), 0)
  INTO v_order_currency, v_order_total
  FROM crm.sales_orders AS sales_order
  WHERE sales_order.id = NEW.order_id
    AND sales_order.workspace_id = NEW.workspace_id;

  IF NEW.manual_commission_type IS NOT NULL THEN
    SELECT plan.commission_type, lower(plan.fixed_currency)
    INTO v_plan_type, v_plan_fixed_currency
    FROM crm.agent_commission_memberships AS membership
    JOIN crm.agent_commission_plans AS plan ON plan.id = membership.plan_id
    WHERE membership.workspace_id = NEW.workspace_id
      AND membership.agent_id = NEW.agent_id
      AND membership.is_deleted = false
      AND membership.effective_from <= NEW.assigned_at
      AND (membership.effective_to IS NULL OR NEW.assigned_at < membership.effective_to)
      AND plan.workspace_id = NEW.workspace_id
      AND plan.is_deleted = false
      AND plan.is_active = true
      AND plan.effective_from <= NEW.assigned_at
      AND (plan.effective_to IS NULL OR NEW.assigned_at < plan.effective_to)
    ORDER BY membership.effective_from DESC
    LIMIT 1;
    IF FOUND AND (
      v_plan_type <> 'fixed_amount'
      OR NEW.manual_commission_type <> 'fixed_amount'
      OR lower(NEW.manual_commission_source_currency) IS DISTINCT FROM v_plan_fixed_currency
    ) THEN
      RAISE EXCEPTION 'Order commission amount overrides are available only for fixed commission plans and must use the fixed-plan currency'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.manual_commission_type = 'percentage' THEN
      IF NEW.manual_commission_source_currency IS DISTINCT FROM v_order_currency
        OR NEW.manual_commission_exchange_rate <> 1
        OR NEW.manual_commission_exchange_rate_source <> 'native'
        OR COALESCE(jsonb_array_length(NEW.manual_commission_exchange_rates), 0) <> 0
      THEN
        RAISE EXCEPTION 'Percentage manual commission must use the order currency without a conversion snapshot'
          USING ERRCODE = '23514';
      END IF;
      v_expected_manual_amount := round(v_order_total * NEW.manual_commission_source_amount / 100, 6);
    ELSE
      v_expected_manual_amount := private.convert_sales_agent_commission_amount(
        NEW.manual_commission_source_amount,
        NEW.manual_commission_source_currency,
        v_order_currency,
        NEW.manual_commission_exchange_rates
      );
      IF v_expected_manual_amount IS NULL THEN
        RAISE EXCEPTION 'Manual commission conversion snapshot cannot convert into the order currency'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF abs(v_expected_manual_amount - NEW.manual_commission_converted_amount) > 0.000001
      OR (
        NEW.manual_commission_type = 'fixed_amount'
        AND NEW.manual_commission_source_amount > 0
        AND abs((v_expected_manual_amount / NEW.manual_commission_source_amount) - NEW.manual_commission_exchange_rate) > 0.000001
      )
    THEN
      RAISE EXCEPTION 'Manual commission conversion does not match its locked order-rate snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.previous_assignment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.sales_order_agent_assignments AS previous_assignment
    WHERE previous_assignment.id = NEW.previous_assignment_id
      AND previous_assignment.workspace_id = NEW.workspace_id
      AND previous_assignment.order_id = NEW.order_id
  ) THEN
    RAISE EXCEPTION 'Previous assignment must belong to the same sales order'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;
