-- Add property_type column and extend transaction_type options
ALTER TABLE real_estate.real_estate_transactions
  ADD COLUMN IF NOT EXISTS property_type text NULL;

ALTER TABLE real_estate.real_estate_transactions
  DROP CONSTRAINT IF EXISTS real_estate_transactions_type_check,
  ADD CONSTRAINT real_estate_transactions_type_check CHECK (transaction_type IN ('sell', 'buy', 'rent', 'lease', 'exchange'));

ALTER TABLE real_estate.real_estate_transactions
  DROP CONSTRAINT IF EXISTS real_estate_transactions_property_type_check,
  ADD CONSTRAINT real_estate_transactions_property_type_check CHECK (
    property_type IS NULL OR property_type IN ('house', 'apartment', 'land', 'commercial', 'villa', 'office', 'warehouse', 'other')
  );

CREATE INDEX IF NOT EXISTS idx_real_estate_transactions_property_type
  ON real_estate.real_estate_transactions (property_type)
  WHERE property_type IS NOT NULL;
