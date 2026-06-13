-- Periodic cleanup of expired demos table entries.
-- This runs every 20 minutes and removes rows where expires_at < now().
-- The demos table is lightweight (uuid + timestamptz only), so this is
-- purely a housekeeping measure to prevent unbounded growth.

CREATE OR REPLACE FUNCTION public.cleanup_expired_demos()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cleaned int;
BEGIN
    DELETE FROM public.demos WHERE expires_at < now();
    GET DIAGNOSTICS v_cleaned = ROW_COUNT;
    RETURN v_cleaned;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_demos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_demos() TO service_role;

-- Schedule cleanup every 20 minutes
SELECT cron.schedule('cleanup-expired-demos', '*/20 * * * *', 'SELECT public.cleanup_expired_demos()');
