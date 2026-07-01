CREATE TABLE IF NOT EXISTS notifications.workspace_disabled_types (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  disabled_by uuid NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  disabled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, notification_type),
  CONSTRAINT notifications_workspace_disabled_types_type_check CHECK (
    notification_type IN (
      'marketplace_order_pending',
      'loan_installment_overdue',
      'expense_item_overdue',
      'payroll_overdue',
      'inventory_low_stock'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_disabled_types_workspace
  ON notifications.workspace_disabled_types (workspace_id);

DROP TRIGGER IF EXISTS set_notifications_workspace_disabled_types_updated_at
  ON notifications.workspace_disabled_types;

CREATE TRIGGER set_notifications_workspace_disabled_types_updated_at
BEFORE UPDATE ON notifications.workspace_disabled_types
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE notifications.workspace_disabled_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_workspace_disabled_types_select
  ON notifications.workspace_disabled_types;
CREATE POLICY notifications_workspace_disabled_types_select
  ON notifications.workspace_disabled_types
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS notifications_workspace_disabled_types_insert
  ON notifications.workspace_disabled_types;
CREATE POLICY notifications_workspace_disabled_types_insert
  ON notifications.workspace_disabled_types
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND (disabled_by IS NULL OR disabled_by = auth.uid())
  );

DROP POLICY IF EXISTS notifications_workspace_disabled_types_update
  ON notifications.workspace_disabled_types;
CREATE POLICY notifications_workspace_disabled_types_update
  ON notifications.workspace_disabled_types
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS notifications_workspace_disabled_types_delete
  ON notifications.workspace_disabled_types;
CREATE POLICY notifications_workspace_disabled_types_delete
  ON notifications.workspace_disabled_types
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

REVOKE ALL ON TABLE notifications.workspace_disabled_types FROM anon;
REVOKE ALL ON TABLE notifications.workspace_disabled_types FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE notifications.workspace_disabled_types TO authenticated;
GRANT ALL ON TABLE notifications.workspace_disabled_types TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_notification_inbox(p_event_id uuid, p_workspace_id uuid, p_user_id uuid, p_notification_type text, p_scope text DEFAULT 'user'::text, p_priority text DEFAULT 'normal'::text, p_dedupe_key text DEFAULT NULL::text, p_title text DEFAULT ''::text, p_body text DEFAULT NULL::text, p_action_url text DEFAULT NULL::text, p_action_label text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_created_at timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, notifications
AS $function$
DECLARE
  v_notification_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM notifications.workspace_disabled_types disabled_type
    WHERE disabled_type.workspace_id = p_workspace_id
      AND disabled_type.notification_type = p_notification_type
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO notifications.inbox (
    event_id,
    workspace_id,
    user_id,
    notification_type,
    scope,
    priority,
    dedupe_key,
    title,
    body,
    action_url,
    action_label,
    payload,
    push_status,
    push_sent_at,
    push_last_attempt_at,
    push_error,
    push_attempt_count,
    created_at
  )
  VALUES (
    p_event_id,
    p_workspace_id,
    p_user_id,
    p_notification_type,
    COALESCE(NULLIF(TRIM(COALESCE(p_scope, '')), ''), 'user'),
    COALESCE(NULLIF(TRIM(COALESCE(p_priority, '')), ''), 'normal'),
    NULLIF(TRIM(COALESCE(p_dedupe_key, '')), ''),
    COALESCE(NULLIF(TRIM(COALESCE(p_title, '')), ''), 'Notification'),
    NULLIF(TRIM(COALESCE(p_body, '')), ''),
    NULLIF(TRIM(COALESCE(p_action_url, '')), ''),
    NULLIF(TRIM(COALESCE(p_action_label, '')), ''),
    COALESCE(p_payload, '{}'::jsonb),
    'pending',
    NULL,
    NULL,
    NULL,
    0,
    COALESCE(p_created_at, now())
  )
  ON CONFLICT (event_id) DO UPDATE
  SET
    workspace_id = EXCLUDED.workspace_id,
    user_id = EXCLUDED.user_id,
    notification_type = EXCLUDED.notification_type,
    scope = EXCLUDED.scope,
    priority = EXCLUDED.priority,
    dedupe_key = COALESCE(EXCLUDED.dedupe_key, notifications.inbox.dedupe_key),
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    action_url = EXCLUDED.action_url,
    action_label = EXCLUDED.action_label,
    payload = EXCLUDED.payload,
    push_status = 'pending',
    push_sent_at = NULL,
    push_last_attempt_at = NULL,
    push_error = NULL,
    push_attempt_count = 0,
    created_at = LEAST(notifications.inbox.created_at, EXCLUDED.created_at),
    updated_at = now()
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$function$;
