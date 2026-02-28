ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS subcategory TEXT;

CREATE INDEX IF NOT EXISTS idx_expenses_workspace_subcategory
ON public.expenses (workspace_id, subcategory);
