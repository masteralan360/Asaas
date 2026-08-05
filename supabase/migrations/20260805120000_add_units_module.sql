-- Custom units module.
-- Workspace-scoped custom units that can be attached to products and used
-- across POS, orders and inventory transfers. Built-in units (pcs, gram,
-- liter, bottle, can, box, pack, carton, bag, m², Kg, Meter) are HARDCODED
-- in the app (DEFAULT_UNITS) and are NOT stored here; this table only holds
-- units created by the user. Codes that match a built-in unit (case
-- insensitive) are rejected server-side.
CREATE TABLE IF NOT EXISTS public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  icon text NULL,
  is_dynamic boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  sync_status text NOT NULL DEFAULT 'synced'::text,
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT units_code_not_blank CHECK (char_length(btrim(code)) > 0),
  CONSTRAINT units_code_not_builtin CHECK (
    lower(btrim(code)) NOT IN (
      'pcs', 'gram', 'liter', 'bottle', 'can', 'box', 'pack', 'carton', 'bag', 'm²', 'kg', 'meter'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_units_workspace
  ON public.units (workspace_id);

CREATE INDEX IF NOT EXISTS idx_units_workspace_updated
  ON public.units (workspace_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_units_workspace_active_code_unique
  ON public.units (workspace_id, lower(btrim(code)))
  WHERE is_deleted = false;

DROP TRIGGER IF EXISTS update_units_updated_at ON public.units;
CREATE TRIGGER update_units_updated_at
BEFORE UPDATE ON public.units
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: same shape as the products metadata tables (see
-- 20260328_secure_public_rls_and_workspace_lookup.sql). Writes require an
-- admin or staff role; the app layer further gates the page with the
-- products.access permission.
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS units_select ON public.units;
CREATE POLICY units_select
  ON public.units
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS units_insert ON public.units;
CREATE POLICY units_insert
  ON public.units
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

DROP POLICY IF EXISTS units_update ON public.units;
CREATE POLICY units_update
  ON public.units
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

DROP POLICY IF EXISTS units_delete ON public.units;
CREATE POLICY units_delete
  ON public.units
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.units TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
