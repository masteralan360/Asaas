-- No client calls this legacy façade directly. Keep it available to trusted
-- database functions and the service role without exposing another RPC.
ALTER FUNCTION public.current_workspace_usage_period_start()
  SECURITY INVOKER;
ALTER FUNCTION public.current_workspace_usage_period_start()
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.current_workspace_usage_period_start()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_workspace_usage_period_start()
  TO service_role;

COMMENT ON FUNCTION public.current_workspace_usage_period_start() IS
  'Internal current-workspace usage-period façade. Client flows use the guarded usage-status functions instead.';

NOTIFY pgrst, 'reload schema';
