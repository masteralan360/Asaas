-- A courier marking a shipment returned and the workspace physically receiving
-- that package are distinct operational events. Keep the return status for
-- history, and record the later custody confirmation separately.
ALTER TABLE delivery.delivery_shipments
  ADD COLUMN IF NOT EXISTS return_received_at timestamptz NULL;

ALTER TABLE delivery.delivery_shipment_events
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'status_change'
  CHECK (action IN ('status_change', 'return_received'));

CREATE INDEX IF NOT EXISTS idx_delivery_shipments_return_receipt
  ON delivery.delivery_shipments (workspace_id, return_received_at, updated_at DESC)
  WHERE is_deleted = false AND status = 'returned';

COMMENT ON COLUMN delivery.delivery_shipments.return_received_at IS
  'When the workspace physically received the returned package from its courier.';

COMMENT ON COLUMN delivery.delivery_shipment_events.action IS
  'Operational action represented by the immutable shipment event.';
