CREATE SCHEMA IF NOT EXISTS real_estate;

REVOKE ALL ON SCHEMA real_estate FROM anon;
GRANT USAGE ON SCHEMA real_estate TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA real_estate TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA real_estate TO authenticated, service_role;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA real_estate TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA real_estate REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA real_estate REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA real_estate REVOKE ALL ON ROUTINES FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA real_estate GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA real_estate GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA real_estate GRANT EXECUTE ON ROUTINES TO authenticated, service_role;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS real_estate boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
    SELECT workspace_id
    FROM public.profiles
    WHERE id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.current_workspace_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS real_estate.real_estate_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  transaction_no text NOT NULL,
  transaction_type text NOT NULL,
  location text NOT NULL,
  land_area_m2 numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  total_amount numeric NOT NULL,
  paid_amount numeric NOT NULL DEFAULT 0,
  balance_amount numeric NOT NULL DEFAULT 0,
  profit_amount numeric NOT NULL DEFAULT 0,
  buyer_name text NOT NULL,
  buyer_business_partner_id uuid NULL,
  seller_name text NOT NULL,
  seller_business_partner_id uuid NULL,
  is_installment_based boolean NOT NULL DEFAULT false,
  installment_count integer NOT NULL DEFAULT 0,
  installment_frequency text NULL,
  first_due_date date NULL,
  next_due_date date NULL,
  status text NOT NULL DEFAULT 'active',
  exchange_rate_snapshot jsonb NULL,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT real_estate_transactions_type_check CHECK (transaction_type IN ('sell', 'buy')),
  CONSTRAINT real_estate_transactions_status_check CHECK (status IN ('active', 'overdue', 'completed')),
  CONSTRAINT real_estate_transactions_frequency_check CHECK (
    installment_frequency IS NULL OR installment_frequency IN ('weekly', 'biweekly', 'monthly')
  ),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_real_estate_transactions_workspace_no
  ON real_estate.real_estate_transactions (workspace_id, transaction_no)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_real_estate_transactions_workspace
  ON real_estate.real_estate_transactions (workspace_id);

CREATE INDEX IF NOT EXISTS idx_real_estate_transactions_workspace_updated
  ON real_estate.real_estate_transactions (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_real_estate_transactions_workspace_status
  ON real_estate.real_estate_transactions (workspace_id, status)
  WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS real_estate.real_estate_installments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  installment_no integer NOT NULL,
  due_date date NOT NULL,
  planned_amount numeric NOT NULL,
  paid_amount numeric NOT NULL DEFAULT 0,
  balance_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'unpaid',
  paid_at timestamp with time zone NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT real_estate_installments_status_check CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue')),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_real_estate_installments_transaction_no
  ON real_estate.real_estate_installments (transaction_id, installment_no)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_real_estate_installments_workspace_due
  ON real_estate.real_estate_installments (workspace_id, due_date);

CREATE INDEX IF NOT EXISTS idx_real_estate_installments_workspace_status
  ON real_estate.real_estate_installments (workspace_id, status)
  WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS real_estate.real_estate_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  installment_id uuid NULL,
  amount numeric NOT NULL,
  payment_method text NOT NULL,
  payment_kind text NOT NULL DEFAULT 'manual',
  paid_at timestamp with time zone NOT NULL DEFAULT now(),
  note text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT real_estate_payments_kind_check CHECK (payment_kind IN ('down_payment', 'installment', 'manual')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_real_estate_payments_workspace_paid
  ON real_estate.real_estate_payments (workspace_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_real_estate_payments_transaction
  ON real_estate.real_estate_payments (transaction_id, paid_at DESC);

ALTER TABLE real_estate.real_estate_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE real_estate.real_estate_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE real_estate.real_estate_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS real_estate_transactions_select ON real_estate.real_estate_transactions;
CREATE POLICY real_estate_transactions_select
  ON real_estate.real_estate_transactions
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_transactions_insert ON real_estate.real_estate_transactions;
CREATE POLICY real_estate_transactions_insert
  ON real_estate.real_estate_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_transactions_update ON real_estate.real_estate_transactions;
CREATE POLICY real_estate_transactions_update
  ON real_estate.real_estate_transactions
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_transactions_delete ON real_estate.real_estate_transactions;
CREATE POLICY real_estate_transactions_delete
  ON real_estate.real_estate_transactions
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_installments_select ON real_estate.real_estate_installments;
CREATE POLICY real_estate_installments_select
  ON real_estate.real_estate_installments
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_installments_insert ON real_estate.real_estate_installments;
CREATE POLICY real_estate_installments_insert
  ON real_estate.real_estate_installments
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_installments_update ON real_estate.real_estate_installments;
CREATE POLICY real_estate_installments_update
  ON real_estate.real_estate_installments
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_installments_delete ON real_estate.real_estate_installments;
CREATE POLICY real_estate_installments_delete
  ON real_estate.real_estate_installments
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_payments_select ON real_estate.real_estate_payments;
CREATE POLICY real_estate_payments_select
  ON real_estate.real_estate_payments
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_payments_insert ON real_estate.real_estate_payments;
CREATE POLICY real_estate_payments_insert
  ON real_estate.real_estate_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_payments_update ON real_estate.real_estate_payments;
CREATE POLICY real_estate_payments_update
  ON real_estate.real_estate_payments
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS real_estate_payments_delete ON real_estate.real_estate_payments;
CREATE POLICY real_estate_payments_delete
  ON real_estate.real_estate_payments
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());
