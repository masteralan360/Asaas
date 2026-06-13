ALTER TABLE crm.business_partners
  ADD COLUMN IF NOT EXISTS agent_facet_id uuid NULL;

ALTER TABLE crm.business_partners
  DROP CONSTRAINT IF EXISTS business_partners_role_check;

ALTER TABLE crm.business_partners
  ADD CONSTRAINT business_partners_role_check CHECK (
    role IN ('customer', 'supplier', 'both', 'agent', 'buyer', 'seller')
  );

CREATE OR REPLACE FUNCTION public.workspace_plan_has_module(p_plan text, p_module text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_module, ''))
    WHEN 'pos' THEN true
    WHEN 'instant_pos' THEN true
    WHEN 'sales_history' THEN true
    WHEN 'products' THEN true
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
    WHEN 'customers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'suppliers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'orders' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'ecommerce' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'travel_agency' THEN false
    WHEN 'real_estate' THEN false
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
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_agents_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF (
      (TG_OP <> 'INSERT' AND OLD.type = 'module' AND OLD.key = 'agents')
      OR (TG_OP <> 'DELETE' AND NEW.type = 'module' AND NEW.key = 'agents')
    )
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Agents module access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_agents_override_admin_console ON public.workspace_access_overrides;
CREATE TRIGGER enforce_agents_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_agents_override_admin_console();

CREATE TABLE IF NOT EXISTS crm.agents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  business_partner_id uuid NOT NULL,
  image_url text NULL,
  zone text NOT NULL,
  agent_type text NOT NULL,
  car_model text NULL,
  plate_number text NULL,
  linked_user_id uuid NULL,
  status text NOT NULL DEFAULT 'active'::text,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  sync_status text NULL DEFAULT 'synced'::text,
  version bigint NULL DEFAULT 1,
  is_deleted boolean NULL DEFAULT false,
  CONSTRAINT agents_pkey PRIMARY KEY (id),
  CONSTRAINT agents_business_partner_id_key UNIQUE (business_partner_id),
  CONSTRAINT agents_business_partner_id_fkey
    FOREIGN KEY (business_partner_id) REFERENCES crm.business_partners(id) ON DELETE CASCADE,
  CONSTRAINT agents_linked_user_id_fkey
    FOREIGN KEY (linked_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT agents_type_check CHECK (
    agent_type IN ('driver', 'field_agent')
  ),
  CONSTRAINT agents_status_check CHECK (
    status IN ('active', 'inactive', 'blocked')
  ),
  CONSTRAINT agents_driver_vehicle_check CHECK (
    agent_type <> 'driver'
    OR (
      NULLIF(BTRIM(car_model), '') IS NOT NULL
      AND NULLIF(BTRIM(plate_number), '') IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_crm_agents_workspace
  ON crm.agents (workspace_id);

CREATE INDEX IF NOT EXISTS idx_crm_agents_workspace_status
  ON crm.agents (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_crm_agents_workspace_type
  ON crm.agents (workspace_id, agent_type);

CREATE INDEX IF NOT EXISTS idx_crm_agents_linked_user
  ON crm.agents (linked_user_id);

CREATE OR REPLACE FUNCTION public.enforce_crm_agent_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM crm.business_partners bp
    WHERE bp.id = NEW.business_partner_id
      AND bp.workspace_id = NEW.workspace_id
      AND COALESCE(bp.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Agent business partner must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.linked_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = NEW.linked_user_id
      AND p.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Linked workspace user must belong to the agent workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.linked_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM crm.agents a
    WHERE a.workspace_id = NEW.workspace_id
      AND a.linked_user_id = NEW.linked_user_id
      AND a.id <> NEW.id
      AND COALESCE(a.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Workspace user is already linked to another agent'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_crm_business_partner_agent_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE
  v_plan text;
BEGIN
  IF NEW.role <> 'agent' THEN
    RETURN NEW;
  END IF;

  SELECT w.plan::text
  INTO v_plan
  FROM public.workspaces w
  WHERE w.id = NEW.workspace_id
    AND w.deleted_at IS NULL;

  IF v_plan IS NULL OR NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'agents') THEN
    RAISE EXCEPTION 'Agents module is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_crm_agent_links ON crm.agents;
CREATE TRIGGER enforce_crm_agent_links
  BEFORE INSERT OR UPDATE ON crm.agents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crm_agent_links();

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON crm.agents;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON crm.agents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('agents');

DROP TRIGGER IF EXISTS enforce_crm_business_partner_agent_role ON crm.business_partners;
CREATE TRIGGER enforce_crm_business_partner_agent_role
  BEFORE INSERT OR UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crm_business_partner_agent_role();

ALTER TABLE crm.agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_agents_select ON crm.agents;
CREATE POLICY crm_agents_select
  ON crm.agents
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = agents.workspace_id),
      'agents'
    )
  );

DROP POLICY IF EXISTS crm_agents_insert ON crm.agents;
CREATE POLICY crm_agents_insert
  ON crm.agents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = agents.workspace_id),
      'agents'
    )
  );

DROP POLICY IF EXISTS crm_agents_update ON crm.agents;
CREATE POLICY crm_agents_update
  ON crm.agents
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = agents.workspace_id),
      'agents'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = agents.workspace_id),
      'agents'
    )
  );

DROP POLICY IF EXISTS crm_agents_delete ON crm.agents;
CREATE POLICY crm_agents_delete
  ON crm.agents
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = agents.workspace_id),
      'agents'
    )
  );

DROP POLICY IF EXISTS crm_business_partners_select ON crm.business_partners;
CREATE POLICY crm_business_partners_select
  ON crm.business_partners
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
    )
  );

DROP POLICY IF EXISTS crm_business_partners_insert ON crm.business_partners;
CREATE POLICY crm_business_partners_insert
  ON crm.business_partners
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
    )
  );

DROP POLICY IF EXISTS crm_business_partners_update ON crm.business_partners;
CREATE POLICY crm_business_partners_update
  ON crm.business_partners
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
    )
  );

DROP POLICY IF EXISTS crm_business_partners_delete ON crm.business_partners;
CREATE POLICY crm_business_partners_delete
  ON crm.business_partners
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = business_partners.workspace_id),
        'agents'
      )
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

  IF NEW.module = 'agents'
    AND NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'agents')
  THEN
    RAISE EXCEPTION 'Agents module is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.agents TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_agents_override_admin_console() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_crm_agent_links() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_crm_business_partner_agent_role() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
