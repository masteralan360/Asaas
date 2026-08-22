-- The Web Live gateway only needs the resolved usage owner and whether it is
-- currently locked. Returning the full usage dashboard row before every CRUD
-- request created unnecessary API-response egress.
CREATE OR REPLACE FUNCTION public.get_current_workspace_usage_access()
RETURNS TABLE (
  workspace_id uuid,
  usage_limit_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_current_workspace_id uuid := public.current_workspace_id();
  v_usage_owner_id uuid := public.workspace_usage_owner_id(public.current_workspace_id());
BEGIN
  IF v_current_workspace_id IS NULL OR v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_usage_owner_id
  ) THEN
    RETURN QUERY SELECT v_usage_owner_id, false;
    RETURN;
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);
  PERFORM public.reconcile_workspace_usage_limit_lock(v_usage_owner_id);

  RETURN QUERY
  SELECT workspace_row.id, COALESCE(workspace_row.usage_limit_locked, false)
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_usage_owner_id;
END;
$function$;

COMMENT ON FUNCTION public.get_current_workspace_usage_access() IS
  'Minimal Web Live gateway preflight: returns the usage-owner id and lock state only.';

REVOKE ALL ON FUNCTION public.get_current_workspace_usage_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_workspace_usage_access() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
