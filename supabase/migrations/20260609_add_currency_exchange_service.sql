CREATE SCHEMA IF NOT EXISTS fx;

REVOKE ALL ON SCHEMA fx FROM anon;
GRANT USAGE ON SCHEMA fx TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fx TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA fx TO authenticated, service_role;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA fx TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA fx REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA fx REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA fx REVOKE ALL ON ROUTINES FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA fx GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fx GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fx GRANT EXECUTE ON ROUTINES TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS fx.exchange_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  transaction_no text NOT NULL,
  transaction_type text NOT NULL,
  transaction_date timestamp with time zone NOT NULL DEFAULT now(),
  from_currency text NOT NULL,
  to_currency text NOT NULL,
  customer_gives_amount numeric NOT NULL,
  customer_receives_amount numeric NOT NULL,
  exchange_rate_used numeric NOT NULL,
  exchange_rate_source text NOT NULL,
  exchange_rate_manually_edited boolean NOT NULL DEFAULT false,
  market_rate_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  fee_rule_id uuid NULL,
  fee_rule_snapshot jsonb NULL,
  fee_type text NULL,
  fee_currency text NULL,
  original_fee_value numeric NULL,
  final_fee_value numeric NOT NULL DEFAULT 0,
  fee_amount numeric NOT NULL DEFAULT 0,
  fee_edited boolean NOT NULL DEFAULT false,
  payment_method text NOT NULL,
  employee_user_id uuid NULL,
  employee_name text NULL,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT exchange_transactions_type_check CHECK (transaction_type IN ('buy', 'sell')),
  CONSTRAINT exchange_transactions_currency_check CHECK (
    from_currency IN ('usd', 'eur', 'iqd', 'try')
    AND to_currency IN ('usd', 'eur', 'iqd', 'try')
    AND from_currency <> to_currency
  ),
  CONSTRAINT exchange_transactions_fee_type_check CHECK (fee_type IS NULL OR fee_type IN ('fixed', 'percentage')),
  CONSTRAINT exchange_transactions_fee_currency_check CHECK (fee_currency IS NULL OR fee_currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT exchange_transactions_payment_method_check CHECK (payment_method IN ('cash', 'fib', 'qicard', 'zaincash', 'fastpay')),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fx.exchange_fee_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  transaction_scope text NOT NULL DEFAULT 'both',
  fee_type text NOT NULL,
  currency text NOT NULL,
  value numeric NOT NULL,
  customer_gives_basis_amount numeric NOT NULL DEFAULT 100000,
  effective_start_date timestamp with time zone NOT NULL,
  effective_end_date timestamp with time zone NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_locked boolean NOT NULL DEFAULT false,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT exchange_fee_rules_scope_check CHECK (transaction_scope IN ('buy', 'sell', 'both')),
  CONSTRAINT exchange_fee_rules_type_check CHECK (fee_type IN ('fixed', 'percentage')),
  CONSTRAINT exchange_fee_rules_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT exchange_fee_rules_value_check CHECK (value >= 0),
  CONSTRAINT exchange_fee_rules_basis_amount_check CHECK (customer_gives_basis_amount > 0),
  CONSTRAINT exchange_fee_rules_dates_check CHECK (effective_end_date IS NULL OR effective_end_date >= effective_start_date),
  PRIMARY KEY (id)
);

ALTER TABLE fx.exchange_fee_rules
  ADD COLUMN IF NOT EXISTS customer_gives_basis_amount numeric NOT NULL DEFAULT 100000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'exchange_fee_rules_basis_amount_check'
      AND conrelid = 'fx.exchange_fee_rules'::regclass
  ) THEN
    ALTER TABLE fx.exchange_fee_rules
      ADD CONSTRAINT exchange_fee_rules_basis_amount_check CHECK (customer_gives_basis_amount > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_transactions_workspace_no
  ON fx.exchange_transactions (workspace_id, transaction_no)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_exchange_transactions_workspace_created
  ON fx.exchange_transactions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exchange_transactions_workspace_date
  ON fx.exchange_transactions (workspace_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_exchange_transactions_workspace_type
  ON fx.exchange_transactions (workspace_id, transaction_type)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_exchange_fee_rules_workspace_active
  ON fx.exchange_fee_rules (workspace_id, is_active, effective_start_date DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_exchange_fee_rules_workspace_scope
  ON fx.exchange_fee_rules (workspace_id, transaction_scope, currency)
  WHERE is_deleted = false;

ALTER TABLE fx.exchange_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.exchange_fee_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exchange_transactions_select ON fx.exchange_transactions;
CREATE POLICY exchange_transactions_select
  ON fx.exchange_transactions
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS exchange_transactions_insert ON fx.exchange_transactions;
CREATE POLICY exchange_transactions_insert
  ON fx.exchange_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS exchange_transactions_update ON fx.exchange_transactions;
CREATE POLICY exchange_transactions_update
  ON fx.exchange_transactions
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS exchange_transactions_delete ON fx.exchange_transactions;
CREATE POLICY exchange_transactions_delete
  ON fx.exchange_transactions
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS exchange_fee_rules_select ON fx.exchange_fee_rules;
CREATE POLICY exchange_fee_rules_select
  ON fx.exchange_fee_rules
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS exchange_fee_rules_insert ON fx.exchange_fee_rules;
CREATE POLICY exchange_fee_rules_insert
  ON fx.exchange_fee_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS exchange_fee_rules_update ON fx.exchange_fee_rules;
CREATE POLICY exchange_fee_rules_update
  ON fx.exchange_fee_rules
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS exchange_fee_rules_delete ON fx.exchange_fee_rules;
CREATE POLICY exchange_fee_rules_delete
  ON fx.exchange_fee_rules
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

CREATE OR REPLACE FUNCTION public.workspace_plan_has_module(p_plan text, p_module text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_module, ''))
    WHEN 'pos' THEN true
    WHEN 'instant_pos' THEN true
    WHEN 'sales_history' THEN true
    WHEN 'products' THEN true
    WHEN 'storages' THEN true
    WHEN 'inventory_transfer' THEN true
    WHEN 'inventory_transactions' THEN true
    WHEN 'stock_adjustments' THEN true
    WHEN 'ledger' THEN true
    WHEN 'payments' THEN true
    WHEN 'direct_transactions' THEN true
    WHEN 'members' THEN true
    WHEN 'business_partners' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'customers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'suppliers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'orders' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'ecommerce' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'real_estate' THEN false
    WHEN 'currency_exchange' THEN false
    WHEN 'loans' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'installments' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'discounts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'revenue_analytics' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'team_performance' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'invoice_history' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'accounting' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'hr' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'expenses' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'payroll' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsapp' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    ELSE false
  END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON fx.exchange_transactions;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON fx.exchange_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('currency_exchange');

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON fx.exchange_fee_rules;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON fx.exchange_fee_rules
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('currency_exchange');

CREATE OR REPLACE FUNCTION fx.enforce_exchange_currency_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, fx
AS $function$
DECLARE
  v_workspace_id uuid;
  v_plan text;
  v_currency text;
BEGIN
  v_workspace_id := nullif(to_jsonb(NEW)->>'workspace_id', '')::uuid;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = v_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH v_currency IN ARRAY ARRAY[
    lower(nullif(to_jsonb(NEW)->>'from_currency', '')),
    lower(nullif(to_jsonb(NEW)->>'to_currency', '')),
    lower(nullif(coalesce(to_jsonb(NEW)->>'fee_currency', to_jsonb(NEW)->>'currency'), ''))
  ]
  LOOP
    IF v_currency IS NOT NULL AND NOT public.workspace_currency_allowed(v_workspace_id, v_plan, v_currency) THEN
      RAISE EXCEPTION 'Currency % is not included in the current workspace plan', v_currency
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_exchange_currency_access ON fx.exchange_transactions;
CREATE TRIGGER enforce_exchange_currency_access
  BEFORE INSERT OR UPDATE ON fx.exchange_transactions
  FOR EACH ROW EXECUTE FUNCTION fx.enforce_exchange_currency_access();

DROP TRIGGER IF EXISTS enforce_exchange_currency_access ON fx.exchange_fee_rules;
CREATE TRIGGER enforce_exchange_currency_access
  BEFORE INSERT OR UPDATE ON fx.exchange_fee_rules
  FOR EACH ROW EXECUTE FUNCTION fx.enforce_exchange_currency_access();

CREATE OR REPLACE FUNCTION fx.enforce_exchange_fee_rule_lock_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, fx
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_locked IS TRUE AND public.current_user_role() <> 'admin' THEN
      RAISE EXCEPTION 'Only workspace admins can create locked currency exchange fee rules'
        USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.is_locked IS DISTINCT FROM NEW.is_locked AND public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only workspace admins can lock or unlock currency exchange fee rules'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_exchange_fee_rule_lock_admin ON fx.exchange_fee_rules;
CREATE TRIGGER enforce_exchange_fee_rule_lock_admin
  BEFORE INSERT OR UPDATE ON fx.exchange_fee_rules
  FOR EACH ROW EXECUTE FUNCTION fx.enforce_exchange_fee_rule_lock_admin();

CREATE OR REPLACE FUNCTION public.enforce_workspace_permissions_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
BEGIN
  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL OR NOT public.workspace_capability_allowed(NEW.workspace_id, v_plan, 'workspaceManagementPermissions') THEN
    RAISE EXCEPTION 'Workspace management permissions are not included in the current workspace plan'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.module IN ('currencyExchange', 'currencyExchangeFeeRules')
    AND NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'currency_exchange')
  THEN
    RAISE EXCEPTION 'Currency Exchange Service is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fx.enforce_exchange_currency_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fx.enforce_exchange_fee_rule_lock_admin() TO authenticated, service_role;
