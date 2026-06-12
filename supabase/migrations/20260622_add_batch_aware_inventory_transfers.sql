ALTER TABLE public.inventory_transfer_transactions
  ADD COLUMN IF NOT EXISTS batch_allocations jsonb NULL;

ALTER TABLE public.inventory_transfer_transactions
  DROP CONSTRAINT IF EXISTS inventory_transfer_transactions_batch_allocations_check;

ALTER TABLE public.inventory_transfer_transactions
  ADD CONSTRAINT inventory_transfer_transactions_batch_allocations_check
  CHECK (
    batch_allocations IS NULL
    OR jsonb_typeof(batch_allocations) = 'array'
  );
