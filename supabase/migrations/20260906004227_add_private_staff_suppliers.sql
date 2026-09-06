-- Opt-in supplier ownership. Existing workspaces and partners remain shared,
-- preserving the pre-existing workspace-wide supplier model.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS private_staff_suppliers boolean NOT NULL DEFAULT false;

-- `staff_visibility` and `owner_user_id` already protect both facets at read
-- time. Extend the write-time enforcement so non-admin staff receive the same
-- owner-private default when they create a supplier, while leaving the current
-- shared behavior untouched unless this option is enabled.
CREATE OR REPLACE FUNCTION crm.enforce_business_partner_privacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE
  workspace_settings public.workspaces%ROWTYPE;
  owner_profile public.profiles%ROWTYPE;
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.staff_visibility := 'shared';
      NEW.owner_user_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO workspace_settings
  FROM public.workspaces
  WHERE id = NEW.workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE = '42501';
  END IF;

  IF NOT crm.is_partner_privacy_admin() THEN
    -- A mixed partner is projected to restricted staff as customer-only.
    -- Preserve the hidden supplier side when that projection is written back
    -- by a normal customer-side edit.
    IF TG_OP = 'UPDATE'
      AND workspace_settings.suppliers_admin_only
      AND OLD.role = 'both' THEN
      NEW.role := OLD.role;
      NEW.supplier_facet_id := OLD.supplier_facet_id;
      NEW.payable_credit_limit := OLD.payable_credit_limit;
      NEW.total_purchase_orders := OLD.total_purchase_orders;
      NEW.total_purchase_value := OLD.total_purchase_value;
      NEW.payable_balance := OLD.payable_balance;
    END IF;

    IF workspace_settings.suppliers_admin_only
      AND (
        (TG_OP = 'INSERT' AND NEW.role IN ('supplier', 'both'))
        OR (TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role AND (OLD.role IN ('supplier', 'both') OR NEW.role IN ('supplier', 'both')))
      ) THEN
      RAISE EXCEPTION 'Supplier access is restricted to administrators in this workspace'
        USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF (
        (workspace_settings.private_staff_customers AND NEW.role IN ('customer', 'both'))
        OR (workspace_settings.private_staff_suppliers AND NEW.role IN ('supplier', 'both'))
      ) THEN
        NEW.staff_visibility := 'owner_private';
        NEW.owner_user_id := auth.uid();
      ELSE
        NEW.staff_visibility := 'shared';
        NEW.owner_user_id := NULL;
      END IF;
    ELSIF NEW.staff_visibility IS DISTINCT FROM OLD.staff_visibility
       OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
      RAISE EXCEPTION 'Only an administrator can change business partner privacy'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.staff_visibility <> 'shared' AND NEW.role NOT IN ('customer', 'supplier', 'both') THEN
    RAISE EXCEPTION 'Only customer- or supplier-capable business partners can use staff privacy'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.staff_visibility = 'owner_private' THEN
    IF NEW.role NOT IN ('customer', 'supplier', 'both') THEN
      RAISE EXCEPTION 'Only customer- or supplier-capable business partners can be owner-private'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.owner_user_id IS NULL THEN
      RAISE EXCEPTION 'Owner-private business partners require a non-admin owner'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO owner_profile
    FROM public.profiles
    WHERE id = NEW.owner_user_id
      AND workspace_id = NEW.workspace_id;
    IF NOT FOUND OR owner_profile.role = 'admin' THEN
      RAISE EXCEPTION 'Owner-private business partners require an active non-admin workspace member'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    NEW.owner_user_id := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_workspace_partner_privacy_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.private_staff_customers IS DISTINCT FROM NEW.private_staff_customers
     OR OLD.private_staff_suppliers IS DISTINCT FROM NEW.private_staff_suppliers
     OR OLD.suppliers_admin_only IS DISTINCT FROM NEW.suppliers_admin_only THEN
    INSERT INTO crm.business_partner_privacy_audit (
      workspace_id,
      event_type,
      new_value,
      changed_by
    ) VALUES (
      NEW.id,
      'workspace_settings_changed',
      jsonb_build_object(
        'privateStaffCustomers', NEW.private_staff_customers,
        'privateStaffSuppliers', NEW.private_staff_suppliers,
        'suppliersAdminOnly', NEW.suppliers_admin_only
      ),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS audit_workspace_partner_privacy_settings_on_write ON public.workspaces;
CREATE TRIGGER audit_workspace_partner_privacy_settings_on_write
  AFTER UPDATE OF private_staff_customers, private_staff_suppliers, suppliers_admin_only ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.audit_workspace_partner_privacy_settings_change();

NOTIFY pgrst, 'reload schema';
