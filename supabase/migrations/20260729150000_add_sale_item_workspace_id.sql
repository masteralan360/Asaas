-- Sale items need their own workspace scope for reliable RLS, sync, and
-- desktop SQLite mirroring. Preserve every legacy row by deriving ownership
-- from its immutable parent sale before enforcing the new invariant.

BEGIN;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

UPDATE public.sale_items AS item
SET workspace_id = sale.workspace_id
FROM public.sales AS sale
WHERE sale.id = item.sale_id
  AND item.workspace_id IS DISTINCT FROM sale.workspace_id;

DO $$
DECLARE
  missing_workspace_count bigint;
BEGIN
  SELECT COUNT(*)
  INTO missing_workspace_count
  FROM public.sale_items
  WHERE workspace_id IS NULL;

  -- Do not silently assign an arbitrary workspace to a corrupt/orphaned
  -- legacy row. Failing the migration leaves all existing data untouched.
  IF missing_workspace_count > 0 THEN
    RAISE EXCEPTION
      'Cannot backfill workspace_id for % sale_items row(s) without a parent sale',
      missing_workspace_count;
  END IF;
END $$;

ALTER TABLE public.sale_items
  ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sale_items_workspace_sale
  ON public.sale_items (workspace_id, sale_id);

CREATE OR REPLACE FUNCTION public.enforce_sale_item_workspace_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_workspace_id uuid;
BEGIN
  SELECT workspace_id
  INTO parent_workspace_id
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF parent_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Sale % does not exist or has no workspace', NEW.sale_id;
  END IF;

  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := parent_workspace_id;
  ELSIF NEW.workspace_id <> parent_workspace_id THEN
    RAISE EXCEPTION
      'sale_items.workspace_id must match the parent sale workspace';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_sale_item_workspace_id ON public.sale_items;
CREATE TRIGGER enforce_sale_item_workspace_id
BEFORE INSERT OR UPDATE OF sale_id, workspace_id
ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_sale_item_workspace_id();

COMMIT;
