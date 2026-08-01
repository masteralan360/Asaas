-- Manual entry templates and saved manual entries.
--
-- Previously these lived only in the local (Dexie) database.  Cloud and
-- hybrid workspaces now sync them through the same offline-mutation pipeline
-- used by every other business table (id, workspace_id, created_at,
-- updated_at, version, is_deleted), so they are stored on the server too.
BEGIN;

CREATE TABLE public.manual_entry_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  header_name text NULL,
  header_phone1 text NULL,
  header_phone2 text NULL,
  details_label1 text NULL,
  details_label2 text NULL,
  details_label3 text NULL,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active'::text,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT manual_entry_templates_status_check CHECK (
    status IN ('active', 'inactive')
  )
);

CREATE INDEX IF NOT EXISTS idx_manual_entry_templates_workspace_updated
  ON public.manual_entry_templates (workspace_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_manual_entry_templates_workspace_deleted
  ON public.manual_entry_templates (workspace_id, is_deleted);

CREATE TABLE public.manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  template_id uuid NULL REFERENCES public.manual_entry_templates(id) ON DELETE SET NULL,
  template_name text NOT NULL,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_manual_entries_workspace_updated
  ON public.manual_entries (workspace_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_manual_entries_workspace_template
  ON public.manual_entries (workspace_id, template_id)
  WHERE is_deleted = false;

DROP TRIGGER IF EXISTS set_manual_entry_templates_updated_at ON public.manual_entry_templates;
CREATE TRIGGER set_manual_entry_templates_updated_at
  BEFORE UPDATE ON public.manual_entry_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_manual_entries_updated_at ON public.manual_entries;
CREATE TRIGGER set_manual_entries_updated_at
  BEFORE UPDATE ON public.manual_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.manual_entry_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manual_entry_templates_select ON public.manual_entry_templates;
CREATE POLICY manual_entry_templates_select
  ON public.manual_entry_templates
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS manual_entry_templates_insert ON public.manual_entry_templates;
CREATE POLICY manual_entry_templates_insert
  ON public.manual_entry_templates
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS manual_entry_templates_update ON public.manual_entry_templates;
CREATE POLICY manual_entry_templates_update
  ON public.manual_entry_templates
  FOR UPDATE TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS manual_entry_templates_delete ON public.manual_entry_templates;
CREATE POLICY manual_entry_templates_delete
  ON public.manual_entry_templates
  FOR DELETE TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS manual_entries_select ON public.manual_entries;
CREATE POLICY manual_entries_select
  ON public.manual_entries
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS manual_entries_insert ON public.manual_entries;
CREATE POLICY manual_entries_insert
  ON public.manual_entries
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS manual_entries_update ON public.manual_entries;
CREATE POLICY manual_entries_update
  ON public.manual_entries
  FOR UPDATE TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS manual_entries_delete ON public.manual_entries;
CREATE POLICY manual_entries_delete
  ON public.manual_entries
  FOR DELETE TO authenticated
  USING (workspace_id = public.current_workspace_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_entry_templates TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_entries TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
