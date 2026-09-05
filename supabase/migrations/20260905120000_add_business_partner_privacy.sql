-- Opt-in customer ownership and supplier privacy. Existing workspaces and
-- partners remain shared, preserving the pre-existing workspace-wide model.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS private_staff_customers boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suppliers_admin_only boolean NOT NULL DEFAULT false;

ALTER TABLE crm.business_partners
  ADD COLUMN IF NOT EXISTS staff_visibility text NOT NULL DEFAULT 'shared',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid NULL;

ALTER TABLE crm.business_partners
  DROP CONSTRAINT IF EXISTS business_partners_staff_visibility_check;

ALTER TABLE crm.business_partners
  ADD CONSTRAINT business_partners_staff_visibility_check
  CHECK (staff_visibility IN ('shared', 'admin_only', 'owner_private'));

CREATE INDEX IF NOT EXISTS business_partners_workspace_visibility_owner_idx
  ON crm.business_partners (workspace_id, staff_visibility, owner_user_id)
  WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.business_partner_privacy_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_partner_id uuid NULL REFERENCES crm.business_partners(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('partner_visibility_changed', 'workspace_settings_changed')),
  old_value jsonb NULL,
  new_value jsonb NOT NULL,
  changed_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_partner_privacy_audit_workspace_changed_idx
  ON crm.business_partner_privacy_audit (workspace_id, changed_at DESC);

ALTER TABLE crm.business_partner_privacy_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_partner_privacy_audit_select ON crm.business_partner_privacy_audit;
CREATE POLICY business_partner_privacy_audit_select
  ON crm.business_partner_privacy_audit
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

REVOKE INSERT, UPDATE, DELETE ON crm.business_partner_privacy_audit FROM authenticated;
GRANT SELECT ON crm.business_partner_privacy_audit TO authenticated;

CREATE OR REPLACE FUNCTION crm.is_partner_privacy_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT auth.role() = 'service_role' OR public.current_user_role() = 'admin';
$function$;

CREATE OR REPLACE FUNCTION crm.can_access_business_partner(
  p_workspace_id uuid,
  p_business_partner_id uuid,
  p_scope text DEFAULT 'customer'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM crm.business_partners AS partner
    INNER JOIN public.workspaces AS workspace ON workspace.id = partner.workspace_id
    WHERE partner.id = p_business_partner_id
      AND partner.workspace_id = p_workspace_id
      AND partner.workspace_id = public.current_workspace_id()
      AND COALESCE(partner.is_deleted, false) = false
      AND (
        crm.is_partner_privacy_admin()
        OR (
          (p_scope <> 'supplier' OR NOT workspace.suppliers_admin_only)
          AND (
            COALESCE(partner.staff_visibility, 'shared') = 'shared'
            OR (
              partner.staff_visibility = 'owner_private'
              AND partner.owner_user_id = auth.uid()
            )
          )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION crm.can_manage_business_partner(
  p_workspace_id uuid,
  p_business_partner_id uuid,
  p_scope text DEFAULT 'customer'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT crm.can_access_business_partner(p_workspace_id, p_business_partner_id, p_scope);
$function$;

REVOKE ALL ON FUNCTION crm.is_partner_privacy_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.can_access_business_partner(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.can_manage_business_partner(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.is_partner_privacy_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.can_access_business_partner(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.can_manage_business_partner(uuid, uuid, text) TO authenticated, service_role;

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
      IF workspace_settings.private_staff_customers
        AND NEW.role IN ('customer', 'both') THEN
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

  IF NEW.staff_visibility <> 'shared' AND NEW.role NOT IN ('customer', 'both') THEN
    RAISE EXCEPTION 'Only customer-capable business partners can use staff privacy'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.staff_visibility = 'owner_private' THEN
    IF NEW.role NOT IN ('customer', 'both') THEN
      RAISE EXCEPTION 'Only customer-capable business partners can be owner-private'
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

DROP TRIGGER IF EXISTS enforce_business_partner_privacy_on_write ON crm.business_partners;
DROP TRIGGER IF EXISTS enforce_business_partner_privacy_on_insert ON crm.business_partners;
DROP TRIGGER IF EXISTS enforce_business_partner_privacy_on_update ON crm.business_partners;
CREATE TRIGGER enforce_business_partner_privacy_on_insert
  BEFORE INSERT ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION crm.enforce_business_partner_privacy();
CREATE TRIGGER enforce_business_partner_privacy_on_update
  BEFORE UPDATE OF workspace_id, role, staff_visibility, owner_user_id,
    supplier_facet_id, payable_credit_limit, total_purchase_orders,
    total_purchase_value, payable_balance
  ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION crm.enforce_business_partner_privacy();

CREATE OR REPLACE FUNCTION public.audit_business_partner_privacy_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.staff_visibility = 'shared' THEN
      RETURN NEW;
    END IF;
  ELSIF OLD.staff_visibility IS NOT DISTINCT FROM NEW.staff_visibility
    AND OLD.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO crm.business_partner_privacy_audit (
    workspace_id,
    business_partner_id,
    event_type,
    old_value,
    new_value,
    changed_by
  ) VALUES (
    NEW.workspace_id,
    NEW.id,
    'partner_visibility_changed',
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('staffVisibility', OLD.staff_visibility, 'ownerUserId', OLD.owner_user_id) END,
    jsonb_build_object('staffVisibility', NEW.staff_visibility, 'ownerUserId', NEW.owner_user_id),
    auth.uid()
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS audit_business_partner_privacy_change_on_write ON crm.business_partners;
DROP TRIGGER IF EXISTS audit_business_partner_privacy_change_on_insert ON crm.business_partners;
DROP TRIGGER IF EXISTS audit_business_partner_privacy_change_on_update ON crm.business_partners;
CREATE TRIGGER audit_business_partner_privacy_change_on_insert
  AFTER INSERT ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION public.audit_business_partner_privacy_change();
CREATE TRIGGER audit_business_partner_privacy_change_on_update
  AFTER UPDATE OF staff_visibility, owner_user_id ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION public.audit_business_partner_privacy_change();

CREATE OR REPLACE FUNCTION public.audit_workspace_partner_privacy_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.private_staff_customers IS DISTINCT FROM NEW.private_staff_customers
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
  AFTER UPDATE OF private_staff_customers, suppliers_admin_only ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.audit_workspace_partner_privacy_settings_change();

-- Non-admin writes retain the existing access model for shared partners, but
-- cannot create supplier facets or modify private partners they do not own.
DROP POLICY IF EXISTS crm_business_partners_insert ON crm.business_partners;
CREATE POLICY crm_business_partners_insert
  ON crm.business_partners
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = business_partners.workspace_id),
        'agents'
      )
      OR delivery.module_allowed(workspace_id)
    )
  );

DROP POLICY IF EXISTS crm_business_partners_update ON crm.business_partners;
CREATE POLICY crm_business_partners_update
  ON crm.business_partners
  FOR UPDATE TO authenticated
  USING (
    crm.can_manage_business_partner(workspace_id, id, CASE WHEN role = 'supplier' THEN 'supplier' ELSE 'customer' END)
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = business_partners.workspace_id),
        'agents'
      )
      OR delivery.module_allowed(workspace_id)
    )
  )
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_business_partners_delete ON crm.business_partners;
CREATE POLICY crm_business_partners_delete
  ON crm.business_partners
  FOR DELETE TO authenticated
  USING (
    crm.can_manage_business_partner(workspace_id, id, CASE WHEN role = 'supplier' THEN 'supplier' ELSE 'customer' END)
    AND (
      role <> 'agent'
      OR public.workspace_module_allowed(
        workspace_id,
        (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = business_partners.workspace_id),
        'agents'
      )
      OR delivery.module_allowed(workspace_id)
    )
  );

DROP POLICY IF EXISTS crm_business_partner_merge_candidates_select ON crm.business_partner_merge_candidates;
CREATE POLICY crm_business_partner_merge_candidates_select
  ON crm.business_partner_merge_candidates
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1 FROM crm.business_partners AS primary_partner
      WHERE primary_partner.id = business_partner_merge_candidates.primary_partner_id
        AND primary_partner.workspace_id = business_partner_merge_candidates.workspace_id
        AND crm.can_access_business_partner(
          primary_partner.workspace_id,
          primary_partner.id,
          CASE WHEN primary_partner.role = 'supplier' THEN 'supplier' ELSE 'customer' END
        )
    )
    AND EXISTS (
      SELECT 1 FROM crm.business_partners AS secondary_partner
      WHERE secondary_partner.id = business_partner_merge_candidates.secondary_partner_id
        AND secondary_partner.workspace_id = business_partner_merge_candidates.workspace_id
        AND crm.can_access_business_partner(
          secondary_partner.workspace_id,
          secondary_partner.id,
          CASE WHEN secondary_partner.role = 'supplier' THEN 'supplier' ELSE 'customer' END
        )
    )
  );

DROP POLICY IF EXISTS crm_customers_select ON crm.customers;
CREATE POLICY crm_customers_select
  ON crm.customers
  FOR SELECT TO authenticated
  USING (crm.can_access_business_partner(workspace_id, business_partner_id, 'customer'));

DROP POLICY IF EXISTS crm_customers_insert ON crm.customers;
CREATE POLICY crm_customers_insert
  ON crm.customers
  FOR INSERT TO authenticated
  WITH CHECK (crm.can_manage_business_partner(workspace_id, business_partner_id, 'customer'));

DROP POLICY IF EXISTS crm_customers_update ON crm.customers;
CREATE POLICY crm_customers_update
  ON crm.customers
  FOR UPDATE TO authenticated
  USING (crm.can_manage_business_partner(workspace_id, business_partner_id, 'customer'))
  WITH CHECK (crm.can_manage_business_partner(workspace_id, business_partner_id, 'customer'));

DROP POLICY IF EXISTS crm_customers_delete ON crm.customers;
CREATE POLICY crm_customers_delete
  ON crm.customers
  FOR DELETE TO authenticated
  USING (crm.can_manage_business_partner(workspace_id, business_partner_id, 'customer'));

DROP POLICY IF EXISTS crm_suppliers_select ON crm.suppliers;
CREATE POLICY crm_suppliers_select
  ON crm.suppliers
  FOR SELECT TO authenticated
  USING (crm.can_access_business_partner(workspace_id, business_partner_id, 'supplier'));

DROP POLICY IF EXISTS crm_suppliers_insert ON crm.suppliers;
CREATE POLICY crm_suppliers_insert
  ON crm.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (crm.can_manage_business_partner(workspace_id, business_partner_id, 'supplier'));

DROP POLICY IF EXISTS crm_suppliers_update ON crm.suppliers;
CREATE POLICY crm_suppliers_update
  ON crm.suppliers
  FOR UPDATE TO authenticated
  USING (crm.can_manage_business_partner(workspace_id, business_partner_id, 'supplier'))
  WITH CHECK (crm.can_manage_business_partner(workspace_id, business_partner_id, 'supplier'));

DROP POLICY IF EXISTS crm_suppliers_delete ON crm.suppliers;
CREATE POLICY crm_suppliers_delete
  ON crm.suppliers
  FOR DELETE TO authenticated
  USING (crm.can_manage_business_partner(workspace_id, business_partner_id, 'supplier'));

CREATE OR REPLACE FUNCTION crm.list_visible_business_partners(p_workspace_id uuid)
RETURNS SETOF crm.business_partners
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT (
    jsonb_populate_record(
      partner,
      CASE
        WHEN workspace.suppliers_admin_only
          AND NOT crm.is_partner_privacy_admin()
          AND partner.role = 'both'
        THEN jsonb_build_object(
          'role', 'customer',
          'supplier_facet_id', NULL,
          'payable_credit_limit', NULL,
          'total_purchase_orders', 0,
          'total_purchase_value', 0,
          'payable_balance', 0
        )
        ELSE '{}'::jsonb
      END
    )
  ).*
  FROM crm.business_partners AS partner
  INNER JOIN public.workspaces AS workspace ON workspace.id = partner.workspace_id
  WHERE partner.workspace_id = p_workspace_id
    AND partner.workspace_id = public.current_workspace_id()
    AND COALESCE(partner.is_deleted, false) = false
    AND crm.can_access_business_partner(
      partner.workspace_id,
      partner.id,
      CASE WHEN partner.role = 'supplier' THEN 'supplier' ELSE 'customer' END
    );
$function$;

CREATE OR REPLACE FUNCTION crm.list_visible_customers(p_workspace_id uuid)
RETURNS SETOF crm.customers
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT customer.*
  FROM crm.customers AS customer
  WHERE customer.workspace_id = p_workspace_id
    AND customer.workspace_id = public.current_workspace_id()
    AND COALESCE(customer.is_deleted, false) = false
    AND crm.can_access_business_partner(customer.workspace_id, customer.business_partner_id, 'customer');
$function$;

CREATE OR REPLACE FUNCTION crm.list_visible_suppliers(p_workspace_id uuid)
RETURNS SETOF crm.suppliers
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT supplier.*
  FROM crm.suppliers AS supplier
  WHERE supplier.workspace_id = p_workspace_id
    AND supplier.workspace_id = public.current_workspace_id()
    AND COALESCE(supplier.is_deleted, false) = false
    AND crm.can_access_business_partner(supplier.workspace_id, supplier.business_partner_id, 'supplier');
$function$;

REVOKE ALL ON FUNCTION crm.list_visible_business_partners(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.list_visible_customers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.list_visible_suppliers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.list_visible_business_partners(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.list_visible_customers(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.list_visible_suppliers(uuid) TO authenticated, service_role;

-- The RPCs above are the only readable projection for these three tables.
-- This prevents direct REST reads from exposing a mixed partner's supplier
-- fields when only its customer side is allowed.
REVOKE SELECT ON crm.business_partners, crm.customers, crm.suppliers FROM authenticated;

CREATE OR REPLACE FUNCTION crm.enforce_visible_partner_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE
  partner_id uuid;
  partner_scope text := CASE WHEN TG_TABLE_NAME = 'purchase_orders' THEN 'supplier' ELSE 'customer' END;
  facet_id uuid;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  partner_id := NULLIF(to_jsonb(NEW)->>'business_partner_id', '')::uuid;
  IF partner_id IS NULL THEN
    IF TG_TABLE_NAME = 'purchase_orders' THEN
      facet_id := NULLIF(to_jsonb(NEW)->>'supplier_id', '')::uuid;
      SELECT supplier.business_partner_id INTO partner_id FROM crm.suppliers AS supplier WHERE supplier.id = facet_id;
    ELSE
      facet_id := NULLIF(to_jsonb(NEW)->>'customer_id', '')::uuid;
      SELECT customer.business_partner_id INTO partner_id FROM crm.customers AS customer WHERE customer.id = facet_id;
    END IF;
  END IF;

  IF partner_id IS NOT NULL
    AND NOT crm.can_access_business_partner(NEW.workspace_id, partner_id, partner_scope) THEN
    RAISE EXCEPTION 'Business partner is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_visible_partner_link_on_sales_orders ON crm.sales_orders;
CREATE TRIGGER enforce_visible_partner_link_on_sales_orders
  BEFORE INSERT OR UPDATE ON crm.sales_orders
  FOR EACH ROW EXECUTE FUNCTION crm.enforce_visible_partner_link();

DROP TRIGGER IF EXISTS enforce_visible_partner_link_on_purchase_orders ON crm.purchase_orders;
CREATE TRIGGER enforce_visible_partner_link_on_purchase_orders
  BEFORE INSERT OR UPDATE ON crm.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION crm.enforce_visible_partner_link();

DROP POLICY IF EXISTS crm_sales_orders_select ON crm.sales_orders;
CREATE POLICY crm_sales_orders_select
  ON crm.sales_orders
  FOR SELECT TO authenticated
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
    AND (
      (business_partner_id IS NOT NULL AND crm.can_access_business_partner(workspace_id, business_partner_id, 'customer'))
      OR (
        business_partner_id IS NULL
        AND EXISTS (
          SELECT 1 FROM crm.customers AS customer
          WHERE customer.id = sales_orders.customer_id
            AND customer.workspace_id = sales_orders.workspace_id
            AND crm.can_access_business_partner(customer.workspace_id, customer.business_partner_id, 'customer')
        )
      )
    )
  );

DROP POLICY IF EXISTS crm_purchase_orders_select ON crm.purchase_orders;
CREATE POLICY crm_purchase_orders_select
  ON crm.purchase_orders
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = purchase_orders.workspace_id),
      'orders'
    )
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
      OR created_by = (SELECT auth.uid())
    )
    AND (
      (business_partner_id IS NOT NULL AND crm.can_access_business_partner(workspace_id, business_partner_id, 'supplier'))
      OR (
        business_partner_id IS NULL
        AND EXISTS (
          SELECT 1 FROM crm.suppliers AS supplier
          WHERE supplier.id = purchase_orders.supplier_id
            AND supplier.workspace_id = purchase_orders.workspace_id
            AND crm.can_access_business_partner(supplier.workspace_id, supplier.business_partner_id, 'supplier')
        )
      )
    )
  );

-- Point-of-sale sales are not linked to a customer/business partner. Customer
-- visibility is enforced for crm.sales_orders above, where that relationship
-- exists; this policy intentionally retains the pre-existing POS access rule.
DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select
  ON public.sales
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
      OR cashier_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS loans_select ON public.loans;
CREATE POLICY loans_select
  ON public.loans
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      (
        COALESCE(loan_category, 'standard') = 'simple'
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('loans.view_own'))
          OR created_by = (SELECT auth.uid())
        )
      )
      OR (
        COALESCE(loan_category, 'standard') <> 'simple'
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('installments.view_own'))
          OR created_by = (SELECT auth.uid())
        )
      )
    )
    AND (
      linked_party_type IS DISTINCT FROM 'business_partner'
      OR linked_party_id IS NULL
      OR crm.can_access_business_partner(workspace_id, linked_party_id, 'customer')
    )
  );

DROP POLICY IF EXISTS payment_transactions_select ON public.payment_transactions;
CREATE POLICY payment_transactions_select
  ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      NULLIF(metadata->>'businessPartnerId', '') IS NULL
      OR crm.can_access_business_partner(
        workspace_id,
        NULLIF(metadata->>'businessPartnerId', '')::uuid,
        CASE WHEN source_type = 'purchase_order' THEN 'supplier' ELSE 'customer' END
      )
    )
  );

DROP POLICY IF EXISTS real_estate_transactions_select ON real_estate.real_estate_transactions;
CREATE POLICY real_estate_transactions_select
  ON real_estate.real_estate_transactions
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (buyer_business_partner_id IS NULL OR crm.can_access_business_partner(workspace_id, buyer_business_partner_id, 'customer'))
    AND (seller_business_partner_id IS NULL OR crm.can_access_business_partner(workspace_id, seller_business_partner_id, 'customer'))
  );

-- Related real-estate rows inherit the transaction's partner visibility.
DROP POLICY IF EXISTS real_estate_installments_select ON real_estate.real_estate_installments;
CREATE POLICY real_estate_installments_select
  ON real_estate.real_estate_installments
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM real_estate.real_estate_transactions AS transaction
      WHERE transaction.id = real_estate_installments.transaction_id
        AND transaction.workspace_id = real_estate_installments.workspace_id
        AND (transaction.buyer_business_partner_id IS NULL OR crm.can_access_business_partner(transaction.workspace_id, transaction.buyer_business_partner_id, 'customer'))
        AND (transaction.seller_business_partner_id IS NULL OR crm.can_access_business_partner(transaction.workspace_id, transaction.seller_business_partner_id, 'customer'))
    )
  );

DROP POLICY IF EXISTS real_estate_payments_select ON real_estate.real_estate_payments;
CREATE POLICY real_estate_payments_select
  ON real_estate.real_estate_payments
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM real_estate.real_estate_transactions AS transaction
      WHERE transaction.id = real_estate_payments.transaction_id
        AND transaction.workspace_id = real_estate_payments.workspace_id
        AND (transaction.buyer_business_partner_id IS NULL OR crm.can_access_business_partner(transaction.workspace_id, transaction.buyer_business_partner_id, 'customer'))
        AND (transaction.seller_business_partner_id IS NULL OR crm.can_access_business_partner(transaction.workspace_id, transaction.seller_business_partner_id, 'customer'))
    )
  );

-- Marketplace orders retain customer snapshots, so their staff-facing read
-- policy must follow the linked customer's privacy too.
DROP POLICY IF EXISTS marketplace_orders_select ON public.marketplace_orders;
CREATE POLICY marketplace_orders_select
  ON public.marketplace_orders
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND (
      business_partner_id IS NULL
      OR crm.can_access_business_partner(workspace_id, business_partner_id, 'customer')
    )
    AND NOT EXISTS (
      SELECT 1 FROM crm.customers AS customer
      WHERE customer.id = marketplace_orders.customer_id
        AND customer.workspace_id = marketplace_orders.workspace_id
        AND NOT crm.can_access_business_partner(customer.workspace_id, customer.business_partner_id, 'customer')
    )
  );

-- Car-rental requests and contracts contain customer contact information even
-- when the partner is no longer shown in the CRM directory.
CREATE OR REPLACE FUNCTION car_rental.can_access_partner_link(
  p_workspace_id uuid,
  p_business_partner_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT p_business_partner_id IS NULL
    OR crm.can_access_business_partner(p_workspace_id, p_business_partner_id, 'customer');
$function$;

CREATE OR REPLACE FUNCTION car_rental.enforce_visible_partner_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
BEGIN
  IF auth.role() <> 'service_role'
    AND NOT car_rental.can_access_partner_link(NEW.workspace_id, NEW.business_partner_id) THEN
    RAISE EXCEPTION 'Business partner is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_visible_partner_link_on_rental_requests ON car_rental.rental_requests;
CREATE TRIGGER enforce_visible_partner_link_on_rental_requests
  BEFORE INSERT OR UPDATE ON car_rental.rental_requests
  FOR EACH ROW EXECUTE FUNCTION car_rental.enforce_visible_partner_link();

DROP TRIGGER IF EXISTS enforce_visible_partner_link_on_rental_contracts ON car_rental.rental_contracts;
CREATE TRIGGER enforce_visible_partner_link_on_rental_contracts
  BEFORE INSERT OR UPDATE ON car_rental.rental_contracts
  FOR EACH ROW EXECUTE FUNCTION car_rental.enforce_visible_partner_link();

DROP POLICY IF EXISTS rental_read ON car_rental.rental_requests;
CREATE POLICY rental_read ON car_rental.rental_requests FOR SELECT TO authenticated USING (
  workspace_id = public.current_workspace_id()
  AND car_rental.module_allowed(workspace_id)
  AND car_rental.can_access_partner_link(workspace_id, business_partner_id)
);
DROP POLICY IF EXISTS rental_write ON car_rental.rental_requests;
CREATE POLICY rental_write ON car_rental.rental_requests FOR INSERT TO authenticated WITH CHECK (
  workspace_id = public.current_workspace_id()
  AND car_rental.module_allowed(workspace_id)
  AND public.current_user_role() IN ('admin', 'staff')
  AND car_rental.can_access_partner_link(workspace_id, business_partner_id)
);
DROP POLICY IF EXISTS rental_update ON car_rental.rental_requests;
CREATE POLICY rental_update ON car_rental.rental_requests FOR UPDATE TO authenticated USING (
  workspace_id = public.current_workspace_id()
  AND car_rental.module_allowed(workspace_id)
  AND public.current_user_role() IN ('admin', 'staff')
  AND car_rental.can_access_partner_link(workspace_id, business_partner_id)
) WITH CHECK (
  workspace_id = public.current_workspace_id()
  AND car_rental.module_allowed(workspace_id)
  AND public.current_user_role() IN ('admin', 'staff')
  AND car_rental.can_access_partner_link(workspace_id, business_partner_id)
);

DROP POLICY IF EXISTS rental_read ON car_rental.rental_contracts;
CREATE POLICY rental_read ON car_rental.rental_contracts FOR SELECT TO authenticated USING (
  workspace_id = public.current_workspace_id()
  AND car_rental.module_allowed(workspace_id)
  AND car_rental.can_access_partner_link(workspace_id, business_partner_id)
  AND NOT EXISTS (
    SELECT 1 FROM car_rental.rental_requests AS request
    WHERE request.id = rental_contracts.request_id
      AND request.workspace_id = rental_contracts.workspace_id
      AND NOT car_rental.can_access_partner_link(request.workspace_id, request.business_partner_id)
  )
);
DROP POLICY IF EXISTS rental_write ON car_rental.rental_contracts;
CREATE POLICY rental_write ON car_rental.rental_contracts FOR INSERT TO authenticated WITH CHECK (
  workspace_id = public.current_workspace_id()
  AND car_rental.module_allowed(workspace_id)
  AND public.current_user_role() IN ('admin', 'staff')
  AND car_rental.can_access_partner_link(workspace_id, business_partner_id)
);
DROP POLICY IF EXISTS rental_update ON car_rental.rental_contracts;
CREATE POLICY rental_update ON car_rental.rental_contracts FOR UPDATE TO authenticated USING (
  workspace_id = public.current_workspace_id()
  AND car_rental.module_allowed(workspace_id)
  AND public.current_user_role() IN ('admin', 'staff')
  AND car_rental.can_access_partner_link(workspace_id, business_partner_id)
) WITH CHECK (
  workspace_id = public.current_workspace_id()
  AND car_rental.module_allowed(workspace_id)
  AND public.current_user_role() IN ('admin', 'staff')
  AND car_rental.can_access_partner_link(workspace_id, business_partner_id)
);

-- Delivery records can reveal a merchant, its balance, recipient details, and
-- operational history. Keep every table in that record graph scoped to the
-- visible merchant rather than only filtering the merchant profile list.
CREATE OR REPLACE FUNCTION delivery.can_access_partner_linked_record(
  p_workspace_id uuid,
  p_table_name text,
  p_record jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, crm, delivery
AS $function$
DECLARE
  partner_id uuid;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN true;
  END IF;

  CASE p_table_name
    WHEN 'delivery_merchant_profiles' THEN
      partner_id := NULLIF(p_record->>'business_partner_id', '')::uuid;
    WHEN 'delivery_shipments' THEN
      partner_id := NULLIF(p_record->>'merchant_business_partner_id', '')::uuid;
    WHEN 'delivery_runs' THEN
      SELECT agent.business_partner_id INTO partner_id
      FROM crm.agents AS agent
      WHERE agent.id = NULLIF(p_record->>'agent_id', '')::uuid
        AND agent.workspace_id = p_workspace_id;
    WHEN 'delivery_run_items', 'delivery_shipment_events', 'delivery_shipment_cod_adjustment_requests' THEN
      SELECT shipment.merchant_business_partner_id INTO partner_id
      FROM delivery.delivery_shipments AS shipment
      WHERE shipment.id = NULLIF(p_record->>'shipment_id', '')::uuid
        AND shipment.workspace_id = p_workspace_id;
    WHEN 'delivery_settlements', 'delivery_ledger_entries' THEN
      partner_id := NULLIF(p_record->>'business_partner_id', '')::uuid;
      IF partner_id IS NULL AND NULLIF(p_record->>'merchant_profile_id', '') IS NOT NULL THEN
        SELECT profile.business_partner_id INTO partner_id
        FROM delivery.delivery_merchant_profiles AS profile
        WHERE profile.id = NULLIF(p_record->>'merchant_profile_id', '')::uuid
          AND profile.workspace_id = p_workspace_id;
      END IF;
      IF partner_id IS NULL AND NULLIF(p_record->>'shipment_id', '') IS NOT NULL THEN
        SELECT shipment.merchant_business_partner_id INTO partner_id
        FROM delivery.delivery_shipments AS shipment
        WHERE shipment.id = NULLIF(p_record->>'shipment_id', '')::uuid
          AND shipment.workspace_id = p_workspace_id;
      END IF;
    ELSE
      RETURN true;
  END CASE;

  RETURN partner_id IS NULL
    OR crm.can_access_business_partner(p_workspace_id, partner_id, 'customer');
END;
$function$;

CREATE OR REPLACE FUNCTION delivery.enforce_visible_partner_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, delivery
AS $function$
BEGIN
  IF NOT delivery.can_access_partner_linked_record(NEW.workspace_id, TG_TABLE_NAME, to_jsonb(NEW)) THEN
    RAISE EXCEPTION 'Business partner is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DO $do$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'delivery_merchant_profiles',
    'delivery_shipments',
    'delivery_runs',
    'delivery_run_items',
    'delivery_shipment_events',
    'delivery_shipment_cod_adjustment_requests',
    'delivery_settlements',
    'delivery_ledger_entries'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON delivery.%I', 'enforce_visible_partner_link_on_' || table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON delivery.%I FOR EACH ROW EXECUTE FUNCTION delivery.enforce_visible_partner_link()',
      'enforce_visible_partner_link_on_' || table_name,
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS delivery_read ON delivery.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS delivery_write ON delivery.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS delivery_update ON delivery.%I', table_name);
    EXECUTE format(
      'CREATE POLICY delivery_read ON delivery.%I FOR SELECT TO authenticated USING (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND delivery.can_access_partner_linked_record(workspace_id, %L, to_jsonb(%I)))',
      table_name,
      table_name,
      table_name
    );
    EXECUTE format(
      'CREATE POLICY delivery_write ON delivery.%I FOR INSERT TO authenticated WITH CHECK (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff'') AND delivery.can_access_partner_linked_record(workspace_id, %L, to_jsonb(%I)))',
      table_name,
      table_name,
      table_name
    );
    EXECUTE format(
      'CREATE POLICY delivery_update ON delivery.%I FOR UPDATE TO authenticated USING (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff'') AND delivery.can_access_partner_linked_record(workspace_id, %L, to_jsonb(%I))) WITH CHECK (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff'') AND delivery.can_access_partner_linked_record(workspace_id, %L, to_jsonb(%I)))',
      table_name,
      table_name,
      table_name,
      table_name,
      table_name
    );
  END LOOP;
END;
$do$;

NOTIFY pgrst, 'reload schema';
