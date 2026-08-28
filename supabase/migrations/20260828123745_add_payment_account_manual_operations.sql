-- Manual payment-account operations are still authoritative payment
-- transactions. Account movements and balances remain derived by the existing
-- payment_accounts.post_payment_transaction trigger.
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
BEGIN
  -- A manual operation is an immutable audit record. Corrections must be a
  -- separate operation, never an edit or a deletion of the original row.
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
      RAISE EXCEPTION 'This withdrawal would make the account balance negative'
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

DROP TRIGGER IF EXISTS payment_transactions_validate_manual_payment_account_operation ON public.payment_transactions;
CREATE TRIGGER payment_transactions_validate_manual_payment_account_operation
  BEFORE INSERT OR UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.validate_manual_payment_account_operation();
