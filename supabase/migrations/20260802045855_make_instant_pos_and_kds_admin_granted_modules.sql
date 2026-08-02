-- Instant POS and KDS are platform-admin-granted modules. They are not part of
-- any subscription plan and must not have per-workspace settings columns.

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

CREATE OR REPLACE FUNCTION public.workspace_plan_has_capability(p_plan text, p_capability text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_capability, ''))
    WHEN 'receiptprinting' THEN true
    WHEN 'a4pdfinvoices' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'pdfinvoicegeneration' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'barcodescanner' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'thermalprinter' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'multipleworkspacecontacts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'marketplaceinquiries' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'marketplacestorefronts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'loaninstallmentinvoices' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'multicurrency' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'excelexportsales' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'excelexportledger' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'excelexportrevenue' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'workspacestorageuploads' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'workspacepdfuploads' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'workspaceimageuploads' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'workspaceaudiouploads' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'workspacemanagementpermissions' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsappintegration' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsappsharing' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'stockbatches' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'orderfreebonus' THEN false
    WHEN 'pricebooks' THEN false
    WHEN 'kds' THEN false
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_workspace_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_member_count integer;
  v_branch_count integer;
  v_contact_count integer;
  v_max_contacts integer;
BEGIN
  NEW.plan := public.normalize_workspace_plan(NEW.plan);

  IF TG_OP = 'UPDATE' AND NEW.plan::text IS DISTINCT FROM OLD.plan::text THEN
    SELECT count(*) INTO v_member_count
    FROM public.profiles
    WHERE workspace_id = NEW.id;

    IF v_member_count > public.workspace_max_members(NEW.id, NEW.plan) THEN
      RAISE EXCEPTION 'Workspace member count exceeds the % plan limit', NEW.plan
        USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_branch_count
    FROM public.workspace_branches
    WHERE source_workspace_id = NEW.id
      AND archived_at IS NULL;

    IF v_branch_count > public.workspace_max_branches(NEW.id, NEW.plan) THEN
      RAISE EXCEPTION 'Workspace branch count exceeds the % plan limit', NEW.plan
        USING ERRCODE = '42501';
    END IF;

    v_max_contacts := public.workspace_max_contacts(NEW.id, NEW.plan);
    IF v_max_contacts IS NOT NULL THEN
      SELECT count(*) INTO v_contact_count
      FROM public.workspace_contacts
      WHERE workspace_id = NEW.id;

      IF v_contact_count > v_max_contacts THEN
        RAISE EXCEPTION 'Workspace contact count exceeds the % plan limit', NEW.plan
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.plan::text IS DISTINCT FROM OLD.plan::text THEN
    NEW.travel_agency := public.workspace_module_allowed(NEW.id, NEW.plan::text, 'travel_agency');
    NEW.real_estate := public.workspace_module_allowed(NEW.id, NEW.plan::text, 'real_estate');
    NEW.allow_whatsapp := public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'whatsappIntegration');
    NEW.upload_limit_mb := CASE
      WHEN public.workspace_has_override(NEW.id, 'limit', 'maxUploadSizeMb')
        THEN public.workspace_get_override_value(NEW.id, 'limit', 'maxUploadSizeMb')::integer
      ELSE CASE public.normalize_workspace_plan(NEW.plan::text)
        WHEN 'enterprise' THEN 1024
        WHEN 'business' THEN 100
        ELSE NULL
      END
    END;
  END IF;

  IF NOT public.workspace_currency_allowed(NEW.id, NEW.plan::text, NEW.default_currency::text) THEN
    NEW.default_currency := 'iqd';
  END IF;

  IF NOT public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'marketplaceStorefronts') THEN
    NEW.visibility := 'private';
    NEW.store_slug := NULL;
    NEW.store_description := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- Carry forward an existing explicit KDS capability override as the new KDS
-- module override, then eliminate the old capability key.
INSERT INTO public.workspace_access_overrides (workspace_id, type, key, value, created_by)
SELECT workspace_id, 'module', 'kds', value, created_by
FROM public.workspace_access_overrides
WHERE type = 'capability'
  AND lower(key) = 'kds'
ON CONFLICT (workspace_id, type, key) DO UPDATE
SET value = EXCLUDED.value,
    created_by = EXCLUDED.created_by;

DELETE FROM public.workspace_access_overrides
WHERE type = 'capability'
  AND lower(key) = 'kds';

CREATE OR REPLACE FUNCTION public.enforce_instant_pos_and_kds_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF (
      (TG_OP <> 'INSERT' AND OLD.type = 'module' AND lower(OLD.key) IN ('instant_pos', 'kds'))
      OR (TG_OP <> 'DELETE' AND NEW.type = 'module' AND lower(NEW.key) IN ('instant_pos', 'kds'))
    )
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Instant POS and KDS access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_instant_pos_and_kds_override_admin_console ON public.workspace_access_overrides;
CREATE TRIGGER enforce_instant_pos_and_kds_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_instant_pos_and_kds_override_admin_console();

CREATE OR REPLACE FUNCTION public.enforce_instant_pos_sale_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
BEGIN
  IF lower(coalesce(NEW.origin, '')) <> 'instant_pos' THEN
    RETURN NEW;
  END IF;

  SELECT plan::text
  INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL
    OR NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'instant_pos')
  THEN
    RAISE EXCEPTION 'Instant POS is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_instant_pos_sale_access ON public.sales;
CREATE TRIGGER enforce_instant_pos_sale_access
  BEFORE INSERT OR UPDATE OF workspace_id, origin ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_instant_pos_sale_access();

ALTER TABLE public.workspaces
  DROP COLUMN IF EXISTS instant_pos,
  DROP COLUMN IF EXISTS kds_enabled;

GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_has_capability(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_instant_pos_and_kds_override_admin_console() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_instant_pos_sale_access() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
