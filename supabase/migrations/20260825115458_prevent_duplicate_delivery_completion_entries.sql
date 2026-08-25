-- A delivered post has one terminal delivery event and exactly one operational
-- obligation per kind. Older clients could replay the same delivery from a
-- second device with new UUIDs, which doubled COD balances and settlement
-- defaults. Keep the first record as the audit source and retire only exact
-- operational duplicates before adding the database guardrails.
WITH ranked_events AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, shipment_id
      ORDER BY occurred_at, created_at, id
    ) AS duplicate_rank
  FROM delivery.delivery_shipment_events
  WHERE status = 'delivered'
    AND is_deleted = false
)
UPDATE delivery.delivery_shipment_events AS event
SET
  is_deleted = true,
  version = event.version + 1,
  updated_at = now()
FROM ranked_events
WHERE event.id = ranked_events.id
  AND ranked_events.duplicate_rank > 1;

WITH ranked_obligations AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, shipment_id, kind
      ORDER BY occurred_at, created_at, id
    ) AS duplicate_rank
  FROM delivery.delivery_ledger_entries
  WHERE is_deleted = false
    AND shipment_id IS NOT NULL
    AND settlement_id IS NULL
    AND kind IN (
      'courier_collection',
      'courier_delivery_fee',
      'merchant_cod_payable',
      'merchant_fee'
    )
)
UPDATE delivery.delivery_ledger_entries AS entry
SET
  is_deleted = true,
  version = entry.version + 1,
  updated_at = now()
FROM ranked_obligations
WHERE entry.id = ranked_obligations.id
  AND ranked_obligations.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_one_delivered_event_per_shipment
  ON delivery.delivery_shipment_events (workspace_id, shipment_id)
  WHERE status = 'delivered' AND is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_one_operational_ledger_entry_per_post_kind
  ON delivery.delivery_ledger_entries (workspace_id, shipment_id, kind)
  WHERE is_deleted = false
    AND shipment_id IS NOT NULL
    AND settlement_id IS NULL
    AND kind IN (
      'courier_collection',
      'courier_delivery_fee',
      'merchant_cod_payable',
      'merchant_fee'
    );
