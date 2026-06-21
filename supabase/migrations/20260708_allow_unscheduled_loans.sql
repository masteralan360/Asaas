ALTER TABLE public.loans
  ALTER COLUMN first_due_date DROP NOT NULL;

ALTER TABLE public.loan_installments
  ALTER COLUMN due_date DROP NOT NULL;
