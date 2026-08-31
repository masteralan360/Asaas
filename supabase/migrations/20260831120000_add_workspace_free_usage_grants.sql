-- A free-usage grant uses the existing canonical usage counter and the
-- existing notification inbox. It deliberately creates no grant ledger,
-- pending-state table, or additional workspace columns.

CREATE OR REPLACE FUNCTION public.admin_grant_workspace_free_usage(
  p_workspace_id uuid,
  p_granted_bytes bigint
)
RETURNS TABLE (
  workspace_id uuid,
  granted_bytes bigint,
  data_transfer_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, notifications
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_data_transfer_bytes bigint;
  v_notified_admin_count integer;
BEGIN
  IF p_workspace_id IS NULL OR v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF p_granted_bytes IS NULL OR p_granted_bytes <= 0 THEN
    RAISE EXCEPTION 'Free usage must be greater than zero bytes';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_usage_owner_id
  ) THEN
    RAISE EXCEPTION 'Free usage is available only for workspaces with usage limits';
  END IF;

  -- Ensuring the row and changing the counter happen in this transaction.
  -- The UPDATE row lock also serializes concurrent usage metering and grants.
  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);

  UPDATE public.workspace_usage AS usage_row
  SET
    data_transfer_bytes = GREATEST(usage_row.data_transfer_bytes - p_granted_bytes, 0),
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE usage_row.workspace_id = v_usage_owner_id
  RETURNING usage_row.data_transfer_bytes INTO v_data_transfer_bytes;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace usage row was not available';
  END IF;

  -- Each workspace administrator receives a normal inbox item. Its normal
  -- read/archive lifecycle owns the seen state; no parallel notification
  -- state needs to be persisted.
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
    v_usage_owner_id,
    profile.id,
    'workspace_free_usage_granted',
    'workspace',
    'normal',
    'Free usage granted',
    'Your workspace received free usage.',
    jsonb_build_object('granted_bytes', p_granted_bytes),
    'skipped',
    timezone('utc', now()),
    timezone('utc', now())
  FROM public.profiles AS profile
  WHERE profile.workspace_id = v_usage_owner_id
    AND profile.role = 'admin';

  GET DIAGNOSTICS v_notified_admin_count = ROW_COUNT;
  IF v_notified_admin_count = 0 THEN
    RAISE EXCEPTION 'The workspace has no administrator to notify';
  END IF;

  PERFORM public.reconcile_workspace_usage_limit_lock(v_usage_owner_id);

  RETURN QUERY SELECT
    v_usage_owner_id,
    p_granted_bytes,
    v_data_transfer_bytes;
END;
$function$;

COMMENT ON FUNCTION public.admin_grant_workspace_free_usage(uuid, bigint) IS
  'Atomically subtracts a free-usage grant from data_transfer_bytes and creates normal inbox notifications for the workspace administrators.';

REVOKE ALL ON FUNCTION public.admin_grant_workspace_free_usage(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_workspace_free_usage(uuid, bigint) TO service_role;
