-- An occurrence is the audit boundary for a cashier's payments. Payment
-- transactions remain the financial source of truth; this nullable relation
-- only records which active shift owned a payment when it was posted.
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS cashier_shift_occurrence_id uuid NULL
    REFERENCES payment_accounts.cashier_shift_occurrences(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS payment_transactions_workspace_cashier_shift_occurrence_paid_at
  ON public.payment_transactions (workspace_id, cashier_shift_occurrence_id, paid_at DESC)
  WHERE cashier_shift_occurrence_id IS NOT NULL AND NOT is_deleted;

ALTER TABLE payment_accounts.cashier_shift_occurrences
  ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS completed_by uuid NULL REFERENCES auth.users(id);

-- Preserve any rows that were already marked completed before completion
-- metadata was introduced. Their scheduled end is the only honest fallback.
UPDATE payment_accounts.cashier_shift_occurrences
SET completed_at = COALESCE(completed_at, scheduled_end_at),
    completed_by = COALESCE(completed_by, cashier_user_id)
WHERE status = 'completed'
  AND (completed_at IS NULL OR completed_by IS NULL);

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_occurrence_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
BEGIN
  IF NEW.status = 'active' THEN
    IF NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL THEN
      RAISE EXCEPTION 'An active cashier shift occurrence cannot have completion metadata.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'completed' THEN
    RAISE EXCEPTION 'Invalid cashier shift occurrence status.';
  END IF;
  IF NEW.completed_at IS NULL OR NEW.completed_by IS NULL THEN
    RAISE EXCEPTION 'A completed cashier shift occurrence requires completed_at and completed_by.';
  END IF;
  IF NEW.completed_by <> NEW.cashier_user_id THEN
    RAISE EXCEPTION 'Only the assigned cashier can complete this shift occurrence.';
  END IF;
  IF NEW.completed_at < NEW.scheduled_end_at THEN
    RAISE EXCEPTION 'A cashier shift occurrence cannot complete before its scheduled end.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RAISE EXCEPTION 'A completed cashier shift occurrence is immutable.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shift_occurrences_enforce_completion ON payment_accounts.cashier_shift_occurrences;
CREATE TRIGGER cashier_shift_occurrences_enforce_completion
  BEFORE INSERT OR UPDATE ON payment_accounts.cashier_shift_occurrences
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_occurrence_completion();

-- Mirror the client-side attribution rule for payments created through a
-- server-side flow. Explicit links are retained; no historical payment is
-- backfilled or inferred from its paid_at timestamp.
CREATE OR REPLACE FUNCTION payment_accounts.assign_cashier_shift_occurrence_to_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
BEGIN
  IF NEW.is_deleted
    OR NEW.cashier_shift_occurrence_id IS NOT NULL
    OR NEW.account_id IS NULL
    OR NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT occurrence.id
    INTO NEW.cashier_shift_occurrence_id
  FROM payment_accounts.cashier_shift_occurrences AS occurrence
  WHERE occurrence.workspace_id = NEW.workspace_id
    AND occurrence.cashier_user_id = NEW.created_by
    AND occurrence.account_id = NEW.account_id
    AND occurrence.status = 'active'
    AND occurrence.started_at <= now()
    AND occurrence.scheduled_end_at > now()
    AND NOT occurrence.is_deleted
  ORDER BY occurrence.started_at DESC, occurrence.scheduled_start_at DESC
  LIMIT 1;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payment_transactions_assign_cashier_shift_occurrence ON public.payment_transactions;
CREATE TRIGGER payment_transactions_assign_cashier_shift_occurrence
  BEFORE INSERT OR UPDATE OF workspace_id, account_id, created_by, cashier_shift_occurrence_id
  ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.assign_cashier_shift_occurrence_to_payment();

NOTIFY pgrst, 'reload schema';
