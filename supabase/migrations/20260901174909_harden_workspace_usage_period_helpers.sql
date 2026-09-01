-- Only the current-workspace façade is available to signed-in clients. The
-- arbitrary-workspace helper reads billing configuration under definer rights,
-- so keep it internal to trusted functions and the service role.
CREATE OR REPLACE FUNCTION public.current_workspace_usage_period_start()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT public.workspace_usage_period_start(public.current_workspace_id());
$function$;

REVOKE ALL ON FUNCTION public.workspace_usage_period_start(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_usage_period_start(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.current_workspace_usage_period_start()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_workspace_usage_period_start()
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
