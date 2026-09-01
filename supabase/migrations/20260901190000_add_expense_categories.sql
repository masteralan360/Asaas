CREATE TABLE IF NOT EXISTS budget.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT expense_categories_id_workspace_unique UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_workspace
  ON budget.expense_categories (workspace_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_workspace_name_unique
  ON budget.expense_categories (workspace_id, lower(btrim(name)))
  WHERE is_deleted = false;

ALTER TABLE budget.expense_series
  ADD COLUMN IF NOT EXISTS category_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expense_series_category_workspace_fk'
      AND conrelid = 'budget.expense_series'::regclass
  ) THEN
    ALTER TABLE budget.expense_series
      ADD CONSTRAINT expense_series_category_workspace_fk
      FOREIGN KEY (category_id, workspace_id)
      REFERENCES budget.expense_categories (id, workspace_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE budget.expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspaces members can view expense_categories"
  ON budget.expense_categories;
CREATE POLICY "Workspaces members can view expense_categories"
  ON budget.expense_categories
  FOR ALL
  TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON budget.expense_categories;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON budget.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('expenses');

GRANT SELECT, INSERT, UPDATE, DELETE ON budget.expense_categories TO authenticated;
