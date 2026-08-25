-- Recipient phone is the sole identifier for a delivery post. Preserve the
-- historical zone by appending it to the delivery address before retiring the
-- now-unused recipient name, alternate phone, and city columns.
DO $migration$
BEGIN
  -- This guard lets the migration be safely reconciled with an environment
  -- where the columns were already removed through an emergency deployment.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'delivery'
      AND table_name = 'delivery_shipments'
      AND column_name = 'recipient_city'
  ) THEN
    UPDATE delivery.delivery_shipments
    SET recipient_address = concat_ws(
      E'\n',
      nullif(btrim(recipient_address), ''),
      nullif(btrim(recipient_city), '')
    )
    WHERE coalesce(nullif(btrim(recipient_city), ''), '') <> ''
      AND position(
        lower(btrim(recipient_city))
        IN lower(coalesce(recipient_address, ''))
      ) = 0;
  END IF;
END
$migration$;

ALTER TABLE delivery.delivery_shipments
  DROP COLUMN IF EXISTS recipient_name,
  DROP COLUMN IF EXISTS recipient_alternate_phone,
  DROP COLUMN IF EXISTS recipient_city;

COMMENT ON COLUMN delivery.delivery_shipments.recipient_phone IS
  'Required primary identifier for the post recipient.';
COMMENT ON COLUMN delivery.delivery_shipments.recipient_address IS
  'Full delivery location, including city or zone where applicable.';

NOTIFY pgrst, 'reload schema';
