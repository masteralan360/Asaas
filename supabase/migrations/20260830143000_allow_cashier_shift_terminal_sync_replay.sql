-- An interrupted/legacy client can have a real terminal occurrence locally
-- while the original active-row insert never reached Supabase.  Its queued
-- terminal upsert is still an auditable occurrence, not a new live shift.
-- Accept that narrow replay path after validating the final snapshot.
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

  -- Sync uses upsert. When the original active insert was interrupted, an
  -- update mutation can arrive as an INSERT containing its final snapshot.
  IF TG_OP = 'INSERT' AND NEW.status = 'terminated' THEN
    IF NEW.terminated_at IS NULL OR NEW.terminated_by IS NULL
      OR NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL
      OR NEW.completion_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A terminated cashier shift requires termination metadata only.';
    END IF;
    IF auth.role() IS DISTINCT FROM 'service_role'
      AND (public.current_user_role() IS DISTINCT FROM 'admin'
        OR NEW.terminated_by IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Only an administrator can terminate a cashier shift.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'completed' THEN
    IF NEW.completed_at IS NULL OR NEW.completed_by IS NULL
      OR NEW.terminated_at IS NOT NULL OR NEW.terminated_by IS NOT NULL THEN
      RAISE EXCEPTION 'A completed cashier shift occurrence requires completion metadata only.';
    END IF;
    IF NEW.completed_by IS DISTINCT FROM NEW.cashier_user_id THEN
      RAISE EXCEPTION 'Only the assigned cashier can complete this shift occurrence.';
    END IF;
    IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM NEW.cashier_user_id THEN
      RAISE EXCEPTION 'Only the assigned cashier can complete this shift occurrence.' USING ERRCODE = '42501';
    END IF;
    IF NEW.assignment_mode = 'login_logout' THEN
      IF NEW.completion_reason IS DISTINCT FROM 'logged_out' THEN
        RAISE EXCEPTION 'A login/logout shift can complete only through logout.' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.assignment_mode = 'manual' THEN RETURN NEW; END IF;
    v_is_early := NEW.completed_at < NEW.scheduled_end_at;
    IF v_is_early THEN
      CASE NEW.early_finish_policy
        WHEN 'scheduled_end' THEN RAISE EXCEPTION 'This cashier shift can only complete after its scheduled end.';
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

NOTIFY pgrst, 'reload schema';
