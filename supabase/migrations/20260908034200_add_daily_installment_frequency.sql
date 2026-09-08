ALTER TABLE public.loans
  DROP CONSTRAINT IF EXISTS loans_installment_frequency_check,
  ADD CONSTRAINT loans_installment_frequency_check
    CHECK (installment_frequency IN ('daily', 'weekly', 'biweekly', 'monthly'));
