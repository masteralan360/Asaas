-- Add indexes on public.sales and public.sale_items to speed up sales history queries
-- without these, every query does a sequential scan on the entire table

CREATE INDEX IF NOT EXISTS idx_sales_workspace
  ON public.sales (workspace_id);

CREATE INDEX IF NOT EXISTS idx_sales_workspace_created
  ON public.sales (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_workspace_updated
  ON public.sales (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_cashier
  ON public.sales (cashier_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale
  ON public.sale_items (sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_product
  ON public.sale_items (product_id);
