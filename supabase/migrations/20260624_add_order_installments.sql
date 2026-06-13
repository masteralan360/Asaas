ALTER TABLE crm.sales_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_installment_based boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS installment_frequency text NULL,
  ADD COLUMN IF NOT EXISTS first_due_date date NULL,
  ADD COLUMN IF NOT EXISTS next_due_date date NULL;

ALTER TABLE crm.purchase_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_installment_based boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS installment_frequency text NULL,
  ADD COLUMN IF NOT EXISTS first_due_date date NULL,
  ADD COLUMN IF NOT EXISTS next_due_date date NULL;

UPDATE crm.sales_orders
SET
  paid_amount = CASE WHEN is_paid THEN total ELSE 0 END,
  balance_amount = CASE WHEN is_paid THEN 0 ELSE total END,
  payment_status = CASE WHEN is_paid THEN 'paid' ELSE 'unpaid' END
WHERE paid_amount = 0
  AND balance_amount = 0;

UPDATE crm.purchase_orders
SET
  paid_amount = CASE WHEN is_paid THEN total ELSE 0 END,
  balance_amount = CASE WHEN is_paid THEN 0 ELSE total END,
  payment_status = CASE WHEN is_paid THEN 'paid' ELSE 'unpaid' END
WHERE paid_amount = 0
  AND balance_amount = 0;

ALTER TABLE crm.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_payment_status_check,
  ADD CONSTRAINT sales_orders_payment_status_check
    CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  DROP CONSTRAINT IF EXISTS sales_orders_installment_frequency_check,
  ADD CONSTRAINT sales_orders_installment_frequency_check
    CHECK (installment_frequency IS NULL OR installment_frequency IN ('weekly', 'biweekly', 'monthly')),
  DROP CONSTRAINT IF EXISTS sales_orders_payment_amounts_check,
  ADD CONSTRAINT sales_orders_payment_amounts_check
    CHECK (paid_amount >= 0 AND balance_amount >= 0);

ALTER TABLE crm.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_payment_status_check,
  ADD CONSTRAINT purchase_orders_payment_status_check
    CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  DROP CONSTRAINT IF EXISTS purchase_orders_installment_frequency_check,
  ADD CONSTRAINT purchase_orders_installment_frequency_check
    CHECK (installment_frequency IS NULL OR installment_frequency IN ('weekly', 'biweekly', 'monthly')),
  DROP CONSTRAINT IF EXISTS purchase_orders_payment_amounts_check,
  ADD CONSTRAINT purchase_orders_payment_amounts_check
    CHECK (paid_amount >= 0 AND balance_amount >= 0);

CREATE TABLE IF NOT EXISTS crm.order_installments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  order_type text NOT NULL,
  order_id uuid NOT NULL,
  installment_no integer NOT NULL,
  due_date date NOT NULL,
  planned_amount numeric NOT NULL,
  paid_amount numeric NOT NULL DEFAULT 0,
  balance_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'unpaid',
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
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_order_installments_insert ON crm.order_installments;
CREATE POLICY crm_order_installments_insert
  ON crm.order_installments
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_order_installments_update ON crm.order_installments;
CREATE POLICY crm_order_installments_update
  ON crm.order_installments
  FOR UPDATE TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS crm_order_installments_delete ON crm.order_installments;
CREATE POLICY crm_order_installments_delete
  ON crm.order_installments
  FOR DELETE TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON crm.order_installments;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON crm.order_installments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_workspace_module_plan_access('orders');

DROP TRIGGER IF EXISTS enforce_workspace_currency_plan_access ON crm.sales_orders;
CREATE TRIGGER enforce_workspace_currency_plan_access
  BEFORE INSERT OR UPDATE ON crm.sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_workspace_currency_plan_access();

DROP TRIGGER IF EXISTS enforce_workspace_currency_plan_access ON crm.purchase_orders;
CREATE TRIGGER enforce_workspace_currency_plan_access
  BEFORE INSERT OR UPDATE ON crm.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_workspace_currency_plan_access();
