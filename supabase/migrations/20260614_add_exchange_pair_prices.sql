CREATE TABLE IF NOT EXISTS fx.exchange_pair_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  buy_price numeric NOT NULL DEFAULT 0,
  sell_price numeric NOT NULL DEFAULT 0,
  price_basis_amount numeric NOT NULL DEFAULT 100,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT exchange_pair_prices_currency_check CHECK (
    base_currency IN ('usd', 'eur', 'iqd', 'try')
    AND quote_currency IN ('usd', 'eur', 'iqd', 'try')
    AND base_currency <> quote_currency
  ),
  CONSTRAINT exchange_pair_prices_price_check CHECK (buy_price >= 0 AND sell_price >= 0),
  CONSTRAINT exchange_pair_prices_basis_check CHECK (price_basis_amount > 0),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_pair_prices_workspace_pair_active
  ON fx.exchange_pair_prices (workspace_id, base_currency, quote_currency)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_exchange_pair_prices_workspace_updated
  ON fx.exchange_pair_prices (workspace_id, updated_at DESC)
  WHERE is_deleted = false;

ALTER TABLE fx.exchange_pair_prices ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fx.can_manage_exchange_pair_prices(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, fx
AS $function$
  SELECT public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.workspace_permissions wp
      WHERE wp.workspace_id = p_workspace_id
        AND wp.user_uuid = auth.uid()
        AND wp.key = 'currencyExchange.managePrices'
    );
$function$;

DROP POLICY IF EXISTS exchange_pair_prices_select ON fx.exchange_pair_prices;
CREATE POLICY exchange_pair_prices_select
  ON fx.exchange_pair_prices
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS exchange_pair_prices_insert ON fx.exchange_pair_prices;
CREATE POLICY exchange_pair_prices_insert
  ON fx.exchange_pair_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND fx.can_manage_exchange_pair_prices(workspace_id)
  );

DROP POLICY IF EXISTS exchange_pair_prices_update ON fx.exchange_pair_prices;
CREATE POLICY exchange_pair_prices_update
  ON fx.exchange_pair_prices
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND fx.can_manage_exchange_pair_prices(workspace_id)
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND fx.can_manage_exchange_pair_prices(workspace_id)
  );

DROP POLICY IF EXISTS exchange_pair_prices_delete ON fx.exchange_pair_prices;
CREATE POLICY exchange_pair_prices_delete
  ON fx.exchange_pair_prices
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND fx.can_manage_exchange_pair_prices(workspace_id)
  );

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON fx.exchange_pair_prices;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON fx.exchange_pair_prices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('currency_exchange');

CREATE OR REPLACE FUNCTION fx.enforce_exchange_currency_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, fx
AS $function$
DECLARE
  v_workspace_id uuid;
  v_plan text;
  v_currency text;
BEGIN
  v_workspace_id := nullif(to_jsonb(NEW)->>'workspace_id', '')::uuid;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = v_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH v_currency IN ARRAY ARRAY[
    lower(nullif(to_jsonb(NEW)->>'from_currency', '')),
    lower(nullif(to_jsonb(NEW)->>'to_currency', '')),
    lower(nullif(to_jsonb(NEW)->>'fee_currency', '')),
    lower(nullif(to_jsonb(NEW)->>'currency', '')),
    lower(nullif(to_jsonb(NEW)->>'base_currency', '')),
    lower(nullif(to_jsonb(NEW)->>'quote_currency', ''))
  ]
  LOOP
    IF v_currency IS NOT NULL AND NOT public.workspace_currency_allowed(v_workspace_id, v_plan, v_currency) THEN
      RAISE EXCEPTION 'Currency % is not included in the current workspace plan', v_currency
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_exchange_currency_access ON fx.exchange_pair_prices;
CREATE TRIGGER enforce_exchange_currency_access
  BEFORE INSERT OR UPDATE ON fx.exchange_pair_prices
  FOR EACH ROW EXECUTE FUNCTION fx.enforce_exchange_currency_access();

GRANT SELECT, INSERT, UPDATE, DELETE ON fx.exchange_pair_prices TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fx.can_manage_exchange_pair_prices(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fx.enforce_exchange_currency_access() TO authenticated, service_role;
