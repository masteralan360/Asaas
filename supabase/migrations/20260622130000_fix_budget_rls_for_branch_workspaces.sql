-- Budget RLS was originally tied to profiles.workspace_id. That column now
-- identifies the user's source workspace, while current_workspace_id() tracks
-- the source workspace or branch the user is actively using.

DROP POLICY IF EXISTS "Workspaces members can view budget_settings"
  ON budget.budget_settings;
CREATE POLICY "Workspaces members can view budget_settings"
  ON budget.budget_settings
  FOR ALL
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS "Workspaces members can view budget_allocations"
  ON budget.budget_allocations;
CREATE POLICY "Workspaces members can view budget_allocations"
  ON budget.budget_allocations
  FOR ALL
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS "Workspaces members can view expense_series"
  ON budget.expense_series;
CREATE POLICY "Workspaces members can view expense_series"
  ON budget.expense_series
  FOR ALL
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS "Workspaces members can view expense_items"
  ON budget.expense_items;
CREATE POLICY "Workspaces members can view expense_items"
  ON budget.expense_items
  FOR ALL
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS "Workspaces members can view payroll_statuses"
  ON budget.payroll_statuses;
CREATE POLICY "Workspaces members can view payroll_statuses"
  ON budget.payroll_statuses
  FOR ALL
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS "Workspaces members can view dividend_statuses"
  ON budget.dividend_statuses;
CREATE POLICY "Workspaces members can view dividend_statuses"
  ON budget.dividend_statuses
  FOR ALL
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());
