-- An occurrence can be started while the assigned cashier is offline, then
-- replayed while an administrator is the current cloud session. Preserve the
-- cashier-only start rule for regular users while allowing that trusted admin
-- session to synchronize the already recorded occurrence.
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

    IF auth.role() IS DISTINCT FROM 'service_role'
      AND NEW.cashier_user_id IS DISTINCT FROM auth.uid()
      AND public.current_user_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Only the assigned cashier or an administrator can synchronize this shift' USING ERRCODE = '42501';
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

NOTIFY pgrst, 'reload schema';
