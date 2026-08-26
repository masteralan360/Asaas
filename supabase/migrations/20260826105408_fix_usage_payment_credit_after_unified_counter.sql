-- The unified usage migration removed the legacy raw-transfer counter.
--
-- Usage payments are allowance purchases: they must increase the current
-- cycle's purchased credit while leaving the one canonical charged-usage
-- counter untouched. The payment-review function was wrapped before the
-- unified migration and retained a stale write to actual_data_transfer_bytes.
-- Rebuild its existing body from the catalog so this narrowly changes that
-- legacy update without discarding the wrapper's payment, audit, and lock
-- handling.
DO $do$
DECLARE
  v_function_definition text;
  v_charged_usage_assignment constant text :=
    'data_transfer_bytes = GREATEST(usage_row.data_transfer_bytes - v_transaction.gb_added_bytes, 0),';
  v_legacy_actual_assignment constant text :=
    'actual_data_transfer_bytes = GREATEST(usage_row.data_transfer_bytes - v_transaction.gb_added_bytes, 0) / 10,';
  v_credit_assignment constant text :=
    'purchased_credit_bytes = usage_row.purchased_credit_bytes + v_transaction.gb_added_bytes,';
BEGIN
  SELECT pg_get_functiondef(function_row.oid)
  INTO v_function_definition
  FROM pg_proc AS function_row
  INNER JOIN pg_namespace AS function_schema
    ON function_schema.oid = function_row.pronamespace
  WHERE function_schema.nspname = 'public'
    AND function_row.proname = 'admin_review_workspace_payment_transaction_base'
    AND pg_get_function_identity_arguments(function_row.oid) =
      'p_transaction_id uuid, p_decision text, p_reviewer_label text, p_note text, p_provider_payment_id text';

  IF v_function_definition IS NULL THEN
    RAISE EXCEPTION 'workspace payment review base function is missing';
  END IF;

  IF position(v_charged_usage_assignment IN v_function_definition) = 0
    OR position(v_legacy_actual_assignment IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'workspace payment review base function does not contain the expected legacy usage update';
  END IF;

  v_function_definition := replace(
    replace(
      v_function_definition,
      v_charged_usage_assignment,
      ''
    ),
    v_legacy_actual_assignment,
    v_credit_assignment
  );

  EXECUTE v_function_definition;
END;
$do$;

COMMENT ON FUNCTION public.admin_review_workspace_payment_transaction_base(
  uuid, text, text, text, text
) IS
  'Internal atomic payment reviewer. Approved usage payments add allowance credit and never mutate the canonical charged-usage counter.';

NOTIFY pgrst, 'reload schema';
