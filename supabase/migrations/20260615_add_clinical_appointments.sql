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

CREATE TABLE IF NOT EXISTS clinics.clinical_patients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  phone text NULL,
  email text NULL,
  is_new_patient boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT clinical_patients_name_check CHECK (length(trim(name)) > 0),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS clinics.clinical_appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  patient_name text NOT NULL,
  patient_phone text NULL,
  is_new_patient boolean NOT NULL DEFAULT false,
  appointment_date date NOT NULL,
  start_time text NOT NULL,
  appointment_type text NOT NULL,
  reason_for_visit text NULL,
  service_procedure text NULL,
  consultation_fee numeric NOT NULL DEFAULT 0,
  estimated_price numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  confirmation_method text NULL,
  priority text NOT NULL DEFAULT 'normal',
  internal_notes text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT clinical_appointments_type_check CHECK (
    appointment_type IN ('consultation', 'follow_up', 'emergency', 'checkup', 'procedure', 'treatment')
  ),
  CONSTRAINT clinical_appointments_status_check CHECK (
    status IN ('draft', 'scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show')
  ),
  CONSTRAINT clinical_appointments_confirmation_method_check CHECK (
    confirmation_method IS NULL OR confirmation_method IN ('phone', 'sms', 'whatsapp', 'email', 'other')
  ),
  CONSTRAINT clinical_appointments_priority_check CHECK (
    priority IN ('normal', 'urgent', 'emergency')
  ),
  CONSTRAINT clinical_appointments_fee_check CHECK (consultation_fee >= 0),
  CONSTRAINT clinical_appointments_estimated_price_check CHECK (estimated_price >= 0),
  CONSTRAINT clinical_appointments_time_check CHECK (length(trim(start_time)) > 0),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS clinics.clinical_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  r2_path text NULL,
  local_path text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT clinical_attachments_file_name_check CHECK (length(trim(file_name)) > 0),
  CONSTRAINT clinical_attachments_file_size_check CHECK (file_size >= 0),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_clinical_patients_workspace
  ON clinics.clinical_patients (workspace_id, created_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_clinical_patients_workspace_name
  ON clinics.clinical_patients (workspace_id, name)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_clinical_appointments_workspace_date
  ON clinics.clinical_appointments (workspace_id, appointment_date DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_clinical_appointments_workspace_patient
  ON clinics.clinical_appointments (workspace_id, patient_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_clinical_appointments_workspace_status
  ON clinics.clinical_appointments (workspace_id, status)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_clinical_attachments_appointment
  ON clinics.clinical_attachments (appointment_id)
  WHERE is_deleted = false;

ALTER TABLE clinics.clinical_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics.clinical_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics.clinical_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinical_patients_select ON clinics.clinical_patients;
CREATE POLICY clinical_patients_select
  ON clinics.clinical_patients
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_patients_insert ON clinics.clinical_patients;
CREATE POLICY clinical_patients_insert
  ON clinics.clinical_patients
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_patients_update ON clinics.clinical_patients;
CREATE POLICY clinical_patients_update
  ON clinics.clinical_patients
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_patients_delete ON clinics.clinical_patients;
CREATE POLICY clinical_patients_delete
  ON clinics.clinical_patients
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_appointments_select ON clinics.clinical_appointments;
CREATE POLICY clinical_appointments_select
  ON clinics.clinical_appointments
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_appointments_insert ON clinics.clinical_appointments;
CREATE POLICY clinical_appointments_insert
  ON clinics.clinical_appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_appointments_update ON clinics.clinical_appointments;
CREATE POLICY clinical_appointments_update
  ON clinics.clinical_appointments
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_appointments_delete ON clinics.clinical_appointments;
CREATE POLICY clinical_appointments_delete
  ON clinics.clinical_appointments
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_attachments_select ON clinics.clinical_attachments;
CREATE POLICY clinical_attachments_select
  ON clinics.clinical_attachments
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_attachments_insert ON clinics.clinical_attachments;
CREATE POLICY clinical_attachments_insert
  ON clinics.clinical_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_attachments_update ON clinics.clinical_attachments;
CREATE POLICY clinical_attachments_update
  ON clinics.clinical_attachments
  FOR UPDATE
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS clinical_attachments_delete ON clinics.clinical_attachments;
CREATE POLICY clinical_attachments_delete
  ON clinics.clinical_attachments
  FOR DELETE
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

CREATE OR REPLACE FUNCTION public.workspace_plan_has_module(p_plan text, p_module text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_module, ''))
    WHEN 'pos' THEN true
    WHEN 'instant_pos' THEN true
    WHEN 'sales_history' THEN true
    WHEN 'products' THEN true
    WHEN 'storages' THEN true
    WHEN 'inventory_transfer' THEN true
    WHEN 'inventory_transactions' THEN true
    WHEN 'stock_adjustments' THEN true
    WHEN 'ledger' THEN true
    WHEN 'payments' THEN true
    WHEN 'direct_transactions' THEN true
    WHEN 'members' THEN true
    WHEN 'business_partners' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'customers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'suppliers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'orders' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'ecommerce' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'travel_agency' THEN false
    WHEN 'real_estate' THEN false
    WHEN 'currency_exchange' THEN false
    WHEN 'clinical_appointments' THEN false
    WHEN 'loans' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'installments' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'discounts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'revenue_analytics' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'team_performance' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'invoice_history' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'accounting' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'hr' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'expenses' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'payroll' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsapp' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    ELSE false
  END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON clinics.clinical_appointments;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON clinics.clinical_appointments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('clinical_appointments');

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON clinics.clinical_patients;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON clinics.clinical_patients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('clinical_appointments');

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON clinics.clinical_attachments;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON clinics.clinical_attachments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('clinical_appointments');

GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;
