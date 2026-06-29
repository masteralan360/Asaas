DROP POLICY IF EXISTS crm_sales_orders_select ON crm.sales_orders;
CREATE POLICY crm_sales_orders_select
  ON crm.sales_orders
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = sales_orders.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_sales_orders_insert ON crm.sales_orders;
CREATE POLICY crm_sales_orders_insert
  ON crm.sales_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = sales_orders.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_sales_orders_update ON crm.sales_orders;
CREATE POLICY crm_sales_orders_update
  ON crm.sales_orders
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = sales_orders.workspace_id),
      'orders'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = sales_orders.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_sales_orders_delete ON crm.sales_orders;
CREATE POLICY crm_sales_orders_delete
  ON crm.sales_orders
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = sales_orders.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_purchase_orders_select ON crm.purchase_orders;
CREATE POLICY crm_purchase_orders_select
  ON crm.purchase_orders
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = purchase_orders.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_purchase_orders_insert ON crm.purchase_orders;
CREATE POLICY crm_purchase_orders_insert
  ON crm.purchase_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = purchase_orders.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_purchase_orders_update ON crm.purchase_orders;
CREATE POLICY crm_purchase_orders_update
  ON crm.purchase_orders
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = purchase_orders.workspace_id),
      'orders'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = purchase_orders.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_purchase_orders_delete ON crm.purchase_orders;
CREATE POLICY crm_purchase_orders_delete
  ON crm.purchase_orders
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = purchase_orders.workspace_id),
      'orders'
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
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = order_installments.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_order_installments_insert ON crm.order_installments;
CREATE POLICY crm_order_installments_insert
  ON crm.order_installments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = order_installments.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_order_installments_update ON crm.order_installments;
CREATE POLICY crm_order_installments_update
  ON crm.order_installments
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = order_installments.workspace_id),
      'orders'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = order_installments.workspace_id),
      'orders'
    )
  );

DROP POLICY IF EXISTS crm_order_installments_delete ON crm.order_installments;
CREATE POLICY crm_order_installments_delete
  ON crm.order_installments
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = order_installments.workspace_id),
      'orders'
    )
  );
