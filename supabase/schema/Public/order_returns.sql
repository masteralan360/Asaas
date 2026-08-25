CREATE TABLE public.order_returns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  order_id uuid NOT NULL REFERENCES crm.sales_orders(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  refund_amount numeric NOT NULL DEFAULT 0,
  returned_by uuid NULL,
  returned_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT order_returns_status_check CHECK (status IN ('posted', 'voided')),
  CONSTRAINT order_returns_refund_amount_check CHECK (refund_amount >= 0),
  PRIMARY KEY (id)
);

ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;

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
