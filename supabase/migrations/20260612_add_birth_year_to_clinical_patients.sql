ALTER TABLE clinics.clinical_patients
  ADD COLUMN birth_year integer NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_patients_birth_year
  ON clinics.clinical_patients (birth_year);
