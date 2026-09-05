-- CRM customer and supplier tables are intentionally readable only through
-- privacy-filtered RPCs. RLS policies that join those tables run as the
-- requesting user, so direct joins fail with 42501 before they can filter.
-- Keep the lookup inside narrowly scoped security-definer helpers instead.
CREATE OR REPLACE FUNCTION crm.can_access_customer_link(
  p_workspace_id uuid,
  p_customer_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT p_workspace_id = public.current_workspace_id()
    AND p_customer_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM crm.customers AS customer
      WHERE customer.id = p_customer_id
        AND customer.workspace_id = p_workspace_id
        AND crm.can_access_business_partner(
          customer.workspace_id,
          customer.business_partner_id,
          'customer'
        )
    );
$function$;

CREATE OR REPLACE FUNCTION crm.can_access_supplier_link(
  p_workspace_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT p_workspace_id = public.current_workspace_id()
    AND p_supplier_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM crm.suppliers AS supplier
      WHERE supplier.id = p_supplier_id
        AND supplier.workspace_id = p_workspace_id
        AND crm.can_access_business_partner(
          supplier.workspace_id,
          supplier.business_partner_id,
          'supplier'
        )
    );
$function$;

-- Marketplace records retain a customer snapshot. A missing linked customer
-- remains valid, but a linked customer hidden by privacy rules must hide its
-- corresponding marketplace order.
CREATE OR REPLACE FUNCTION crm.has_no_hidden_customer_link(
  p_workspace_id uuid,
  p_customer_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT p_workspace_id = public.current_workspace_id()
    AND (
      p_customer_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM crm.customers AS customer
        WHERE customer.id = p_customer_id
          AND customer.workspace_id = p_workspace_id
          AND NOT crm.can_access_business_partner(
            customer.workspace_id,
            customer.business_partner_id,
            'customer'
          )
      )
    );
$function$;

REVOKE ALL ON FUNCTION crm.can_access_customer_link(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.can_access_supplier_link(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.has_no_hidden_customer_link(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.can_access_customer_link(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.can_access_supplier_link(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.has_no_hidden_customer_link(uuid, uuid) TO authenticated, service_role;

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
        AND crm.can_access_customer_link(workspace_id, customer_id)
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
        AND crm.can_access_supplier_link(workspace_id, supplier_id)
      )
    )
  );

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
    AND crm.has_no_hidden_customer_link(workspace_id, customer_id)
  );
