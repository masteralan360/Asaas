ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS loan_category text NULL,
  ADD COLUMN IF NOT EXISTS direction text NULL;

UPDATE public.loans
SET loan_category = COALESCE(loan_category, 'standard'),
    direction = COALESCE(direction, 'lent');

ALTER TABLE public.loans
  ALTER COLUMN loan_category SET DEFAULT 'standard',
  ALTER COLUMN loan_category SET NOT NULL,
  ALTER COLUMN direction SET DEFAULT 'lent',
  ALTER COLUMN direction SET NOT NULL;

ALTER TABLE public.loans
  DROP CONSTRAINT IF EXISTS loans_category_check;

ALTER TABLE public.loans
  ADD CONSTRAINT loans_category_check CHECK (
    loan_category IN ('standard', 'simple')
  );

ALTER TABLE public.loans
  DROP CONSTRAINT IF EXISTS loans_direction_check;

ALTER TABLE public.loans
  ADD CONSTRAINT loans_direction_check CHECK (
    direction IN ('lent', 'borrowed')
  );

CREATE INDEX IF NOT EXISTS idx_loans_workspace_category_direction
  ON public.loans (workspace_id, loan_category, direction)
  WHERE is_deleted = false;
