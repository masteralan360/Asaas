-- Keep legacy public.sales.currency aligned with the authoritative settlement currency.

CREATE OR REPLACE FUNCTION public.sync_sales_currency_with_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_currency text;
BEGIN
  v_currency := lower(coalesce(
    nullif(NEW.settlement_currency, ''),
    nullif(NEW.currency, ''),
    'usd'
  ));

  NEW.settlement_currency := v_currency;
  NEW.currency := v_currency;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_sales_currency_with_settlement ON public.sales;

CREATE TRIGGER sync_sales_currency_with_settlement
BEFORE INSERT OR UPDATE OF currency, settlement_currency ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.sync_sales_currency_with_settlement();

UPDATE public.sales
SET
  settlement_currency = lower(coalesce(nullif(settlement_currency, ''), nullif(currency, ''), 'usd')),
  currency = lower(coalesce(nullif(settlement_currency, ''), nullif(currency, ''), 'usd')),
  updated_at = coalesce(updated_at, timezone('utc'::text, now()))
WHERE currency IS DISTINCT FROM lower(coalesce(nullif(settlement_currency, ''), nullif(currency, ''), 'usd'))
   OR settlement_currency IS DISTINCT FROM lower(coalesce(nullif(settlement_currency, ''), nullif(currency, ''), 'usd'));
