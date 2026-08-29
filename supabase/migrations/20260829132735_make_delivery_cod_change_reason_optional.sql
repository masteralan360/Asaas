-- Preserve existing audit text when present, but allow couriers to submit a
-- COD correction request without a written explanation.
ALTER TABLE delivery.delivery_shipment_cod_adjustment_requests
  DROP CONSTRAINT IF EXISTS delivery_shipment_cod_adjustment_requests_reason_check;

ALTER TABLE delivery.delivery_shipment_cod_adjustment_requests
  ALTER COLUMN reason DROP NOT NULL;
