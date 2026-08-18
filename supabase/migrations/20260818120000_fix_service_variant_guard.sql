-- Fix the services variant guard: a service may be created/updated as long as
-- it is not a variant (parent_product_id set) and not a variant parent (has
-- active children). Previously the trigger rejected every service insert.

CREATE OR REPLACE FUNCTION public.validate_product_variant_relationship()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_product public.products%ROWTYPE;
BEGIN
  IF NEW.is_service THEN
    IF NEW.parent_product_id IS NOT NULL THEN
      RAISE EXCEPTION 'Services cannot be variant parents or variants.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.products AS child_product
      WHERE child_product.parent_product_id = NEW.id
        AND child_product.is_deleted = false
    ) THEN
      RAISE EXCEPTION 'Services cannot be variant parents or variants.';
    END IF;

    RETURN NEW;
  END IF;

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

  IF parent_product.is_service THEN
    RAISE EXCEPTION 'Variant parent must not be a service.';
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
  BEFORE INSERT OR UPDATE OF parent_product_id, workspace_id, is_deleted, is_service ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_product_variant_relationship();

NOTIFY pgrst, 'reload schema';
