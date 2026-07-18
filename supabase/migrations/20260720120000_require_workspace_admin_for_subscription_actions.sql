-- Only workspace administrators may submit subscription renewals or grant
-- temporary extra days. Keep the authorization in the RPC layer so hidden UI
-- controls cannot be bypassed with a direct PostgREST request.

ALTER FUNCTION public.submit_workspace_payment(text, text)
  RENAME TO submit_workspace_payment_base;

CREATE OR REPLACE FUNCTION public.submit_workspace_payment(
  p_provider text,
  p_account_holder_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing, auth
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'workspace_payment_workspace_admin_required'
      USING ERRCODE = '42501',
        DETAIL = 'Only workspace administrators can submit a subscription renewal.';
  END IF;

  RETURN public.submit_workspace_payment_base(
    p_provider,
    p_account_holder_name
  );
END;
$function$;

COMMENT ON FUNCTION public.submit_workspace_payment(text, text) IS
  'Creates a manual workspace payment for an authenticated workspace administrator and requires a normalized FIB/QiCard account holder name.';

ALTER FUNCTION public.grant_workspace_subscription_extra_days(integer)
  RENAME TO grant_workspace_subscription_extra_days_base;

CREATE OR REPLACE FUNCTION public.grant_workspace_subscription_extra_days(
  p_extra_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing, auth
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'workspace_subscription_extra_days_workspace_admin_required'
      USING ERRCODE = '42501',
        DETAIL = 'Only workspace administrators can add temporary subscription days.';
  END IF;

  RETURN public.grant_workspace_subscription_extra_days_base(p_extra_days);
END;
$function$;

COMMENT ON FUNCTION public.grant_workspace_subscription_extra_days(integer) IS
  'Allows only workspace administrators to apply one to six temporary subscription days and create the pending debit record.';

REVOKE ALL ON FUNCTION public.submit_workspace_payment_base(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_workspace_payment(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_workspace_payment(text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.grant_workspace_subscription_extra_days_base(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.grant_workspace_subscription_extra_days(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_workspace_subscription_extra_days(integer)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
