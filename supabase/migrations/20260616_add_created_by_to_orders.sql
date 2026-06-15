-- Add created_by column to sales_orders
ALTER TABLE crm.sales_orders
ADD COLUMN IF NOT EXISTS created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN crm.sales_orders.created_by IS 'User who created the sales order';

-- Add created_by column to purchase_orders
ALTER TABLE crm.purchase_orders
ADD COLUMN IF NOT EXISTS created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN crm.purchase_orders.created_by IS 'User who created the purchase order';

-- Create indexes for created_by columns
CREATE INDEX IF NOT EXISTS idx_crm_sales_orders_created_by
  ON crm.sales_orders (created_by)
  WHERE COALESCE(is_deleted, false) = false;

CREATE INDEX IF NOT EXISTS idx_crm_purchase_orders_created_by
  ON crm.purchase_orders (created_by)
  WHERE COALESCE(is_deleted, false) = false;