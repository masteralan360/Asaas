-- A courier fee is the amount a courier keeps for each successfully delivered
-- post. It is configured on the courier, then snapshotted on the manifest and
-- its shipments so later profile edits never alter historical accounting.
ALTER TABLE crm.agents
  ADD COLUMN IF NOT EXISTS courier_delivery_fee numeric NOT NULL DEFAULT 0
  CHECK (courier_delivery_fee >= 0);

ALTER TABLE crm.agents
  DROP CONSTRAINT IF EXISTS agents_courier_delivery_fee_check;
ALTER TABLE crm.agents
  ADD CONSTRAINT agents_courier_delivery_fee_check CHECK (
    agent_type = 'courier' OR courier_delivery_fee = 0
  );

ALTER TABLE delivery.delivery_runs
  ADD COLUMN IF NOT EXISTS courier_delivery_fee numeric NOT NULL DEFAULT 0
  CHECK (courier_delivery_fee >= 0);

ALTER TABLE delivery.delivery_shipments
  ADD COLUMN IF NOT EXISTS courier_delivery_fee numeric NOT NULL DEFAULT 0
  CHECK (courier_delivery_fee >= 0);

-- A negative courier-fee entry reduces the cash the courier must hand over.
-- It belongs to the courier side of the delivery ledger, not the merchant
-- payout side.
ALTER TABLE delivery.delivery_ledger_entries
  DROP CONSTRAINT IF EXISTS delivery_ledger_party_check;
ALTER TABLE delivery.delivery_ledger_entries
  ADD CONSTRAINT delivery_ledger_party_check CHECK (
    (kind IN ('courier_collection', 'courier_remittance', 'courier_delivery_fee')
      AND agent_id IS NOT NULL
      AND merchant_profile_id IS NULL)
    OR (kind IN ('merchant_cod_payable', 'merchant_fee', 'merchant_payout')
      AND merchant_profile_id IS NOT NULL
      AND agent_id IS NULL)
    OR kind = 'adjustment'
  );

ALTER TABLE delivery.delivery_ledger_entries
  DROP CONSTRAINT IF EXISTS delivery_ledger_entries_kind_check;
ALTER TABLE delivery.delivery_ledger_entries
  ADD CONSTRAINT delivery_ledger_entries_kind_check CHECK (
    kind IN (
      'courier_collection',
      'courier_delivery_fee',
      'courier_remittance',
      'merchant_cod_payable',
      'merchant_fee',
      'merchant_payout',
      'adjustment'
    )
  );

NOTIFY pgrst, 'reload schema';
