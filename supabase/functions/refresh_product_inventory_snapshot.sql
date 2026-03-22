CREATE OR REPLACE FUNCTION public.refresh_product_inventory_snapshot(p_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_total_quantity integer := 0;
    v_storage_count integer := 0;
    v_single_storage_id uuid := null;
BEGIN
    SELECT
        COALESCE(SUM(quantity), 0)::integer,
        COUNT(*)::integer,
        CASE WHEN COUNT(*) = 1 THEN MIN(storage_id::text)::uuid ELSE NULL END
    INTO v_total_quantity, v_storage_count, v_single_storage_id
    FROM public.inventory
    WHERE product_id = p_product_id
      AND COALESCE(is_deleted, false) = false;

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

    IF TG_OP = 'UPDATE' AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
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
