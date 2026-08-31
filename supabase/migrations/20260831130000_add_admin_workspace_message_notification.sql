-- Admin-to-workspace messages reuse the existing inbox and its realtime
-- publication. No message table or notification schema change is required.

CREATE OR REPLACE FUNCTION public.admin_send_workspace_message(
  p_workspace_id uuid,
  p_message text
)
RETURNS TABLE (
  workspace_id uuid,
  recipient_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, notifications
AS $function$
DECLARE
  v_message text := btrim(COALESCE(p_message, ''));
  v_recipient_count integer;
BEGIN
  IF p_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF v_message = '' THEN
    RAISE EXCEPTION 'Message is required';
  END IF;

  IF char_length(v_message) > 2000 THEN
    RAISE EXCEPTION 'Message must be 2000 characters or fewer';
  END IF;

  -- Inbox rows are individually addressed, so every current workspace admin
  -- receives the same normal notification and its existing realtime delivery.
  INSERT INTO notifications.inbox (
    workspace_id,
    user_id,
    notification_type,
    scope,
    priority,
    title,
    body,
    payload,
    push_status,
    created_at,
    updated_at
  )
  SELECT
    p_workspace_id,
    profile.id,
    'admin_workspace_message',
    'workspace',
    'normal',
    'Message from Atlas Admin',
    v_message,
    jsonb_build_object('source', 'admin_console'),
    'skipped',
    timezone('utc', now()),
    timezone('utc', now())
  FROM public.profiles AS profile
  WHERE profile.workspace_id = p_workspace_id
    AND profile.role = 'admin';

  GET DIAGNOSTICS v_recipient_count = ROW_COUNT;
  IF v_recipient_count = 0 THEN
    RAISE EXCEPTION 'The workspace has no administrator to notify';
  END IF;

  RETURN QUERY SELECT p_workspace_id, v_recipient_count;
END;
$function$;

COMMENT ON FUNCTION public.admin_send_workspace_message(uuid, text) IS
  'Creates normal realtime inbox notifications for every administrator in the specified workspace.';

REVOKE ALL ON FUNCTION public.admin_send_workspace_message(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_workspace_message(uuid, text) TO service_role;
