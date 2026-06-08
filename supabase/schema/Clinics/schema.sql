CREATE SCHEMA IF NOT EXISTS clinics;

CREATE TABLE clinics.clinical_patients (
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

CREATE TABLE clinics.clinical_appointments (
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
  confirmation_status text NOT NULL DEFAULT 'not_contacted',
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
  CONSTRAINT clinical_appointments_confirmation_status_check CHECK (
    confirmation_status IN ('not_contacted', 'pending_confirmation', 'confirmed', 'declined', 'unable_to_reach')
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

CREATE TABLE clinics.clinical_attachments (
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
