ALTER TABLE clinics.clinical_presets
  DROP CONSTRAINT IF EXISTS clinical_presets_category_check,
  ADD CONSTRAINT clinical_presets_category_check CHECK (
    category IN ('reason_for_visit', 'appointment_type', 'registry_type')
  );

ALTER TABLE clinics.clinical_presets
  DROP CONSTRAINT IF EXISTS clinical_presets_registry_type_name_check,
  ADD CONSTRAINT clinical_presets_registry_type_name_check CHECK (
    category <> 'registry_type' OR name IN ('medical', 'beauty')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_presets_workspace_registry_type
  ON clinics.clinical_presets (workspace_id, category)
  WHERE category = 'registry_type' AND is_deleted = false;
