-- Give each sale line an immutable creation timestamp and a reliable
-- modification timestamp.  These are required for auditing returns and for
-- resolving local-mode cache state independently from the parent sale.
BEGIN;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Preserve historical timing wherever it can be derived.  A returned line
-- has a known later modification time; otherwise the parent sale time is the
-- only authoritative legacy timestamp.
UPDATE public.sale_items AS item
SET
  created_at = COALESCE(item.created_at, sale.created_at),
  updated_at = COALESCE(
    item.updated_at,
    item.returned_at,
    item.created_at,
    sale.created_at
  )
FROM public.sales AS sale
WHERE sale.id = item.sale_id
  AND (item.created_at IS NULL OR item.updated_at IS NULL);

-- Do not silently invent audit data for malformed legacy rows.  The whole
-- migration rolls back if a line cannot be linked to a timestamped sale.
DO $$
DECLARE
  unresolved_count bigint;
BEGIN
  SELECT COUNT(*)
  INTO unresolved_count
  FROM public.sale_items
  WHERE created_at IS NULL OR updated_at IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Cannot backfill created_at/updated_at for % sale_items row(s)',
      unresolved_count;
  END IF;
END;
$$;

ALTER TABLE public.sale_items
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_sale_item_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := COALESCE(NEW.updated_at, NEW.created_at);
  ELSE
    -- Audit creation time is immutable.  Every return, exchange, or other
    -- modification receives a server-authoritative modification timestamp.
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_sale_item_timestamps ON public.sale_items;
CREATE TRIGGER set_sale_item_timestamps
BEFORE INSERT OR UPDATE ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.set_sale_item_timestamps();

COMMIT;
