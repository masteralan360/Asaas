-- Storage objects must only be deleted through Supabase Storage's API.  A
-- previous version attempted to delete `storage.objects` inside a database
-- trigger, which Storage intentionally rejects.  The cleanup is performed by
-- the authenticated client after the redispatch mutation has been synced.
SELECT 1;
