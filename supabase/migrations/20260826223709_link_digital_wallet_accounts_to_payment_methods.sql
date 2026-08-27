-- A Digital Wallet can describe which branded payment method it represents.
-- This is configuration only: the selected account is still stored on the
-- authoritative payment_transaction when an actual payment is posted.
ALTER TABLE payment_accounts.accounts
  ADD COLUMN IF NOT EXISTS linked_payment_method text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_accounts_linked_payment_method_check'
      AND conrelid = 'payment_accounts.accounts'::regclass
  ) THEN
    ALTER TABLE payment_accounts.accounts
      ADD CONSTRAINT payment_accounts_linked_payment_method_check CHECK (
        linked_payment_method IS NULL
        OR (
          account_type = 'digital_wallet'
          AND linked_payment_method IN ('fib', 'qicard', 'zaincash', 'fastpay')
        )
      );
  END IF;
END $$;

-- A payment method can resolve to one available Digital Wallet in a workspace.
-- Soft-deleted and inactive accounts deliberately stop participating so the
-- replacement wallet can be linked immediately.
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_one_active_wallet_per_payment_method
  ON payment_accounts.accounts (workspace_id, linked_payment_method)
  WHERE linked_payment_method IS NOT NULL
    AND account_type = 'digital_wallet'
    AND is_active
    AND NOT is_deleted;

NOTIFY pgrst, 'reload schema';
