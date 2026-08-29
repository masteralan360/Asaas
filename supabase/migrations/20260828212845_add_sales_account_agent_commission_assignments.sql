-- Marks the beneficiary which is automatically derived from the order's
-- selected sales account. Manual beneficiaries remain independently editable.
ALTER TABLE crm.sales_order_agent_assignments
  ADD COLUMN IF NOT EXISTS assignment_source text NOT NULL DEFAULT 'manual';

ALTER TABLE crm.sales_order_agent_assignments
  DROP CONSTRAINT IF EXISTS sales_order_agent_assignments_source_check,
  ADD CONSTRAINT sales_order_agent_assignments_source_check
    CHECK (assignment_source IN ('manual', 'sales_account'));

NOTIFY pgrst, 'reload schema';
