-- Payment Accounts are an optional context on the authoritative payment
-- transaction. A transaction without an account continues to behave exactly
-- as it did before this migration.
CREATE SCHEMA IF NOT EXISTS payment_accounts;

GRANT USAGE ON SCHEMA payment_accounts TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.workspace_plan_has_module(p_plan text, p_module text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_module, ''))
    WHEN 'pos' THEN true
    WHEN 'instant_pos' THEN false
    WHEN 'kds' THEN false
    WHEN 'sales_history' THEN true
    WHEN 'products' THEN true
    WHEN 'services' THEN false
    WHEN 'storages' THEN true
    WHEN 'inventory_transfer' THEN true
    WHEN 'inventory_transactions' THEN true
    WHEN 'stock_adjustments' THEN true
    WHEN 'ledger' THEN true
    WHEN 'payments' THEN true
    WHEN 'direct_transactions' THEN true
    WHEN 'members' THEN true
    WHEN 'payment_accounts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'cashier_shift_control' THEN false
    WHEN 'business_partners' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'agents' THEN false
    WHEN 'sales_agent_commissions' THEN false
    WHEN 'post_service' THEN false
    WHEN 'car_rental' THEN false
    WHEN 'customers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'suppliers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'orders' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'ecommerce' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'real_estate' THEN false
    WHEN 'activities' THEN false
    WHEN 'currency_exchange' THEN false
    WHEN 'clinical_appointments' THEN false
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
    WHEN 'manual_entry' THEN false
    ELSE false
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
BEGIN
  IF (
      (TG_OP <> 'INSERT' AND OLD.type = 'module' AND lower(OLD.key) = 'cashier_shift_control')
      OR (TG_OP <> 'DELETE' AND NEW.type = 'module' AND lower(NEW.key) = 'cashier_shift_control')
    )
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Cashier Shift Control access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_cashier_shift_override_admin_console ON public.workspace_access_overrides;
CREATE TRIGGER enforce_cashier_shift_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_override_admin_console();

CREATE OR REPLACE FUNCTION payment_accounts.module_allowed(
  p_workspace_id uuid,
  p_module text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_plan text;
  v_override text;
BEGIN
  SELECT plan
  INTO v_plan
  FROM public.workspaces
  WHERE id = p_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN false;
  END IF;

  SELECT value
  INTO v_override
  FROM public.workspace_access_overrides
  WHERE workspace_id = p_workspace_id
    AND type = 'module'
    AND key = p_module
  LIMIT 1;

  IF FOUND THEN
    RETURN coalesce(v_override, 'grant') = 'grant';
  END IF;

  RETURN public.workspace_plan_has_module(v_plan, p_module);
END;
$function$;

REVOKE ALL ON FUNCTION payment_accounts.module_allowed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_accounts.module_allowed(uuid, text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS payment_accounts.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  account_type text NOT NULL DEFAULT 'cash_drawer',
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_accounts_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT payment_accounts_type_check CHECK (
    account_type IN ('cash_drawer', 'bank_account', 'digital_wallet', 'other')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_workspace_name_unique
  ON payment_accounts.accounts (workspace_id, lower(name))
  WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS payment_accounts_workspace_active
  ON payment_accounts.accounts (workspace_id, is_active)
  WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS payment_accounts.account_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES payment_accounts.accounts(id) ON DELETE CASCADE,
  currency text NOT NULL,
  balance_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_account_balances_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT payment_account_balances_unique UNIQUE (account_id, currency)
);

CREATE INDEX IF NOT EXISTS payment_account_balances_workspace_account
  ON payment_accounts.account_balances (workspace_id, account_id)
  WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS payment_accounts.account_movements (
  -- The payment transaction id is deliberately reused as the movement id. This
  -- makes transaction posting idempotent across local and cloud reconciliation.
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES payment_accounts.accounts(id) ON DELETE RESTRICT,
  payment_transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  account_name_snapshot text NOT NULL,
  direction text NOT NULL,
  amount numeric NOT NULL,
  delta_amount numeric NOT NULL,
  currency text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_account_movements_direction_check CHECK (direction IN ('incoming', 'outgoing')),
  CONSTRAINT payment_account_movements_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT payment_account_movements_payment_transaction_unique UNIQUE (payment_transaction_id)
);

CREATE INDEX IF NOT EXISTS payment_account_movements_workspace_account_time
  ON payment_accounts.account_movements (workspace_id, account_id, occurred_at DESC)
  WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS payment_accounts.cashier_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES payment_accounts.accounts(id) ON DELETE RESTRICT,
  account_name_snapshot text NOT NULL,
  cashier_user_id uuid NOT NULL REFERENCES auth.users(id),
  cashier_name_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id),
  opening_note text,
  closing_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_accounts_cashier_shifts_status_check CHECK (status IN ('open', 'closed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_one_open_shift_per_cashier_account
  ON payment_accounts.cashier_shifts (workspace_id, account_id, cashier_user_id)
  WHERE status = 'open' AND NOT is_deleted;

CREATE INDEX IF NOT EXISTS payment_accounts_cashier_shifts_workspace_status
  ON payment_accounts.cashier_shifts (workspace_id, status, opened_at DESC)
  WHERE NOT is_deleted;

-- Retained for existing installations that already have historic shift counts.
-- V1 creates no count rows and presents no cash-count or reconciliation flow.
CREATE TABLE IF NOT EXISTS payment_accounts.cashier_shift_currency_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES payment_accounts.cashier_shifts(id) ON DELETE CASCADE,
  currency text NOT NULL,
  opening_amount numeric NOT NULL DEFAULT 0,
  expected_amount numeric NOT NULL DEFAULT 0,
  counted_amount numeric,
  variance_amount numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_accounts_cashier_shift_counts_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT payment_accounts_cashier_shift_counts_unique UNIQUE (shift_id, currency)
);

CREATE INDEX IF NOT EXISTS payment_accounts_cashier_shift_counts_workspace_shift
  ON payment_accounts.cashier_shift_currency_counts (workspace_id, shift_id)
  WHERE NOT is_deleted;

-- Reusable schedules are separate from cashier assignments and real shift runs.
CREATE TABLE IF NOT EXISTS payment_accounts.cashier_shift_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_accounts_cashier_shift_template_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT payment_accounts_cashier_shift_template_start_time_valid CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT payment_accounts_cashier_shift_template_end_time_valid CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT payment_accounts_cashier_shift_template_times_differ CHECK (start_time <> end_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_cashier_shift_template_name_unique
  ON payment_accounts.cashier_shift_templates (workspace_id, lower(name))
  WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS payment_accounts.cashier_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  template_id uuid REFERENCES payment_accounts.cashier_shift_templates(id) ON DELETE SET NULL,
  template_name_snapshot text,
  account_id uuid NOT NULL REFERENCES payment_accounts.accounts(id) ON DELETE RESTRICT,
  account_name_snapshot text NOT NULL,
  cashier_user_id uuid NOT NULL REFERENCES auth.users(id),
  cashier_name_snapshot text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  working_days integer[] NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_accounts_cashier_shift_assignment_start_time_valid CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT payment_accounts_cashier_shift_assignment_end_time_valid CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT payment_accounts_cashier_shift_assignment_times_differ CHECK (start_time <> end_time),
  CONSTRAINT payment_accounts_cashier_shift_assignment_working_days_valid CHECK (
    cardinality(working_days) > 0
    AND working_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
  )
);

CREATE INDEX IF NOT EXISTS payment_accounts_cashier_shift_assignments_workspace_cashier
  ON payment_accounts.cashier_shift_assignments (workspace_id, cashier_user_id)
  WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS payment_accounts.cashier_shift_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES payment_accounts.cashier_shift_assignments(id) ON DELETE RESTRICT,
  template_id uuid REFERENCES payment_accounts.cashier_shift_templates(id) ON DELETE SET NULL,
  template_name_snapshot text,
  account_id uuid NOT NULL REFERENCES payment_accounts.accounts(id) ON DELETE RESTRICT,
  account_name_snapshot text NOT NULL,
  cashier_user_id uuid NOT NULL REFERENCES auth.users(id),
  cashier_name_snapshot text NOT NULL,
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_accounts_cashier_shift_occurrence_status_check CHECK (status IN ('active', 'completed')),
  CONSTRAINT payment_accounts_cashier_shift_occurrence_time_order CHECK (scheduled_end_at > scheduled_start_at),
  CONSTRAINT payment_accounts_cashier_shift_occurrence_unique UNIQUE (assignment_id, scheduled_start_at)
);

CREATE INDEX IF NOT EXISTS payment_accounts_cashier_shift_occurrences_workspace_cashier_time
  ON payment_accounts.cashier_shift_occurrences (workspace_id, cashier_user_id, scheduled_start_at DESC)
  WHERE NOT is_deleted;

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS account_id uuid NULL REFERENCES payment_accounts.accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS account_name_snapshot text NULL;

-- Retain the account selected for an order's initial/down payment while its
-- normal order lifecycle runs. The resulting payment transaction is still
-- authoritative; these are only posting instructions/snapshots.
ALTER TABLE crm.sales_orders
  ADD COLUMN IF NOT EXISTS initial_payment_account_id uuid NULL REFERENCES payment_accounts.accounts(id),
  ADD COLUMN IF NOT EXISTS initial_payment_account_name_snapshot text NULL;

ALTER TABLE crm.purchase_orders
  ADD COLUMN IF NOT EXISTS initial_payment_account_id uuid NULL REFERENCES payment_accounts.accounts(id),
  ADD COLUMN IF NOT EXISTS initial_payment_account_name_snapshot text NULL;

CREATE INDEX IF NOT EXISTS payment_transactions_workspace_account_paid_at
  ON public.payment_transactions (workspace_id, account_id, paid_at DESC)
  WHERE account_id IS NOT NULL AND NOT is_deleted;

CREATE OR REPLACE FUNCTION payment_accounts.validate_payment_transaction_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
DECLARE
  v_account payment_accounts.accounts%ROWTYPE;
BEGIN
  -- RPC-owned flows occasionally create their immutable business record and
  -- payment transaction in an existing transaction. They may assign the
  -- selected account immediately afterwards through this scoped local setting.
  IF TG_OP = 'UPDATE'
    AND current_setting('payment_accounts.allow_initial_assignment', true) = 'on'
    AND OLD.account_id IS NULL
    AND NEW.account_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND (OLD.account_id IS NOT NULL OR NEW.account_id IS NOT NULL)
    AND (
    NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.direction IS DISTINCT FROM OLD.direction
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR NEW.account_name_snapshot IS DISTINCT FROM OLD.account_name_snapshot
  ) THEN
    RAISE EXCEPTION 'A posted payment account link cannot be changed; reverse and record a replacement payment instead'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT payment_accounts.module_allowed(NEW.workspace_id, 'payment_accounts') THEN
    RAISE EXCEPTION 'Payment Accounts is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    SELECT *
    INTO v_account
    FROM payment_accounts.accounts
    WHERE id = NEW.account_id
      AND workspace_id = NEW.workspace_id
      AND NOT is_deleted
    FOR KEY SHARE;

    IF NOT FOUND OR NOT v_account.is_active THEN
      RAISE EXCEPTION 'The selected payment account is unavailable'
        USING ERRCODE = '23503';
    END IF;

    NEW.account_name_snapshot := coalesce(nullif(NEW.account_name_snapshot, ''), v_account.name);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION payment_accounts.post_payment_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
DECLARE
  v_delta numeric;
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_delta := CASE WHEN NEW.is_deleted THEN 0
    WHEN NEW.direction = 'incoming' THEN NEW.amount
    ELSE -NEW.amount
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO payment_accounts.account_movements (
      id, workspace_id, account_id, payment_transaction_id,
      account_name_snapshot, direction, amount, delta_amount, currency, occurred_at
    ) VALUES (
      NEW.id, NEW.workspace_id, NEW.account_id, NEW.id,
      NEW.account_name_snapshot, NEW.direction, NEW.amount, v_delta, NEW.currency, NEW.paid_at
    );

    INSERT INTO payment_accounts.account_balances (
      workspace_id, account_id, currency, balance_amount, updated_at
    ) VALUES (
      NEW.workspace_id, NEW.account_id, NEW.currency, v_delta, now()
    ) ON CONFLICT (account_id, currency) DO UPDATE
      SET balance_amount = payment_accounts.account_balances.balance_amount + EXCLUDED.balance_amount,
          updated_at = now(),
          version = payment_accounts.account_balances.version + 1,
          is_deleted = false;
  ELSE
    -- A payment transaction is immutable after posting. The only supported
    -- account-affecting update is soft deletion, which removes its movement.
    IF OLD.is_deleted IS DISTINCT FROM NEW.is_deleted THEN
      UPDATE payment_accounts.account_movements
      SET delta_amount = v_delta,
          amount = NEW.amount,
          occurred_at = NEW.paid_at,
          is_deleted = NEW.is_deleted,
          updated_at = now(),
          version = version + 1
      WHERE payment_transaction_id = NEW.id;

      INSERT INTO payment_accounts.account_balances (
        workspace_id, account_id, currency, balance_amount, updated_at
      ) VALUES (
        NEW.workspace_id, NEW.account_id, NEW.currency,
        CASE WHEN NEW.is_deleted THEN -OLD.amount * CASE WHEN OLD.direction = 'incoming' THEN 1 ELSE -1 END
             ELSE v_delta END,
        now()
      ) ON CONFLICT (account_id, currency) DO UPDATE
        SET balance_amount = payment_accounts.account_balances.balance_amount + EXCLUDED.balance_amount,
            updated_at = now(),
            version = payment_accounts.account_balances.version + 1,
            is_deleted = false;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payment_transactions_validate_payment_account ON public.payment_transactions;
CREATE TRIGGER payment_transactions_validate_payment_account
  BEFORE INSERT OR UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.validate_payment_transaction_account();

DROP TRIGGER IF EXISTS payment_transactions_post_payment_account ON public.payment_transactions;
CREATE TRIGGER payment_transactions_post_payment_account
  AFTER INSERT OR UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.post_payment_transaction();

-- Keep the product-exchange RPC atomic while accepting the optional account
-- selected by its dialog. The existing function remains the implementation
-- of the inventory/return transaction; this distinct wrapper attaches the
-- verified account before the outer RPC commits.
CREATE OR REPLACE FUNCTION public.process_sale_product_exchange_with_account(
  p_exchange_id uuid,
  p_return_id uuid,
  p_sale_id uuid,
  p_return_sale_item_id uuid,
  p_return_quantity numeric,
  p_replacement_product_id uuid,
  p_replacement_storage_id uuid,
  p_replacement_quantity numeric,
  p_replacement_unit_amount numeric,
  p_settlement_method text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_return_reason text DEFAULT 'Product exchange',
  p_account_id uuid DEFAULT NULL,
  p_account_name_snapshot text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, payment_accounts, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_account_name text;
  v_cash_amount numeric;
BEGIN
  v_result := public.process_sale_product_exchange(
    p_exchange_id, p_return_id, p_sale_id, p_return_sale_item_id,
    p_return_quantity, p_replacement_product_id, p_replacement_storage_id,
    p_replacement_quantity, p_replacement_unit_amount, p_settlement_method,
    p_note, p_return_reason
  );

  IF p_account_id IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT name INTO v_account_name
  FROM payment_accounts.accounts
  WHERE id = p_account_id
    AND workspace_id = public.current_workspace_id()
    AND is_active
    AND NOT is_deleted;
  IF v_account_name IS NULL THEN
    RAISE EXCEPTION 'Payment account is unavailable';
  END IF;

  SELECT cash_settlement_amount INTO v_cash_amount
  FROM public.sale_product_exchanges
  WHERE id = p_exchange_id;
  IF COALESCE(v_cash_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'An account can only be selected when this exchange has a cash settlement';
  END IF;

  PERFORM set_config('payment_accounts.allow_initial_assignment', 'on', true);
  UPDATE public.payment_transactions
  SET account_id = p_account_id,
      account_name_snapshot = v_account_name
  WHERE workspace_id = public.current_workspace_id()
    AND source_type = 'sale_exchange'
    AND source_record_id = p_exchange_id
    AND reversal_of_transaction_id IS NULL
    AND account_id IS NULL;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_sale_product_exchange_with_account(uuid, uuid, uuid, uuid, numeric, uuid, uuid, numeric, numeric, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_sale_product_exchange_with_account(uuid, uuid, uuid, uuid, numeric, uuid, uuid, numeric, numeric, text, text, text, uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
DECLARE
  v_account_type text;
BEGIN
  IF NOT payment_accounts.module_allowed(NEW.workspace_id, 'cashier_shift_control') THEN
    RAISE EXCEPTION 'Cashier Shift Control is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_type
  INTO v_account_type
  FROM payment_accounts.accounts
  WHERE id = NEW.account_id
    AND workspace_id = NEW.workspace_id
    AND is_active
    AND NOT is_deleted;

  IF v_account_type IS DISTINCT FROM 'cash_drawer' THEN
    RAISE EXCEPTION 'Cashier shifts can only use an active cash drawer payment account'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = NEW.cashier_user_id
      AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Cashier shifts must be assigned to a member of the workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shifts_enforce_account ON payment_accounts.cashier_shifts;
CREATE TRIGGER cashier_shifts_enforce_account
  BEFORE INSERT OR UPDATE OF workspace_id, account_id ON payment_accounts.cashier_shifts
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_account();

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
DECLARE
  v_account_type text;
BEGIN
  IF NOT payment_accounts.module_allowed(NEW.workspace_id, 'cashier_shift_control') THEN
    RAISE EXCEPTION 'Cashier Shift Control is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_type
  INTO v_account_type
  FROM payment_accounts.accounts
  WHERE id = NEW.account_id
    AND workspace_id = NEW.workspace_id
    AND is_active
    AND NOT is_deleted;

  IF v_account_type IS DISTINCT FROM 'cash_drawer' THEN
    RAISE EXCEPTION 'Cashier shifts can only use an active cash drawer payment account'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = NEW.cashier_user_id
      AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Cashier shifts must be assigned to a member of the workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM payment_accounts.cashier_shift_templates
    WHERE id = NEW.template_id
      AND workspace_id = NEW.workspace_id
      AND is_active
      AND NOT is_deleted
  ) THEN
    RAISE EXCEPTION 'Cashier shift template is unavailable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shift_assignments_enforce_values ON payment_accounts.cashier_shift_assignments;
CREATE TRIGGER cashier_shift_assignments_enforce_values
  BEFORE INSERT OR UPDATE OF workspace_id, template_id, account_id, cashier_user_id ON payment_accounts.cashier_shift_assignments
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_assignment();

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_occurrence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts, auth
AS $function$
DECLARE
  v_assignment payment_accounts.cashier_shift_assignments%ROWTYPE;
BEGIN
  IF NOT payment_accounts.module_allowed(NEW.workspace_id, 'cashier_shift_control') THEN
    RAISE EXCEPTION 'Cashier Shift Control is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_assignment
  FROM payment_accounts.cashier_shift_assignments
  WHERE id = NEW.assignment_id
    AND workspace_id = NEW.workspace_id
    AND is_active
    AND NOT is_deleted;

  IF NOT FOUND
    OR NEW.cashier_user_id IS DISTINCT FROM v_assignment.cashier_user_id
    OR NEW.account_id IS DISTINCT FROM v_assignment.account_id
  THEN
    RAISE EXCEPTION 'The shift occurrence does not match an active cashier assignment'
      USING ERRCODE = '23514';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' AND NEW.cashier_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the assigned cashier can start this shift'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shift_occurrences_enforce_values ON payment_accounts.cashier_shift_occurrences;
CREATE TRIGGER cashier_shift_occurrences_enforce_values
  BEFORE INSERT OR UPDATE OF workspace_id, assignment_id, cashier_user_id, account_id ON payment_accounts.cashier_shift_occurrences
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_occurrence();

ALTER TABLE payment_accounts.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts.account_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts.account_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts.cashier_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts.cashier_shift_currency_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts.cashier_shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts.cashier_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts.cashier_shift_occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_accounts_accounts_access ON payment_accounts.accounts
  FOR ALL TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
  );

CREATE POLICY payment_accounts_balances_select ON payment_accounts.account_balances
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
  );

CREATE POLICY payment_accounts_movements_select ON payment_accounts.account_movements
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
  );

CREATE POLICY payment_accounts_shifts_access ON payment_accounts.cashier_shifts
  FOR ALL TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  );

CREATE POLICY payment_accounts_shift_counts_access ON payment_accounts.cashier_shift_currency_counts
  FOR ALL TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  );

CREATE POLICY payment_accounts_shift_templates_access ON payment_accounts.cashier_shift_templates
  FOR ALL TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  );

CREATE POLICY payment_accounts_shift_assignments_access ON payment_accounts.cashier_shift_assignments
  FOR ALL TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  );

CREATE POLICY payment_accounts_shift_occurrences_access ON payment_accounts.cashier_shift_occurrences
  FOR ALL TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control')
  );

GRANT SELECT, INSERT, UPDATE ON payment_accounts.accounts TO authenticated, service_role;
GRANT SELECT ON payment_accounts.account_balances, payment_accounts.account_movements TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON payment_accounts.cashier_shifts, payment_accounts.cashier_shift_currency_counts TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON payment_accounts.cashier_shift_templates, payment_accounts.cashier_shift_assignments, payment_accounts.cashier_shift_occurrences TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
