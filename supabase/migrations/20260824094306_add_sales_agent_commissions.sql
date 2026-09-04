-- Sales Agent Commissions is an isolated, platform-admin-granted workspace
-- feature. Existing order and agent behavior is unchanged when the module has
-- no explicit grant in workspace_access_overrides.

CREATE OR REPLACE FUNCTION public.workspace_plan_has_module(p_plan text, p_module text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_module, ''))
    WHEN 'pos' THEN true
    WHEN 'instant_pos' THEN false
    WHEN 'kds' THEN false
    WHEN 'sales_history' THEN true
    WHEN 'products' THEN true
    WHEN 'services' THEN false
    WHEN 'storages' THEN true
    WHEN 'inventory_transfer' THEN true
    WHEN 'inventory_transactions' THEN true
    WHEN 'stock_adjustments' THEN true
    WHEN 'ledger' THEN true
    WHEN 'payments' THEN true
    WHEN 'direct_transactions' THEN true
    WHEN 'members' THEN true
    WHEN 'business_partners' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'agents' THEN false
    WHEN 'sales_agent_commissions' THEN false
    WHEN 'post_service' THEN false
    WHEN 'customers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'suppliers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'orders' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'ecommerce' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'real_estate' THEN false
    WHEN 'activities' THEN false
    WHEN 'currency_exchange' THEN false
    WHEN 'clinical_appointments' THEN false
    WHEN 'loans' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'installments' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'discounts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'revenue_analytics' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'team_performance' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'invoice_history' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'accounting' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'hr' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'expenses' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'payroll' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsapp' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'manual_entry' THEN false
    ELSE false
  END;
$function$;

-- The commission workspace access is independent and disabled by every plan,
-- but its screens and assignment flow require the existing Agents and Orders
-- modules. An orphaned grant is therefore never effective.
CREATE OR REPLACE FUNCTION public.workspace_module_allowed(
  p_workspace_id uuid,
  p_plan text,
  p_module text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  WITH requested AS (
    SELECT CASE
      WHEN public.workspace_has_override(p_workspace_id, 'module', p_module) THEN
        COALESCE(public.workspace_get_override_value(p_workspace_id, 'module', p_module), 'grant') = 'grant'
      ELSE public.workspace_plan_has_module(p_plan, p_module)
    END AS allowed
  ), prerequisites AS (
    SELECT
      CASE
        WHEN public.workspace_has_override(p_workspace_id, 'module', 'agents') THEN
          COALESCE(public.workspace_get_override_value(p_workspace_id, 'module', 'agents'), 'grant') = 'grant'
        ELSE public.workspace_plan_has_module(p_plan, 'agents')
      END AS agents_allowed,
      CASE
        WHEN public.workspace_has_override(p_workspace_id, 'module', 'orders') THEN
          COALESCE(public.workspace_get_override_value(p_workspace_id, 'module', 'orders'), 'grant') = 'grant'
        ELSE public.workspace_plan_has_module(p_plan, 'orders')
      END AS orders_allowed
  )
  SELECT requested.allowed
    AND (
      lower(COALESCE(p_module, '')) <> 'sales_agent_commissions'
      OR (prerequisites.agents_allowed AND prerequisites.orders_allowed)
    )
  FROM requested, prerequisites;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_sales_agent_commissions_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_workspace_id uuid;
  v_plan text;
  v_old_plan text;
  v_commission_granted boolean := false;
  v_post_allowed boolean := true;
BEGIN
  IF (
      (TG_OP <> 'INSERT' AND OLD.type = 'module' AND lower(OLD.key) = 'sales_agent_commissions')
      OR (TG_OP <> 'DELETE' AND NEW.type = 'module' AND lower(NEW.key) = 'sales_agent_commissions')
    )
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Sales Agent Commissions access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  v_workspace_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  SELECT workspace.plan INTO v_plan
  FROM public.workspaces AS workspace
  WHERE workspace.id = v_workspace_id
    AND workspace.deleted_at IS NULL;

  IF TG_OP <> 'DELETE'
    AND NEW.type = 'module'
    AND lower(NEW.key) = 'sales_agent_commissions'
    AND COALESCE(lower(NEW.value), 'grant') = 'grant'
    AND (
      NOT public.workspace_module_allowed(v_workspace_id, v_plan, 'agents')
      OR NOT public.workspace_module_allowed(v_workspace_id, v_plan, 'orders')
    )
  THEN
    RAISE EXCEPTION 'Sales Agent Commissions requires both Agents and Orders workspace access'
      USING ERRCODE = '23514';
  END IF;

  -- Evaluate the prerequisite override as it will exist after this row
  -- operation. Removing an Orders override falls back to the plan, while
  -- removing the Agents grant (disabled by every plan) correctly fails.
  IF TG_OP IN ('UPDATE', 'DELETE')
    AND OLD.type = 'module'
    AND lower(OLD.key) IN ('agents', 'orders')
  THEN
    SELECT workspace.plan INTO v_old_plan
    FROM public.workspaces AS workspace
    WHERE workspace.id = OLD.workspace_id
      AND workspace.deleted_at IS NULL;

    IF TG_OP = 'UPDATE'
      AND NEW.workspace_id = OLD.workspace_id
      AND NEW.type = OLD.type
      AND lower(NEW.key) = lower(OLD.key)
    THEN
      v_post_allowed := COALESCE(lower(NEW.value), 'grant') = 'grant';
    ELSE
      v_post_allowed := public.workspace_plan_has_module(v_old_plan, lower(OLD.key));
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.workspace_access_overrides AS access_override
      WHERE access_override.workspace_id = OLD.workspace_id
        AND access_override.type = 'module'
        AND lower(access_override.key) = 'sales_agent_commissions'
        AND COALESCE(lower(access_override.value), 'grant') = 'grant'
    ) INTO v_commission_granted;

    IF v_commission_granted AND NOT v_post_allowed THEN
      RAISE EXCEPTION 'Disable Sales Agent Commissions before removing its Agents or Orders prerequisite'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE'
    AND NEW.type = 'module'
    AND lower(NEW.key) IN ('agents', 'orders')
    AND COALESCE(lower(NEW.value), 'grant') <> 'grant'
  THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.workspace_access_overrides AS access_override
      WHERE access_override.workspace_id = NEW.workspace_id
        AND access_override.type = 'module'
        AND lower(access_override.key) = 'sales_agent_commissions'
        AND COALESCE(lower(access_override.value), 'grant') = 'grant'
    ) INTO v_commission_granted;

    IF v_commission_granted THEN
      RAISE EXCEPTION 'Disable Sales Agent Commissions before revoking its Agents or Orders prerequisite'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_sales_agent_commissions_override_admin_console
  ON public.workspace_access_overrides;
CREATE TRIGGER enforce_sales_agent_commissions_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sales_agent_commissions_override_admin_console();

CREATE TABLE public.agent_commission_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  level text NOT NULL,
  rate_percent numeric(9, 6) NOT NULL,
  calculation_basis text NOT NULL DEFAULT 'net_profit',
  include_tax boolean NOT NULL DEFAULT false,
  include_delivery_charge boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT agent_commission_plans_name_check CHECK (NULLIF(btrim(name), '') IS NOT NULL),
  CONSTRAINT agent_commission_plans_level_check CHECK (level IN ('level_1', 'level_2', 'level_3')),
  CONSTRAINT agent_commission_plans_rate_check CHECK (rate_percent >= 0 AND rate_percent <= 100),
  CONSTRAINT agent_commission_plans_basis_check CHECK (calculation_basis IN ('net_profit', 'net_revenue')),
  CONSTRAINT agent_commission_plans_effective_range_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT agent_commission_plans_version_check CHECK (version >= 1)
);

CREATE TABLE public.agent_commission_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.agent_commission_plans(id) ON DELETE RESTRICT,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz NULL,
  assigned_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT agent_commission_memberships_effective_range_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT agent_commission_memberships_version_check CHECK (version >= 1),
  CONSTRAINT agent_commission_memberships_not_deleted_check CHECK (is_deleted = false)
);

CREATE TABLE public.sales_order_agent_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES crm.sales_orders(id) ON DELETE RESTRICT,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz NULL,
  assigned_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  unassigned_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reassignment_reason text NULL,
  previous_assignment_id uuid NULL REFERENCES public.sales_order_agent_assignments(id) ON DELETE RESTRICT,
  customer_city_snapshot text NULL,
  delivery_charge_amount numeric NOT NULL DEFAULT 0,
  internal_delivery_cost_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT sales_order_agent_assignments_time_check CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at),
  CONSTRAINT sales_order_agent_assignments_delivery_charge_check CHECK (delivery_charge_amount >= 0),
  CONSTRAINT sales_order_agent_assignments_delivery_cost_check CHECK (internal_delivery_cost_amount >= 0),
  CONSTRAINT sales_order_agent_assignments_version_check CHECK (version >= 1),
  CONSTRAINT sales_order_agent_assignments_not_deleted_check CHECK (is_deleted = false),
  CONSTRAINT sales_order_agent_assignments_previous_not_self CHECK (previous_assignment_id IS NULL OR previous_assignment_id <> id)
);

CREATE TABLE public.agent_commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  order_id uuid NULL REFERENCES crm.sales_orders(id) ON DELETE RESTRICT,
  assignment_id uuid NULL REFERENCES public.sales_order_agent_assignments(id) ON DELETE RESTRICT,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  membership_id uuid NULL REFERENCES public.agent_commission_memberships(id) ON DELETE RESTRICT,
  plan_id uuid NULL REFERENCES public.agent_commission_plans(id) ON DELETE RESTRICT,
  order_return_id uuid NULL REFERENCES public.order_returns(id) ON DELETE RESTRICT,
  related_entry_id uuid NULL REFERENCES public.agent_commission_entries(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  status text NOT NULL,
  currency text NOT NULL,
  calculation_basis text NOT NULL DEFAULT 'net_profit',
  include_tax boolean NOT NULL DEFAULT false,
  include_delivery_charge boolean NOT NULL DEFAULT false,
  basis_amount numeric NOT NULL DEFAULT 0,
  revenue_amount numeric NOT NULL DEFAULT 0,
  cost_amount numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  delivery_charge_amount numeric NOT NULL DEFAULT 0,
  rate_percent numeric(9, 6) NOT NULL DEFAULT 0,
  amount numeric NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payout_reference text NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT agent_commission_entries_kind_check CHECK (kind IN ('estimate', 'accrual', 'approval', 'reversal', 'payout', 'adjustment')),
  CONSTRAINT agent_commission_entries_status_check CHECK (status IN ('estimated', 'earned', 'approved', 'paid', 'reversed')),
  CONSTRAINT agent_commission_entries_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT agent_commission_entries_basis_check CHECK (calculation_basis IN ('net_profit', 'net_revenue')),
  CONSTRAINT agent_commission_entries_snapshots_check CHECK (
    basis_amount >= 0 AND revenue_amount >= 0 AND cost_amount >= 0
    AND tax_amount >= 0 AND delivery_charge_amount >= 0
    AND rate_percent >= 0 AND rate_percent <= 100
  ),
  CONSTRAINT agent_commission_entries_kind_status_check CHECK (
    (kind = 'estimate' AND status = 'estimated' AND amount >= 0)
    OR (kind = 'accrual' AND status = 'earned' AND amount >= 0)
    OR (kind = 'approval' AND status = 'approved' AND amount = 0)
    OR (kind = 'reversal' AND status = 'reversed' AND amount <= 0)
    OR (kind = 'payout' AND status = 'paid' AND amount <= 0 AND NULLIF(btrim(payout_reference), '') IS NOT NULL)
    OR (kind = 'adjustment' AND status IN ('earned', 'approved', 'reversed'))
  ),
  CONSTRAINT agent_commission_entries_return_kind_check CHECK (order_return_id IS NULL OR kind = 'reversal'),
  CONSTRAINT agent_commission_entries_version_check CHECK (version = 1),
  CONSTRAINT agent_commission_entries_not_deleted_check CHECK (is_deleted = false),
  CONSTRAINT agent_commission_entries_related_not_self CHECK (related_entry_id IS NULL OR related_entry_id <> id)
);

CREATE INDEX agent_commission_plans_workspace_idx
  ON public.agent_commission_plans (workspace_id);
CREATE INDEX agent_commission_plans_workspace_level_idx
  ON public.agent_commission_plans (workspace_id, level, effective_from DESC)
  WHERE is_deleted = false;
CREATE UNIQUE INDEX agent_commission_plans_one_per_level_idx
  ON public.agent_commission_plans (workspace_id, level)
  WHERE is_deleted = false;
CREATE INDEX agent_commission_plans_created_by_idx
  ON public.agent_commission_plans (created_by);

CREATE INDEX agent_commission_memberships_workspace_idx
  ON public.agent_commission_memberships (workspace_id);
CREATE INDEX agent_commission_memberships_agent_idx
  ON public.agent_commission_memberships (agent_id, effective_from DESC)
  WHERE is_deleted = false;
CREATE INDEX agent_commission_memberships_plan_idx
  ON public.agent_commission_memberships (plan_id)
  WHERE is_deleted = false;
CREATE INDEX agent_commission_memberships_assigned_by_idx
  ON public.agent_commission_memberships (assigned_by);
CREATE INDEX agent_commission_memberships_ended_by_idx
  ON public.agent_commission_memberships (ended_by);
CREATE UNIQUE INDEX agent_commission_memberships_one_active_idx
  ON public.agent_commission_memberships (workspace_id, agent_id)
  WHERE effective_to IS NULL AND is_deleted = false;

CREATE INDEX sales_order_agent_assignments_workspace_idx
  ON public.sales_order_agent_assignments (workspace_id);
CREATE INDEX sales_order_agent_assignments_order_idx
  ON public.sales_order_agent_assignments (order_id, assigned_at DESC)
  WHERE is_deleted = false;
CREATE INDEX sales_order_agent_assignments_agent_idx
  ON public.sales_order_agent_assignments (agent_id, assigned_at DESC)
  WHERE is_deleted = false;
CREATE INDEX sales_order_agent_assignments_previous_idx
  ON public.sales_order_agent_assignments (previous_assignment_id);
CREATE INDEX sales_order_agent_assignments_assigned_by_idx
  ON public.sales_order_agent_assignments (assigned_by);
CREATE INDEX sales_order_agent_assignments_unassigned_by_idx
  ON public.sales_order_agent_assignments (unassigned_by);
CREATE UNIQUE INDEX sales_order_agent_assignments_one_active_idx
  ON public.sales_order_agent_assignments (workspace_id, order_id)
  WHERE unassigned_at IS NULL AND is_deleted = false;

CREATE INDEX agent_commission_entries_workspace_idx
  ON public.agent_commission_entries (workspace_id);
CREATE INDEX agent_commission_entries_order_idx
  ON public.agent_commission_entries (order_id, occurred_at DESC);
CREATE INDEX agent_commission_entries_assignment_idx
  ON public.agent_commission_entries (assignment_id);
CREATE INDEX agent_commission_entries_agent_idx
  ON public.agent_commission_entries (agent_id, occurred_at DESC);
CREATE INDEX agent_commission_entries_workspace_agent_currency_idx
  ON public.agent_commission_entries (workspace_id, agent_id, currency, occurred_at DESC);
CREATE INDEX agent_commission_entries_membership_idx
  ON public.agent_commission_entries (membership_id);
CREATE INDEX agent_commission_entries_plan_idx
  ON public.agent_commission_entries (plan_id);
CREATE INDEX agent_commission_entries_return_idx
  ON public.agent_commission_entries (order_return_id);
CREATE INDEX agent_commission_entries_related_idx
  ON public.agent_commission_entries (related_entry_id);
CREATE INDEX agent_commission_entries_created_by_idx
  ON public.agent_commission_entries (created_by);
CREATE INDEX agent_commission_entries_workspace_status_idx
  ON public.agent_commission_entries (workspace_id, status, occurred_at DESC);
CREATE UNIQUE INDEX agent_commission_entries_one_accrual_per_assignment_idx
  ON public.agent_commission_entries (assignment_id)
  WHERE kind = 'accrual';
CREATE UNIQUE INDEX agent_commission_entries_one_reversal_per_return_idx
  ON public.agent_commission_entries (order_return_id, assignment_id)
  WHERE kind = 'reversal' AND order_return_id IS NOT NULL;
CREATE UNIQUE INDEX agent_commission_entries_one_approval_per_source_idx
  ON public.agent_commission_entries (related_entry_id)
  WHERE kind = 'approval';
CREATE UNIQUE INDEX agent_commission_entries_payout_reference_idx
  ON public.agent_commission_entries (
    workspace_id,
    agent_id,
    currency,
    lower(btrim(payout_reference))
  )
  WHERE kind = 'payout';

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

CREATE OR REPLACE FUNCTION private.sales_agent_commissions_is_agent_user(
  p_workspace_id uuid,
  p_agent_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM crm.agents AS agent
    WHERE agent.id = p_agent_id
      AND agent.workspace_id = p_workspace_id
      AND agent.linked_user_id = (SELECT auth.uid())
      AND agent.agent_type = 'field_agent'
      AND COALESCE(agent.is_deleted, false) = false
  );
$function$;

CREATE OR REPLACE FUNCTION private.sales_agent_commissions_plan_is_own(
  p_workspace_id uuid,
  p_plan_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.agent_commission_memberships AS membership
    JOIN crm.agents AS agent ON agent.id = membership.agent_id
    WHERE membership.workspace_id = p_workspace_id
      AND membership.plan_id = p_plan_id
      AND membership.effective_to IS NULL
      AND membership.is_deleted = false
      AND agent.linked_user_id = (SELECT auth.uid())
      AND agent.agent_type = 'field_agent'
      AND COALESCE(agent.is_deleted, false) = false
  );
$function$;

CREATE OR REPLACE FUNCTION private.sales_agent_commissions_order_is_own(
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
    FROM public.sales_order_agent_assignments AS assignment
    JOIN crm.agents AS agent ON agent.id = assignment.agent_id
    WHERE assignment.workspace_id = p_workspace_id
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
      AND agent.workspace_id = p_workspace_id
      AND agent.linked_user_id = (SELECT auth.uid())
      AND agent.agent_type = 'field_agent'
      AND COALESCE(agent.is_deleted, false) = false
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
        (
          private.sales_agent_commissions_has_permission(workspace.id, 'salesAgentCommissions.viewAll')
          OR private.sales_agent_commissions_has_permission(workspace.id, 'salesAgentCommissions.assignOrders')
          OR private.sales_agent_commissions_has_permission(workspace.id, 'salesAgentCommissions.pay')
        )
        OR (
          private.sales_agent_commissions_has_permission(workspace.id, 'salesAgentCommissions.viewOwn')
          AND private.sales_agent_commissions_order_is_own(workspace.id, p_order_id)
        )
      )
  );
$function$;

-- Keep the existing Orders view-own scope, while allowing a linked field
-- agent with the explicit commission permission to see an actively assigned
-- sales order. The commission module gate remains independent of Orders.
DROP POLICY IF EXISTS crm_sales_orders_select ON crm.sales_orders;
CREATE POLICY crm_sales_orders_select
  ON crm.sales_orders
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = sales_orders.workspace_id),
      'orders'
    )
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
      OR created_by = (SELECT auth.uid())
      OR private.sales_agent_commissions_can_view_assigned_order(workspace_id, id)
    )
  );

DROP POLICY IF EXISTS crm_order_installments_select ON crm.order_installments;
CREATE POLICY crm_order_installments_select
  ON crm.order_installments
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = order_installments.workspace_id),
      'orders'
    )
    AND (
      (
        order_type = 'sales'
        AND EXISTS (
          SELECT 1 FROM crm.sales_orders AS sales_order
          WHERE sales_order.id = order_installments.order_id
            AND sales_order.workspace_id = order_installments.workspace_id
            AND (
              NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
              OR sales_order.created_by = (SELECT auth.uid())
              OR private.sales_agent_commissions_can_view_assigned_order(
                order_installments.workspace_id,
                sales_order.id
              )
            )
        )
      )
      OR (
        order_type = 'purchase'
        AND EXISTS (
          SELECT 1 FROM crm.purchase_orders AS purchase_order
          WHERE purchase_order.id = order_installments.order_id
            AND purchase_order.workspace_id = order_installments.workspace_id
            AND (
              NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
              OR purchase_order.created_by = (SELECT auth.uid())
            )
        )
      )
    )
  );

DROP POLICY IF EXISTS order_returns_select ON public.order_returns;
CREATE POLICY order_returns_select
  ON public.order_returns
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1 FROM crm.sales_orders AS sales_order
      WHERE sales_order.id = order_returns.order_id
        AND sales_order.workspace_id = order_returns.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
          OR sales_order.created_by = (SELECT auth.uid())
          OR private.sales_agent_commissions_can_view_assigned_order(
            order_returns.workspace_id,
            sales_order.id
          )
        )
    )
  );

DROP POLICY IF EXISTS order_return_items_select ON public.order_return_items;
CREATE POLICY order_return_items_select
  ON public.order_return_items
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1 FROM crm.sales_orders AS sales_order
      WHERE sales_order.id = order_return_items.order_id
        AND sales_order.workspace_id = order_return_items.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
          OR sales_order.created_by = (SELECT auth.uid())
          OR private.sales_agent_commissions_can_view_assigned_order(
            order_return_items.workspace_id,
            sales_order.id
          )
        )
    )
  );

CREATE OR REPLACE FUNCTION private.enforce_agent_commission_plan_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
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

CREATE OR REPLACE FUNCTION private.enforce_sales_order_agent_assignment_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
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

-- Single source of truth for the commission recognized by an order's current
-- state. Every normalized persisted order adjustment, including immutable
-- post-return corrections, affects the commissionable commercial balance.
CREATE OR REPLACE FUNCTION private.calculate_sales_agent_commission_order_target(
  p_workspace_id uuid,
  p_order_id uuid,
  p_assignment_id uuid,
  p_calculation_basis text,
  p_include_tax boolean,
  p_include_delivery_charge boolean,
  p_rate_percent numeric
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
      CASE WHEN jsonb_typeof(sales_order.items) = 'array'
        THEN sales_order.items ELSE '[]'::jsonb END AS items,
      CASE WHEN jsonb_typeof(sales_order.order_adjustments) = 'array'
        THEN sales_order.order_adjustments ELSE '[]'::jsonb END AS order_adjustments,
      GREATEST(COALESCE(sales_order.discount, 0), 0) AS discount,
      CASE WHEN p_include_tax THEN GREATEST(COALESCE(sales_order.tax, 0), 0) ELSE 0 END AS tax_amount,
      CASE WHEN p_include_delivery_charge THEN assignment.delivery_charge_amount ELSE 0 END AS delivery_amount,
      CASE WHEN p_include_delivery_charge THEN assignment.internal_delivery_cost_amount ELSE 0 END AS delivery_cost,
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
  ), raw_adjustments AS (
    SELECT
      source.*,
      adjustment.item,
      COALESCE(
        adjustment.item->>'converted_amount',
        adjustment.item->>'convertedAmount',
        CASE
          WHEN lower(COALESCE(adjustment.item->>'currency', '')) = source.currency
          THEN adjustment.item->>'amount'
          ELSE NULL
        END
      ) AS converted_amount_text,
      adjustment.item->>'amount' AS original_amount_text
    FROM source
    LEFT JOIN LATERAL jsonb_array_elements(source.order_adjustments) AS adjustment(item) ON true
  ), adjustment_totals AS (
    SELECT
      raw.currency,
      raw.items,
      raw.discount,
      raw.tax_amount,
      raw.delivery_amount,
      raw.delivery_cost,
      raw.eligible,
      COALESCE(sum(
        CASE
          WHEN jsonb_typeof(raw.item) = 'object'
            AND NULLIF(btrim(COALESCE(raw.item->>'id', '')), '') IS NOT NULL
            AND NULLIF(btrim(COALESCE(raw.item->>'name', '')), '') IS NOT NULL
            AND raw.item->>'type' IN ('addition', 'deduction')
            AND lower(COALESCE(raw.item->>'currency', '')) IN ('usd', 'eur', 'iqd', 'try')
            AND lower(COALESCE(
              raw.item->>'order_currency',
              raw.item->>'orderCurrency',
              raw.currency
            )) = raw.currency
            AND COALESCE(raw.converted_amount_text, '') ~ '^[0-9]+([.][0-9]+)?$'
            AND COALESCE(raw.original_amount_text, '') ~ '^[0-9]+([.][0-9]+)?$'
          THEN CASE
            WHEN raw.converted_amount_text::numeric > 0
              AND raw.original_amount_text::numeric > 0
            THEN CASE raw.item->>'type'
              WHEN 'addition' THEN raw.converted_amount_text::numeric
              ELSE -raw.converted_amount_text::numeric
            END
            ELSE 0
          END
          ELSE 0
        END
      ), 0) AS order_adjustment_net
    FROM raw_adjustments AS raw
    GROUP BY
      raw.currency,
      raw.items,
      raw.discount,
      raw.tax_amount,
      raw.delivery_amount,
      raw.delivery_cost,
      raw.eligible
  ), normalized_lines AS (
    SELECT
      totals.currency,
      totals.discount,
      totals.tax_amount,
      totals.delivery_amount,
      totals.delivery_cost,
      totals.order_adjustment_net,
      totals.eligible,
      round(GREATEST(COALESCE(NULLIF(line.item->>'quantity', '')::numeric, 0), 0), 6) AS paid_quantity,
      round(
        GREATEST(
          COALESCE(NULLIF(line.item->>'quantity', '')::numeric, 0)
          + COALESCE(
            NULLIF(line.item->>'free_bonus_quantity', '')::numeric,
            NULLIF(line.item->>'freeBonusQuantity', '')::numeric,
            NULLIF(line.item->>'free_quantity', '')::numeric,
            NULLIF(line.item->>'freeQuantity', '')::numeric,
            0
          ),
          0
        ),
        6
      ) AS inventory_quantity,
      GREATEST(COALESCE(
        NULLIF(line.item->>'returned_quantity', '')::numeric,
        NULLIF(line.item->>'returnedQuantity', '')::numeric,
        0
      ), 0) AS raw_returned_quantity,
      GREATEST(COALESCE(
        NULLIF(line.item->>'converted_unit_price', '')::numeric,
        NULLIF(line.item->>'convertedUnitPrice', '')::numeric,
        0
      ), 0) AS unit_price,
      GREATEST(COALESCE(
        NULLIF(line.item->>'converted_cost_price', '')::numeric,
        NULLIF(line.item->>'convertedCostPrice', '')::numeric,
        NULLIF(line.item->>'cost_price', '')::numeric,
        NULLIF(line.item->>'costPrice', '')::numeric,
        0
      ), 0) AS unit_cost
    FROM adjustment_totals AS totals
    LEFT JOIN LATERAL jsonb_array_elements(totals.items) AS line(item) ON true
  ), line_amounts AS (
    SELECT
      currency,
      tax_amount,
      delivery_amount,
      delivery_cost,
      eligible,
      GREATEST(
        COALESCE(sum(
          GREATEST(
            paid_quantity - LEAST(inventory_quantity, raw_returned_quantity),
            0
          ) * unit_price
        ), 0) - discount + order_adjustment_net,
        0
      ) + tax_amount + delivery_amount AS revenue_amount,
      COALESCE(sum(
        GREATEST(
          inventory_quantity - LEAST(inventory_quantity, raw_returned_quantity),
          0
        ) * unit_cost
      ), 0) + delivery_cost AS cost_amount
    FROM normalized_lines
    GROUP BY
      currency,
      discount,
      tax_amount,
      delivery_amount,
      delivery_cost,
      order_adjustment_net,
      eligible
  ), calculated AS (
    SELECT
      currency,
      round(revenue_amount, 6) AS revenue_amount,
      round(cost_amount, 6) AS cost_amount,
      round(tax_amount, 6) AS tax_amount,
      round(delivery_amount, 6) AS delivery_charge_amount,
      round(GREATEST(
        CASE WHEN p_calculation_basis = 'net_revenue'
          THEN revenue_amount
          ELSE revenue_amount - cost_amount
        END,
        0
      ), 6) AS basis_amount,
      eligible
    FROM line_amounts
  )
  SELECT
    calculated.currency,
    CASE WHEN calculated.eligible THEN calculated.revenue_amount ELSE 0 END,
    CASE WHEN calculated.eligible THEN calculated.cost_amount ELSE 0 END,
    CASE WHEN calculated.eligible THEN calculated.tax_amount ELSE 0 END,
    CASE WHEN calculated.eligible THEN calculated.delivery_charge_amount ELSE 0 END,
    CASE WHEN calculated.eligible THEN calculated.basis_amount ELSE 0 END,
    round(
      CASE WHEN calculated.eligible
        THEN calculated.basis_amount * p_rate_percent / 100
        ELSE 0
      END,
      6
    ) AS commission_amount,
    calculated.eligible
  FROM calculated;
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
BEGIN
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
    v_target := COALESCE(v_target, 0);
  END IF;

  IF NEW.kind = 'accrual' THEN
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

    IF NOT EXISTS (
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

CREATE OR REPLACE FUNCTION private.prevent_agent_commission_entry_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Commission ledger entries are immutable'
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER enforce_agent_commission_plan_row
  BEFORE INSERT OR UPDATE ON public.agent_commission_plans
  FOR EACH ROW EXECUTE FUNCTION private.enforce_agent_commission_plan_row();

CREATE TRIGGER enforce_agent_commission_membership_row
  BEFORE INSERT OR UPDATE ON public.agent_commission_memberships
  FOR EACH ROW EXECUTE FUNCTION private.enforce_agent_commission_membership_row();

CREATE TRIGGER enforce_sales_order_agent_assignment_row
  BEFORE INSERT OR UPDATE ON public.sales_order_agent_assignments
  FOR EACH ROW EXECUTE FUNCTION private.enforce_sales_order_agent_assignment_row();

CREATE TRIGGER enforce_agent_commission_entry_row
  BEFORE INSERT OR UPDATE ON public.agent_commission_entries
  FOR EACH ROW EXECUTE FUNCTION private.enforce_agent_commission_entry_row();

CREATE TRIGGER prevent_agent_commission_entry_delete
  BEFORE DELETE ON public.agent_commission_entries
  FOR EACH ROW EXECUTE FUNCTION private.prevent_agent_commission_entry_delete();

-- Authenticated workspace members may request reconciliation, but cannot
-- choose the agent, plan, terms, snapshots, kind, or amount. The function
-- derives all lifecycle ledger events from committed server state while
-- holding the same order/assignment locks used by the entry trigger.
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

      SELECT *
      INTO v_calculation
      FROM private.calculate_sales_agent_commission_order_target(
        v_order.workspace_id,
        v_order.id,
        v_assignment.id,
        v_plan.calculation_basis,
        v_plan.include_tax,
        v_plan.include_delivery_charge,
        v_plan.rate_percent
      );
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
        v_assignment.agent_id, v_membership.id, v_plan.id, NULL, NULL,
        'accrual', 'earned', v_calculation.currency, v_plan.calculation_basis,
        v_plan.include_tax, v_plan.include_delivery_charge,
        v_calculation.basis_amount, v_calculation.revenue_amount,
        v_calculation.cost_amount, v_calculation.tax_amount,
        v_calculation.delivery_charge_amount, v_plan.rate_percent,
        v_calculation.commission_amount, v_event_at, NULL,
        'Commission accrued from committed sales order state', v_actor,
        now(), now(), 'synced', 1, false
      )
      RETURNING * INTO v_accrual;
      v_changed := v_changed + 1;
    END IF;

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

ALTER TABLE public.agent_commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_commission_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_agent_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_commission_entries ENABLE ROW LEVEL SECURITY;

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
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
      OR (
        private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewOwn')
        AND private.sales_agent_commissions_plan_is_own(workspace_id, id)
      )
    )
  );

CREATE POLICY agent_commission_plans_insert ON public.agent_commission_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_plans.workspace_id),
      'sales_agent_commissions'
    )
    AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
  );

CREATE POLICY agent_commission_plans_update ON public.agent_commission_plans
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_plans.workspace_id),
      'sales_agent_commissions'
    )
    AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
  );

CREATE POLICY agent_commission_memberships_select ON public.agent_commission_memberships
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_memberships.workspace_id),
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

CREATE POLICY agent_commission_memberships_insert ON public.agent_commission_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_memberships.workspace_id),
      'sales_agent_commissions'
    )
    AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
  );

CREATE POLICY agent_commission_memberships_update ON public.agent_commission_memberships
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_memberships.workspace_id),
      'sales_agent_commissions'
    )
    AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
  );

CREATE POLICY sales_order_agent_assignments_select ON public.sales_order_agent_assignments
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = sales_order_agent_assignments.workspace_id),
      'sales_agent_commissions'
    )
    AND (
      private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewAll')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay')
      OR (
        private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewOwn')
        AND private.sales_agent_commissions_is_agent_user(workspace_id, agent_id)
      )
    )
  );

CREATE POLICY sales_order_agent_assignments_insert ON public.sales_order_agent_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = sales_order_agent_assignments.workspace_id),
      'sales_agent_commissions'
    )
    AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
  );

CREATE POLICY sales_order_agent_assignments_update ON public.sales_order_agent_assignments
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = sales_order_agent_assignments.workspace_id),
      'sales_agent_commissions'
    )
    AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
  );

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

CREATE POLICY agent_commission_entries_insert ON public.agent_commission_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_entries.workspace_id),
      'sales_agent_commissions'
    )
    AND (
      (kind = 'estimate'
        AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders'))
      OR (kind IN ('approval', 'payout')
        AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay'))
      OR (kind = 'adjustment'
        AND related_entry_id IS NULL
        AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay'))
    )
  );

-- UPDATE exists solely so an idempotent upsert can retry the exact same row.
-- The immutable-row trigger rejects any actual field change.
CREATE POLICY agent_commission_entries_update ON public.agent_commission_entries
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay')
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_entries.workspace_id),
      'sales_agent_commissions'
    )
    AND (
      private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay')
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_workspace_permissions_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
BEGIN
  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL OR NOT public.workspace_capability_allowed(NEW.workspace_id, v_plan, 'workspaceManagementPermissions') THEN
    RAISE EXCEPTION 'Workspace management permissions are not included in the current workspace plan'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.module IN ('currencyExchange', 'currencyExchangeFeeRules')
    AND NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'currency_exchange')
  THEN
    RAISE EXCEPTION 'Currency Exchange Service is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.module IN ('agents', 'fleet')
    AND NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'agents')
  THEN
    RAISE EXCEPTION 'Agents module is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.module = 'salesAgentCommissions'
    AND NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'sales_agent_commissions')
  THEN
    RAISE EXCEPTION 'Sales Agent Commissions is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON TABLE public.agent_commission_plans FROM anon;
REVOKE ALL ON TABLE public.agent_commission_memberships FROM anon;
REVOKE ALL ON TABLE public.sales_order_agent_assignments FROM anon;
REVOKE ALL ON TABLE public.agent_commission_entries FROM anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_commission_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_commission_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sales_order_agent_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_commission_entries TO authenticated;

GRANT ALL ON TABLE public.agent_commission_plans TO service_role;
GRANT ALL ON TABLE public.agent_commission_memberships TO service_role;
GRANT ALL ON TABLE public.sales_order_agent_assignments TO service_role;
GRANT ALL ON TABLE public.agent_commission_entries TO service_role;

GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sales_agent_commissions_has_permission(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sales_agent_commissions_is_agent_user(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sales_agent_commissions_plan_is_own(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sales_agent_commissions_order_is_own(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sales_agent_commissions_can_view_assigned_order(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enforce_sales_agent_commissions_override_admin_console() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_agent_commission_plan_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_agent_commission_membership_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_sales_order_agent_assignment_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_agent_commission_entry_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.prevent_agent_commission_entry_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.calculate_sales_agent_commission_order_target(uuid, uuid, uuid, text, boolean, boolean, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_sales_agent_commission(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_sales_agent_commission(uuid, uuid) TO authenticated, service_role;

COMMENT ON TABLE public.agent_commission_plans IS
  'Effective-dated, workspace-scoped commission terms for the optional Sales Agent Commissions feature.';
COMMENT ON TABLE public.agent_commission_memberships IS
  'Effective-dated membership linking an existing field_agent to a commission plan.';
COMMENT ON TABLE public.sales_order_agent_assignments IS
  'Historical sales-order attribution with city and delivery snapshots; unrelated to optional Post Service delivery assignment.';
COMMENT ON TABLE public.agent_commission_entries IS
  'Append-only commission event ledger. Reversals and payouts are new signed events, never edits to earlier entries.';

NOTIFY pgrst, 'reload schema';
