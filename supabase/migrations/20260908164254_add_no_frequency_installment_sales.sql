-- An untimed installment sale has an open customer balance rather than a
-- repayment schedule. Its one internal allocation row has no due date.
ALTER TABLE public.installment_sales
  ALTER COLUMN first_due_date DROP NOT NULL;

ALTER TABLE public.installment_sales
  DROP CONSTRAINT IF EXISTS installment_sales_installment_check,
  ADD CONSTRAINT installment_sales_installment_check CHECK (
    (
      installment_frequency = 'no_frequency'
      AND installment_count = 1
      AND first_due_date IS NULL
      AND next_due_date IS NULL
    )
    OR (
      installment_frequency IN ('daily', 'weekly', 'biweekly', 'monthly')
      AND installment_count > 0
      AND first_due_date IS NOT NULL
    )
  );

ALTER TABLE public.installment_sale_installments
  ALTER COLUMN due_date DROP NOT NULL;
