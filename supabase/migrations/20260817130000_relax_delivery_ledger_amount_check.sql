-- Zero-amount ledger entries: a post with COD 0 (fee-only delivery) previously
-- produced courier_collection / merchant_cod_payable entries with amount 0,
-- which the CHECK (amount <> 0) constraint rejected during sync. The client no
-- longer writes zero-amount entries, but already-queued rows must still be able
-- to sync on retry. Allow zero only for those two kinds; settlements and fees
-- remain nonzero.
ALTER TABLE delivery.delivery_ledger_entries
  DROP CONSTRAINT IF EXISTS delivery_ledger_entries_amount_check;

ALTER TABLE delivery.delivery_ledger_entries
  ADD CONSTRAINT delivery_ledger_entries_amount_check CHECK (
    amount <> 0 OR kind IN ('courier_collection', 'merchant_cod_payable')
  );