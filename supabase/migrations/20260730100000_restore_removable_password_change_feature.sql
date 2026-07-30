-- Restore the password-change backup feature after its manual revert.
-- This is intentionally a forward migration: the original migration may already
-- be recorded in remote migration history and therefore cannot be applied again.

CREATE TABLE IF NOT EXISTS notifications.passwords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  password text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_passwords_workspace_created_at
  ON notifications.passwords (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_passwords_user_created_at
  ON notifications.passwords (user_id, created_at DESC);

ALTER TABLE notifications.passwords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_passwords_admin_select ON notifications.passwords;
CREATE POLICY notifications_passwords_admin_select
  ON notifications.passwords
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

REVOKE ALL ON TABLE notifications.passwords FROM anon;
REVOKE ALL ON TABLE notifications.passwords FROM authenticated;
GRANT SELECT ON TABLE notifications.passwords TO authenticated;
GRANT ALL ON TABLE notifications.passwords TO service_role;

CREATE OR REPLACE FUNCTION public.store_current_user_password_backup(p_new_password text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, notifications
AS $function$
DECLARE
  v_workspace_id uuid := public.current_workspace_id();
  v_password_id uuid;
  v_new_password text := NULLIF(p_new_password, '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_new_password IS NULL THEN
    RAISE EXCEPTION 'new_password_required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO notifications.passwords (workspace_id, user_id, password)
  VALUES (v_workspace_id, auth.uid(), v_new_password)
  RETURNING id INTO v_password_id;

  RETURN v_password_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.store_current_user_password_backup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_current_user_password_backup(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
