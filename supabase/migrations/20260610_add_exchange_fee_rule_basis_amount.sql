ALTER TABLE fx.exchange_fee_rules
  ADD COLUMN IF NOT EXISTS customer_gives_basis_amount numeric NOT NULL DEFAULT 100000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'exchange_fee_rules_basis_amount_check'
      AND conrelid = 'fx.exchange_fee_rules'::regclass
  ) THEN
    ALTER TABLE fx.exchange_fee_rules
      ADD CONSTRAINT exchange_fee_rules_basis_amount_check CHECK (customer_gives_basis_amount > 0);
  END IF;
END $$;
