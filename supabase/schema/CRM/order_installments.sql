CREATE TABLE crm.order_installments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  order_type text NOT NULL,
  order_id uuid NOT NULL,
  installment_no integer NOT NULL,
  due_date date NOT NULL,
  planned_amount numeric NOT NULL,
  paid_amount numeric NOT NULL DEFAULT 0,
  balance_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'unpaid'::text,
  paid_at timestamp with time zone NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT order_installments_order_type_check CHECK (order_type IN ('sales', 'purchase')),
  CONSTRAINT order_installments_status_check CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue')),
  CONSTRAINT order_installments_amounts_check CHECK (
    planned_amount >= 0 AND paid_amount >= 0 AND balance_amount >= 0
  ),
  CONSTRAINT order_installments_order_no_unique UNIQUE (order_type, order_id, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_crm_order_installments_workspace_due
  ON crm.order_installments (workspace_id, due_date);

CREATE INDEX IF NOT EXISTS idx_crm_order_installments_workspace_status
  ON crm.order_installments (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_crm_order_installments_order
  ON crm.order_installments (order_type, order_id);

ALTER TABLE crm.order_installments ENABLE ROW LEVEL SECURITY;

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
