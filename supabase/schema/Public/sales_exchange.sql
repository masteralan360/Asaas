CREATE TABLE public.sales_exchange (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  base_amount numeric NOT NULL DEFAULT 100,
  quote_amount numeric NOT NULL,
  source text NOT NULL,
  captured_at timestamp with time zone NOT NULL,
  rate_side text NOT NULL DEFAULT 'mid'::text,
  source_price_id uuid NULL,
  source_price_updated_at timestamp with time zone NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sales_exchange_currency_check CHECK (
    base_currency = ANY (ARRAY['usd'::text, 'eur'::text, 'iqd'::text, 'try'::text])
    AND quote_currency = ANY (ARRAY['usd'::text, 'eur'::text, 'iqd'::text, 'try'::text])
    AND base_currency <> quote_currency
  ),
  CONSTRAINT sales_exchange_amount_check CHECK (
    base_amount > 0 AND quote_amount > 0
  ),
  CONSTRAINT sales_exchange_side_check CHECK (
    rate_side = ANY (ARRAY['buy'::text, 'sell'::text, 'mid'::text])
  ),
  CONSTRAINT sales_exchange_sale_fk
    FOREIGN KEY (sale_id, workspace_id)
    REFERENCES public.sales (id, workspace_id)
    ON DELETE CASCADE,
  PRIMARY KEY (id)
);
