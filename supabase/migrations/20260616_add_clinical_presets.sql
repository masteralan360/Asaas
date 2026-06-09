CREATE SCHEMA IF NOT EXISTS clinics;

REVOKE ALL ON SCHEMA clinics FROM anon;
GRANT USAGE ON SCHEMA clinics TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA clinics TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA clinics TO authenticated, service_role;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA clinics TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA clinics REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA clinics REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA clinics REVOKE ALL ON ROUTINES FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA clinics GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA clinics GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA clinics GRANT EXECUTE ON ROUTINES TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS clinics.clinical_presets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  category text NOT NULL,
  name text NOT NULL,
  consultation_fee numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT clinical_presets_category_check CHECK (
    category IN ('reason_for_visit', 'appointment_type')
  ),
  CONSTRAINT clinical_presets_name_check CHECK (length(trim(name)) > 0),
  CONSTRAINT clinical_presets_fee_check CHECK (consultation_fee >= 0),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_clinical_presets_workspace
  ON clinics.clinical_presets (workspace_id, sort_order)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_clinical_presets_workspace_category
  ON clinics.clinical_presets (workspace_id, category, sort_order)
  WHERE is_deleted = false;

ALTER TABLE clinics.clinical_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinical_presets_select ON clinics.clinical_presets;
CREATE POLICY clinical_presets_select
  ON clinics.clinical_presets
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_presets_insert ON clinics.clinical_presets;
CREATE POLICY clinical_presets_insert
  ON clinics.clinical_presets
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_presets_update ON clinics.clinical_presets;
CREATE POLICY clinical_presets_update
  ON clinics.clinical_presets
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_presets_delete ON clinics.clinical_presets;
CREATE POLICY clinical_presets_delete
  ON clinics.clinical_presets
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON clinics.clinical_presets;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON clinics.clinical_presets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('clinical_appointments');

-- Update CHECK constraint to include appointment_type (replaces old service_procedure)
ALTER TABLE clinics.clinical_presets
  DROP CONSTRAINT IF EXISTS clinical_presets_category_check,
  ADD CONSTRAINT clinical_presets_category_check CHECK (
    category IN ('reason_for_visit', 'appointment_type')
  );
