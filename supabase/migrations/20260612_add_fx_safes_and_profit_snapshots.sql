ALTER TABLE fx.exchange_transactions
  ADD COLUMN IF NOT EXISTS safe_id uuid NULL,
  ADD COLUMN IF NOT EXISTS safe_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS acquisition_rate numeric NULL,
  ADD COLUMN IF NOT EXISTS acquisition_rate_source text NULL,
  ADD COLUMN IF NOT EXISTS acquisition_rate_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS profit_amount numeric NULL,
  ADD COLUMN IF NOT EXISTS profit_currency text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exchange_transactions_acquisition_source_check'
      AND conrelid = 'fx.exchange_transactions'::regclass
  ) THEN
    ALTER TABLE fx.exchange_transactions
      ADD CONSTRAINT exchange_transactions_acquisition_source_check
      CHECK (acquisition_rate_source IS NULL OR acquisition_rate_source IN ('last_buy', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exchange_transactions_profit_currency_check'
      AND conrelid = 'fx.exchange_transactions'::regclass
  ) THEN
    ALTER TABLE fx.exchange_transactions
      ADD CONSTRAINT exchange_transactions_profit_currency_check
      CHECK (profit_currency IS NULL OR profit_currency IN ('usd', 'eur', 'iqd', 'try'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS fx.fx_safes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT fx_safes_name_check CHECK (length(trim(name)) > 0),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fx.fx_safe_balances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  safe_id uuid NOT NULL,
  currency text NOT NULL,
  balance_amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT fx_safe_balances_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT fx_safe_balances_safe_currency_unique UNIQUE (safe_id, currency),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fx.fx_safe_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  safe_id uuid NOT NULL,
  safe_name_snapshot text NOT NULL,
  currency text NOT NULL,
  movement_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NULL,
  delta_amount numeric NOT NULL,
  balance_before numeric NOT NULL,
  balance_after numeric NOT NULL,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT fx_safe_movements_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT fx_safe_movements_type_check CHECK (movement_type IN ('opening_balance', 'adjustment', 'exchange_in', 'exchange_out')),
  CONSTRAINT fx_safe_movements_source_check CHECK (source_type IN ('opening_balance', 'adjustment', 'exchange_transaction')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_exchange_transactions_workspace_safe
  ON fx.exchange_transactions (workspace_id, safe_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_fx_safes_workspace_active
  ON fx.fx_safes (workspace_id, is_active)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_fx_safe_balances_workspace_safe
  ON fx.fx_safe_balances (workspace_id, safe_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_fx_safe_balances_workspace_currency
  ON fx.fx_safe_balances (workspace_id, currency)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_fx_safe_movements_workspace_safe
  ON fx.fx_safe_movements (workspace_id, safe_id, created_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_fx_safe_movements_source
  ON fx.fx_safe_movements (source_type, source_id)
  WHERE is_deleted = false;

ALTER TABLE fx.fx_safes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.fx_safe_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.fx_safe_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_safes_select ON fx.fx_safes;
CREATE POLICY fx_safes_select ON fx.fx_safes
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safes_insert ON fx.fx_safes;
CREATE POLICY fx_safes_insert ON fx.fx_safes
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safes_update ON fx.fx_safes;
CREATE POLICY fx_safes_update ON fx.fx_safes
  FOR UPDATE TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safes_delete ON fx.fx_safes;
CREATE POLICY fx_safes_delete ON fx.fx_safes
  FOR DELETE TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safe_balances_select ON fx.fx_safe_balances;
CREATE POLICY fx_safe_balances_select ON fx.fx_safe_balances
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safe_balances_insert ON fx.fx_safe_balances;
CREATE POLICY fx_safe_balances_insert ON fx.fx_safe_balances
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safe_balances_update ON fx.fx_safe_balances;
CREATE POLICY fx_safe_balances_update ON fx.fx_safe_balances
  FOR UPDATE TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safe_balances_delete ON fx.fx_safe_balances;
CREATE POLICY fx_safe_balances_delete ON fx.fx_safe_balances
  FOR DELETE TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safe_movements_select ON fx.fx_safe_movements;
CREATE POLICY fx_safe_movements_select ON fx.fx_safe_movements
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safe_movements_insert ON fx.fx_safe_movements;
CREATE POLICY fx_safe_movements_insert ON fx.fx_safe_movements
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safe_movements_update ON fx.fx_safe_movements;
CREATE POLICY fx_safe_movements_update ON fx.fx_safe_movements
  FOR UPDATE TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS fx_safe_movements_delete ON fx.fx_safe_movements;
CREATE POLICY fx_safe_movements_delete ON fx.fx_safe_movements
  FOR DELETE TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON fx.fx_safes;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON fx.fx_safes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('currency_exchange');

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON fx.fx_safe_balances;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON fx.fx_safe_balances
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('currency_exchange');

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON fx.fx_safe_movements;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON fx.fx_safe_movements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('currency_exchange');

DROP TRIGGER IF EXISTS enforce_exchange_currency_access ON fx.fx_safe_balances;
CREATE TRIGGER enforce_exchange_currency_access
  BEFORE INSERT OR UPDATE ON fx.fx_safe_balances
  FOR EACH ROW EXECUTE FUNCTION fx.enforce_exchange_currency_access();

DROP TRIGGER IF EXISTS enforce_exchange_currency_access ON fx.fx_safe_movements;
CREATE TRIGGER enforce_exchange_currency_access
  BEFORE INSERT OR UPDATE ON fx.fx_safe_movements
  FOR EACH ROW EXECUTE FUNCTION fx.enforce_exchange_currency_access();

CREATE OR REPLACE FUNCTION fx.enforce_safe_admin_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, fx
AS $function$
BEGIN
  IF NEW.movement_type IN ('opening_balance', 'adjustment')
     AND public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only workspace admins can create opening balance or adjustment safe movements'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_safe_admin_movements ON fx.fx_safe_movements;
CREATE TRIGGER enforce_safe_admin_movements
  BEFORE INSERT OR UPDATE ON fx.fx_safe_movements
  FOR EACH ROW EXECUTE FUNCTION fx.enforce_safe_admin_movements();

CREATE OR REPLACE FUNCTION public.workspace_has_fx_accounting_data(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM fx.exchange_transactions WHERE workspace_id = p_workspace_id AND is_deleted = false
    UNION ALL
    SELECT 1 FROM fx.fx_safes WHERE workspace_id = p_workspace_id AND is_deleted = false
    UNION ALL
    SELECT 1 FROM fx.fx_safe_balances WHERE workspace_id = p_workspace_id AND is_deleted = false
    UNION ALL
    SELECT 1 FROM fx.fx_safe_movements WHERE workspace_id = p_workspace_id AND is_deleted = false
    LIMIT 1
  );
$function$;

CREATE OR REPLACE FUNCTION public.enforce_fx_workspace_currency_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, fx
AS $function$
BEGIN
  IF OLD.default_currency IS DISTINCT FROM NEW.default_currency
     AND public.workspace_has_fx_accounting_data(NEW.id) THEN
    RAISE EXCEPTION 'Workspace currency is locked because Currency Exchange has safes or transactions. This protects historical balances and profit reports.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_fx_workspace_currency_lock ON public.workspaces;
CREATE TRIGGER enforce_fx_workspace_currency_lock
  BEFORE UPDATE OF default_currency ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fx_workspace_currency_lock();
