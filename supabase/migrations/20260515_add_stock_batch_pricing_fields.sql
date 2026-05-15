ALTER TABLE public.stock_batches
  ADD COLUMN IF NOT EXISTS price numeric NULL,
  ADD COLUMN IF NOT EXISTS cost_price numeric NULL,
  ADD COLUMN IF NOT EXISTS currency text NULL;

CREATE OR REPLACE FUNCTION public.apply_stock_batch_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_product_price numeric := 0;
  v_product_cost_price numeric := 0;
  v_product_currency text := 'usd';
BEGIN
  SELECT
    COALESCE(price, 0),
    COALESCE(cost_price, 0),
    lower(COALESCE(currency, 'usd'))
  INTO
    v_product_price,
    v_product_cost_price,
    v_product_currency
  FROM public.products
  WHERE id = NEW.product_id
    AND workspace_id = NEW.workspace_id
  LIMIT 1;

  NEW.price := COALESCE(NEW.price, v_product_price, 0);
  NEW.cost_price := COALESCE(NEW.cost_price, v_product_cost_price, 0);
  NEW.currency := lower(COALESCE(NULLIF(NEW.currency, ''), v_product_currency, 'usd'));

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stock_batches_apply_defaults ON public.stock_batches;

CREATE TRIGGER stock_batches_apply_defaults
BEFORE INSERT OR UPDATE ON public.stock_batches
FOR EACH ROW
EXECUTE FUNCTION public.apply_stock_batch_defaults();

UPDATE public.stock_batches AS sb
SET
  price = COALESCE(sb.price, p.price, 0),
  cost_price = COALESCE(sb.cost_price, p.cost_price, 0),
  currency = lower(COALESCE(NULLIF(sb.currency, ''), p.currency, 'usd'))
FROM public.products AS p
WHERE p.id = sb.product_id
  AND p.workspace_id = sb.workspace_id;

UPDATE public.stock_batches
SET
  price = COALESCE(price, 0),
  cost_price = COALESCE(cost_price, 0),
  currency = lower(COALESCE(NULLIF(currency, ''), 'usd'))
WHERE price IS NULL
   OR cost_price IS NULL
   OR currency IS NULL
   OR currency = '';

ALTER TABLE public.stock_batches
  ALTER COLUMN price SET NOT NULL,
  ALTER COLUMN cost_price SET NOT NULL,
  ALTER COLUMN currency SET NOT NULL;

ALTER TABLE public.stock_batches
  DROP CONSTRAINT IF EXISTS stock_batches_price_check,
  DROP CONSTRAINT IF EXISTS stock_batches_cost_price_check,
  DROP CONSTRAINT IF EXISTS stock_batches_currency_check;

ALTER TABLE public.stock_batches
  ADD CONSTRAINT stock_batches_price_check CHECK (price >= 0),
  ADD CONSTRAINT stock_batches_cost_price_check CHECK (cost_price >= 0),
  ADD CONSTRAINT stock_batches_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try'));
