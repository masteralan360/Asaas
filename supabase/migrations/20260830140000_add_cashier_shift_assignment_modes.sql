-- Cashier assignments now have one explicit lifecycle mode.  Existing rows are
-- scheduled rows, which preserves their device-local recurring-window behavior.
ALTER TABLE payment_accounts.cashier_shift_assignments
  ADD COLUMN IF NOT EXISTS assignment_mode text NOT NULL DEFAULT 'scheduled';

ALTER TABLE payment_accounts.cashier_shift_occurrences
  ADD COLUMN IF NOT EXISTS assignment_mode text NOT NULL DEFAULT 'scheduled';

ALTER TABLE payment_accounts.cashier_shift_assignments
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time DROP NOT NULL,
  ALTER COLUMN working_days DROP NOT NULL,
  ALTER COLUMN early_finish_policy DROP NOT NULL;

ALTER TABLE payment_accounts.cashier_shift_occurrences
  ALTER COLUMN scheduled_start_at DROP NOT NULL,
  ALTER COLUMN scheduled_end_at DROP NOT NULL,
  ALTER COLUMN early_finish_policy DROP NOT NULL,
  ALTER COLUMN early_finish_request_status DROP NOT NULL;

ALTER TABLE payment_accounts.cashier_shift_assignments
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_assignment_start_time_valid,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_assignment_end_time_valid,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_assignment_times_differ,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_assignment_working_days_valid,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_assignment_early_finish_policy_check,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_assignment_early_finish_offset_check,
  ADD CONSTRAINT payment_accounts_cashier_shift_assignment_mode_check
    CHECK (assignment_mode IN ('scheduled', 'manual', 'login_logout')),
  ADD CONSTRAINT payment_accounts_cashier_shift_assignment_mode_fields_check
    CHECK (
      (assignment_mode = 'scheduled'
        AND start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND start_time <> end_time
        AND cardinality(working_days) > 0
        AND working_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
        AND early_finish_policy IN ('scheduled_end', 'time_before_end', 'request_approval', 'free_with_reason')
        AND ((early_finish_policy = 'time_before_end' AND early_finish_offset_minutes IS NOT NULL AND early_finish_offset_minutes > 0)
          OR (early_finish_policy <> 'time_before_end' AND early_finish_offset_minutes IS NULL)))
      OR (assignment_mode = 'manual'
        AND start_time IS NULL AND end_time IS NULL AND template_id IS NULL
        AND cardinality(working_days) > 0 AND working_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
        AND early_finish_policy IS NULL AND early_finish_offset_minutes IS NULL)
      OR (assignment_mode = 'login_logout'
        AND start_time IS NULL AND end_time IS NULL AND template_id IS NULL
        AND (working_days IS NULL OR cardinality(working_days) = 0)
        AND early_finish_policy IS NULL AND early_finish_offset_minutes IS NULL)
    );

ALTER TABLE payment_accounts.cashier_shift_occurrences
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_occurrence_time_order,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_occurrence_early_finish_policy_check,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_occurrence_early_finish_offset_check,
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_occurrence_early_finish_request_status_check,
  ADD CONSTRAINT payment_accounts_cashier_shift_occurrence_mode_check
    CHECK (assignment_mode IN ('scheduled', 'manual', 'login_logout')),
  ADD CONSTRAINT payment_accounts_cashier_shift_occurrence_mode_fields_check
    CHECK (
      (assignment_mode = 'scheduled'
        AND scheduled_start_at IS NOT NULL AND scheduled_end_at > scheduled_start_at
        AND early_finish_policy IN ('scheduled_end', 'time_before_end', 'request_approval', 'free_with_reason')
        AND ((early_finish_policy = 'time_before_end' AND early_finish_offset_minutes IS NOT NULL AND early_finish_offset_minutes > 0)
          OR (early_finish_policy <> 'time_before_end' AND early_finish_offset_minutes IS NULL))
        AND early_finish_request_status IN ('not_requested', 'requested', 'approved', 'rejected'))
      OR (assignment_mode IN ('manual', 'login_logout')
        AND template_id IS NULL AND template_name_snapshot IS NULL
        AND scheduled_start_at IS NULL AND scheduled_end_at IS NULL
        AND early_finish_policy IS NULL AND early_finish_offset_minutes IS NULL
        AND early_finish_request_status IS NULL
        AND early_finish_request_reason IS NULL AND early_finish_requested_at IS NULL
        AND early_finish_requested_by IS NULL AND early_finish_reviewed_at IS NULL
        AND early_finish_reviewed_by IS NULL AND early_finish_review_note IS NULL)
    );

-- A pause remains an active occurrence for exclusivity purposes.
DROP INDEX IF EXISTS payment_accounts.payment_accounts_cashier_occurrence_active_unique;
CREATE UNIQUE INDEX payment_accounts_cashier_occurrence_active_unique
  ON payment_accounts.cashier_shift_occurrences (workspace_id, cashier_user_id)
  WHERE status IN ('active', 'paused') AND NOT is_deleted;

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_cashier_shift_assignment_unscheduled_unique
  ON payment_accounts.cashier_shift_assignments (workspace_id, cashier_user_id)
  WHERE is_active AND NOT is_deleted AND assignment_mode IN ('manual', 'login_logout');

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
DECLARE
  v_existing payment_accounts.cashier_shift_assignments%ROWTYPE;
  v_new_day integer;
  v_existing_day integer;
  v_new_start integer;
  v_new_end integer;
  v_existing_start integer;
  v_existing_end integer;
  v_week_offset integer;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM payment_accounts.cashier_shift_occurrences occurrence
    WHERE occurrence.assignment_id = OLD.id
      AND occurrence.workspace_id = OLD.workspace_id
      AND occurrence.status IN ('active', 'paused')
      AND NOT occurrence.is_deleted
  ) THEN
    RAISE EXCEPTION 'A cashier shift assignment cannot be changed while it owns an active occurrence.' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NOT NEW.is_active OR NEW.is_deleted THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text || ':' || NEW.cashier_user_id::text, 0));
  FOR v_existing IN
    SELECT * FROM payment_accounts.cashier_shift_assignments
    WHERE workspace_id = NEW.workspace_id
      AND cashier_user_id = NEW.cashier_user_id
      AND id <> NEW.id
      AND is_active AND NOT is_deleted
  LOOP
    IF NEW.assignment_mode <> 'scheduled' AND v_existing.assignment_mode <> 'scheduled' THEN
      RAISE EXCEPTION 'A cashier can have only one enabled manual or login/logout assignment.' USING ERRCODE = '23505';
    END IF;
    IF NEW.assignment_mode <> 'scheduled' OR v_existing.assignment_mode <> 'scheduled' THEN CONTINUE; END IF;

    FOREACH v_new_day IN ARRAY NEW.working_days LOOP
      FOREACH v_existing_day IN ARRAY v_existing.working_days LOOP
        v_new_start := v_new_day * 1440 + extract(hour from NEW.start_time::time)::integer * 60 + extract(minute from NEW.start_time::time)::integer;
        v_new_end := v_new_start + (extract(hour from NEW.end_time::time)::integer * 60 + extract(minute from NEW.end_time::time)::integer)
          - (extract(hour from NEW.start_time::time)::integer * 60 + extract(minute from NEW.start_time::time)::integer)
          + CASE WHEN NEW.end_time::time <= NEW.start_time::time THEN 1440 ELSE 0 END;
        v_existing_start := v_existing_day * 1440 + extract(hour from v_existing.start_time::time)::integer * 60 + extract(minute from v_existing.start_time::time)::integer;
        v_existing_end := v_existing_start + (extract(hour from v_existing.end_time::time)::integer * 60 + extract(minute from v_existing.end_time::time)::integer)
          - (extract(hour from v_existing.start_time::time)::integer * 60 + extract(minute from v_existing.start_time::time)::integer)
          + CASE WHEN v_existing.end_time::time <= v_existing.start_time::time THEN 1440 ELSE 0 END;
        FOREACH v_week_offset IN ARRAY ARRAY[-10080, 0, 10080] LOOP
          IF v_new_start < v_existing_end + v_week_offset AND v_existing_start + v_week_offset < v_new_end THEN
            RAISE EXCEPTION 'Scheduled cashier assignments for this member cannot overlap.' USING ERRCODE = '23505';
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shift_assignments_enforce_values ON payment_accounts.cashier_shift_assignments;
CREATE TRIGGER cashier_shift_assignments_enforce_values
  BEFORE INSERT OR UPDATE OR DELETE ON payment_accounts.cashier_shift_assignments
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
    RAISE EXCEPTION 'Cashier Shift Control is not enabled for this workspace' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_assignment FROM payment_accounts.cashier_shift_assignments
      WHERE id = NEW.assignment_id AND workspace_id = NEW.workspace_id AND is_active AND NOT is_deleted;
    IF NOT FOUND OR NEW.cashier_user_id IS DISTINCT FROM v_assignment.cashier_user_id
      OR NEW.account_id IS DISTINCT FROM v_assignment.account_id THEN
      RAISE EXCEPTION 'The shift occurrence does not match an active cashier assignment' USING ERRCODE = '23514';
    END IF;
    IF NEW.assignment_mode IS DISTINCT FROM v_assignment.assignment_mode THEN
      RAISE EXCEPTION 'The occurrence mode must match its assignment.' USING ERRCODE = '23514';
    END IF;
    IF NEW.assignment_mode = 'scheduled' AND (
      NEW.early_finish_policy IS DISTINCT FROM v_assignment.early_finish_policy
      OR NEW.early_finish_offset_minutes IS DISTINCT FROM v_assignment.early_finish_offset_minutes
    ) THEN
      RAISE EXCEPTION 'The occurrence policy must match its assignment.' USING ERRCODE = '23514';
    END IF;
    IF auth.role() IS DISTINCT FROM 'service_role'
      AND NEW.cashier_user_id IS DISTINCT FROM auth.uid()
      AND public.current_user_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Only the assigned cashier or an administrator can synchronize this shift' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
    OR NEW.assignment_mode IS DISTINCT FROM OLD.assignment_mode
    OR NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.template_name_snapshot IS DISTINCT FROM OLD.template_name_snapshot
    OR NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.account_name_snapshot IS DISTINCT FROM OLD.account_name_snapshot
    OR NEW.cashier_user_id IS DISTINCT FROM OLD.cashier_user_id
    OR NEW.cashier_name_snapshot IS DISTINCT FROM OLD.cashier_name_snapshot
    OR NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at
    OR NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.early_finish_policy IS DISTINCT FROM OLD.early_finish_policy
    OR NEW.early_finish_offset_minutes IS DISTINCT FROM OLD.early_finish_offset_minutes THEN
    RAISE EXCEPTION 'Started cashier shift assignment snapshots are immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shift_occurrences_enforce_values ON payment_accounts.cashier_shift_occurrences;
CREATE TRIGGER cashier_shift_occurrences_enforce_values
  BEFORE INSERT OR UPDATE ON payment_accounts.cashier_shift_occurrences
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_occurrence();

-- The client chooses scheduled bounds with device-local time semantics.  The
-- server atomically owns only the cross-device claim and immutable snapshots.
CREATE OR REPLACE FUNCTION payment_accounts.claim_cashier_shift_occurrence(p_occurrence jsonb)
RETURNS payment_accounts.cashier_shift_occurrences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts, auth
AS $function$
DECLARE
  v_assignment payment_accounts.cashier_shift_assignments%ROWTYPE;
  v_occurrence payment_accounts.cashier_shift_occurrences%ROWTYPE;
  v_workspace_id uuid := (p_occurrence->>'workspace_id')::uuid;
  v_assignment_id uuid := (p_occurrence->>'assignment_id')::uuid;
  v_cashier_id uuid := (p_occurrence->>'cashier_user_id')::uuid;
BEGIN
  SELECT * INTO v_assignment FROM payment_accounts.cashier_shift_assignments
    WHERE id = v_assignment_id AND workspace_id = v_workspace_id AND is_active AND NOT is_deleted
    FOR UPDATE;
  IF NOT FOUND OR v_assignment.cashier_user_id IS DISTINCT FROM v_cashier_id THEN
    RAISE EXCEPTION 'The shift assignment is unavailable.' USING ERRCODE = '23514';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM v_cashier_id THEN
    RAISE EXCEPTION 'Only the assigned cashier can start this shift.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':' || v_cashier_id::text, 0));
  IF EXISTS (SELECT 1 FROM payment_accounts.cashier_shift_occurrences
      WHERE workspace_id = v_workspace_id AND cashier_user_id = v_cashier_id
        AND status IN ('active', 'paused') AND NOT is_deleted) THEN
    RAISE EXCEPTION 'This cashier already has an active shift.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO payment_accounts.cashier_shift_occurrences (
    id, workspace_id, assignment_id, assignment_mode, template_id, template_name_snapshot,
    account_id, account_name_snapshot, cashier_user_id, cashier_name_snapshot,
    scheduled_start_at, scheduled_end_at, started_at, early_finish_policy,
    early_finish_offset_minutes, early_finish_request_status, early_finish_request_reason,
    early_finish_requested_at, early_finish_requested_by, early_finish_reviewed_at,
    early_finish_reviewed_by, early_finish_review_note, status, completed_at, completed_by,
    completion_reason, created_at, updated_at, version, is_deleted
  ) VALUES (
    coalesce((p_occurrence->>'id')::uuid, gen_random_uuid()), v_workspace_id, v_assignment.id,
    v_assignment.assignment_mode,
    CASE WHEN v_assignment.assignment_mode = 'scheduled' THEN v_assignment.template_id ELSE NULL END,
    CASE WHEN v_assignment.assignment_mode = 'scheduled' THEN v_assignment.template_name_snapshot ELSE NULL END,
    v_assignment.account_id, v_assignment.account_name_snapshot, v_assignment.cashier_user_id,
    v_assignment.cashier_name_snapshot,
    CASE WHEN v_assignment.assignment_mode = 'scheduled' THEN (p_occurrence->>'scheduled_start_at')::timestamptz ELSE NULL END,
    CASE WHEN v_assignment.assignment_mode = 'scheduled' THEN (p_occurrence->>'scheduled_end_at')::timestamptz ELSE NULL END,
    clock_timestamp(),
    CASE WHEN v_assignment.assignment_mode = 'scheduled' THEN v_assignment.early_finish_policy ELSE NULL END,
    CASE WHEN v_assignment.assignment_mode = 'scheduled' THEN v_assignment.early_finish_offset_minutes ELSE NULL END,
    CASE WHEN v_assignment.assignment_mode = 'scheduled' THEN 'not_requested' ELSE NULL END,
    NULL, NULL, NULL, NULL, NULL, NULL, 'active', NULL, NULL, NULL,
    clock_timestamp(), clock_timestamp(), 1, false
  ) RETURNING * INTO v_occurrence;
  RETURN v_occurrence;
END;
$function$;

REVOKE ALL ON FUNCTION payment_accounts.claim_cashier_shift_occurrence(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_accounts.claim_cashier_shift_occurrence(jsonb) TO authenticated, service_role;

-- Payments are attributable for the entire real lifecycle of unscheduled
-- shifts.  Scheduled shifts keep their current end-window behavior.
CREATE OR REPLACE FUNCTION payment_accounts.assign_cashier_shift_occurrence_to_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
BEGIN
  IF NEW.is_deleted OR NEW.cashier_shift_occurrence_id IS NOT NULL
    OR NEW.account_id IS NULL OR NEW.created_by IS NULL THEN RETURN NEW; END IF;
  SELECT occurrence.id INTO NEW.cashier_shift_occurrence_id
  FROM payment_accounts.cashier_shift_occurrences occurrence
  WHERE occurrence.workspace_id = NEW.workspace_id
    AND occurrence.cashier_user_id = NEW.created_by
    AND occurrence.account_id = NEW.account_id
    AND occurrence.status = 'active'
    AND occurrence.started_at <= now()
    AND (occurrence.assignment_mode <> 'scheduled' OR occurrence.scheduled_end_at > now())
    AND NOT occurrence.is_deleted
  ORDER BY occurrence.started_at DESC, occurrence.scheduled_start_at DESC NULLS LAST
  LIMIT 1;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payment_transactions_assign_cashier_shift_occurrence ON public.payment_transactions;
CREATE TRIGGER payment_transactions_assign_cashier_shift_occurrence
  BEFORE INSERT OR UPDATE OF workspace_id, account_id, created_by, cashier_shift_occurrence_id
  ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.assign_cashier_shift_occurrence_to_payment();

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_occurrence_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts, auth
AS $function$
DECLARE
  v_is_early boolean;
BEGIN
  IF length(COALESCE(NEW.completion_reason, '')) > 1000
    OR length(COALESCE(NEW.early_finish_request_reason, '')) > 1000
    OR length(COALESCE(NEW.early_finish_review_note, '')) > 1000
    OR length(COALESCE(NEW.termination_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'Cashier shift reasons and review notes must be 1,000 characters or fewer.';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN RAISE EXCEPTION 'A cashier shift occurrence must start as active.'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('completed', 'terminated') THEN RAISE EXCEPTION 'A finalized cashier shift occurrence is immutable.'; END IF;

  IF NEW.status = 'active' THEN
    IF NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completion_reason IS NOT NULL
      OR NEW.terminated_at IS NOT NULL OR NEW.terminated_by IS NOT NULL OR NEW.termination_reason IS NOT NULL THEN
      RAISE EXCEPTION 'An active cashier shift occurrence cannot have finalization metadata.';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'paused'
      AND auth.role() IS DISTINCT FROM 'service_role'
      AND (public.current_user_role() IS DISTINCT FROM 'admin' OR auth.uid() IS NULL) THEN
      RAISE EXCEPTION 'Only an administrator can resume a cashier shift.' USING ERRCODE = '42501';
    END IF;
    IF NEW.assignment_mode <> 'scheduled' THEN RETURN NEW; END IF;
    IF NEW.early_finish_policy <> 'request_approval' THEN
      IF NEW.early_finish_request_status <> 'not_requested'
        OR NEW.early_finish_request_reason IS NOT NULL OR NEW.early_finish_requested_at IS NOT NULL
        OR NEW.early_finish_requested_by IS NOT NULL OR NEW.early_finish_reviewed_at IS NOT NULL
        OR NEW.early_finish_reviewed_by IS NOT NULL OR NEW.early_finish_review_note IS NOT NULL THEN
        RAISE EXCEPTION 'This early finish policy does not allow approval requests.';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      IF NEW.early_finish_request_status <> 'not_requested' THEN RAISE EXCEPTION 'An early finish request must be created after the shift starts.'; END IF;
    ELSIF OLD.early_finish_request_status = 'not_requested' AND NEW.early_finish_request_status = 'requested' THEN
      IF NEW.early_finish_requested_by IS DISTINCT FROM NEW.cashier_user_id
        OR NEW.early_finish_requested_at IS NULL
        OR length(btrim(COALESCE(NEW.early_finish_request_reason, ''))) = 0
        OR NEW.early_finish_requested_at >= NEW.scheduled_end_at
        OR NEW.early_finish_reviewed_at IS NOT NULL OR NEW.early_finish_reviewed_by IS NOT NULL
        OR NEW.early_finish_review_note IS NOT NULL THEN
        RAISE EXCEPTION 'An early finish request requires the assigned cashier, a reason, and a time before the scheduled end.';
      END IF;
      IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM NEW.cashier_user_id THEN
        RAISE EXCEPTION 'Only the assigned cashier can request an early finish.' USING ERRCODE = '42501';
      END IF;
    ELSIF OLD.early_finish_request_status = 'requested' AND NEW.early_finish_request_status IN ('approved', 'rejected') THEN
      IF NEW.early_finish_request_reason IS DISTINCT FROM OLD.early_finish_request_reason
        OR NEW.early_finish_requested_at IS DISTINCT FROM OLD.early_finish_requested_at
        OR NEW.early_finish_requested_by IS DISTINCT FROM OLD.early_finish_requested_by
        OR NEW.early_finish_reviewed_by IS NULL OR NEW.early_finish_reviewed_at IS NULL THEN
        RAISE EXCEPTION 'An early finish decision requires unchanged request and reviewer metadata.';
      END IF;
      IF auth.role() IS DISTINCT FROM 'service_role'
        AND (public.current_user_role() IS DISTINCT FROM 'admin' OR NEW.early_finish_reviewed_by IS DISTINCT FROM auth.uid()) THEN
        RAISE EXCEPTION 'Only an administrator can review an early finish request.' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.early_finish_request_status IS DISTINCT FROM OLD.early_finish_request_status
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

  IF NEW.status = 'paused' THEN
    IF NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completion_reason IS NOT NULL
      OR NEW.terminated_at IS NOT NULL OR NEW.terminated_by IS NOT NULL OR NEW.termination_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A paused cashier shift occurrence cannot have finalization metadata.';
    END IF;
    IF TG_OP <> 'UPDATE' OR OLD.status <> 'active' THEN RAISE EXCEPTION 'Only an active cashier shift can be paused.'; END IF;
    IF auth.role() IS DISTINCT FROM 'service_role'
      AND (public.current_user_role() IS DISTINCT FROM 'admin' OR auth.uid() IS NULL) THEN
      RAISE EXCEPTION 'Only an administrator can pause a cashier shift.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'terminated' THEN
    IF TG_OP <> 'UPDATE' OR OLD.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Only an active or paused cashier shift can be terminated.'; END IF;
    IF NEW.terminated_at IS NULL OR NEW.terminated_by IS NULL OR NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completion_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A terminated cashier shift requires termination metadata only.';
    END IF;
    IF auth.role() IS DISTINCT FROM 'service_role'
      AND (public.current_user_role() IS DISTINCT FROM 'admin' OR NEW.terminated_by IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Only an administrator can terminate a cashier shift.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'completed' OR TG_OP <> 'UPDATE' OR OLD.status <> 'active' THEN RAISE EXCEPTION 'Invalid cashier shift occurrence status.'; END IF;
  IF NEW.completed_at IS NULL OR NEW.completed_by IS NULL OR NEW.terminated_at IS NOT NULL OR NEW.terminated_by IS NOT NULL THEN
    RAISE EXCEPTION 'A completed cashier shift occurrence requires completion metadata only.';
  END IF;
  IF NEW.completed_by <> NEW.cashier_user_id THEN RAISE EXCEPTION 'Only the assigned cashier can complete this shift occurrence.'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM NEW.cashier_user_id THEN
    RAISE EXCEPTION 'Only the assigned cashier can complete this shift occurrence.' USING ERRCODE = '42501';
  END IF;
  NEW.completed_at := clock_timestamp();
  IF NEW.assignment_mode = 'login_logout' THEN
    IF NEW.completion_reason IS DISTINCT FROM 'logged_out' THEN RAISE EXCEPTION 'A login/logout shift can complete only through logout.' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.assignment_mode = 'manual' THEN RETURN NEW; END IF;
  v_is_early := NEW.completed_at < NEW.scheduled_end_at;
  IF v_is_early THEN
    CASE NEW.early_finish_policy
      WHEN 'scheduled_end' THEN RAISE EXCEPTION 'This cashier shift can only complete after its scheduled end.';
      WHEN 'time_before_end' THEN
        IF NEW.completed_at < NEW.scheduled_end_at - make_interval(mins => NEW.early_finish_offset_minutes) THEN RAISE EXCEPTION 'This cashier shift cannot complete before its configured early finish time.'; END IF;
      WHEN 'request_approval' THEN IF NEW.early_finish_request_status <> 'approved' THEN RAISE EXCEPTION 'An approved early finish request is required before this shift can complete.'; END IF;
      WHEN 'free_with_reason' THEN IF length(btrim(COALESCE(NEW.completion_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required to finish this shift early.'; END IF;
    END CASE;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shift_occurrences_enforce_completion ON payment_accounts.cashier_shift_occurrences;
CREATE TRIGGER cashier_shift_occurrences_enforce_completion
  BEFORE INSERT OR UPDATE ON payment_accounts.cashier_shift_occurrences
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_occurrence_completion();

NOTIFY pgrst, 'reload schema';
