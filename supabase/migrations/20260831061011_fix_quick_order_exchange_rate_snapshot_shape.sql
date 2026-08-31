-- Prevent JSON `null` exchange-rate snapshots from reaching commission
-- reconciliation as scalars. Quick Order submits a JSON RPC payload, where
-- `payload->'exchange_rates'` preserves JSON null rather than SQL NULL.

CREATE OR REPLACE FUNCTION private.convert_sales_agent_commission_amount(
  p_amount numeric,
  p_from_currency text,
  p_to_currency text,
  p_exchange_rates jsonb
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  WITH RECURSIVE raw_rates AS (
    SELECT
      lower(split_part(rate.item->>'pair', '/', 1)) AS from_currency,
      lower(split_part(rate.item->>'pair', '/', 2)) AS to_currency,
      CASE
        WHEN COALESCE(rate.item->>'rate', '') ~ '^[0-9]+([.][0-9]+)?$'
          AND COALESCE(rate.item->>'priceBasisAmount', rate.item->>'price_basis_amount', '100') ~ '^[0-9]+([.][0-9]+)?$'
          AND (rate.item->>'rate')::numeric > 0
          AND COALESCE(rate.item->>'priceBasisAmount', rate.item->>'price_basis_amount', '100')::numeric > 0
        THEN (rate.item->>'rate')::numeric
          / COALESCE(rate.item->>'priceBasisAmount', rate.item->>'price_basis_amount', '100')::numeric
        ELSE NULL
      END AS factor
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(p_exchange_rates) = 'array' THEN p_exchange_rates
        ELSE '[]'::jsonb
      END
    ) AS rate(item)
    WHERE jsonb_typeof(rate.item) = 'object'
  ), edges AS (
    SELECT from_currency, to_currency, factor
    FROM raw_rates
    WHERE from_currency IN ('usd', 'eur', 'iqd', 'try')
      AND to_currency IN ('usd', 'eur', 'iqd', 'try')
      AND factor IS NOT NULL
    UNION ALL
    SELECT to_currency, from_currency, 1 / factor
    FROM raw_rates
    WHERE from_currency IN ('usd', 'eur', 'iqd', 'try')
      AND to_currency IN ('usd', 'eur', 'iqd', 'try')
      AND factor IS NOT NULL
  ), paths(currency, factor, visited) AS (
    SELECT lower(p_from_currency), 1::numeric, ARRAY[lower(p_from_currency)]::text[]
    UNION ALL
    SELECT edge.to_currency, path.factor * edge.factor, path.visited || edge.to_currency
    FROM paths AS path
    JOIN edges AS edge ON edge.from_currency = path.currency
    WHERE NOT edge.to_currency = ANY(path.visited)
      AND cardinality(path.visited) < 4
  )
  SELECT CASE
    WHEN p_amount = 0
      AND lower(p_from_currency) IN ('usd', 'eur', 'iqd', 'try')
      AND lower(p_to_currency) IN ('usd', 'eur', 'iqd', 'try')
      THEN 0
    ELSE (
      SELECT round(p_amount * paths.factor, 6)
      FROM paths
      WHERE paths.currency = lower(p_to_currency)
      ORDER BY cardinality(paths.visited)
      LIMIT 1
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION private.normalize_sales_order_exchange_rates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.exchange_rates IS NULL OR jsonb_typeof(NEW.exchange_rates) = 'null' THEN
    NEW.exchange_rates := NULL;
  ELSIF jsonb_typeof(NEW.exchange_rates) <> 'array' THEN
    RAISE EXCEPTION 'Sales order exchange rate snapshot must be an array'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_sales_order_exchange_rates ON crm.sales_orders;
CREATE TRIGGER normalize_sales_order_exchange_rates
  BEFORE INSERT OR UPDATE OF exchange_rates ON crm.sales_orders
  FOR EACH ROW EXECUTE FUNCTION private.normalize_sales_order_exchange_rates();

-- Repair Quick Orders already created with a JSON null snapshot without
-- changing their business values. The converter above also protects any
-- reconciliation retries that race with this cleanup.
UPDATE crm.sales_orders
SET exchange_rates = NULL
WHERE jsonb_typeof(exchange_rates) = 'null';

REVOKE ALL ON FUNCTION private.convert_sales_agent_commission_amount(numeric, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.normalize_sales_order_exchange_rates() FROM PUBLIC;
