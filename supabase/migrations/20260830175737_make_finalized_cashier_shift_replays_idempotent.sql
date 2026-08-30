-- The offline queue can contain more than one final snapshot for the same
-- occurrence. A second delivery that is byte-for-byte identical must be a
-- no-op; any actual attempted modification remains subject to the existing
-- finalized-occurrence trigger.
CREATE OR REPLACE FUNCTION payment_accounts.ignore_identical_finalized_cashier_shift_replay()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF OLD.status IN ('completed', 'terminated')
    AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cashier_shift_occurrences_accept_identical_finalized_replay
  ON payment_accounts.cashier_shift_occurrences;
CREATE TRIGGER cashier_shift_occurrences_accept_identical_finalized_replay
  BEFORE UPDATE ON payment_accounts.cashier_shift_occurrences
  FOR EACH ROW EXECUTE FUNCTION payment_accounts.ignore_identical_finalized_cashier_shift_replay();

NOTIFY pgrst, 'reload schema';
