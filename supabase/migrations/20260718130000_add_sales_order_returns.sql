-- Immutable returns for fulfilled sales orders. Purchase returns deliberately use
-- a separate workflow because they affect supplier payables and received stock.

ALTER TABLE crm.sales_orders
  ADD COLUMN IF NOT EXISTS original_total_amount numeric NULL,
  ADD COLUMN IF NOT EXISTS returned_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS returned_at timestamp with time zone NULL,
  ADD COLUMN IF NOT EXISTS returned_by uuid NULL,
  DROP CONSTRAINT IF EXISTS sales_orders_return_status_check,
  ADD CONSTRAINT sales_orders_return_status_check
    CHECK (return_status IN ('none', 'partial', 'full')),
  ADD CONSTRAINT sales_orders_returned_amount_check
    CHECK (returned_amount >= 0);

CREATE TABLE IF NOT EXISTS public.order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  order_id uuid NOT NULL REFERENCES crm.sales_orders(id) ON DELETE RESTRICT,
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
  CONSTRAINT order_returns_refund_amount_check CHECK (refund_amount >= 0)
);

CREATE TABLE IF NOT EXISTS public.order_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  return_id uuid NOT NULL REFERENCES public.order_returns(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES crm.sales_orders(id) ON DELETE RESTRICT,
  order_item_id text NOT NULL,
  quantity numeric NOT NULL,
  unit_refund_amount numeric NOT NULL DEFAULT 0,
  refund_amount numeric NOT NULL DEFAULT 0,
  restored_storage_id uuid NULL REFERENCES public.storages(id),
  restored_batch_allocations jsonb NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT order_return_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT order_return_items_unit_refund_amount_check CHECK (unit_refund_amount >= 0),
  CONSTRAINT order_return_items_refund_amount_check CHECK (refund_amount >= 0),
  CONSTRAINT order_return_items_return_line_key UNIQUE (return_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS order_returns_workspace_returned_at_idx
  ON public.order_returns (workspace_id, returned_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS order_returns_order_idx
  ON public.order_returns (order_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS order_return_items_workspace_order_idx
  ON public.order_return_items (workspace_id, order_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS order_return_items_order_line_idx
  ON public.order_return_items (order_id, order_item_id)
  WHERE is_deleted = false;

ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_returns_select ON public.order_returns;
CREATE POLICY order_returns_select ON public.order_returns
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS order_returns_insert ON public.order_returns;
CREATE POLICY order_returns_insert ON public.order_returns
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS order_returns_update ON public.order_returns;
CREATE POLICY order_returns_update ON public.order_returns
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS order_return_items_select ON public.order_return_items;
CREATE POLICY order_return_items_select ON public.order_return_items
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS order_return_items_insert ON public.order_return_items;
CREATE POLICY order_return_items_insert ON public.order_return_items
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS order_return_items_update ON public.order_return_items;
CREATE POLICY order_return_items_update ON public.order_return_items
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

GRANT SELECT, INSERT, UPDATE ON public.order_returns TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_return_items TO authenticated;
