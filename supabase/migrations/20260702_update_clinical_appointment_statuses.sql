ALTER TABLE clinics.clinical_appointments
  DROP CONSTRAINT IF EXISTS clinical_appointments_status_check,
  ADD CONSTRAINT clinical_appointments_status_check CHECK (
    status IN ('draft', 'booked', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show')
  );
