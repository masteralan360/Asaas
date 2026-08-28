-- Keep the account-funds rejection human-readable in Cloud/Hybrid mode.
-- These replace existing trigger functions only; no table, policy, or
-- privilege surface is added.

CREATE OR REPLACE FUNCTION payment_accounts.validate_payment_transaction_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
DECLARE
  v_account payment_accounts.accounts%ROWTYPE;
  v_current_balance numeric := 0;
  v_new_delta numeric := 0;
  v_old_delta numeric := 0;
  v_balance_change numeric := 0;
  v_allow_initial_assignment boolean := false;
  v_formatted_balance text;
  v_currency_symbol text;
BEGIN
  v_allow_initial_assignment := TG_OP = 'UPDATE'
    AND current_setting('payment_accounts.allow_initial_assignment', true) = 'on'
    AND OLD.account_id IS NULL
    AND NEW.account_id IS NOT NULL;

  IF TG_OP = 'UPDATE'
    AND (OLD.account_id IS NOT NULL OR NEW.account_id IS NOT NULL)
    AND NOT v_allow_initial_assignment
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

  SELECT *
  INTO v_account
  FROM payment_accounts.accounts
  WHERE id = NEW.account_id
    AND workspace_id = NEW.workspace_id
    AND NOT is_deleted
  FOR UPDATE;

  IF NOT FOUND OR NOT v_account.is_active THEN
    RAISE EXCEPTION 'The selected payment account is unavailable'
      USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    NEW.account_name_snapshot := coalesce(nullif(NEW.account_name_snapshot, ''), v_account.name);
  END IF;

  v_new_delta := payment_accounts.payment_transaction_effective_delta(
    NEW.direction,
    NEW.amount,
    NEW.is_deleted
  );
  v_old_delta := CASE
    WHEN TG_OP = 'UPDATE'
      AND OLD.account_id IS NOT NULL
      AND OLD.account_id = NEW.account_id
      AND OLD.currency = NEW.currency
    THEN payment_accounts.payment_transaction_effective_delta(OLD.direction, OLD.amount, OLD.is_deleted)
    ELSE 0
  END;
  v_balance_change := v_new_delta - v_old_delta;

  IF v_balance_change < 0 THEN
    SELECT balance_amount
    INTO v_current_balance
    FROM payment_accounts.account_balances
    WHERE account_id = NEW.account_id
      AND currency = NEW.currency
      AND NOT is_deleted
    FOR UPDATE;

    v_current_balance := coalesce(v_current_balance, 0);
    IF v_current_balance + v_balance_change < 0 THEN
      v_formatted_balance := trim(trailing '.' FROM trim(trailing '0' FROM to_char(v_current_balance, 'FM999G999G999G999G990D0000')));
      v_currency_symbol := CASE lower(NEW.currency)
        WHEN 'iqd' THEN 'د.ع'
        WHEN 'usd' THEN '$'
        WHEN 'eur' THEN '€'
        WHEN 'try' THEN '₺'
        ELSE upper(NEW.currency)
      END;
      RAISE EXCEPTION 'You do not have enough balance in % to proceed with this transaction. Current balance: % %.', v_account.name, v_formatted_balance, v_currency_symbol
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION payment_accounts.validate_manual_payment_account_operation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
DECLARE
  v_role text;
  v_account_type text;
  v_current_balance numeric := 0;
  v_counted_balance numeric;
  v_previous_balance numeric;
  v_expected_delta numeric;
  v_formatted_balance text;
  v_currency_symbol text;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.source_type IN (
      'payment_account_deposit',
      'payment_account_withdrawal',
      'payment_account_adjustment'
    )
    OR NEW.source_type IN (
      'payment_account_deposit',
      'payment_account_withdrawal',
      'payment_account_adjustment'
    )
  ) THEN
    RAISE EXCEPTION 'Posted payment-account operations cannot be changed; record a correcting operation instead'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_type NOT IN (
    'payment_account_deposit',
    'payment_account_withdrawal',
    'payment_account_adjustment'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.source_module IS DISTINCT FROM 'payment_accounts'
    OR NEW.account_id IS NULL
    OR NEW.source_record_id IS DISTINCT FROM NEW.id
    OR NEW.amount <= 0
    OR nullif(btrim(coalesce(NEW.reference_label, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid manual payment-account operation'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(NEW.metadata ->> 'paymentAccountOperation', '') <> replace(NEW.source_type, 'payment_account_', '') THEN
    RAISE EXCEPTION 'The payment-account operation metadata does not match its source type'
      USING ERRCODE = '23514';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_role := public.current_user_role();
    IF NEW.source_type = 'payment_account_adjustment' AND v_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Only administrators can post a payment-account balance adjustment'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.source_type <> 'payment_account_adjustment' AND v_role NOT IN ('admin', 'staff') THEN
      RAISE EXCEPTION 'Only authorized payment-account operators can post a deposit or withdrawal'
        USING ERRCODE = '42501';
    END IF;
    NEW.created_by := auth.uid();
  END IF;

  SELECT account_type
  INTO v_account_type
  FROM payment_accounts.accounts
  WHERE id = NEW.account_id
    AND workspace_id = NEW.workspace_id
    AND is_active
    AND NOT is_deleted
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected payment account is unavailable'
      USING ERRCODE = '23503';
  END IF;

  SELECT balance_amount
  INTO v_current_balance
  FROM payment_accounts.account_balances
  WHERE account_id = NEW.account_id
    AND currency = NEW.currency
    AND NOT is_deleted
  FOR UPDATE;
  v_current_balance := coalesce(v_current_balance, 0);

  IF NEW.source_type = 'payment_account_deposit' THEN
    IF NEW.direction IS DISTINCT FROM 'incoming' THEN
      RAISE EXCEPTION 'A deposit must be incoming'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'payment_account_withdrawal' THEN
    IF NEW.direction IS DISTINCT FROM 'outgoing' THEN
      RAISE EXCEPTION 'A withdrawal must be outgoing'
        USING ERRCODE = '23514';
    END IF;
    IF v_account_type <> 'bank_account' AND v_current_balance - NEW.amount < 0 THEN
      v_formatted_balance := trim(trailing '.' FROM trim(trailing '0' FROM to_char(v_current_balance, 'FM999G999G999G999G990D0000')));
      v_currency_symbol := CASE lower(NEW.currency)
        WHEN 'iqd' THEN 'د.ع'
        WHEN 'usd' THEN '$'
        WHEN 'eur' THEN '€'
        WHEN 'try' THEN '₺'
        ELSE upper(NEW.currency)
      END;
      RAISE EXCEPTION 'You do not have enough balance in this payment account to make this withdrawal. Current balance: % %.', v_formatted_balance, v_currency_symbol
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF jsonb_typeof(coalesce(NEW.metadata, '{}'::jsonb) -> 'countedBalance') <> 'number'
      OR jsonb_typeof(coalesce(NEW.metadata, '{}'::jsonb) -> 'previousBalance') <> 'number'
      OR nullif(btrim(coalesce(NEW.metadata ->> 'adjustmentReason', '')), '') IS NULL
    THEN
      RAISE EXCEPTION 'A balance adjustment requires its counted balance, posted balance, and reason'
        USING ERRCODE = '23514';
    END IF;

    v_counted_balance := (NEW.metadata ->> 'countedBalance')::numeric;
    v_previous_balance := (NEW.metadata ->> 'previousBalance')::numeric;
    IF v_counted_balance < 0 OR v_previous_balance <> v_current_balance THEN
      RAISE EXCEPTION 'The payment-account adjustment was prepared against a stale or invalid balance'
        USING ERRCODE = '23514';
    END IF;

    v_expected_delta := v_counted_balance - v_current_balance;
    IF v_expected_delta = 0
      OR abs(v_expected_delta) <> NEW.amount
      OR (v_expected_delta > 0 AND NEW.direction <> 'incoming')
      OR (v_expected_delta < 0 AND NEW.direction <> 'outgoing')
    THEN
      RAISE EXCEPTION 'The adjustment amount or direction does not match the counted balance'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION payment_accounts.validate_payment_transaction_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION payment_accounts.validate_manual_payment_account_operation() FROM PUBLIC, anon, authenticated;
