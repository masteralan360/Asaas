ALTER TABLE real_estate.real_estate_transactions
  ADD COLUMN IF NOT EXISTS buyer_witness_name text NULL,
  ADD COLUMN IF NOT EXISTS buyer_witness_address text NULL,
  ADD COLUMN IF NOT EXISTS buyer_witness_phone text NULL,
  ADD COLUMN IF NOT EXISTS seller_witness_name text NULL,
  ADD COLUMN IF NOT EXISTS seller_witness_address text NULL,
  ADD COLUMN IF NOT EXISTS seller_witness_phone text NULL;

ALTER TABLE crm.business_partners
  DROP CONSTRAINT IF EXISTS business_partners_role_check;

ALTER TABLE crm.business_partners
  ADD CONSTRAINT business_partners_role_check CHECK (
    role IN ('customer', 'supplier', 'both', 'buyer', 'seller')
  );

CREATE OR REPLACE FUNCTION public.enforce_crm_business_partner_real_estate_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
BEGIN
  IF NEW.role NOT IN ('buyer', 'seller') THEN
    RETURN NEW;
  END IF;

  SELECT plan::text INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL OR NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'real_estate') THEN
    RAISE EXCEPTION 'Real Estate partner role % requires workspace Real Estate access', NEW.role
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_crm_business_partner_real_estate_roles
  ON crm.business_partners;

CREATE TRIGGER enforce_crm_business_partner_real_estate_roles
  BEFORE INSERT OR UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crm_business_partner_real_estate_roles();

GRANT EXECUTE ON FUNCTION public.enforce_crm_business_partner_real_estate_roles() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_crm_business_partners_module_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
  v_required_module text;
BEGIN
  SELECT plan::text INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  v_required_module := CASE
    WHEN NEW.role IN ('buyer', 'seller') THEN 'real_estate'
    ELSE 'business_partners'
  END;

  IF NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, v_required_module) THEN
    RAISE EXCEPTION 'Module % is not included in the current workspace access', v_required_module
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access
  ON crm.business_partners;

DROP TRIGGER IF EXISTS enforce_crm_business_partners_module_access
  ON crm.business_partners;

CREATE TRIGGER enforce_crm_business_partners_module_access
  BEFORE INSERT OR UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crm_business_partners_module_access();

GRANT EXECUTE ON FUNCTION public.enforce_crm_business_partners_module_access() TO authenticated, service_role;
