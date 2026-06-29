ALTER TABLE clinics.clinical_appointments
  ADD COLUMN IF NOT EXISTS sent_by_name text,
  ADD COLUMN IF NOT EXISTS sent_by_partner_id uuid;

CREATE INDEX IF NOT EXISTS idx_clinical_appointments_workspace_sent_by_partner
  ON clinics.clinical_appointments (workspace_id, sent_by_partner_id)
  WHERE sent_by_partner_id IS NOT NULL AND is_deleted = false;
