CREATE OR REPLACE FUNCTION public.set_workspace_notification_type_disabled(
  p_notification_type text,
  p_disabled boolean DEFAULT true
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, notifications
AS $function$
DECLARE
  v_workspace_id uuid := public.current_workspace_id();
  v_notification_type text := NULLIF(BTRIM(COALESCE(p_notification_type, '')), '');
BEGIN
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_required'
      USING ERRCODE = '42501';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'notification_settings_admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_notification_type NOT IN (
    'marketplace_order_pending',
    'order_approval_request',
    'order_approval_approved',
    'loan_installment_overdue',
    'expense_item_overdue',
    'payroll_overdue',
    'inventory_low_stock'
  ) THEN
    RAISE EXCEPTION 'unsupported_notification_type'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_disabled, true) THEN
    INSERT INTO notifications.workspace_disabled_types (
      workspace_id,
      notification_type,
      disabled_by
    )
    VALUES (
      v_workspace_id,
      v_notification_type,
      auth.uid()
    )
    ON CONFLICT (workspace_id, notification_type) DO UPDATE
    SET
      disabled_by = EXCLUDED.disabled_by,
      updated_at = now();
  ELSE
    DELETE FROM notifications.workspace_disabled_types
    WHERE workspace_id = v_workspace_id
      AND notification_type = v_notification_type;
  END IF;

  RETURN true;
END;
$function$;
