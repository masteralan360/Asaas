-- Real Estate users are mediators: contract payments are pass-through tracking,
-- not workspace cash flow. Hide legacy ledger/payment rows that treated contract
-- installments/down payments as incoming or outgoing business transactions.

UPDATE public.payment_transactions
SET
  is_deleted = true,
  updated_at = now(),
  version = version + 1
WHERE source_module = 'real_estate'
  AND source_type IN ('real_estate_payment', 'real_estate_installment')
  AND is_deleted = false;
