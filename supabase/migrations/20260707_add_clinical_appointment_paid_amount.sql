ALTER TABLE clinics.clinical_appointments
  ADD COLUMN IF NOT EXISTS paid_amount numeric;

CREATE OR REPLACE FUNCTION clinics.calculate_clinical_appointment_paid_amount(
  p_appointment_id uuid
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, clinics
AS $$
  SELECT GREATEST(COALESCE(SUM(payment.amount), 0), 0)
  FROM public.payment_transactions AS payment
  WHERE payment.source_type = 'clinical_appointment'
    AND payment.source_record_id = p_appointment_id
    AND NOT payment.is_deleted;
$$;

CREATE OR REPLACE FUNCTION clinics.calculate_clinical_appointment_payment_status(
  p_appointment_id uuid,
  p_service_fee numeric
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, clinics
AS $$
DECLARE
  v_paid_amount numeric := 0;
BEGIN
  v_paid_amount := clinics.calculate_clinical_appointment_paid_amount(p_appointment_id);

  IF COALESCE(p_service_fee, 0) <= 0 THEN
    RETURN 'no_fee';
  ELSIF v_paid_amount >= p_service_fee THEN
    RETURN 'paid';
  ELSIF v_paid_amount > 0 THEN
    RETURN 'partial';
  END IF;

  RETURN 'unpaid';
END;
$$;

UPDATE clinics.clinical_appointments AS appointment
SET paid_amount = clinics.calculate_clinical_appointment_paid_amount(appointment.id),
    payment_status = clinics.calculate_clinical_appointment_payment_status(
      appointment.id,
      appointment.consultation_fee
    );

ALTER TABLE clinics.clinical_appointments
  ALTER COLUMN paid_amount SET DEFAULT 0,
  ALTER COLUMN paid_amount SET NOT NULL,
  DROP CONSTRAINT IF EXISTS clinical_appointments_paid_amount_check,
  ADD CONSTRAINT clinical_appointments_paid_amount_check CHECK (paid_amount >= 0);

CREATE OR REPLACE FUNCTION clinics.set_clinical_appointment_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, clinics
AS $$
BEGIN
  NEW.paid_amount := clinics.calculate_clinical_appointment_paid_amount(NEW.id);
  NEW.payment_status := clinics.calculate_clinical_appointment_payment_status(
    NEW.id,
    NEW.consultation_fee
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION clinics.refresh_clinical_appointment_payment_status_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, clinics
AS $$
BEGIN
  IF TG_OP <> 'INSERT'
    AND OLD.source_type = 'clinical_appointment'
  THEN
    UPDATE clinics.clinical_appointments AS appointment
    SET paid_amount = clinics.calculate_clinical_appointment_paid_amount(appointment.id),
        payment_status = clinics.calculate_clinical_appointment_payment_status(
          appointment.id,
          appointment.consultation_fee
        )
    WHERE appointment.id = OLD.source_record_id;
  END IF;

  IF TG_OP <> 'DELETE'
    AND NEW.source_type = 'clinical_appointment'
  THEN
    UPDATE clinics.clinical_appointments AS appointment
    SET paid_amount = clinics.calculate_clinical_appointment_paid_amount(appointment.id),
        payment_status = clinics.calculate_clinical_appointment_payment_status(
          appointment.id,
          appointment.consultation_fee
        )
    WHERE appointment.id = NEW.source_record_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION clinics.calculate_clinical_appointment_paid_amount(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION clinics.calculate_clinical_appointment_payment_status(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION clinics.set_clinical_appointment_payment_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION clinics.refresh_clinical_appointment_payment_status_from_transaction() FROM PUBLIC;
