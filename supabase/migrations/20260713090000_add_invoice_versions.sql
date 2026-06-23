ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source_id uuid NULL,
  ADD COLUMN IF NOT EXISTS latest_version_id uuid NULL,
  ADD COLUMN IF NOT EXISTS latest_version_number integer NOT NULL DEFAULT 0;

UPDATE public.invoices
SET source_id = COALESCE(source_id, order_id, id)
WHERE source_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_workspace_origin_source
  ON public.invoices (workspace_id, origin, source_id)
  WHERE source_id IS NOT NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS public.invoice_versions (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,
  origin text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  format text NOT NULL CHECK (format IN ('a4', 'receipt')),
  r2_path text NULL,
  file_size bigint NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT invoice_versions_invoice_version_unique UNIQUE (invoice_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_invoice_versions_workspace_invoice_created
  ON public.invoice_versions (workspace_id, invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_versions_workspace_origin_source
  ON public.invoice_versions (workspace_id, origin, source_id, version_number DESC);

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_latest_version_id_fkey;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_latest_version_id_fkey
  FOREIGN KEY (latest_version_id)
  REFERENCES public.invoice_versions(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.invoice_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_versions_select ON public.invoice_versions;
CREATE POLICY invoice_versions_select
  ON public.invoice_versions
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

-- Version rows are immutable. Creation goes through create_invoice_version;
-- there are intentionally no UPDATE or DELETE policies for authenticated users.
DROP POLICY IF EXISTS invoice_versions_insert ON public.invoice_versions;
CREATE POLICY invoice_versions_insert
  ON public.invoice_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND (created_by IS NULL OR created_by = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.create_invoice_version(
  p_id uuid,
  p_invoice_id uuid,
  p_workspace_id uuid,
  p_source_id uuid,
  p_origin text,
  p_format text,
  p_r2_path text,
  p_file_size bigint DEFAULT 0,
  p_created_by_name text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.invoice_versions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_version public.invoice_versions%ROWTYPE;
  v_next_version integer;
BEGIN
  IF p_format NOT IN ('a4', 'receipt') THEN
    RAISE EXCEPTION 'Unsupported invoice format: %', p_format;
  END IF;

  SELECT *
  INTO v_version
  FROM public.invoice_versions
  WHERE id = p_id;

  IF FOUND THEN
    IF v_version.invoice_id IS DISTINCT FROM p_invoice_id
       OR v_version.workspace_id IS DISTINCT FROM p_workspace_id
       OR v_version.r2_path IS DISTINCT FROM p_r2_path THEN
      RAISE EXCEPTION 'Invoice version id % is already used by another snapshot', p_id;
    END IF;
    RETURN v_version;
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
    AND workspace_id = p_workspace_id
    AND is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % was not found in workspace %', p_invoice_id, p_workspace_id;
  END IF;

  IF v_invoice.source_id IS DISTINCT FROM p_source_id
     OR v_invoice.origin IS DISTINCT FROM p_origin THEN
    RAISE EXCEPTION 'Invoice origin identity does not match %:%', p_origin, p_source_id;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM public.invoice_versions
  WHERE invoice_id = p_invoice_id;

  INSERT INTO public.invoice_versions (
    id,
    invoice_id,
    workspace_id,
    source_id,
    origin,
    version_number,
    format,
    r2_path,
    file_size,
    created_by,
    created_by_name,
    metadata
  ) VALUES (
    p_id,
    p_invoice_id,
    p_workspace_id,
    p_source_id,
    p_origin,
    v_next_version,
    p_format,
    p_r2_path,
    GREATEST(COALESCE(p_file_size, 0), 0),
    auth.uid(),
    p_created_by_name,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_version;

  UPDATE public.invoices
  SET latest_version_id = v_version.id,
      latest_version_number = v_version.version_number,
      print_format = p_format,
      r2_path_a4 = CASE WHEN p_format = 'a4' THEN p_r2_path ELSE r2_path_a4 END,
      r2_path_receipt = CASE WHEN p_format = 'receipt' THEN p_r2_path ELSE r2_path_receipt END,
      updated_at = now()
  WHERE id = p_invoice_id;

  RETURN v_version;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_invoice_version(uuid, uuid, uuid, uuid, text, text, text, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_version(uuid, uuid, uuid, uuid, text, text, text, bigint, text, jsonb) TO authenticated, service_role;

-- Preserve existing PDFs as version 1/2 so the Versions UI remains useful
-- immediately after deployment. New paths are always immutable.
WITH legacy AS (
  SELECT
    gen_random_uuid() AS version_id,
    i.id AS invoice_id,
    i.workspace_id,
    COALESCE(i.source_id, i.order_id, i.id) AS source_id,
    COALESCE(NULLIF(i.origin, ''), 'manual') AS origin,
    1 AS version_number,
    'a4'::text AS format,
    i.r2_path_a4 AS r2_path,
    COALESCE(i.file_size, 0) AS file_size,
    i.created_by,
    i.created_by_name,
    i.created_at
  FROM public.invoices i
  WHERE i.r2_path_a4 IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoice_versions v WHERE v.invoice_id = i.id)
), inserted AS (
  INSERT INTO public.invoice_versions (
    id, invoice_id, workspace_id, source_id, origin, version_number, format,
    r2_path, file_size, created_by, created_by_name, created_at, metadata
  )
  SELECT
    version_id, invoice_id, workspace_id, source_id, origin, version_number, format,
    r2_path, file_size, created_by, created_by_name, created_at,
    jsonb_build_object('migratedFromLegacyInvoice', true)
  FROM legacy
  RETURNING id, invoice_id, version_number
)
UPDATE public.invoices i
SET latest_version_id = inserted.id,
    latest_version_number = inserted.version_number
FROM inserted
WHERE i.id = inserted.invoice_id;

WITH legacy_receipts AS (
  SELECT
    gen_random_uuid() AS version_id,
    i.id AS invoice_id,
    i.workspace_id,
    COALESCE(i.source_id, i.order_id, i.id) AS source_id,
    COALESCE(NULLIF(i.origin, ''), 'manual') AS origin,
    COALESCE((SELECT MAX(v.version_number) FROM public.invoice_versions v WHERE v.invoice_id = i.id), 0) + 1 AS version_number,
    'receipt'::text AS format,
    i.r2_path_receipt AS r2_path,
    COALESCE(i.file_size, 0) AS file_size,
    i.created_by,
    i.created_by_name,
    i.created_at
  FROM public.invoices i
  WHERE i.r2_path_receipt IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.invoice_versions v
      WHERE v.invoice_id = i.id AND v.format = 'receipt'
    )
), inserted AS (
  INSERT INTO public.invoice_versions (
    id, invoice_id, workspace_id, source_id, origin, version_number, format,
    r2_path, file_size, created_by, created_by_name, created_at, metadata
  )
  SELECT
    version_id, invoice_id, workspace_id, source_id, origin, version_number, format,
    r2_path, file_size, created_by, created_by_name, created_at,
    jsonb_build_object('migratedFromLegacyInvoice', true)
  FROM legacy_receipts
  RETURNING id, invoice_id, version_number
)
UPDATE public.invoices i
SET latest_version_id = inserted.id,
    latest_version_number = inserted.version_number
FROM inserted
WHERE i.id = inserted.invoice_id;
