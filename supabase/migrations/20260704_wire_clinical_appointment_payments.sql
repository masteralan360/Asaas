ALTER TABLE clinics.clinical_appointments
  ADD COLUMN IF NOT EXISTS currency text;

UPDATE clinics.clinical_appointments AS appointment
SET currency = COALESCE(
  (
    SELECT lower(workspace.default_currency::text)
    FROM public.workspaces AS workspace
    WHERE workspace.id = appointment.workspace_id
  ),
  'usd'
)
WHERE appointment.currency IS NULL;

ALTER TABLE clinics.clinical_appointments
  ALTER COLUMN currency SET DEFAULT 'usd',
  ALTER COLUMN currency SET NOT NULL,
  DROP CONSTRAINT IF EXISTS clinical_appointments_currency_check,
  ADD CONSTRAINT clinical_appointments_currency_check CHECK (
    currency IN ('usd', 'iqd', 'eur', 'try')
  );
