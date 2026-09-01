-- Consolidate the historic provider constraints so service-role prepaid term
-- activations can record their required manual payment transaction.
ALTER TABLE billing.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_provider_check,
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_provider_check;

ALTER TABLE billing.payment_transactions
  ADD CONSTRAINT workspace_payment_transactions_provider_check
  CHECK (provider IN ('fib', 'qicard', 'free', 'manual'));

COMMENT ON CONSTRAINT workspace_payment_transactions_provider_check
  ON billing.payment_transactions IS
  'Allowed payment providers. manual is reserved for service-role prepaid term activation.';
