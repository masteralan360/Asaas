-- The temporary-day grant intentionally updates subscription_expires_at. Keep
-- the client-side workspace-field guard intact, but mark this validated RPC as
-- a trusted server-side update for the duration of its transaction.

ALTER FUNCTION public.grant_workspace_subscription_extra_days_base(integer)
  RENAME TO grant_workspace_subscription_extra_days_v1;

CREATE OR REPLACE FUNCTION public.grant_workspace_subscription_extra_days_base(
  p_extra_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
BEGIN
  PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);

  RETURN public.grant_workspace_subscription_extra_days_v1(p_extra_days);
END;
$function$;

COMMENT ON FUNCTION public.grant_workspace_subscription_extra_days_base(integer) IS
  'Internal temporary-extension grant that marks its subscription-expiry update as trusted before invoking the validated grant workflow.';

REVOKE ALL ON FUNCTION public.grant_workspace_subscription_extra_days_v1(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.grant_workspace_subscription_extra_days_base(integer)
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
