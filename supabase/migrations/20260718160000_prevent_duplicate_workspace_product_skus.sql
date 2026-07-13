-- A functional index keeps workspace SKU checks fast without requiring a full
-- catalog scan. It intentionally permits existing historical duplicates so the
-- migration is safe on already-populated workspaces; the trigger prevents any
-- subsequent duplicate create, restore, or product save.
CREATE INDEX IF NOT EXISTS idx_products_workspace_active_normalized_sku
  ON public.products (workspace_id, lower(btrim(sku)))
  WHERE is_deleted = false AND workspace_id IS NOT NULL;

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

  -- Serializes competing saves for the same workspace/SKU. The indexed lookup
  -- below then makes the check safe across tabs and devices as well as fast.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.workspace_id::text || ':' || v_sku_key));

  IF EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.workspace_id = NEW.workspace_id
      AND product.id <> NEW.id
      AND product.is_deleted = false
      AND lower(btrim(product.sku)) = v_sku_key
  ) THEN
    RAISE EXCEPTION 'A product with this SKU already exists in this workspace.'
      USING ERRCODE = '23505',
            CONSTRAINT = 'products_workspace_sku_active_unique';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_duplicate_workspace_product_sku ON public.products;
CREATE TRIGGER prevent_duplicate_workspace_product_sku
  BEFORE INSERT OR UPDATE OF workspace_id, sku, is_deleted ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_workspace_product_sku();
