-- Clean up legacy demo infrastructure that is no longer needed.
-- Demo workspaces are now created locally (IndexedDB) with an optional
-- server-side timer via the `demos` table. The old server-side cascade
-- delete and expiry cleanup functions are superseded by local cleanup.

-- 1. Drop the old cascade delete function
DROP FUNCTION IF EXISTS public.delete_demo_cascade(uuid);

-- 2. Drop the old expiry cleanup function
DROP FUNCTION IF EXISTS public.cleanup_expired_demos();

-- 3. Unschedule the pg_cron job that called cleanup_expired_demos
SELECT cron.unschedule('cleanup-expired-demos');
