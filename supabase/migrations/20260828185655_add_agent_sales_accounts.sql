-- Agent Sales Accounts is an admin-granted-only extension of Agents and
-- Orders. It permits explicitly enabled agents to be the selling account on a
-- sales order without receiving a linked workspace user account.

ALTER TABLE crm.agents
  ADD COLUMN IF NOT EXISTS sales_account_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE crm.sales_orders
  ADD COLUMN IF NOT EXISTS sales_account_agent_id uuid NULL
  REFERENCES crm.agents(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_crm_sales_orders_sales_account_agent
  ON crm.sales_orders (workspace_id, sales_account_agent_id)
  WHERE sales_account_agent_id IS NOT NULL;

-- Keep the database-side default deny-list explicit so a plan never enables
-- the feature. A public.workspace_access_overrides grant is the sole way to
-- enable it.
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
    WHEN 'agent_sales_accounts' THEN false
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
      lower(COALESCE(p_module, '')) NOT IN ('sales_agent_commissions', 'agent_sales_accounts')
      OR (prerequisites.agents_allowed AND prerequisites.orders_allowed)
    )
  FROM requested, prerequisites;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_agent_sales_accounts_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_workspace_id uuid;
  v_plan text;
  v_prerequisite_allowed boolean := true;
  v_add_on_granted boolean := false;
BEGIN
  IF (
      (TG_OP <> 'INSERT' AND OLD.type = 'module' AND lower(OLD.key) = 'agent_sales_accounts')
      OR (TG_OP <> 'DELETE' AND NEW.type = 'module' AND lower(NEW.key) = 'agent_sales_accounts')
    )
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Agent Sales Accounts access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  v_workspace_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  SELECT workspace.plan INTO v_plan
  FROM public.workspaces AS workspace
  WHERE workspace.id = v_workspace_id
    AND workspace.deleted_at IS NULL;

  IF TG_OP <> 'DELETE'
    AND NEW.type = 'module'
    AND lower(NEW.key) = 'agent_sales_accounts'
    AND COALESCE(lower(NEW.value), 'grant') = 'grant'
    AND (
      NOT public.workspace_module_allowed(v_workspace_id, v_plan, 'agents')
      OR NOT public.workspace_module_allowed(v_workspace_id, v_plan, 'orders')
    )
  THEN
    RAISE EXCEPTION 'Agent Sales Accounts requires both Agents and Orders workspace access'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP <> 'DELETE'
    AND NEW.type = 'module'
    AND lower(NEW.key) IN ('agents', 'orders')
    AND COALESCE(lower(NEW.value), 'grant') <> 'grant'
  THEN
    v_prerequisite_allowed := false;
  ELSIF TG_OP = 'DELETE'
    AND OLD.type = 'module'
    AND lower(OLD.key) IN ('agents', 'orders')
  THEN
    v_prerequisite_allowed := public.workspace_plan_has_module(v_plan, lower(OLD.key));
  END IF;

  IF NOT v_prerequisite_allowed THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.workspace_access_overrides AS access_override
      WHERE access_override.workspace_id = v_workspace_id
        AND access_override.type = 'module'
        AND lower(access_override.key) = 'agent_sales_accounts'
        AND COALESCE(lower(access_override.value), 'grant') = 'grant'
    ) INTO v_add_on_granted;

    IF v_add_on_granted THEN
      RAISE EXCEPTION 'Disable Agent Sales Accounts before removing its Agents or Orders prerequisite'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_agent_sales_accounts_override_admin_console
  ON public.workspace_access_overrides;
CREATE TRIGGER enforce_agent_sales_accounts_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_agent_sales_accounts_override_admin_console();

CREATE OR REPLACE FUNCTION private.enforce_agent_sales_account_enabled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, crm, private
AS $function$
DECLARE
  v_plan text;
BEGIN
  IF NOT NEW.sales_account_enabled THEN
    RETURN NEW;
  END IF;

  SELECT workspace.plan INTO v_plan
  FROM public.workspaces AS workspace
  WHERE workspace.id = NEW.workspace_id
    AND workspace.deleted_at IS NULL;

  IF NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'agent_sales_accounts') THEN
    RAISE EXCEPTION 'Agent Sales Accounts is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_agent_sales_account_enabled ON crm.agents;
CREATE TRIGGER enforce_agent_sales_account_enabled
  BEFORE INSERT OR UPDATE OF sales_account_enabled ON crm.agents
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_agent_sales_account_enabled();

CREATE OR REPLACE FUNCTION private.enforce_sales_order_agent_sales_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, crm, private
AS $function$
DECLARE
  v_plan text;
  v_agent crm.agents%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.sales_account_agent_id IS NOT DISTINCT FROM OLD.sales_account_agent_id
    AND NEW.business_partner_id IS NOT DISTINCT FROM OLD.business_partner_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.sales_account_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT workspace.plan INTO v_plan
  FROM public.workspaces AS workspace
  WHERE workspace.id = NEW.workspace_id
    AND workspace.deleted_at IS NULL;

  IF NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'agent_sales_accounts') THEN
    RAISE EXCEPTION 'Agent Sales Accounts is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  SELECT agent.* INTO v_agent
  FROM crm.agents AS agent
  WHERE agent.id = NEW.sales_account_agent_id
    AND agent.workspace_id = NEW.workspace_id
    AND agent.status = 'active'
    AND agent.sales_account_enabled = true
    AND COALESCE(agent.is_deleted, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected agent does not have an active sales account'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.business_partner_id IS DISTINCT FROM v_agent.business_partner_id THEN
    RAISE EXCEPTION 'Agent sales account must be the order counterparty'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_sales_order_agent_sales_account ON crm.sales_orders;
CREATE TRIGGER enforce_sales_order_agent_sales_account
  BEFORE INSERT OR UPDATE OF workspace_id, business_partner_id, sales_account_agent_id ON crm.sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_sales_order_agent_sales_account();
