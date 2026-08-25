-- Manual Sales Agent Order Commissions
--
-- Adds an order-specific commission fallback for field agents with no
-- effective commission plan. Fixed amounts retain their entered currency and
-- the exact order-rate snapshot used to convert them to the order currency.

ALTER TABLE public.sales_order_agent_assignments
  ADD COLUMN IF NOT EXISTS manual_commission_type text NULL,
  ADD COLUMN IF NOT EXISTS manual_commission_source_amount numeric NULL,
  ADD COLUMN IF NOT EXISTS manual_commission_source_currency text NULL,
  ADD COLUMN IF NOT EXISTS manual_commission_converted_amount numeric NULL,
  ADD COLUMN IF NOT EXISTS manual_commission_exchange_rate numeric NULL,
  ADD COLUMN IF NOT EXISTS manual_commission_exchange_rate_source text NULL,
  ADD COLUMN IF NOT EXISTS manual_commission_exchange_rate_timestamp timestamptz NULL,
  ADD COLUMN IF NOT EXISTS manual_commission_exchange_rates jsonb NULL;

ALTER TABLE public.sales_order_agent_assignments
  DROP CONSTRAINT IF EXISTS sales_order_agent_assignments_manual_commission_type_check,
  DROP CONSTRAINT IF EXISTS sales_order_agent_assignments_manual_commission_currency_check,
  DROP CONSTRAINT IF EXISTS sales_order_agent_assignments_manual_commission_shape_check,
  ADD CONSTRAINT sales_order_agent_assignments_manual_commission_type_check CHECK (
    manual_commission_type IS NULL OR manual_commission_type IN ('fixed_amount', 'percentage')
  ),
  ADD CONSTRAINT sales_order_agent_assignments_manual_commission_currency_check CHECK (
    manual_commission_source_currency IS NULL OR manual_commission_source_currency IN ('usd', 'eur', 'iqd', 'try')
  ),
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
      AND manual_commission_source_amount > 0
      AND manual_commission_source_currency IS NOT NULL
      AND manual_commission_converted_amount > 0
      AND manual_commission_exchange_rate > 0
      AND NULLIF(btrim(manual_commission_exchange_rate_source), '') IS NOT NULL
      AND manual_commission_exchange_rate_timestamp IS NOT NULL
      AND jsonb_typeof(COALESCE(manual_commission_exchange_rates, '[]'::jsonb)) = 'array')
    OR (manual_commission_type = 'percentage'
      AND manual_commission_source_amount > 0
      AND manual_commission_source_amount <= 100
      AND manual_commission_source_currency IS NOT NULL
      AND manual_commission_converted_amount >= 0
      AND manual_commission_exchange_rate = 1
      AND manual_commission_exchange_rate_source = 'native'
      AND manual_commission_exchange_rate_timestamp IS NOT NULL
      AND jsonb_typeof(COALESCE(manual_commission_exchange_rates, '[]'::jsonb)) = 'array')
  );

-- Multiple historical revisions may exist for a level; only an active/open
-- revision must remain unique.
DROP INDEX IF EXISTS public.agent_commission_plans_one_per_level_idx;
CREATE UNIQUE INDEX agent_commission_plans_one_per_level_idx
  ON public.agent_commission_plans (workspace_id, level)
  WHERE is_deleted = false
    AND (is_active = true OR effective_to IS NULL);

CREATE OR REPLACE FUNCTION private.sales_agent_commissions_has_permission(
  p_workspace_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = (SELECT auth.uid())
      AND COALESCE(profile.current_workspace, profile.workspace_id) = p_workspace_id
      AND (
        profile.role = 'admin'
        OR (
          EXISTS (
            SELECT 1
            FROM public.workspaces AS workspace
            WHERE workspace.id = p_workspace_id
              AND workspace.deleted_at IS NULL
              AND public.workspace_capability_allowed(
                workspace.id,
                workspace.plan::text,
                'workspaceManagementPermissions'
              )
          )
          AND
          EXISTS (
            SELECT 1
            FROM public.workspace_permissions AS permission
            WHERE permission.workspace_id = p_workspace_id
              AND permission.user_uuid = profile.id
              AND permission.key = p_permission
          )
          AND (
            (
              p_permission = 'salesAgentCommissions.managePlans'
              AND EXISTS (
                SELECT 1 FROM public.workspace_permissions AS base_permission
                WHERE base_permission.workspace_id = p_workspace_id
                  AND base_permission.user_uuid = profile.id
                  AND base_permission.key = 'agents.access'
              )
            )
            OR (
              p_permission = 'salesAgentCommissions.assignOrders'
              AND EXISTS (
                SELECT 1 FROM public.workspace_permissions AS base_permission
                WHERE base_permission.workspace_id = p_workspace_id
                  AND base_permission.user_uuid = profile.id
                  AND base_permission.key = 'orders.saleOrdersAccess'
              )
            )
            OR (
              p_permission IN (
                'salesAgentCommissions.viewOwn',
                'salesAgentCommissions.viewAll',
                'salesAgentCommissions.pay'
              )
              AND EXISTS (
                SELECT 1 FROM public.workspace_permissions AS base_permission
                WHERE base_permission.workspace_id = p_workspace_id
                  AND base_permission.user_uuid = profile.id
                  AND base_permission.key = 'agents.access'
              )
              AND EXISTS (
                SELECT 1 FROM public.workspace_permissions AS base_permission
                WHERE base_permission.workspace_id = p_workspace_id
                  AND base_permission.user_uuid = profile.id
                  AND base_permission.key = 'orders.saleOrdersAccess'
              )
            )
          )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.sales_agent_commissions_can_view_assigned_order(
  p_workspace_id uuid,
  p_order_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces AS workspace
    WHERE workspace.id = p_workspace_id
      AND workspace.deleted_at IS NULL
      AND public.workspace_module_allowed(
        workspace.id,
        workspace.plan::text,
        'sales_agent_commissions'
      )
      AND (
        private.sales_agent_commissions_has_permission(workspace.id, 'salesAgentCommissions.assignOrders')
        OR (
          (
            private.sales_agent_commissions_has_permission(workspace.id, 'salesAgentCommissions.viewAll')
            OR private.sales_agent_commissions_has_permission(workspace.id, 'salesAgentCommissions.pay')
          )
          AND EXISTS (
            SELECT 1
            FROM public.sales_order_agent_assignments AS assignment
            WHERE assignment.workspace_id = workspace.id
              AND assignment.order_id = p_order_id
              AND assignment.is_deleted = false
              AND (
                assignment.unassigned_at IS NULL
                OR EXISTS (
                  SELECT 1
                  FROM public.agent_commission_entries AS entry
                  WHERE entry.workspace_id = assignment.workspace_id
                    AND entry.assignment_id = assignment.id
                )
              )
          )
        )
        OR (
          private.sales_agent_commissions_has_permission(workspace.id, 'salesAgentCommissions.viewOwn')
          AND private.sales_agent_commissions_order_is_own(workspace.id, p_order_id)
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.enforce_agent_commission_plan_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND (SELECT auth.uid()) IS NOT NULL THEN
    NEW.created_by := (SELECT auth.uid());
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
  ) THEN
    RAISE EXCEPTION 'Commission plan identity and audit fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.effective_to IS NOT NULL AND (
    NEW.effective_to IS DISTINCT FROM OLD.effective_to
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
  ) THEN
    RAISE EXCEPTION 'Closed commission plans cannot be reopened or retimed'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM public.agent_commission_memberships AS membership
    WHERE membership.plan_id = OLD.id
    UNION ALL
    SELECT 1
    FROM public.agent_commission_entries AS entry
    WHERE entry.plan_id = OLD.id
  ) AND (
    NEW.level IS DISTINCT FROM OLD.level
    OR NEW.rate_percent IS DISTINCT FROM OLD.rate_percent
    OR NEW.calculation_basis IS DISTINCT FROM OLD.calculation_basis
    OR NEW.include_tax IS DISTINCT FROM OLD.include_tax
    OR NEW.include_delivery_charge IS DISTINCT FROM OLD.include_delivery_charge
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
  ) THEN
    RAISE EXCEPTION 'Referenced commission plan terms are immutable; close and create a revision instead'
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

  NEW.name := btrim(NEW.name);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_agent_commission_membership_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND (SELECT auth.uid()) IS NOT NULL THEN
    NEW.assigned_by := (SELECT auth.uid());
  ELSIF TG_OP = 'UPDATE'
    AND OLD.effective_to IS NULL
    AND NEW.effective_to IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
  THEN
    NEW.ended_by := (SELECT auth.uid());
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
  ) THEN
    RAISE EXCEPTION 'Commission membership identity and history fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.effective_to IS NOT NULL AND (
    NEW.effective_to IS DISTINCT FROM OLD.effective_to
    OR NEW.ended_by IS DISTINCT FROM OLD.ended_by
  ) THEN
    RAISE EXCEPTION 'Closed commission memberships cannot be reopened or edited'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.effective_to IS NULL
    AND NEW.effective_to IS NULL
    AND NEW.ended_by IS DISTINCT FROM OLD.ended_by
  THEN
    RAISE EXCEPTION 'Membership closure metadata requires an end timestamp'
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
    SELECT 1 FROM crm.agents AS agent
    WHERE agent.id = NEW.agent_id
      AND agent.workspace_id = NEW.workspace_id
      AND agent.agent_type = 'field_agent'
      AND COALESCE(agent.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Commission memberships require a field agent in the same workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.agent_commission_plans AS plan
    WHERE plan.id = NEW.plan_id
      AND plan.workspace_id = NEW.workspace_id
      AND plan.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Commission plan must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

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
  SELECT round(p_amount * paths.factor, 6)
  FROM paths
  WHERE paths.currency = lower(p_to_currency)
  ORDER BY cardinality(paths.visited)
  LIMIT 1;
$function$;

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
    IF EXISTS (
      SELECT 1
      FROM public.agent_commission_memberships AS membership
      JOIN public.agent_commission_plans AS plan ON plan.id = membership.plan_id
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
    ) THEN
      RAISE EXCEPTION 'Manual order commission is allowed only when the assigned agent has no commission plan'
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
        AND abs((v_expected_manual_amount / NEW.manual_commission_source_amount) - NEW.manual_commission_exchange_rate) > 0.000001
      )
    THEN
      RAISE EXCEPTION 'Manual commission conversion does not match its locked order-rate snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.previous_assignment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_order_agent_assignments AS previous_assignment
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

CREATE OR REPLACE FUNCTION private.calculate_manual_sales_agent_commission_order_target(
  p_workspace_id uuid,
  p_order_id uuid,
  p_assignment_id uuid
)
RETURNS TABLE (
  currency text,
  revenue_amount numeric,
  cost_amount numeric,
  tax_amount numeric,
  delivery_charge_amount numeric,
  basis_amount numeric,
  commission_amount numeric,
  eligible boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH source AS (
    SELECT
      lower(sales_order.currency::text) AS currency,
      GREATEST(COALESCE(sales_order.total, 0), 0) AS order_total,
      assignment.manual_commission_type,
      assignment.manual_commission_source_amount,
      assignment.manual_commission_converted_amount,
      (
        sales_order.status = 'completed'
        AND (COALESCE(sales_order.is_paid, false) OR sales_order.payment_status = 'paid')
        AND COALESCE(sales_order.is_deleted, false) = false
        AND sales_order.return_status <> 'full'
        AND assignment.unassigned_at IS NULL
        AND assignment.is_deleted = false
      ) AS eligible
    FROM crm.sales_orders AS sales_order
    JOIN public.sales_order_agent_assignments AS assignment
      ON assignment.id = p_assignment_id
     AND assignment.order_id = sales_order.id
     AND assignment.workspace_id = p_workspace_id
    WHERE sales_order.id = p_order_id
      AND sales_order.workspace_id = p_workspace_id
      AND assignment.manual_commission_type IN ('fixed_amount', 'percentage')
  )
  SELECT
    source.currency,
    CASE WHEN source.eligible THEN round(source.order_total, 6) ELSE 0 END,
    0,
    0,
    0,
    CASE WHEN source.eligible THEN round(source.order_total, 6) ELSE 0 END,
    CASE WHEN source.eligible THEN round(
      CASE source.manual_commission_type
        WHEN 'percentage' THEN source.order_total * source.manual_commission_source_amount / 100
        ELSE source.manual_commission_converted_amount
      END,
      6
    ) ELSE 0 END,
    source.eligible
  FROM source;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_agent_commission_entry_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_recognized numeric := 0;
  v_related public.agent_commission_entries%ROWTYPE;
  v_expected_currency text;
  v_expected_revenue numeric;
  v_expected_cost numeric;
  v_expected_tax numeric;
  v_expected_delivery numeric;
  v_expected_basis numeric;
  v_expected_commission numeric;
  v_target numeric := 0;
  v_eligible boolean := false;
  v_manual_type text;
  v_manual_rate numeric;
BEGIN
  IF TG_OP = 'INSERT' AND (SELECT auth.uid()) IS NOT NULL THEN
    NEW.created_by := (SELECT auth.uid());
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Commission ledger entries are immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- Let an identical-id insert reach the primary-key conflict. The sync layer
  -- treats that conflict as a successful immutable retry and never updates the
  -- existing ledger event.
  IF EXISTS (
    SELECT 1 FROM public.agent_commission_entries AS existing
    WHERE existing.id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.kind = 'payout' THEN
    NEW.payout_reference := btrim(NEW.payout_reference);
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
    SELECT 1 FROM crm.agents AS agent
    WHERE agent.id = NEW.agent_id
      AND agent.workspace_id = NEW.workspace_id
      AND agent.agent_type = 'field_agent'
      AND COALESCE(agent.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Commission entry agent must be a field agent in the same workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind IN ('accrual', 'reversal', 'payout', 'adjustment') THEN
    -- Every balance-changing event for an agent/currency takes the same lock.
    -- Assignment-linked events then take a narrower lock in a stable order.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'commission-agent:' || NEW.workspace_id::text || ':' || NEW.agent_id::text || ':' || NEW.currency,
        0
      )
    );
    IF NEW.assignment_id IS NOT NULL THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'commission-assignment:' || NEW.workspace_id::text || ':' || NEW.assignment_id::text || ':' || NEW.currency,
          0
        )
      );
    END IF;
  END IF;

  IF NEW.kind = 'payout' THEN
    SELECT COALESCE(sum(entry.amount), 0)
    INTO v_recognized
    FROM public.agent_commission_entries AS entry
    WHERE entry.workspace_id = NEW.workspace_id
      AND entry.agent_id = NEW.agent_id
      AND entry.currency = NEW.currency
      AND entry.kind NOT IN ('estimate', 'approval');
    IF -NEW.amount > GREATEST(v_recognized, 0) + 0.000001 THEN
      RAISE EXCEPTION 'Commission payout exceeds the outstanding balance'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.sales_orders AS sales_order
    WHERE sales_order.id = NEW.order_id
      AND sales_order.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Commission entry order must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.order_id IS NOT NULL AND NEW.assignment_id IS NULL THEN
    RAISE EXCEPTION 'Order-linked commission entries require a matching sales-agent assignment'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'adjustment'
    AND NEW.related_entry_id IS NULL
    AND NEW.order_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM crm.sales_orders AS sales_order
      WHERE sales_order.id = NEW.order_id
        AND sales_order.workspace_id = NEW.workspace_id
        AND lower(sales_order.currency::text) = NEW.currency
    )
  THEN
    RAISE EXCEPTION 'Order-linked commission adjustments must use the sales order currency'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.assignment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_order_agent_assignments AS assignment
    WHERE assignment.id = NEW.assignment_id
      AND assignment.workspace_id = NEW.workspace_id
      AND assignment.agent_id = NEW.agent_id
      AND assignment.order_id IS NOT DISTINCT FROM NEW.order_id
  ) THEN
    RAISE EXCEPTION 'Commission entry assignment does not match its order and agent'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_commission_memberships AS membership
    WHERE membership.id = NEW.membership_id
      AND membership.workspace_id = NEW.workspace_id
      AND membership.agent_id = NEW.agent_id
      AND membership.plan_id IS NOT DISTINCT FROM NEW.plan_id
  ) THEN
    RAISE EXCEPTION 'Commission entry membership does not match its agent and plan'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_commission_plans AS plan
    WHERE plan.id = NEW.plan_id
      AND plan.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Commission entry plan must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.order_return_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.order_returns AS order_return
    WHERE order_return.id = NEW.order_return_id
      AND order_return.workspace_id = NEW.workspace_id
      AND order_return.order_id IS NOT DISTINCT FROM NEW.order_id
      AND order_return.status = 'posted'
  ) THEN
    RAISE EXCEPTION 'Commission reversal return does not match its workspace and order'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.related_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_commission_entries AS related_entry
    WHERE related_entry.id = NEW.related_entry_id
      AND related_entry.workspace_id = NEW.workspace_id
      AND related_entry.agent_id = NEW.agent_id
      AND (NEW.order_id IS NULL OR related_entry.order_id IS NOT DISTINCT FROM NEW.order_id)
  ) THEN
    RAISE EXCEPTION 'Related commission entry must belong to the same workspace and agent'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.related_entry_id IS NOT NULL THEN
    SELECT * INTO v_related
    FROM public.agent_commission_entries AS related_entry
    WHERE related_entry.id = NEW.related_entry_id;
  END IF;

  IF NEW.kind IN ('reversal', 'adjustment')
    AND NEW.related_entry_id IS NOT NULL
  THEN
    IF v_related.membership_id IS NULL AND v_related.plan_id IS NULL THEN
      SELECT calculation.commission_amount
      INTO v_target
      FROM private.calculate_manual_sales_agent_commission_order_target(
        v_related.workspace_id,
        v_related.order_id,
        v_related.assignment_id
      ) AS calculation;
    ELSE
      SELECT calculation.commission_amount
      INTO v_target
      FROM private.calculate_sales_agent_commission_order_target(
        v_related.workspace_id,
        v_related.order_id,
        v_related.assignment_id,
        v_related.calculation_basis,
        v_related.include_tax,
        v_related.include_delivery_charge,
        v_related.rate_percent
      ) AS calculation;
    END IF;
    v_target := COALESCE(v_target, 0);
  END IF;

  IF NEW.kind = 'accrual' THEN
    SELECT assignment.manual_commission_type, assignment.manual_commission_source_amount
    INTO v_manual_type, v_manual_rate
    FROM public.sales_order_agent_assignments AS assignment
    WHERE assignment.id = NEW.assignment_id;

    IF v_manual_type IS NOT NULL THEN
      SELECT
        calculation.currency,
        calculation.revenue_amount,
        calculation.cost_amount,
        calculation.tax_amount,
        calculation.delivery_charge_amount,
        calculation.basis_amount,
        calculation.commission_amount,
        calculation.eligible
      INTO
        v_expected_currency,
        v_expected_revenue,
        v_expected_cost,
        v_expected_tax,
        v_expected_delivery,
        v_expected_basis,
        v_expected_commission,
        v_eligible
      FROM private.calculate_manual_sales_agent_commission_order_target(
        NEW.workspace_id,
        NEW.order_id,
        NEW.assignment_id
      ) AS calculation;
    ELSE
      SELECT
        calculation.currency,
        calculation.revenue_amount,
        calculation.cost_amount,
        calculation.tax_amount,
        calculation.delivery_charge_amount,
        calculation.basis_amount,
        calculation.commission_amount,
        calculation.eligible
      INTO
        v_expected_currency,
        v_expected_revenue,
        v_expected_cost,
        v_expected_tax,
        v_expected_delivery,
        v_expected_basis,
        v_expected_commission,
        v_eligible
      FROM private.calculate_sales_agent_commission_order_target(
        NEW.workspace_id,
        NEW.order_id,
        NEW.assignment_id,
        NEW.calculation_basis,
        NEW.include_tax,
        NEW.include_delivery_charge,
        NEW.rate_percent
      ) AS calculation;
    END IF;

    IF NOT COALESCE(v_eligible, false) THEN
      RAISE EXCEPTION 'Commission accrual requires a currently assigned, completed and paid sales order'
        USING ERRCODE = '23514';
    END IF;

    IF v_expected_currency IS DISTINCT FROM NEW.currency
      OR abs(v_expected_revenue - NEW.revenue_amount) > 0.000001
      OR abs(v_expected_cost - NEW.cost_amount) > 0.000001
      OR abs(v_expected_tax - NEW.tax_amount) > 0.000001
      OR abs(v_expected_delivery - NEW.delivery_charge_amount) > 0.000001
      OR abs(v_expected_basis - NEW.basis_amount) > 0.000001
      OR abs(v_expected_commission - NEW.amount) > 0.000001
    THEN
      RAISE EXCEPTION 'Commission accrual snapshots do not match the sales order calculation'
        USING ERRCODE = '23514';
    END IF;

    IF v_manual_type IS NOT NULL AND (
      NEW.membership_id IS NOT NULL
      OR NEW.plan_id IS NOT NULL
      OR NEW.calculation_basis <> 'net_revenue'
      OR NEW.include_tax
      OR NEW.include_delivery_charge
      OR NEW.rate_percent <> CASE WHEN v_manual_type = 'percentage' THEN v_manual_rate ELSE 0 END
    ) THEN
      RAISE EXCEPTION 'Manual order commission accrual must preserve the assignment-only terms'
        USING ERRCODE = '23514';
    ELSIF v_manual_type IS NULL AND NOT EXISTS (
      SELECT 1
      FROM crm.sales_orders AS sales_order
      JOIN public.sales_order_agent_assignments AS assignment
        ON assignment.id = NEW.assignment_id
       AND assignment.order_id = sales_order.id
       AND assignment.agent_id = NEW.agent_id
      JOIN public.agent_commission_memberships AS membership
        ON membership.id = NEW.membership_id
       AND membership.agent_id = NEW.agent_id
       AND membership.plan_id = NEW.plan_id
      JOIN public.agent_commission_plans AS plan
        ON plan.id = NEW.plan_id
      WHERE sales_order.id = NEW.order_id
        AND sales_order.workspace_id = NEW.workspace_id
        AND assignment.workspace_id = NEW.workspace_id
        AND assignment.assigned_at <= NEW.occurred_at
        AND (assignment.unassigned_at IS NULL OR NEW.occurred_at < assignment.unassigned_at)
        AND membership.workspace_id = NEW.workspace_id
        AND membership.effective_from <= NEW.occurred_at
        AND (membership.effective_to IS NULL OR NEW.occurred_at < membership.effective_to)
        AND plan.workspace_id = NEW.workspace_id
        AND plan.effective_from <= NEW.occurred_at
        AND (plan.effective_to IS NULL OR NEW.occurred_at < plan.effective_to)
        AND plan.rate_percent = NEW.rate_percent
        AND plan.calculation_basis = NEW.calculation_basis
        AND plan.include_tax = NEW.include_tax
        AND plan.include_delivery_charge = NEW.include_delivery_charge
    ) THEN
      RAISE EXCEPTION 'Commission accrual does not match its event-time assignment, membership and plan'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.kind = 'approval'
    AND (
      NEW.related_entry_id IS NULL
      OR v_related.kind NOT IN ('accrual', 'adjustment')
      OR v_related.status <> 'earned'
      OR v_related.amount <= 0
      OR v_related.currency IS DISTINCT FROM NEW.currency
    )
  THEN
    RAISE EXCEPTION 'Commission approval must reference an earned ledger entry'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'reversal' THEN
    IF NEW.related_entry_id IS NULL
      OR v_related.kind <> 'accrual'
      OR v_related.assignment_id IS DISTINCT FROM NEW.assignment_id
      OR v_related.membership_id IS DISTINCT FROM NEW.membership_id
      OR v_related.plan_id IS DISTINCT FROM NEW.plan_id
      OR v_related.currency IS DISTINCT FROM NEW.currency
      OR v_related.calculation_basis IS DISTINCT FROM NEW.calculation_basis
      OR v_related.include_tax IS DISTINCT FROM NEW.include_tax
      OR v_related.include_delivery_charge IS DISTINCT FROM NEW.include_delivery_charge
      OR v_related.basis_amount IS DISTINCT FROM NEW.basis_amount
      OR v_related.revenue_amount IS DISTINCT FROM NEW.revenue_amount
      OR v_related.cost_amount IS DISTINCT FROM NEW.cost_amount
      OR v_related.tax_amount IS DISTINCT FROM NEW.tax_amount
      OR v_related.delivery_charge_amount IS DISTINCT FROM NEW.delivery_charge_amount
      OR v_related.rate_percent IS DISTINCT FROM NEW.rate_percent
    THEN
      RAISE EXCEPTION 'Commission reversal must preserve its source accrual terms'
        USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(sum(entry.amount), 0)
    INTO v_recognized
    FROM public.agent_commission_entries AS entry
    WHERE entry.workspace_id = NEW.workspace_id
      AND entry.assignment_id = NEW.assignment_id
      AND entry.currency = NEW.currency
      AND entry.kind IN ('accrual', 'reversal', 'adjustment')
      AND (entry.kind <> 'adjustment' OR entry.related_entry_id IS NOT NULL);
    IF -NEW.amount > GREATEST(v_recognized, 0) + 0.000001 THEN
      RAISE EXCEPTION 'Commission reversal exceeds the recognized assignment balance'
        USING ERRCODE = '23514';
    END IF;
    IF abs((v_recognized + NEW.amount) - v_target) > 0.000001 THEN
      RAISE EXCEPTION 'Commission reversal must reconcile exactly to the current sales order target'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.kind = 'adjustment' AND NEW.related_entry_id IS NOT NULL THEN
    IF v_related.kind <> 'accrual'
      OR v_related.assignment_id IS DISTINCT FROM NEW.assignment_id
      OR v_related.membership_id IS DISTINCT FROM NEW.membership_id
      OR v_related.plan_id IS DISTINCT FROM NEW.plan_id
      OR v_related.currency IS DISTINCT FROM NEW.currency
      OR v_related.calculation_basis IS DISTINCT FROM NEW.calculation_basis
      OR v_related.include_tax IS DISTINCT FROM NEW.include_tax
      OR v_related.include_delivery_charge IS DISTINCT FROM NEW.include_delivery_charge
      OR v_related.rate_percent IS DISTINCT FROM NEW.rate_percent
    THEN
      RAISE EXCEPTION 'Order reconciliation adjustments must reference their assignment accrual'
        USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(sum(entry.amount), 0)
    INTO v_recognized
    FROM public.agent_commission_entries AS entry
    WHERE entry.workspace_id = NEW.workspace_id
      AND entry.assignment_id = NEW.assignment_id
      AND entry.currency = NEW.currency
      AND entry.kind IN ('accrual', 'reversal', 'adjustment')
      AND (entry.kind <> 'adjustment' OR entry.related_entry_id IS NOT NULL);
    IF v_recognized + NEW.amount < -0.000001
      OR v_recognized + NEW.amount > v_related.amount + 0.000001
    THEN
      RAISE EXCEPTION 'Commission reconciliation adjustment exceeds its accrual bounds'
        USING ERRCODE = '23514';
    END IF;
    IF abs((v_recognized + NEW.amount) - v_target) > 0.000001 THEN
      RAISE EXCEPTION 'Commission adjustment must reconcile exactly to the current sales order target'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_sales_agent_commission(
  p_order_id uuid,
  p_order_return_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order crm.sales_orders%ROWTYPE;
  v_assignment public.sales_order_agent_assignments%ROWTYPE;
  v_accrual public.agent_commission_entries%ROWTYPE;
  v_membership public.agent_commission_memberships%ROWTYPE;
  v_plan public.agent_commission_plans%ROWTYPE;
  v_calculation record;
  v_actor uuid := (SELECT auth.uid());
  v_event_at timestamptz;
  v_recognized numeric;
  v_delta numeric;
  v_calculation_basis text;
  v_include_tax boolean;
  v_include_delivery_charge boolean;
  v_rate_percent numeric;
  v_changed integer := 0;
  v_return_id uuid := NULL;
  v_entry_return_id uuid;
BEGIN
  SELECT *
  INTO v_order
  FROM crm.sales_orders AS sales_order
  WHERE sales_order.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_actor IS NULL
    OR public.current_workspace_id() IS DISTINCT FROM v_order.workspace_id
  THEN
    RAISE EXCEPTION 'Sales order is not available in the current workspace'
      USING ERRCODE = '42501';
  END IF;

  -- Revoking the optional module makes reconciliation a harmless no-op. This
  -- lets already-queued offline requests drain without reopening the feature.
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspaces AS workspace
    WHERE workspace.id = v_order.workspace_id
      AND workspace.deleted_at IS NULL
      AND public.workspace_module_allowed(
        workspace.id,
        workspace.plan::text,
        'sales_agent_commissions'
      )
  ) THEN
    RETURN 0;
  END IF;

  IF p_order_return_id IS NOT NULL THEN
    SELECT order_return.id
    INTO v_return_id
    FROM public.order_returns AS order_return
    WHERE order_return.id = p_order_return_id
      AND order_return.workspace_id = v_order.workspace_id
      AND order_return.order_id = v_order.id
      AND order_return.status = 'posted'
      AND COALESCE(order_return.is_deleted, false) = false;
    IF v_return_id IS NULL THEN
      RAISE EXCEPTION 'Posted order return is not available for this sales order'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commission-order:' || v_order.workspace_id::text || ':' || v_order.id::text,
      0
    )
  );

  FOR v_assignment IN
    SELECT assignment.*
    FROM public.sales_order_agent_assignments AS assignment
    WHERE assignment.workspace_id = v_order.workspace_id
      AND assignment.order_id = v_order.id
      AND assignment.is_deleted = false
    ORDER BY assignment.agent_id, assignment.id
    FOR UPDATE
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'commission-agent:' || v_assignment.workspace_id::text || ':' || v_assignment.agent_id::text || ':' || lower(v_order.currency::text),
        0
      )
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'commission-assignment:' || v_assignment.workspace_id::text || ':' || v_assignment.id::text || ':' || lower(v_order.currency::text),
        0
      )
    );

    SELECT *
    INTO v_accrual
    FROM public.agent_commission_entries AS entry
    WHERE entry.assignment_id = v_assignment.id
      AND entry.kind = 'accrual'
    LIMIT 1;

    IF NOT FOUND THEN
      IF v_assignment.unassigned_at IS NOT NULL THEN
        CONTINUE;
      END IF;

      v_event_at := GREATEST(
        v_assignment.assigned_at,
        COALESCE(
          GREATEST(v_order.actual_delivery_date, v_order.paid_at),
          v_order.actual_delivery_date,
          v_order.paid_at,
          v_order.updated_at,
          v_assignment.assigned_at
        )
      );

      IF v_assignment.manual_commission_type IS NOT NULL THEN
        v_calculation_basis := 'net_revenue';
        v_include_tax := false;
        v_include_delivery_charge := false;
        v_rate_percent := CASE
          WHEN v_assignment.manual_commission_type = 'percentage'
            THEN v_assignment.manual_commission_source_amount
          ELSE 0
        END;
        SELECT *
        INTO v_calculation
        FROM private.calculate_manual_sales_agent_commission_order_target(
          v_order.workspace_id,
          v_order.id,
          v_assignment.id
        );
      ELSE
        SELECT membership.*
        INTO v_membership
        FROM public.agent_commission_memberships AS membership
        WHERE membership.workspace_id = v_order.workspace_id
          AND membership.agent_id = v_assignment.agent_id
          AND membership.is_deleted = false
          AND membership.effective_from <= v_event_at
          AND (membership.effective_to IS NULL OR v_event_at < membership.effective_to)
        ORDER BY membership.effective_from DESC
        LIMIT 1;
        IF NOT FOUND THEN
          CONTINUE;
        END IF;

        SELECT plan.*
        INTO v_plan
        FROM public.agent_commission_plans AS plan
        WHERE plan.id = v_membership.plan_id
          AND plan.workspace_id = v_order.workspace_id
          AND plan.is_deleted = false
          AND plan.effective_from <= v_event_at
          AND (plan.effective_to IS NULL OR v_event_at < plan.effective_to)
        LIMIT 1;
        IF NOT FOUND THEN
          CONTINUE;
        END IF;
        v_calculation_basis := v_plan.calculation_basis;
        v_include_tax := v_plan.include_tax;
        v_include_delivery_charge := v_plan.include_delivery_charge;
        v_rate_percent := v_plan.rate_percent;

        SELECT *
        INTO v_calculation
        FROM private.calculate_sales_agent_commission_order_target(
          v_order.workspace_id,
          v_order.id,
          v_assignment.id,
          v_calculation_basis,
          v_include_tax,
          v_include_delivery_charge,
          v_rate_percent
        );
      END IF;
      IF NOT COALESCE(v_calculation.eligible, false) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.agent_commission_entries (
        id, workspace_id, order_id, assignment_id, agent_id,
        membership_id, plan_id, order_return_id, related_entry_id,
        kind, status, currency, calculation_basis, include_tax,
        include_delivery_charge, basis_amount, revenue_amount, cost_amount,
        tax_amount, delivery_charge_amount, rate_percent, amount, occurred_at,
        payout_reference, notes, created_by, created_at, updated_at,
        sync_status, version, is_deleted
      ) VALUES (
        gen_random_uuid(), v_order.workspace_id, v_order.id, v_assignment.id,
        v_assignment.agent_id,
        CASE WHEN v_assignment.manual_commission_type IS NULL THEN v_membership.id ELSE NULL END,
        CASE WHEN v_assignment.manual_commission_type IS NULL THEN v_plan.id ELSE NULL END,
        NULL, NULL,
        'accrual', 'earned', v_calculation.currency, v_calculation_basis,
        v_include_tax, v_include_delivery_charge,
        v_calculation.basis_amount, v_calculation.revenue_amount,
        v_calculation.cost_amount, v_calculation.tax_amount,
        v_calculation.delivery_charge_amount, v_rate_percent,
        v_calculation.commission_amount, v_event_at, NULL,
        'Commission accrued from committed sales order state', v_actor,
        now(), now(), 'synced', 1, false
      )
      RETURNING * INTO v_accrual;
      v_changed := v_changed + 1;
    END IF;

    IF v_accrual.membership_id IS NULL AND v_accrual.plan_id IS NULL THEN
      SELECT *
      INTO v_calculation
      FROM private.calculate_manual_sales_agent_commission_order_target(
        v_order.workspace_id,
        v_order.id,
        v_assignment.id
      );
    ELSE
      SELECT *
      INTO v_calculation
      FROM private.calculate_sales_agent_commission_order_target(
        v_order.workspace_id,
        v_order.id,
        v_assignment.id,
        v_accrual.calculation_basis,
        v_accrual.include_tax,
        v_accrual.include_delivery_charge,
        v_accrual.rate_percent
      );
    END IF;

    SELECT COALESCE(sum(entry.amount), 0)
    INTO v_recognized
    FROM public.agent_commission_entries AS entry
    WHERE entry.workspace_id = v_order.workspace_id
      AND entry.assignment_id = v_assignment.id
      AND entry.currency = v_accrual.currency
      AND entry.kind IN ('accrual', 'reversal', 'adjustment')
      AND (entry.kind <> 'adjustment' OR entry.related_entry_id IS NOT NULL);
    v_delta := round(COALESCE(v_calculation.commission_amount, 0) - v_recognized, 6);
    IF abs(v_delta) <= 0.000001 THEN
      CONTINUE;
    END IF;

    IF v_delta < 0 THEN
      -- One return event can have one reversal per assignment. If that audit
      -- pair already exists, a later state change is recorded as a linked
      -- reconciliation adjustment instead of violating the unique key.
      v_entry_return_id := v_return_id;
      IF v_entry_return_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.agent_commission_entries AS prior_return_reversal
        WHERE prior_return_reversal.order_return_id = v_entry_return_id
          AND prior_return_reversal.assignment_id = v_assignment.id
          AND prior_return_reversal.kind = 'reversal'
      ) THEN
        v_entry_return_id := NULL;
      END IF;

      IF v_entry_return_id IS NOT NULL THEN
        INSERT INTO public.agent_commission_entries (
          id, workspace_id, order_id, assignment_id, agent_id,
          membership_id, plan_id, order_return_id, related_entry_id,
          kind, status, currency, calculation_basis, include_tax,
          include_delivery_charge, basis_amount, revenue_amount, cost_amount,
          tax_amount, delivery_charge_amount, rate_percent, amount, occurred_at,
          payout_reference, notes, created_by, created_at, updated_at,
          sync_status, version, is_deleted
        ) VALUES (
          gen_random_uuid(), v_order.workspace_id, v_order.id, v_assignment.id,
          v_assignment.agent_id, v_accrual.membership_id, v_accrual.plan_id,
          v_entry_return_id, v_accrual.id, 'reversal', 'reversed', v_accrual.currency,
          v_accrual.calculation_basis, v_accrual.include_tax,
          v_accrual.include_delivery_charge, v_accrual.basis_amount,
          v_accrual.revenue_amount, v_accrual.cost_amount, v_accrual.tax_amount,
          v_accrual.delivery_charge_amount, v_accrual.rate_percent, v_delta,
          now(), NULL, 'Commission reconciled for posted order return', v_actor,
          now(), now(), 'synced', 1, false
        );
      ELSE
        INSERT INTO public.agent_commission_entries (
          id, workspace_id, order_id, assignment_id, agent_id,
          membership_id, plan_id, order_return_id, related_entry_id,
          kind, status, currency, calculation_basis, include_tax,
          include_delivery_charge, basis_amount, revenue_amount, cost_amount,
          tax_amount, delivery_charge_amount, rate_percent, amount, occurred_at,
          payout_reference, notes, created_by, created_at, updated_at,
          sync_status, version, is_deleted
        ) VALUES (
          gen_random_uuid(), v_order.workspace_id, v_order.id, v_assignment.id,
          v_assignment.agent_id, v_accrual.membership_id, v_accrual.plan_id,
          NULL, v_accrual.id, 'adjustment', 'reversed', v_accrual.currency,
          v_accrual.calculation_basis, v_accrual.include_tax,
          v_accrual.include_delivery_charge, v_calculation.basis_amount,
          v_calculation.revenue_amount, v_calculation.cost_amount,
          v_calculation.tax_amount, v_calculation.delivery_charge_amount,
          v_accrual.rate_percent, v_delta, now(), NULL,
          'Commission reduced to committed sales order state', v_actor,
          now(), now(), 'synced', 1, false
        );
      END IF;
    ELSE
      INSERT INTO public.agent_commission_entries (
        id, workspace_id, order_id, assignment_id, agent_id,
        membership_id, plan_id, order_return_id, related_entry_id,
        kind, status, currency, calculation_basis, include_tax,
        include_delivery_charge, basis_amount, revenue_amount, cost_amount,
        tax_amount, delivery_charge_amount, rate_percent, amount, occurred_at,
        payout_reference, notes, created_by, created_at, updated_at,
        sync_status, version, is_deleted
      ) VALUES (
        gen_random_uuid(), v_order.workspace_id, v_order.id, v_assignment.id,
        v_assignment.agent_id, v_accrual.membership_id, v_accrual.plan_id,
        NULL, v_accrual.id, 'adjustment', 'earned', v_accrual.currency,
        v_accrual.calculation_basis, v_accrual.include_tax,
        v_accrual.include_delivery_charge, v_calculation.basis_amount,
        v_calculation.revenue_amount, v_calculation.cost_amount,
        v_calculation.tax_amount, v_calculation.delivery_charge_amount,
        v_accrual.rate_percent, v_delta, now(), NULL,
        'Commission restored to committed sales order state', v_actor,
        now(), now(), 'synced', 1, false
      );
    END IF;
    v_changed := v_changed + 1;
  END LOOP;

  RETURN v_changed;
END;
$function$;
DROP POLICY IF EXISTS agent_commission_plans_select ON public.agent_commission_plans;
CREATE POLICY agent_commission_plans_select ON public.agent_commission_plans
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_plans.workspace_id),
      'sales_agent_commissions'
    )
    AND (
      private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewAll')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay')
      OR (
        private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewOwn')
        AND private.sales_agent_commissions_plan_is_own(workspace_id, id)
      )
    )
  );

DROP POLICY IF EXISTS agent_commission_entries_select ON public.agent_commission_entries;
CREATE POLICY agent_commission_entries_select ON public.agent_commission_entries
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_entries.workspace_id),
      'sales_agent_commissions'
    )
    AND (
      private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewAll')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
      OR (
        private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewOwn')
        AND private.sales_agent_commissions_is_agent_user(workspace_id, agent_id)
      )
    )
  );

REVOKE ALL ON FUNCTION private.convert_sales_agent_commission_amount(numeric, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.calculate_manual_sales_agent_commission_order_target(uuid, uuid, uuid) FROM PUBLIC;


