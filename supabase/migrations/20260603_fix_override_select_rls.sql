-- Allow all workspace members to SELECT overrides (needed for frontend feature resolution),
-- but keep INSERT/UPDATE/DELETE restricted to admins.

DROP POLICY IF EXISTS workspace_access_overrides_select ON public.workspace_access_overrides;
CREATE POLICY workspace_access_overrides_select
  ON public.workspace_access_overrides
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
  );
