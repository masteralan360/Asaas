-- Function to clean up expired demo workspaces.
-- Called by pg_cron every 5 minutes.
CREATE OR REPLACE FUNCTION public.cleanup_expired_demos()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_workspace record;
  v_user_ids uuid[];
  v_user_id uuid;
  v_cleaned int := 0;
BEGIN
  FOR v_workspace IN
    SELECT id FROM public.workspaces
    WHERE code LIKE 'demo.%'
      AND subscription_expires_at < now()
      AND deleted_at IS NULL
  LOOP
    -- Collect auth user IDs for this workspace before cascade deletes them
    SELECT array_agg(id) INTO v_user_ids
    FROM auth.users
    WHERE raw_user_meta_data->>'workspace_id' = v_workspace.id::text;

    -- Delete workspace data (profiles, products, etc.)
    PERFORM public.delete_demo_cascade(v_workspace.id);

    -- Delete auth users
    IF v_user_ids IS NOT NULL THEN
      FOREACH v_user_id IN ARRAY v_user_ids LOOP
        DELETE FROM auth.users WHERE id = v_user_id;
      END LOOP;
    END IF;

    v_cleaned := v_cleaned + 1;
  END LOOP;

  RETURN v_cleaned;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_expired_demos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_demos() TO service_role;

-- Schedule cleanup every 5 minutes
SELECT cron.schedule('cleanup-expired-demos', '*/5 * * * *', 'SELECT public.cleanup_expired_demos()');
