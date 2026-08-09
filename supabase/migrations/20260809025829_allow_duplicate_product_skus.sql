-- SKU is a descriptive catalog field rather than a product identity. Parent
-- products and variants may share it, and unlinking/deleting a parent must not
-- force the application to rewrite a sellable product's SKU. Product IDs and
-- barcodes remain the unambiguous identities.
DROP TRIGGER IF EXISTS prevent_duplicate_workspace_product_sku ON public.products;
DROP FUNCTION IF EXISTS public.prevent_duplicate_workspace_product_sku();
