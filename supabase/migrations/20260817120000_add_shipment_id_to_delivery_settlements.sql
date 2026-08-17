-- Allow settlements to be recorded against a single post (shipment).
-- Per-post handovers/payouts clear exactly that post instead of the whole
-- party balance; existing whole-balance settlements keep shipment_id NULL.

ALTER TABLE delivery.delivery_settlements
  ADD COLUMN IF NOT EXISTS shipment_id uuid NULL
  REFERENCES delivery.delivery_shipments(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_delivery_settlements_shipment
  ON delivery.delivery_settlements (workspace_id, shipment_id, settled_at DESC)
  WHERE is_deleted = false;
