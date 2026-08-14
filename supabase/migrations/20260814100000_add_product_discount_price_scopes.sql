-- Product discounts can now target native prices, all price sources, or a
-- selected set of Price Books. Existing discounts retain their historical
-- broad behavior by defaulting to all price sources.
ALTER TABLE public.product_discounts
  ADD COLUMN IF NOT EXISTS price_scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS price_book_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS discount_currency text NULL;

UPDATE public.product_discounts AS discount
SET discount_currency = product.currency
FROM public.products AS product
WHERE discount.discount_type = 'fixed_amount'
  AND discount.discount_currency IS NULL
  AND product.id = discount.product_id;

ALTER TABLE public.product_discounts
  DROP CONSTRAINT IF EXISTS product_discounts_price_scope_check,
  ADD CONSTRAINT product_discounts_price_scope_check
    CHECK (price_scope IN ('all', 'native_only', 'specific_price_books')),
  DROP CONSTRAINT IF EXISTS product_discounts_price_scope_targets_check,
  ADD CONSTRAINT product_discounts_price_scope_targets_check
    CHECK (
      (price_scope = 'specific_price_books' AND cardinality(price_book_ids) > 0)
      OR (price_scope <> 'specific_price_books' AND cardinality(price_book_ids) = 0)
    ),
  DROP CONSTRAINT IF EXISTS product_discounts_fixed_currency_check,
  ADD CONSTRAINT product_discounts_fixed_currency_check
    CHECK (
      (discount_type = 'fixed_amount' AND discount_currency IN ('usd', 'eur', 'iqd', 'try'))
      OR (discount_type = 'percentage' AND discount_currency IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_product_discounts_price_book_ids
  ON public.product_discounts USING gin (price_book_ids);

CREATE OR REPLACE FUNCTION public.enforce_product_discount_price_books()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.price_scope <> 'specific_price_books' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.price_book_ids) AS selected_price_book(id)
    LEFT JOIN public.price_books AS price_book
      ON price_book.id = selected_price_book.id
    WHERE price_book.id IS NULL
      OR price_book.workspace_id <> NEW.workspace_id
      OR price_book.is_deleted = true
  ) THEN
    RAISE EXCEPTION 'Product discount Price Books must belong to the same active workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_product_discount_price_books ON public.product_discounts;
CREATE TRIGGER enforce_product_discount_price_books
  BEFORE INSERT OR UPDATE OF workspace_id, price_scope, price_book_ids ON public.product_discounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_product_discount_price_books();

-- Marketplace pricing is always native pricing. Price-Book-only product rules
-- must not suppress an eligible category rule in marketplace responses.
CREATE OR REPLACE FUNCTION public.get_active_discounts_for_marketplace_storage(
  p_workspace_id uuid,
  p_storage_id uuid
)
RETURNS TABLE (
  product_id uuid,
  discount_type text,
  discount_value numeric,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  min_stock_threshold integer,
  source text,
  is_stock_ok boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_workspace_id IS NULL OR p_storage_id IS NULL THEN
    RETURN;
  END IF;

  IF auth.role() = 'authenticated' AND p_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  RETURN QUERY
  WITH stock_totals AS (
    SELECT inventory.product_id, COALESCE(SUM(inventory.quantity), 0)::integer AS total_stock
    FROM public.inventory
    WHERE inventory.workspace_id = p_workspace_id
      AND inventory.storage_id = p_storage_id
      AND COALESCE(inventory.is_deleted, false) = false
    GROUP BY inventory.product_id
  ),
  active_product_discounts AS (
    SELECT
      pd.product_id,
      pd.discount_type,
      pd.discount_value,
      pd.starts_at,
      pd.ends_at,
      pd.min_stock_threshold,
      'product'::text AS source,
      ROW_NUMBER() OVER (
        PARTITION BY pd.product_id
        ORDER BY pd.starts_at DESC, pd.created_at DESC, pd.id DESC
      ) AS rn
    FROM public.product_discounts pd
    JOIN public.products p
      ON p.id = pd.product_id
     AND p.workspace_id = p_workspace_id
     AND COALESCE(p.is_deleted, false) = false
    WHERE pd.workspace_id = p_workspace_id
      AND COALESCE(pd.is_deleted, false) = false
      AND pd.is_active = true
      AND pd.price_scope IN ('all', 'native_only')
      AND pd.starts_at <= timezone('utc', now())
      AND pd.ends_at >= timezone('utc', now())
  ),
  active_category_discounts AS (
    SELECT
      p.id AS product_id,
      cd.discount_type,
      cd.discount_value,
      cd.starts_at,
      cd.ends_at,
      cd.min_stock_threshold,
      'category'::text AS source,
      ROW_NUMBER() OVER (
        PARTITION BY p.id
        ORDER BY cd.starts_at DESC, cd.created_at DESC, cd.id DESC
      ) AS rn
    FROM public.category_discounts cd
    JOIN public.products p
      ON p.category_id = cd.category_id
     AND p.workspace_id = p_workspace_id
     AND COALESCE(p.is_deleted, false) = false
    WHERE cd.workspace_id = p_workspace_id
      AND COALESCE(cd.is_deleted, false) = false
      AND cd.is_active = true
      AND cd.starts_at <= timezone('utc', now())
      AND cd.ends_at >= timezone('utc', now())
  ),
  resolved_discounts AS (
    SELECT apd.product_id, apd.discount_type, apd.discount_value, apd.starts_at, apd.ends_at, apd.min_stock_threshold, apd.source
    FROM active_product_discounts apd
    WHERE apd.rn = 1

    UNION ALL

    SELECT acd.product_id, acd.discount_type, acd.discount_value, acd.starts_at, acd.ends_at, acd.min_stock_threshold, acd.source
    FROM active_category_discounts acd
    WHERE acd.rn = 1
      AND NOT EXISTS (
        SELECT 1
        FROM active_product_discounts apd
        WHERE apd.product_id = acd.product_id
          AND apd.rn = 1
      )
  )
  SELECT
    rd.product_id,
    rd.discount_type,
    rd.discount_value,
    rd.starts_at,
    rd.ends_at,
    rd.min_stock_threshold,
    rd.source,
    CASE
      WHEN rd.min_stock_threshold IS NULL THEN true
      ELSE COALESCE(stock_totals.total_stock, 0) >= rd.min_stock_threshold
    END AS is_stock_ok
  FROM resolved_discounts rd
  LEFT JOIN stock_totals ON stock_totals.product_id = rd.product_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_product_discount_price_books() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_product_discount_price_books() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_active_discounts_for_marketplace_storage(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_discounts_for_marketplace_storage(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
