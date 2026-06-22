ALTER TABLE clinics.clinical_appointments
  ADD COLUMN IF NOT EXISTS calculated_amount_currency text;

UPDATE clinics.clinical_appointments
SET calculated_amount_currency = CASE
  WHEN lower(COALESCE(currency, '')) IN ('iqd', 'usd') THEN lower(currency)
  ELSE 'iqd'
END
WHERE calculated_amount IS NOT NULL
  AND calculated_amount_currency IS NULL;

ALTER TABLE clinics.clinical_appointments
  DROP CONSTRAINT IF EXISTS clinical_appointments_calculated_amount_currency_check,
  ADD CONSTRAINT clinical_appointments_calculated_amount_currency_check CHECK (
    calculated_amount_currency IS NULL OR calculated_amount_currency IN ('iqd', 'usd')
  );
