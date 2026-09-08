-- Recipient-payout adjustments update the shipment and are recognized by the
-- normal delivery ledger. The abandoned pre-delivery projection is removed.
DROP TABLE IF EXISTS delivery.delivery_shipment_settlement_obligations;
DROP FUNCTION IF EXISTS delivery.assert_recipient_payout_settlement_obligation();

NOTIFY pgrst, 'reload schema';
