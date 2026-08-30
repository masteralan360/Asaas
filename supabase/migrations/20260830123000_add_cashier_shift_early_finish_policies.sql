-- Completion policies are selected on the recurring assignment and copied to
-- each occurrence when it starts. That snapshot keeps an in-progress shift's
-- approval rules stable if its future schedule is later changed.
ALTER TABLE payment_accounts.cashier_shift_assignments
  ADD COLUMN IF NOT EXISTS early_finish_policy text NOT NULL DEFAULT 'scheduled_end',
  ADD COLUMN IF NOT EXISTS early_finish_offset_minutes integer NULL;

ALTER TABLE payment_accounts.cashier_shift_occurrences
  ADD COLUMN IF NOT EXISTS early_finish_policy text NOT NULL DEFAULT 'scheduled_end',
  ADD COLUMN IF NOT EXISTS early_finish_offset_minutes integer NULL,
  ADD COLUMN IF NOT EXISTS early_finish_request_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS early_finish_request_reason text NULL,
  ADD COLUMN IF NOT EXISTS early_finish_requested_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS early_finish_requested_by uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS early_finish_reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS early_finish_reviewed_by uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS early_finish_review_note text NULL,
  ADD COLUMN IF NOT EXISTS completion_reason text NULL;

ALTER TABLE payment_accounts.cashier_shift_assignments
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_assignment_early_finish_policy_check,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_assignment_early_finish_offset_check,
  ADD CONSTRAINT payment_accounts_cashier_shift_assignment_early_finish_policy_check
    CHECK (early_finish_policy IN ('scheduled_end', 'time_before_end', 'request_approval', 'free_with_reason')),
  ADD CONSTRAINT payment_accounts_cashier_shift_assignment_early_finish_offset_check
    CHECK (
      (early_finish_policy = 'time_before_end' AND early_finish_offset_minutes IS NOT NULL AND early_finish_offset_minutes > 0)
      OR (early_finish_policy <> 'time_before_end' AND early_finish_offset_minutes IS NULL)
    );

ALTER TABLE payment_accounts.cashier_shift_occurrences
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_occurrence_early_finish_policy_check,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_occurrence_early_finish_offset_check,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_occurrence_early_finish_request_status_check,
  ADD CONSTRAINT payment_accounts_cashier_shift_occurrence_early_finish_policy_check
    CHECK (early_finish_policy IN ('scheduled_end', 'time_before_end', 'request_approval', 'free_with_reason')),
  ADD CONSTRAINT payment_accounts_cashier_shift_occurrence_early_finish_offset_check
    CHECK (
      (early_finish_policy = 'time_before_end' AND early_finish_offset_minutes IS NOT NULL AND early_finish_offset_minutes > 0)
      OR (early_finish_policy <> 'time_before_end' AND early_finish_offset_minutes IS NULL)
    ),
  ADD CONSTRAINT payment_accounts_cashier_shift_occurrence_early_finish_request_status_check
    CHECK (early_finish_request_status IN ('not_requested', 'requested', 'approved', 'rejected'));

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
    AND NOT is_deleted;

  IF NOT FOUND
    OR (TG_OP = 'INSERT' AND NOT v_assignment.is_active)
    OR NEW.cashier_user_id IS DISTINCT FROM v_assignment.cashier_user_id
    OR NEW.account_id IS DISTINCT FROM v_assignment.account_id
  THEN
    RAISE EXCEPTION 'The shift occurrence does not match an active cashier assignment'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW.early_finish_policy IS DISTINCT FROM OLD.early_finish_policy
      OR NEW.early_finish_offset_minutes IS DISTINCT FROM OLD.early_finish_offset_minutes
    ) THEN
    RAISE EXCEPTION 'An active cashier shift occurrence cannot change its early finish policy.';
  END IF;

  IF TG_OP = 'INSERT'
    AND (
      NEW.early_finish_policy IS DISTINCT FROM v_assignment.early_finish_policy
      OR NEW.early_finish_offset_minutes IS DISTINCT FROM v_assignment.early_finish_offset_minutes
    ) THEN
    RAISE EXCEPTION 'The shift occurrence early finish policy does not match its assignment'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT'
    AND NEW.early_finish_policy = 'time_before_end'
    AND NEW.early_finish_offset_minutes >= EXTRACT(EPOCH FROM (NEW.scheduled_end_at - NEW.scheduled_start_at)) / 60 THEN
    RAISE EXCEPTION 'The early finish offset must be shorter than the scheduled shift duration.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT'
    AND auth.role() IS DISTINCT FROM 'service_role'
    AND NEW.cashier_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the assigned cashier can start this shift'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shift_occurrences_enforce_values ON payment_accounts.cashier_shift_occurrences;
CREATE TRIGGER cashier_shift_occurrences_enforce_values
  BEFORE INSERT OR UPDATE OF workspace_id, assignment_id, cashier_user_id, account_id, early_finish_policy, early_finish_offset_minutes
  ON payment_accounts.cashier_shift_occurrences
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_occurrence();

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_occurrence_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts, auth
AS $function$
DECLARE
  v_is_early boolean;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'A cashier shift occurrence must start as active.';
  END IF;

  IF length(COALESCE(NEW.completion_reason, '')) > 1000
    OR length(COALESCE(NEW.early_finish_request_reason, '')) > 1000
    OR length(COALESCE(NEW.early_finish_review_note, '')) > 1000 THEN
    RAISE EXCEPTION 'Cashier shift reasons and review notes must be 1,000 characters or fewer.';
  END IF;

  IF NEW.status = 'active' THEN
    IF NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completion_reason IS NOT NULL THEN
      RAISE EXCEPTION 'An active cashier shift occurrence cannot have completion metadata.';
    END IF;

    IF NEW.early_finish_policy <> 'request_approval' THEN
      IF NEW.early_finish_request_status <> 'not_requested'
        OR NEW.early_finish_request_reason IS NOT NULL
        OR NEW.early_finish_requested_at IS NOT NULL
        OR NEW.early_finish_requested_by IS NOT NULL
        OR NEW.early_finish_reviewed_at IS NOT NULL
        OR NEW.early_finish_reviewed_by IS NOT NULL
        OR NEW.early_finish_review_note IS NOT NULL THEN
        RAISE EXCEPTION 'This early finish policy does not allow approval requests.';
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NEW.early_finish_request_status <> 'not_requested' THEN
        RAISE EXCEPTION 'An early finish request must be created after the shift starts.';
      END IF;
      RETURN NEW;
    END IF;

    IF OLD.early_finish_request_status = 'not_requested'
      AND NEW.early_finish_request_status = 'requested' THEN
      IF NEW.early_finish_requested_by IS DISTINCT FROM NEW.cashier_user_id
        OR NEW.early_finish_requested_at IS NULL
        OR length(btrim(COALESCE(NEW.early_finish_request_reason, ''))) = 0
        OR NEW.early_finish_requested_at >= NEW.scheduled_end_at
        OR NEW.early_finish_reviewed_at IS NOT NULL
        OR NEW.early_finish_reviewed_by IS NOT NULL
        OR NEW.early_finish_review_note IS NOT NULL THEN
        RAISE EXCEPTION 'An early finish request requires the assigned cashier, a reason, and a time before the scheduled end.';
      END IF;
      IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM NEW.cashier_user_id THEN
        RAISE EXCEPTION 'Only the assigned cashier can request an early finish.'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;

    IF OLD.early_finish_request_status = 'requested'
      AND NEW.early_finish_request_status IN ('approved', 'rejected') THEN
      IF NEW.early_finish_request_reason IS DISTINCT FROM OLD.early_finish_request_reason
        OR NEW.early_finish_requested_at IS DISTINCT FROM OLD.early_finish_requested_at
        OR NEW.early_finish_requested_by IS DISTINCT FROM OLD.early_finish_requested_by THEN
        RAISE EXCEPTION 'An early finish request cannot change while it is reviewed.';
      END IF;
      IF NEW.early_finish_reviewed_by IS NULL OR NEW.early_finish_reviewed_at IS NULL THEN
        RAISE EXCEPTION 'An early finish decision requires reviewer metadata.';
      END IF;
      IF auth.role() IS DISTINCT FROM 'service_role'
        AND (public.current_user_role() IS DISTINCT FROM 'admin' OR NEW.early_finish_reviewed_by IS DISTINCT FROM auth.uid()) THEN
        RAISE EXCEPTION 'Only an administrator can review an early finish request.'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.early_finish_request_status IS DISTINCT FROM OLD.early_finish_request_status
      OR NEW.early_finish_request_reason IS DISTINCT FROM OLD.early_finish_request_reason
      OR NEW.early_finish_requested_at IS DISTINCT FROM OLD.early_finish_requested_at
      OR NEW.early_finish_requested_by IS DISTINCT FROM OLD.early_finish_requested_by
      OR NEW.early_finish_reviewed_at IS DISTINCT FROM OLD.early_finish_reviewed_at
      OR NEW.early_finish_reviewed_by IS DISTINCT FROM OLD.early_finish_reviewed_by
      OR NEW.early_finish_review_note IS DISTINCT FROM OLD.early_finish_review_note THEN
      RAISE EXCEPTION 'The early finish request is no longer pending review.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'completed' THEN
    RAISE EXCEPTION 'Invalid cashier shift occurrence status.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RAISE EXCEPTION 'A completed cashier shift occurrence is immutable.';
  END IF;
  IF NEW.completed_at IS NULL OR NEW.completed_by IS NULL THEN
    RAISE EXCEPTION 'A completed cashier shift occurrence requires completed_at and completed_by.';
  END IF;
  IF NEW.completed_by <> NEW.cashier_user_id THEN
    RAISE EXCEPTION 'Only the assigned cashier can complete this shift occurrence.';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM NEW.cashier_user_id THEN
    RAISE EXCEPTION 'Only the assigned cashier can complete this shift occurrence.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
    NEW.completed_at := clock_timestamp();
  END IF;

  v_is_early := NEW.completed_at < NEW.scheduled_end_at;
  IF v_is_early THEN
    CASE NEW.early_finish_policy
      WHEN 'scheduled_end' THEN
        RAISE EXCEPTION 'This cashier shift can only complete after its scheduled end.';
      WHEN 'time_before_end' THEN
        IF NEW.completed_at < NEW.scheduled_end_at - make_interval(mins => NEW.early_finish_offset_minutes) THEN
          RAISE EXCEPTION 'This cashier shift cannot complete before its configured early finish time.';
        END IF;
      WHEN 'request_approval' THEN
        IF NEW.early_finish_request_status <> 'approved' THEN
          RAISE EXCEPTION 'An approved early finish request is required before this shift can complete.';
        END IF;
      WHEN 'free_with_reason' THEN
        IF length(btrim(COALESCE(NEW.completion_reason, ''))) = 0 THEN
          RAISE EXCEPTION 'A reason is required to finish this shift early.';
        END IF;
    END CASE;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
