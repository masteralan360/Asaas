-- Pause requests and pause periods are kept independently from an occurrence so
-- every request, review, and interruption remains auditable after a shift ends.
ALTER TABLE payment_accounts.cashier_shift_occurrences
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS terminated_by uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS termination_reason text NULL;

ALTER TABLE payment_accounts.cashier_shift_occurrences
  DROP CONSTRAINT IF EXISTS payment_accounts_cashier_shift_occurrence_status_check,
  ADD CONSTRAINT payment_accounts_cashier_shift_occurrence_status_check
    CHECK (status IN ('active', 'paused', 'completed', 'terminated'));

CREATE TABLE IF NOT EXISTS payment_accounts.cashier_shift_pause_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES payment_accounts.cashier_shift_occurrences(id) ON DELETE RESTRICT,
  cashier_user_id uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL,
  requested_duration_minutes integer NULL,
  requested_resume_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  reviewed_by uuid NULL REFERENCES auth.users(id),
  review_note text NULL,
  approved_pause_period_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_accounts_cashier_shift_pause_request_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT payment_accounts_cashier_shift_pause_request_timing_check
    CHECK (
      (requested_duration_minutes IS NOT NULL AND requested_duration_minutes > 0 AND requested_resume_at IS NULL)
      OR (requested_duration_minutes IS NULL AND requested_resume_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_cashier_shift_pause_request_one_pending
  ON payment_accounts.cashier_shift_pause_requests (occurrence_id)
  WHERE status = 'pending' AND NOT is_deleted;

CREATE INDEX IF NOT EXISTS payment_accounts_cashier_shift_pause_requests_workspace_occurrence
  ON payment_accounts.cashier_shift_pause_requests (workspace_id, occurrence_id, requested_at DESC)
  WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS payment_accounts.cashier_shift_pause_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES payment_accounts.cashier_shift_occurrences(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  initiated_by uuid NOT NULL REFERENCES auth.users(id),
  note text NULL,
  pause_request_id uuid NULL REFERENCES payment_accounts.cashier_shift_pause_requests(id) ON DELETE RESTRICT,
  resumed_at timestamptz NULL,
  resumed_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_accounts_cashier_shift_pause_period_kind_check
    CHECK (kind IN ('cashier_request', 'admin', 'emergency')),
  CONSTRAINT payment_accounts_cashier_shift_pause_period_resume_check
    CHECK ((resumed_at IS NULL AND resumed_by IS NULL) OR (resumed_at IS NOT NULL AND resumed_by IS NOT NULL)),
  CONSTRAINT payment_accounts_cashier_shift_pause_period_request_check
    CHECK ((kind = 'cashier_request' AND pause_request_id IS NOT NULL) OR (kind <> 'cashier_request' AND pause_request_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_cashier_shift_pause_period_one_open
  ON payment_accounts.cashier_shift_pause_periods (occurrence_id)
  WHERE resumed_at IS NULL AND NOT is_deleted;

CREATE INDEX IF NOT EXISTS payment_accounts_cashier_shift_pause_periods_workspace_occurrence
  ON payment_accounts.cashier_shift_pause_periods (workspace_id, occurrence_id, started_at DESC)
  WHERE NOT is_deleted;

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
    SELECT * INTO v_assignment
    FROM payment_accounts.cashier_shift_assignments
    WHERE id = NEW.assignment_id AND workspace_id = NEW.workspace_id AND is_active AND NOT is_deleted;
    IF NOT FOUND
      OR NEW.cashier_user_id IS DISTINCT FROM v_assignment.cashier_user_id
      OR NEW.account_id IS DISTINCT FROM v_assignment.account_id THEN
      RAISE EXCEPTION 'The shift occurrence does not match an active cashier assignment' USING ERRCODE = '23514';
    END IF;
    IF auth.role() IS DISTINCT FROM 'service_role' AND NEW.cashier_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Only the assigned cashier can start this shift' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
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

  IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'A cashier shift occurrence must start as active.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('completed', 'terminated') THEN
    RAISE EXCEPTION 'A finalized cashier shift occurrence is immutable.';
  END IF;

  IF NEW.status = 'active' THEN
    IF NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completion_reason IS NOT NULL
      OR NEW.terminated_at IS NOT NULL OR NEW.terminated_by IS NOT NULL OR NEW.termination_reason IS NOT NULL THEN
      RAISE EXCEPTION 'An active cashier shift occurrence cannot have finalization metadata.';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'paused' THEN
      IF auth.role() IS DISTINCT FROM 'service_role'
        AND (public.current_user_role() IS DISTINCT FROM 'admin' OR auth.uid() IS NULL) THEN
        RAISE EXCEPTION 'Only an administrator can resume a cashier shift.' USING ERRCODE = '42501';
      END IF;
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
    ELSIF TG_OP = 'INSERT' THEN
      IF NEW.early_finish_request_status <> 'not_requested' THEN
        RAISE EXCEPTION 'An early finish request must be created after the shift starts.';
      END IF;
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
    IF TG_OP <> 'UPDATE' OR OLD.status <> 'active' THEN
      RAISE EXCEPTION 'Only an active cashier shift can be paused.';
    END IF;
    IF auth.role() IS DISTINCT FROM 'service_role'
      AND (public.current_user_role() IS DISTINCT FROM 'admin' OR auth.uid() IS NULL) THEN
      RAISE EXCEPTION 'Only an administrator can pause a cashier shift.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'terminated' THEN
    IF TG_OP <> 'UPDATE' OR OLD.status NOT IN ('active', 'paused') THEN
      RAISE EXCEPTION 'Only an active or paused cashier shift can be terminated.';
    END IF;
    IF NEW.terminated_at IS NULL OR NEW.terminated_by IS NULL
      OR NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completion_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A terminated cashier shift requires termination metadata only.';
    END IF;
    IF auth.role() IS DISTINCT FROM 'service_role'
      AND (public.current_user_role() IS DISTINCT FROM 'admin' OR NEW.terminated_by IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Only an administrator can terminate a cashier shift.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'completed' OR TG_OP <> 'UPDATE' OR OLD.status <> 'active' THEN
    RAISE EXCEPTION 'Invalid cashier shift occurrence status.';
  END IF;
  IF NEW.completed_at IS NULL OR NEW.completed_by IS NULL OR NEW.terminated_at IS NOT NULL OR NEW.terminated_by IS NOT NULL THEN
    RAISE EXCEPTION 'A completed cashier shift occurrence requires completion metadata only.';
  END IF;
  IF NEW.completed_by <> NEW.cashier_user_id THEN
    RAISE EXCEPTION 'Only the assigned cashier can complete this shift occurrence.';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM NEW.cashier_user_id THEN
    RAISE EXCEPTION 'Only the assigned cashier can complete this shift occurrence.' USING ERRCODE = '42501';
  END IF;
  NEW.completed_at := clock_timestamp();
  v_is_early := NEW.completed_at < NEW.scheduled_end_at;
  IF v_is_early THEN
    CASE NEW.early_finish_policy
      WHEN 'scheduled_end' THEN RAISE EXCEPTION 'This cashier shift can only complete after its scheduled end.';
      WHEN 'time_before_end' THEN
        IF NEW.completed_at < NEW.scheduled_end_at - make_interval(mins => NEW.early_finish_offset_minutes) THEN
          RAISE EXCEPTION 'This cashier shift cannot complete before its configured early finish time.';
        END IF;
      WHEN 'request_approval' THEN
        IF NEW.early_finish_request_status <> 'approved' THEN RAISE EXCEPTION 'An approved early finish request is required before this shift can complete.'; END IF;
      WHEN 'free_with_reason' THEN
        IF length(btrim(COALESCE(NEW.completion_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required to finish this shift early.'; END IF;
    END CASE;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_pause_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts, auth
AS $function$
DECLARE
  v_occurrence payment_accounts.cashier_shift_occurrences%ROWTYPE;
BEGIN
  IF length(btrim(COALESCE(NEW.reason, ''))) = 0 OR length(NEW.reason) > 1000 OR length(COALESCE(NEW.review_note, '')) > 1000 THEN
    RAISE EXCEPTION 'A cashier pause request needs a reason of 1,000 characters or fewer.';
  END IF;
  SELECT * INTO v_occurrence FROM payment_accounts.cashier_shift_occurrences
    WHERE id = NEW.occurrence_id AND workspace_id = NEW.workspace_id AND NOT is_deleted;
  IF NOT FOUND OR NEW.cashier_user_id IS DISTINCT FROM v_occurrence.cashier_user_id THEN
    RAISE EXCEPTION 'The pause request must belong to the occurrence cashier.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR v_occurrence.status <> 'active' THEN RAISE EXCEPTION 'A pause request can only be made for an active shift.'; END IF;
    IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM NEW.cashier_user_id THEN
      RAISE EXCEPTION 'Only the assigned cashier can request a pause.' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    IF NEW.reviewed_at IS NULL OR NEW.reviewed_by IS NULL THEN RAISE EXCEPTION 'A pause review requires reviewer metadata.'; END IF;
    IF auth.role() IS DISTINCT FROM 'service_role'
      AND (public.current_user_role() IS DISTINCT FROM 'admin' OR NEW.reviewed_by IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Only an administrator can review a pause request.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.requested_duration_minutes IS DISTINCT FROM OLD.requested_duration_minutes
    OR NEW.requested_resume_at IS DISTINCT FROM OLD.requested_resume_at
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.review_note IS DISTINCT FROM OLD.review_note OR NEW.approved_pause_period_id IS DISTINCT FROM OLD.approved_pause_period_id THEN
    RAISE EXCEPTION 'A reviewed cashier pause request is immutable.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION payment_accounts.enforce_cashier_shift_pause_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, payment_accounts, auth
AS $function$
DECLARE
  v_request payment_accounts.cashier_shift_pause_requests%ROWTYPE;
BEGIN
  IF length(COALESCE(NEW.note, '')) > 1000 THEN RAISE EXCEPTION 'A pause note must be 1,000 characters or fewer.'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'cashier_request' THEN
      SELECT * INTO v_request FROM payment_accounts.cashier_shift_pause_requests
        WHERE id = NEW.pause_request_id AND occurrence_id = NEW.occurrence_id AND workspace_id = NEW.workspace_id AND status = 'approved' AND NOT is_deleted;
      IF NOT FOUND THEN RAISE EXCEPTION 'An approved pause request is required for this pause period.'; END IF;
      IF auth.role() IS DISTINCT FROM 'service_role'
        AND (public.current_user_role() IS DISTINCT FROM 'admin' OR NEW.initiated_by IS DISTINCT FROM auth.uid()) THEN
        RAISE EXCEPTION 'Only an administrator can start an approved cashier pause.' USING ERRCODE = '42501';
      END IF;
    ELSIF auth.role() IS DISTINCT FROM 'service_role' AND public.current_user_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Only an administrator can directly pause a cashier shift.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by
    OR NEW.note IS DISTINCT FROM OLD.note OR NEW.pause_request_id IS DISTINCT FROM OLD.pause_request_id
    OR OLD.resumed_at IS NOT NULL OR NEW.resumed_at IS NULL OR NEW.resumed_by IS NULL THEN
    RAISE EXCEPTION 'A pause period can only be closed once.';
  ELSIF auth.role() IS DISTINCT FROM 'service_role' AND public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can resume a cashier shift.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shift_pause_requests_enforce_values ON payment_accounts.cashier_shift_pause_requests;
CREATE TRIGGER cashier_shift_pause_requests_enforce_values
  BEFORE INSERT OR UPDATE ON payment_accounts.cashier_shift_pause_requests
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_pause_request();

DROP TRIGGER IF EXISTS cashier_shift_pause_periods_enforce_values ON payment_accounts.cashier_shift_pause_periods;
CREATE TRIGGER cashier_shift_pause_periods_enforce_values
  BEFORE INSERT OR UPDATE ON payment_accounts.cashier_shift_pause_periods
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.enforce_cashier_shift_pause_period();

ALTER TABLE payment_accounts.cashier_shift_pause_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts.cashier_shift_pause_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_accounts_shift_pause_requests_access ON payment_accounts.cashier_shift_pause_requests
  FOR ALL TO authenticated
  USING (workspace_id = public.current_workspace_id() AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control'))
  WITH CHECK (workspace_id = public.current_workspace_id() AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control'));

CREATE POLICY payment_accounts_shift_pause_periods_access ON payment_accounts.cashier_shift_pause_periods
  FOR ALL TO authenticated
  USING (workspace_id = public.current_workspace_id() AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control'))
  WITH CHECK (workspace_id = public.current_workspace_id() AND payment_accounts.module_allowed(workspace_id, 'cashier_shift_control'));

GRANT SELECT, INSERT, UPDATE ON payment_accounts.cashier_shift_pause_requests, payment_accounts.cashier_shift_pause_periods TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
