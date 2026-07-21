-- Inventory is the source of truth for a product's stock snapshot.  The
-- product fields are retained for reads, but must never be able to drift from
-- the active inventory positions in the same workspace.

CREATE OR REPLACE FUNCTION public.refresh_product_inventory_snapshot(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_workspace_id uuid;
    v_total_quantity numeric := 0;
    v_storage_count integer := 0;
    v_single_storage_id uuid := NULL;
BEGIN
    SELECT workspace_id
    INTO v_workspace_id
    FROM public.products
    WHERE id = p_product_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT
        COALESCE(SUM(i.quantity), 0)::numeric,
        COUNT(*)::integer,
        CASE WHEN COUNT(*) = 1 THEN MIN(i.storage_id::text)::uuid ELSE NULL END
    INTO v_total_quantity, v_storage_count, v_single_storage_id
    FROM public.inventory AS i
    WHERE i.workspace_id = v_workspace_id
      AND i.product_id = p_product_id
      AND COALESCE(i.is_deleted, false) = false;

    UPDATE public.products
    SET
        quantity = v_total_quantity,
        storage_id = CASE WHEN v_storage_count = 1 THEN v_single_storage_id ELSE NULL END,
        updated_at = timezone('utc', now()),
        version = COALESCE(version, 0) + 1
    WHERE id = p_product_id
      AND (
        quantity IS DISTINCT FROM v_total_quantity
        OR storage_id IS DISTINCT FROM CASE WHEN v_storage_count = 1 THEN v_single_storage_id ELSE NULL END
      );
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_inventory_snapshot_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.refresh_product_inventory_snapshot(OLD.product_id);
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE'
       AND (
           NEW.product_id IS DISTINCT FROM OLD.product_id
           OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       ) THEN
        PERFORM public.refresh_product_inventory_snapshot(OLD.product_id);
    END IF;

    PERFORM public.refresh_product_inventory_snapshot(NEW.product_id);
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_inventory_refresh_product_snapshot ON public.inventory;
CREATE TRIGGER trg_inventory_refresh_product_snapshot
AFTER INSERT OR UPDATE OR DELETE ON public.inventory
FOR EACH ROW
EXECUTE FUNCTION public.handle_inventory_snapshot_refresh();

-- Older clients and queued mutations can still submit products.quantity or
-- products.storage_id.  Preserve the request's non-stock fields, but replace
-- those two derived fields before the row is written.
CREATE OR REPLACE FUNCTION public.enforce_product_inventory_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_total_quantity numeric := 0;
    v_storage_count integer := 0;
    v_single_storage_id uuid := NULL;
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.quantity := 0;
        NEW.storage_id := NULL;
        RETURN NEW;
    END IF;

    SELECT
        COALESCE(SUM(i.quantity), 0)::numeric,
        COUNT(*)::integer,
        CASE WHEN COUNT(*) = 1 THEN MIN(i.storage_id::text)::uuid ELSE NULL END
    INTO v_total_quantity, v_storage_count, v_single_storage_id
    FROM public.inventory AS i
    WHERE i.workspace_id = NEW.workspace_id
      AND i.product_id = NEW.id
      AND COALESCE(i.is_deleted, false) = false;

    NEW.quantity := v_total_quantity;
    NEW.storage_id := CASE WHEN v_storage_count = 1 THEN v_single_storage_id ELSE NULL END;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_products_enforce_inventory_snapshot ON public.products;
CREATE TRIGGER trg_products_enforce_inventory_snapshot
BEFORE INSERT OR UPDATE OF quantity, storage_id, workspace_id ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.enforce_product_inventory_snapshot();

-- Repair every existing product snapshot as part of the migration.
WITH active_inventory AS (
    SELECT
        i.workspace_id,
        i.product_id,
        COALESCE(SUM(i.quantity), 0)::numeric AS total_quantity,
        COUNT(*)::integer AS storage_count,
        CASE WHEN COUNT(*) = 1 THEN MIN(i.storage_id::text)::uuid ELSE NULL END AS single_storage_id
    FROM public.inventory AS i
    WHERE COALESCE(i.is_deleted, false) = false
    GROUP BY i.workspace_id, i.product_id
)
UPDATE public.products AS p
SET
    quantity = ai.total_quantity,
    storage_id = CASE WHEN ai.storage_count = 1 THEN ai.single_storage_id ELSE NULL END,
    updated_at = timezone('utc', now()),
    version = COALESCE(p.version, 0) + 1
FROM active_inventory AS ai
WHERE p.id = ai.product_id
  AND p.workspace_id = ai.workspace_id
  AND COALESCE(p.is_deleted, false) = false
  AND (
      p.quantity IS DISTINCT FROM ai.total_quantity
      OR p.storage_id IS DISTINCT FROM CASE WHEN ai.storage_count = 1 THEN ai.single_storage_id ELSE NULL END
  );

UPDATE public.products AS p
SET
    quantity = 0,
    storage_id = NULL,
    updated_at = timezone('utc', now()),
    version = COALESCE(p.version, 0) + 1
WHERE COALESCE(p.is_deleted, false) = false
  AND NOT EXISTS (
      SELECT 1
      FROM public.inventory AS i
      WHERE i.workspace_id = p.workspace_id
        AND i.product_id = p.id
        AND COALESCE(i.is_deleted, false) = false
  )
  AND (p.quantity IS DISTINCT FROM 0 OR p.storage_id IS NOT NULL);
