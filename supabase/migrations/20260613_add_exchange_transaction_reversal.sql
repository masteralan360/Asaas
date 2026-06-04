ALTER TABLE fx.exchange_transactions
  ADD COLUMN IF NOT EXISTS is_reversed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversal_transaction_id uuid NULL,
  ADD COLUMN IF NOT EXISTS reversed_transaction_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_exchange_transactions_is_reversed
  ON fx.exchange_transactions (workspace_id, is_reversed)
  WHERE is_deleted = false;
