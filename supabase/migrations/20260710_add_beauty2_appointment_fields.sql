ALTER TABLE clinics.clinical_appointments
  ADD COLUMN IF NOT EXISTS appointment_number text,
  ADD COLUMN IF NOT EXISTS issue_date date,
  ADD COLUMN IF NOT EXISTS next_visit_date date,
  ADD COLUMN IF NOT EXISTS received_from_name text,
  ADD COLUMN IF NOT EXISTS amount_iqd numeric,
  ADD COLUMN IF NOT EXISTS amount_usd numeric,
  ADD COLUMN IF NOT EXISTS calculated_amount numeric;

ALTER TABLE clinics.clinical_appointments
  DROP CONSTRAINT IF EXISTS clinical_appointments_amount_iqd_check,
  DROP CONSTRAINT IF EXISTS clinical_appointments_amount_usd_check,
  DROP CONSTRAINT IF EXISTS clinical_appointments_calculated_amount_check,
  ADD CONSTRAINT clinical_appointments_amount_iqd_check CHECK (
    amount_iqd IS NULL OR amount_iqd >= 0
  ),
  ADD CONSTRAINT clinical_appointments_amount_usd_check CHECK (
    amount_usd IS NULL OR amount_usd >= 0
  ),
  ADD CONSTRAINT clinical_appointments_calculated_amount_check CHECK (
    calculated_amount IS NULL OR calculated_amount >= 0
  );

CREATE INDEX IF NOT EXISTS idx_clinical_appointments_workspace_appointment_number
  ON clinics.clinical_appointments (workspace_id, appointment_number)
  WHERE appointment_number IS NOT NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_clinical_appointments_workspace_issue_date
  ON clinics.clinical_appointments (workspace_id, issue_date DESC)
  WHERE issue_date IS NOT NULL AND is_deleted = false;
