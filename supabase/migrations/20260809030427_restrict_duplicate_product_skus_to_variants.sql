-- A SKU must be unique across product families. The only permitted duplicate is
-- a root product and/or its direct variants, which lets a parent and its
-- variants use the same SKU without permitting duplicate independent products.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_workspace_product_sku()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_sku_key text;
BEGIN
  IF NEW.is_deleted = true OR NEW.workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_sku_key := lower(btrim(NEW.sku));

  PERFORM pg_advisory_xact_lock(hashtext(NEW.workspace_id::text || ':' || v_sku_key));

  IF EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.workspace_id = NEW.workspace_id
      AND product.id <> NEW.id
      AND product.is_deleted = false
      AND lower(btrim(product.sku)) = v_sku_key
      AND NOT (
        (NEW.parent_product_id IS NOT NULL AND (
          product.id = NEW.parent_product_id
          OR product.parent_product_id = NEW.parent_product_id
        ))
        OR (
          NEW.parent_product_id IS NULL
          AND product.parent_product_id = NEW.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'This SKU is already used by another product group. It may only be shared by a parent product and its direct variants.'
      USING ERRCODE = '23505',
            CONSTRAINT = 'products_workspace_sku_active_unique';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_products_workspace_active_normalized_sku
  ON public.products (workspace_id, lower(btrim(sku)))
  WHERE is_deleted = false AND workspace_id IS NOT NULL;

DROP TRIGGER IF EXISTS prevent_duplicate_workspace_product_sku ON public.products;
CREATE TRIGGER prevent_duplicate_workspace_product_sku
  BEFORE INSERT OR UPDATE OF workspace_id, sku, is_deleted, parent_product_id ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_workspace_product_sku();
