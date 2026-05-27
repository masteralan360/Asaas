CREATE TABLE IF NOT EXISTS public.custom_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  module_type_key text NOT NULL,
  layout_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_templates_module_type_key_format_check CHECK (
    module_type_key ~ '^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$'
  ),
  CONSTRAINT custom_templates_layout_json_object_check CHECK (
    jsonb_typeof(layout_json) = 'object'
  ),
  CONSTRAINT custom_templates_workspace_module_type_unique UNIQUE (workspace_id, module_type_key)
);

CREATE INDEX IF NOT EXISTS idx_custom_templates_workspace_updated
  ON public.custom_templates (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_templates_module_type_key
  ON public.custom_templates (module_type_key);

CREATE OR REPLACE FUNCTION public.touch_custom_templates_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS touch_custom_templates_updated_at
  ON public.custom_templates;

CREATE TRIGGER touch_custom_templates_updated_at
BEFORE UPDATE ON public.custom_templates
FOR EACH ROW
EXECUTE FUNCTION public.touch_custom_templates_updated_at();

ALTER TABLE public.custom_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_templates_select ON public.custom_templates;
CREATE POLICY custom_templates_select
  ON public.custom_templates
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
  );

DROP POLICY IF EXISTS custom_templates_insert ON public.custom_templates;
CREATE POLICY custom_templates_insert
  ON public.custom_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS custom_templates_update ON public.custom_templates;
CREATE POLICY custom_templates_update
  ON public.custom_templates
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS custom_templates_delete ON public.custom_templates;
CREATE POLICY custom_templates_delete
  ON public.custom_templates
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_templates TO authenticated;
GRANT ALL ON public.custom_templates TO service_role;
