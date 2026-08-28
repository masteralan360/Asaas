-- Payment Accounts are custody records.  A selected account must never be
-- driven below zero in its own currency.  The ledger-only path deliberately
-- remains untouched: transactions with no account_id are still valid.

CREATE OR REPLACE FUNCTION payment_accounts.payment_transaction_effective_delta(
  p_direction text,
  p_amount numeric,
  p_is_deleted boolean
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN coalesce(p_is_deleted, false) THEN 0::numeric
    WHEN p_direction = 'incoming' THEN coalesce(p_amount, 0)
    ELSE -coalesce(p_amount, 0)
  END;
$function$;

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
BEGIN
  -- A few RPC-owned flows create their immutable payment record and attach
  -- the selected account in the same transaction.  Treat that attachment as
  -- the first posting, rather than bypassing balance validation.
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

  -- Lock the account row before reading its currency balance.  This also
  -- serializes the first posting for a currency that has no balance row yet.
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
      RAISE EXCEPTION 'This payment would make the selected payment account balance negative'
        USING ERRCODE = '23514';
    END IF;
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
  v_new_delta numeric := 0;
  v_old_delta numeric := 0;
  v_balance_change numeric := 0;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.account_id IS NULL AND NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.account_id IS NOT NULL AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'A posted payment account link cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_new_delta := payment_accounts.payment_transaction_effective_delta(
    NEW.direction,
    NEW.amount,
    NEW.is_deleted
  );

  IF TG_OP = 'INSERT' OR OLD.account_id IS NULL THEN
    INSERT INTO payment_accounts.account_movements (
      id, workspace_id, account_id, payment_transaction_id,
      account_name_snapshot, direction, amount, delta_amount, currency, occurred_at
    ) VALUES (
      NEW.id, NEW.workspace_id, NEW.account_id, NEW.id,
      NEW.account_name_snapshot, NEW.direction, NEW.amount, v_new_delta, NEW.currency, NEW.paid_at
    );
    v_balance_change := v_new_delta;
  ELSE
    v_old_delta := payment_accounts.payment_transaction_effective_delta(
      OLD.direction,
      OLD.amount,
      OLD.is_deleted
    );
    v_balance_change := v_new_delta - v_old_delta;

    IF OLD.is_deleted IS DISTINCT FROM NEW.is_deleted THEN
      UPDATE payment_accounts.account_movements
      SET delta_amount = v_new_delta,
          amount = NEW.amount,
          occurred_at = NEW.paid_at,
          is_deleted = NEW.is_deleted,
          updated_at = now(),
          version = version + 1
      WHERE payment_transaction_id = NEW.id;
    END IF;
  END IF;

  IF v_balance_change <> 0 THEN
    INSERT INTO payment_accounts.account_balances (
      workspace_id, account_id, currency, balance_amount, updated_at
    ) VALUES (
      NEW.workspace_id, NEW.account_id, NEW.currency, v_balance_change, now()
    ) ON CONFLICT (account_id, currency) DO UPDATE
      SET balance_amount = payment_accounts.account_balances.balance_amount + EXCLUDED.balance_amount,
          updated_at = now(),
          version = payment_accounts.account_balances.version + 1,
          is_deleted = false;
  END IF;

  RETURN NEW;
END;
$function$;

-- Repair any historical account assignment that was attached after its payment
-- transaction had already been inserted. Those rows were valid, but older
-- trigger logic did not create a corresponding movement. Rebuild the derived
-- projection from the authoritative payment transactions before enforcing new
-- postings.
INSERT INTO payment_accounts.account_movements (
  id,
  workspace_id,
  account_id,
  payment_transaction_id,
  account_name_snapshot,
  direction,
  amount,
  delta_amount,
  currency,
  occurred_at,
  is_deleted,
  created_at,
  updated_at,
  version
)
SELECT
  pt.id,
  pt.workspace_id,
  pt.account_id,
  pt.id,
  coalesce(pt.account_name_snapshot, ''),
  pt.direction,
  pt.amount,
  payment_accounts.payment_transaction_effective_delta(pt.direction, pt.amount, pt.is_deleted),
  pt.currency,
  pt.paid_at,
  pt.is_deleted,
  pt.created_at,
  pt.updated_at,
  greatest(pt.version, 1)
FROM public.payment_transactions pt
WHERE pt.account_id IS NOT NULL
ON CONFLICT (payment_transaction_id) DO UPDATE
SET workspace_id = EXCLUDED.workspace_id,
    account_id = EXCLUDED.account_id,
    account_name_snapshot = EXCLUDED.account_name_snapshot,
    direction = EXCLUDED.direction,
    amount = EXCLUDED.amount,
    delta_amount = EXCLUDED.delta_amount,
    currency = EXCLUDED.currency,
    occurred_at = EXCLUDED.occurred_at,
    is_deleted = EXCLUDED.is_deleted,
    updated_at = EXCLUDED.updated_at,
    version = payment_accounts.account_movements.version + 1;

WITH computed_balances AS (
  SELECT
    pt.workspace_id,
    pt.account_id,
    pt.currency,
    sum(payment_accounts.payment_transaction_effective_delta(pt.direction, pt.amount, pt.is_deleted)) AS balance_amount
  FROM public.payment_transactions pt
  WHERE pt.account_id IS NOT NULL
  GROUP BY pt.workspace_id, pt.account_id, pt.currency
)
INSERT INTO payment_accounts.account_balances (
  workspace_id,
  account_id,
  currency,
  balance_amount,
  updated_at,
  is_deleted
)
SELECT workspace_id, account_id, currency, balance_amount, now(), false
FROM computed_balances
ON CONFLICT (account_id, currency) DO UPDATE
SET workspace_id = EXCLUDED.workspace_id,
    balance_amount = EXCLUDED.balance_amount,
    updated_at = EXCLUDED.updated_at,
    version = payment_accounts.account_balances.version + 1,
    is_deleted = false;

-- Account movements are derived records.  Hard-deleting an account-linked
-- payment would bypass the posting trigger, so require an audited reversal or
-- a soft deletion instead.
CREATE OR REPLACE FUNCTION payment_accounts.prevent_account_payment_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF OLD.account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Account-linked payment transactions cannot be hard deleted; reverse or soft delete the payment instead'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS payment_transactions_prevent_account_hard_delete ON public.payment_transactions;
CREATE TRIGGER payment_transactions_prevent_account_hard_delete
  BEFORE DELETE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.prevent_account_payment_hard_delete();

-- These trigger helpers are not application RPC endpoints.
REVOKE ALL ON FUNCTION payment_accounts.payment_transaction_effective_delta(text, numeric, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION payment_accounts.validate_payment_transaction_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION payment_accounts.post_payment_transaction() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION payment_accounts.prevent_account_payment_hard_delete() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
