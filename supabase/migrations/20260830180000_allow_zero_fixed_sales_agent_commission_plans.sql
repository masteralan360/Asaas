-- A zero fixed commission is a valid no-payout commission level. Keep the
-- database constraint aligned with the app validation and local data layer.
ALTER TABLE crm.agent_commission_plans
  DROP CONSTRAINT IF EXISTS agent_commission_plans_commission_shape_check,
  ADD CONSTRAINT agent_commission_plans_commission_shape_check CHECK (
    (commission_type = 'percentage'
      AND fixed_amount IS NULL
      AND fixed_currency IS NULL)
    OR (commission_type = 'fixed_amount'
      AND rate_percent = 0
      AND fixed_amount >= 0
      AND fixed_currency IS NOT NULL)
  );
