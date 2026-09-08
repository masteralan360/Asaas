-- Generic, off-catalog installment sales. These records deliberately do not
-- join Products or Storages: the sale describes an owned item/service supplied
-- outside the catalog, while retaining customer receivables. Acquisition cost
-- remains internal for expected-profit reporting only.
CREATE TABLE IF NOT EXISTS public.installment_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  sale_no text NOT NULL,
  customer_business_partner_id uuid NOT NULL,
  customer_name_snapshot text NOT NULL,
  description text NOT NULL,
  notes text NULL,
  currency text NOT NULL,
  acquisition_cost numeric NOT NULL,
  total_sale_price numeric NOT NULL,
  gross_profit numeric NOT NULL,
  down_payment_amount numeric NOT NULL DEFAULT 0,
  customer_paid_amount numeric NOT NULL DEFAULT 0,
  customer_balance_amount numeric NOT NULL,
  installment_count integer NOT NULL,
  installment_frequency text NOT NULL,
  first_due_date date NOT NULL,
  next_due_date date NULL,
  status text NOT NULL DEFAULT 'active',
  cancelled_at timestamp with time zone NULL,
  cancelled_by uuid NULL,
  cancellation_reason text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT installment_sales_price_check CHECK (acquisition_cost > 0 AND total_sale_price >= acquisition_cost),
  CONSTRAINT installment_sales_profit_check CHECK (gross_profit = total_sale_price - acquisition_cost),
  CONSTRAINT installment_sales_customer_balance_check CHECK (customer_paid_amount >= 0 AND customer_balance_amount >= 0 AND (status = 'cancelled' OR customer_paid_amount + customer_balance_amount = total_sale_price)),
  CONSTRAINT installment_sales_down_payment_check CHECK (down_payment_amount >= 0 AND down_payment_amount < total_sale_price AND (status = 'cancelled' OR customer_paid_amount >= down_payment_amount)),
  CONSTRAINT installment_sales_installment_check CHECK (installment_count > 0 AND installment_frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  CONSTRAINT installment_sales_status_check CHECK (status IN ('active', 'overdue', 'completed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS installment_sales_workspace_sale_no_key
  ON public.installment_sales (workspace_id, sale_no)
  WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS installment_sales_workspace_status_created_idx
  ON public.installment_sales (workspace_id, status, created_at DESC)
  WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS installment_sales_customer_idx
  ON public.installment_sales (workspace_id, customer_business_partner_id)
  WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS public.installment_sale_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  installment_sale_id uuid NOT NULL REFERENCES public.installment_sales(id) ON DELETE RESTRICT,
  installment_no integer NOT NULL,
  due_date date NOT NULL,
  planned_amount numeric NOT NULL,
  paid_amount numeric NOT NULL DEFAULT 0,
  balance_amount numeric NOT NULL,
  status text NOT NULL,
  paid_at timestamp with time zone NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT installment_sale_installments_amount_check CHECK (planned_amount > 0 AND paid_amount >= 0 AND balance_amount >= 0 AND (status = 'cancelled' OR paid_amount + balance_amount = planned_amount)),
  CONSTRAINT installment_sale_installments_status_check CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue', 'cancelled')),
  CONSTRAINT installment_sale_installments_number_check CHECK (installment_no > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS installment_sale_installments_sale_number_key
  ON public.installment_sale_installments (installment_sale_id, installment_no)
  WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS installment_sale_installments_workspace_due_idx
  ON public.installment_sale_installments (workspace_id, due_date, status)
  WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS public.installment_sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  installment_sale_id uuid NOT NULL REFERENCES public.installment_sales(id) ON DELETE RESTRICT,
  installment_id uuid NULL REFERENCES public.installment_sale_installments(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL,
  paid_at timestamp with time zone NOT NULL,
  note text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS installment_sale_payments_sale_paid_idx
  ON public.installment_sale_payments (installment_sale_id, paid_at DESC)
  WHERE NOT is_deleted;

ALTER TABLE public.installment_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_sale_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_sale_payments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'installment_sales',
    'installment_sale_installments',
    'installment_sale_payments'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_select', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_insert', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_update', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_delete', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (workspace_id = public.current_workspace_id())', table_name || '_select', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (workspace_id = public.current_workspace_id() AND public.current_user_role() IN (''admin'', ''staff''))', table_name || '_insert', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (workspace_id = public.current_workspace_id() AND public.current_user_role() IN (''admin'', ''staff'')) WITH CHECK (workspace_id = public.current_workspace_id() AND public.current_user_role() IN (''admin'', ''staff''))', table_name || '_update', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (workspace_id = public.current_workspace_id() AND public.current_user_role() IN (''admin'', ''staff''))', table_name || '_delete', table_name);
  END LOOP;
END $$;
