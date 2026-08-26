-- Postponing or returning a post is now a confirmation-only workflow. Keep
-- historical text/FLAC evidence valid, but do not require new evidence.
SET LOCAL lock_timeout = '5s';

ALTER TABLE delivery.delivery_shipment_events
  DROP CONSTRAINT IF EXISTS delivery_shipment_event_reason_source_check;

ALTER TABLE delivery.delivery_shipment_events
  ADD CONSTRAINT delivery_shipment_event_reason_source_check
    CHECK (
      status <> 'cancelled'
      OR char_length(btrim(coalesce(note, ''))) > 0
    );

NOTIFY pgrst, 'reload schema';
