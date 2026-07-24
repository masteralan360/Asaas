-- Confirmed order adjustments are kept as a JSONB array so their row-level
-- labels and amounts travel with the order through local/cloud synchronization.
ALTER TABLE crm.sales_orders
  ADD COLUMN IF NOT EXISTS order_adjustments jsonb NULL;

ALTER TABLE crm.purchase_orders
  ADD COLUMN IF NOT EXISTS order_adjustments jsonb NULL;
