-- Revert indexes added in 20260615_add_sales_indexes.sql
-- Run this only if the indexes cause issues and you need to rollback

DROP INDEX IF EXISTS public.idx_sales_workspace;
DROP INDEX IF EXISTS public.idx_sales_workspace_created;
DROP INDEX IF EXISTS public.idx_sales_workspace_updated;
DROP INDEX IF EXISTS public.idx_sales_cashier;
DROP INDEX IF EXISTS public.idx_sale_items_sale;
DROP INDEX IF EXISTS public.idx_sale_items_product;
