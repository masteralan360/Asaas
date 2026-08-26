-- The public review wrapper supplies (note, reviewer_label), while the
-- historical internal function retained the opposite parameter names after a
-- rename. Preserve the established callable signatures and map those inputs
-- to the correct audit fields inside the internal function body.
DO $do$
DECLARE
  v_function_definition text;
  v_legacy_reviewer_declaration constant text :=
    'v_reviewer_label text := COALESCE(NULLIF(btrim(p_reviewer_label), ''''), ''Platform administrator'');';
  v_legacy_note_declaration constant text :=
    'v_audit_note text := NULLIF(btrim(p_note), '''');';
  v_reviewer_declaration constant text :=
    'v_reviewer_label text := COALESCE(NULLIF(btrim(p_note), ''''), ''Platform administrator'');';
  v_note_declaration constant text :=
    'v_audit_note text := NULLIF(btrim(p_reviewer_label), '''');';
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

  IF position(v_legacy_reviewer_declaration IN v_function_definition) = 0
    OR position(v_legacy_note_declaration IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'workspace payment review base function does not contain the expected audit declarations';
  END IF;

  EXECUTE replace(
    replace(
      v_function_definition,
      v_legacy_reviewer_declaration,
      v_reviewer_declaration
    ),
    v_legacy_note_declaration,
    v_note_declaration
  );
END;
$do$;

NOTIFY pgrst, 'reload schema';
