-- Repair installations that ran the former database-trigger implementation.
-- Supabase Storage prohibits direct writes to storage.objects, so remove the
-- trigger before any queued redispatch updates are retried.
DROP TRIGGER IF EXISTS delivery_delete_redispatched_postponed_voice_reasons
  ON delivery.delivery_shipments;

DROP FUNCTION IF EXISTS app_private.delete_redispatched_postponed_voice_reasons();

NOTIFY pgrst, 'reload schema';
