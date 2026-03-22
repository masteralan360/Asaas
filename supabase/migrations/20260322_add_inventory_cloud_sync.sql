CREATE TABLE IF NOT EXISTS public.inventory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  storage_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT inventory_workspace_product_storage_key UNIQUE (workspace_id, product_id, storage_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace
  ON public.inventory (workspace_id);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace_updated
  ON public.inventory (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace_deleted
  ON public.inventory (workspace_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace_storage
  ON public.inventory (workspace_id, storage_id);

CREATE INDEX IF NOT EXISTS idx_inventory_workspace_product
  ON public.inventory (workspace_id, product_id);

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS storage_id uuid NULL;

ALTER TABLE crm.sales_orders
  ADD COLUMN IF NOT EXISTS source_storage_id uuid NULL;

ALTER TABLE crm.purchase_orders
  ADD COLUMN IF NOT EXISTS destination_storage_id uuid NULL;

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

INSERT INTO public.storages (
    workspace_id,
    name,
    is_system,
    is_protected,
    created_at,
    updated_at,
    is_deleted
)
SELECT DISTINCT
    p.workspace_id,
    'Main',
    true,
    true,
    timezone('utc', now()),
    timezone('utc', now()),
    false
FROM public.products p
WHERE p.workspace_id IS NOT NULL
  AND COALESCE(p.is_deleted, false) = false
  AND COALESCE(p.quantity, 0) > 0
  AND p.storage_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.storages s
    WHERE s.workspace_id = p.workspace_id
      AND LOWER(s.name) = 'main'
      AND COALESCE(s.is_deleted, false) = false
  );

INSERT INTO public.inventory (
    id,
    workspace_id,
    product_id,
    storage_id,
    quantity,
    created_at,
    updated_at,
    version,
    is_deleted
)
SELECT
    gen_random_uuid(),
    p.workspace_id,
    p.id,
    COALESCE(
        p.storage_id,
        main_storage.id
    ) AS resolved_storage_id,
    GREATEST(COALESCE(p.quantity, 0), 0),
    COALESCE(p.created_at, timezone('utc', now())),
    COALESCE(p.updated_at, timezone('utc', now())),
    GREATEST(COALESCE(p.version, 1), 1),
    false
FROM public.products p
LEFT JOIN LATERAL (
    SELECT s.id
    FROM public.storages s
    WHERE s.workspace_id = p.workspace_id
      AND LOWER(s.name) = 'main'
      AND COALESCE(s.is_deleted, false) = false
    ORDER BY s.created_at NULLS LAST, s.id
    LIMIT 1
) AS main_storage ON true
WHERE p.workspace_id IS NOT NULL
  AND COALESCE(p.is_deleted, false) = false
  AND GREATEST(COALESCE(p.quantity, 0), 0) > 0
  AND COALESCE(p.storage_id, main_storage.id) IS NOT NULL
ON CONFLICT (workspace_id, product_id, storage_id) DO UPDATE
SET
    quantity = EXCLUDED.quantity,
    updated_at = EXCLUDED.updated_at,
    version = GREATEST(public.inventory.version, EXCLUDED.version),
    is_deleted = false;

UPDATE public.sale_items si
SET storage_id = p.storage_id
FROM public.sales s,
     public.products p
WHERE si.sale_id = s.id
  AND p.id = si.product_id
  AND p.workspace_id = s.workspace_id
  AND si.storage_id IS NULL
  AND p.storage_id IS NOT NULL;

DO $$
DECLARE
    product_row RECORD;
BEGIN
    FOR product_row IN
        SELECT id
        FROM public.products
    LOOP
        PERFORM public.refresh_product_inventory_snapshot(product_row.id);
    END LOOP;
END $$;
