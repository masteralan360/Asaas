-- Store the administrator-to-customer contact number as an immutable audit record.
-- This schema is intentionally private and is never exposed to the workspace client.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private."workspaces-a2c" (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  phone_number text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL,
  CONSTRAINT workspaces_a2c_phone_number_format
    CHECK (
      char_length(phone_number) BETWEEN 6 AND 32
      AND phone_number = btrim(phone_number)
      AND phone_number ~ '^[0-9+(). -]+$'
      AND phone_number ~ '[0-9]'
    )
);

COMMENT ON TABLE private."workspaces-a2c" IS
  'Immutable audit record of the administrator-to-customer phone number captured during initial workspace configuration.';

ALTER TABLE private."workspaces-a2c" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.prevent_workspace_a2c_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Workspace administrator-to-customer phone audit records are immutable';
END;
$$;

DROP TRIGGER IF EXISTS prevent_workspace_a2c_mutation
  ON private."workspaces-a2c";

CREATE TRIGGER prevent_workspace_a2c_mutation
  BEFORE UPDATE OR DELETE ON private."workspaces-a2c"
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_workspace_a2c_mutation();

CREATE OR REPLACE FUNCTION public.record_workspace_a2c_phone(
  p_phone_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_workspace_id uuid;
  v_is_configured boolean;
  v_phone_number text := btrim(COALESCE(p_phone_number, ''));
BEGIN
  IF v_phone_number !~ '^[0-9+(). -]{6,32}$' OR v_phone_number !~ '[0-9]' THEN
    RAISE EXCEPTION 'A valid administrator-to-customer phone number is required';
  END IF;

  SELECT profile.workspace_id, COALESCE(workspace.is_configured, false)
    INTO v_workspace_id, v_is_configured
  FROM public.profiles AS profile
  JOIN public.workspaces AS workspace ON workspace.id = profile.workspace_id
  WHERE profile.id = auth.uid()
    AND profile.role = 'admin'
  FOR UPDATE OF workspace;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Only a workspace administrator can record this phone number';
  END IF;

  -- A retry after the initial insert is safe, but never changes the original audit value.
  IF EXISTS (
    SELECT 1
    FROM private."workspaces-a2c" AS audit
    WHERE audit.workspace_id = v_workspace_id
  ) THEN
    RETURN;
  END IF;

  IF v_is_configured THEN
    RAISE EXCEPTION 'The administrator-to-customer phone number can only be recorded during initial workspace configuration';
  END IF;

  INSERT INTO private."workspaces-a2c" (
    workspace_id,
    phone_number,
    recorded_by_user_id
  ) VALUES (
    v_workspace_id,
    v_phone_number,
    auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_workspace_a2c_phones()
RETURNS TABLE (
  workspace_id uuid,
  phone_number text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT audit.workspace_id, audit.phone_number
  FROM private."workspaces-a2c" AS audit;
$$;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private."workspaces-a2c" FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.record_workspace_a2c_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_workspace_a2c_phone(text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_workspace_a2c_phones() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_workspace_a2c_phones() TO service_role;
