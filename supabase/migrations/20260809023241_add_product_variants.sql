ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS parent_product_id uuid;

ALTER TABLE public.products
  ADD CONSTRAINT products_parent_product_not_self
  CHECK (parent_product_id IS DISTINCT FROM id) NOT VALID;

ALTER TABLE public.products
  VALIDATE CONSTRAINT products_parent_product_not_self;

ALTER TABLE public.products
  ADD CONSTRAINT products_parent_product_workspace_fk
  FOREIGN KEY (parent_product_id, workspace_id)
  REFERENCES public.products (id, workspace_id)
  ON UPDATE RESTRICT
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_products_workspace_active_parent
  ON public.products (workspace_id, parent_product_id)
  WHERE parent_product_id IS NOT NULL AND is_deleted = false;

CREATE OR REPLACE FUNCTION public.validate_product_variant_relationship()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_product public.products%ROWTYPE;
BEGIN
  IF NEW.parent_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO parent_product
  FROM public.products
  WHERE id = NEW.parent_product_id
    AND workspace_id = NEW.workspace_id
    AND is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant parent must be an active product in the same workspace.';
  END IF;

  IF parent_product.parent_product_id IS NOT NULL THEN
    RAISE EXCEPTION 'A variant cannot be used as a parent product.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products AS child_product
    WHERE child_product.parent_product_id = NEW.id
      AND child_product.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'A product with variants cannot become a variant itself.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_product_variant_relationship ON public.products;
CREATE TRIGGER validate_product_variant_relationship
  BEFORE INSERT OR UPDATE OF parent_product_id, workspace_id, is_deleted ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_product_variant_relationship();

CREATE OR REPLACE FUNCTION public.unlink_variants_when_parent_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.is_deleted = true AND OLD.is_deleted IS DISTINCT FROM NEW.is_deleted THEN
    UPDATE public.products
    SET
      parent_product_id = NULL,
      updated_at = NEW.updated_at
    WHERE workspace_id = NEW.workspace_id
      AND parent_product_id = NEW.id
      AND is_deleted = false;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS unlink_variants_when_parent_deleted ON public.products;
CREATE TRIGGER unlink_variants_when_parent_deleted
  AFTER UPDATE OF is_deleted ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.unlink_variants_when_parent_deleted();
