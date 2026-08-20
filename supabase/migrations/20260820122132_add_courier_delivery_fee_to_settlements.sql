-- Preserve the courier-fee snapshot alongside each per-post settlement. The
-- ledger remains the source of truth for balances; this supports auditing the
-- cost that applied when the handover or payout was recorded.
ALTER TABLE delivery.delivery_settlements
  ADD COLUMN IF NOT EXISTS courier_delivery_fee numeric NOT NULL DEFAULT 0
  CHECK (courier_delivery_fee >= 0);
