CREATE TABLE public.workspace_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_uuid uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  key text NOT NULL,
  module text NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT workspace_permissions_key_format_check CHECK (
    key ~ '^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$'
  ),
  CONSTRAINT workspace_permissions_module_matches_key_check CHECK (
    module = split_part(key, '.', 1)
  ),
  CONSTRAINT workspace_permissions_unique_user_key UNIQUE (workspace_id, user_uuid, key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_permissions_workspace_user
  ON public.workspace_permissions (workspace_id, user_uuid);

CREATE INDEX IF NOT EXISTS idx_workspace_permissions_workspace_module
  ON public.workspace_permissions (workspace_id, module);

ALTER TABLE public.workspace_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_permissions_select ON public.workspace_permissions;
CREATE POLICY workspace_permissions_select
  ON public.workspace_permissions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND (
      user_uuid = auth.uid()
      OR public.current_user_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS workspace_permissions_insert ON public.workspace_permissions;
CREATE POLICY workspace_permissions_insert
  ON public.workspace_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND module = split_part(key, '.', 1)
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = workspace_permissions.user_uuid
        AND p.workspace_id = workspace_permissions.workspace_id
        AND p.role <> 'admin'
    )
  );

DROP POLICY IF EXISTS workspace_permissions_update ON public.workspace_permissions;
CREATE POLICY workspace_permissions_update
  ON public.workspace_permissions
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND module = split_part(key, '.', 1)
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = workspace_permissions.user_uuid
        AND p.workspace_id = workspace_permissions.workspace_id
        AND p.role <> 'admin'
    )
  );

DROP POLICY IF EXISTS workspace_permissions_delete ON public.workspace_permissions;
CREATE POLICY workspace_permissions_delete
  ON public.workspace_permissions
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
  );

CREATE OR REPLACE FUNCTION public.cleanup_workspace_permissions_on_profile_workspace_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    DELETE FROM public.workspace_permissions
    WHERE user_uuid = NEW.id
      AND workspace_id IS DISTINCT FROM NEW.workspace_id;
  END IF;

  IF OLD.role IS DISTINCT FROM NEW.role AND NEW.role = 'admin' THEN
    DELETE FROM public.workspace_permissions
    WHERE user_uuid = NEW.id
      AND workspace_id = NEW.workspace_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleanup_workspace_permissions_on_profile_workspace_change
  ON public.profiles;

CREATE TRIGGER cleanup_workspace_permissions_on_profile_workspace_change
AFTER UPDATE OF workspace_id, role ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_workspace_permissions_on_profile_workspace_change();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_permissions TO authenticated;
GRANT ALL ON public.workspace_permissions TO service_role;
