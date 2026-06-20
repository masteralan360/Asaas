ALTER TABLE clinics.clinical_appointments
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS payment_status text;

UPDATE clinics.clinical_appointments AS appointment
SET currency = CASE
  WHEN lower(trim(COALESCE(appointment.currency, ''))) IN ('usd', 'iqd', 'eur', 'try')
    THEN lower(trim(appointment.currency))
  ELSE COALESCE(
    (
      SELECT lower(workspace.default_currency::text)
      FROM public.workspaces AS workspace
      WHERE workspace.id = appointment.workspace_id
        AND lower(workspace.default_currency::text) IN ('usd', 'iqd', 'eur', 'try')
    ),
    'usd'
  )
END;

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
  SELECT GREATEST(COALESCE(SUM(payment.amount), 0), 0)
  INTO v_paid_amount
  FROM public.payment_transactions AS payment
  WHERE payment.source_type = 'clinical_appointment'
    AND payment.source_record_id = p_appointment_id
    AND NOT payment.is_deleted;

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
SET payment_status = clinics.calculate_clinical_appointment_payment_status(
  appointment.id,
  appointment.consultation_fee
);

ALTER TABLE clinics.clinical_appointments
  ALTER COLUMN currency SET DEFAULT 'usd',
  ALTER COLUMN currency SET NOT NULL,
  ALTER COLUMN payment_status SET DEFAULT 'unpaid',
  ALTER COLUMN payment_status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS clinical_appointments_currency_check,
  DROP CONSTRAINT IF EXISTS clinical_appointments_payment_status_check,
  ADD CONSTRAINT clinical_appointments_currency_check CHECK (
    currency IN ('usd', 'iqd', 'eur', 'try')
  ),
  ADD CONSTRAINT clinical_appointments_payment_status_check CHECK (
    payment_status IN ('no_fee', 'unpaid', 'partial', 'paid')
  );

CREATE OR REPLACE FUNCTION clinics.set_clinical_appointment_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, clinics
AS $$
BEGIN
  NEW.payment_status := clinics.calculate_clinical_appointment_payment_status(
    NEW.id,
    NEW.consultation_fee
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clinical_appointments_set_payment_status
  ON clinics.clinical_appointments;
CREATE TRIGGER clinical_appointments_set_payment_status
  BEFORE INSERT OR UPDATE OF consultation_fee
  ON clinics.clinical_appointments
  FOR EACH ROW
  EXECUTE FUNCTION clinics.set_clinical_appointment_payment_status();

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
    SET payment_status = clinics.calculate_clinical_appointment_payment_status(
      appointment.id,
      appointment.consultation_fee
    )
    WHERE appointment.id = OLD.source_record_id;
  END IF;

  IF TG_OP <> 'DELETE'
    AND NEW.source_type = 'clinical_appointment'
  THEN
    UPDATE clinics.clinical_appointments AS appointment
    SET payment_status = clinics.calculate_clinical_appointment_payment_status(
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

DROP TRIGGER IF EXISTS payment_transactions_refresh_clinical_appointment_status
  ON public.payment_transactions;
CREATE TRIGGER payment_transactions_refresh_clinical_appointment_status
  AFTER INSERT OR UPDATE OR DELETE
  ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION clinics.refresh_clinical_appointment_payment_status_from_transaction();

REVOKE ALL ON FUNCTION clinics.calculate_clinical_appointment_payment_status(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION clinics.set_clinical_appointment_payment_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION clinics.refresh_clinical_appointment_payment_status_from_transaction() FROM PUBLIC;
