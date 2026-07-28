-- Workspace-wide POS currency conversion policy. The setting is controlled by
-- workspace admins through the existing workspaces RLS policy.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS pos_convert_to_workspace_currency boolean NOT NULL DEFAULT true;

-- Preserve the policy that was effective at checkout for auditability.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS currency_conversion_applied boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.capture_pos_currency_conversion_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_conversion_enabled boolean;
  v_workspace_currency text;
BEGIN
  -- Activities, orders, and other modules have their own checkout policies.
  IF COALESCE(NEW.origin, 'pos') <> 'pos' THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(pos_convert_to_workspace_currency, true),
    lower(default_currency::text)
  INTO v_conversion_enabled, v_workspace_currency
  FROM public.workspaces
  WHERE id = NEW.workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found for POS sale';
  END IF;

  IF v_conversion_enabled
    AND lower(COALESCE(NEW.settlement_currency, '')) <> v_workspace_currency THEN
    RAISE EXCEPTION 'POS sales must use the workspace currency while currency conversion is enabled';
  END IF;

  -- Do not trust a client payload to decide the audit value.
  NEW.currency_conversion_applied := v_conversion_enabled;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS capture_pos_currency_conversion_policy_on_sales ON public.sales;
CREATE TRIGGER capture_pos_currency_conversion_policy_on_sales
BEFORE INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.capture_pos_currency_conversion_policy();

CREATE OR REPLACE FUNCTION public.enforce_pos_sale_item_currency_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_origin text;
  v_conversion_applied boolean;
  v_settlement_currency text;
BEGIN
  SELECT
    origin,
    currency_conversion_applied,
    lower(settlement_currency)
  INTO v_origin, v_conversion_applied, v_settlement_currency
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found for sale item';
  END IF;

  IF COALESCE(v_origin, 'pos') = 'pos'
    AND NOT COALESCE(v_conversion_applied, true)
    AND (
      lower(COALESCE(NEW.original_currency, '')) <> v_settlement_currency
      OR lower(COALESCE(NEW.settlement_currency, '')) <> v_settlement_currency
    ) THEN
    RAISE EXCEPTION 'Currency conversion is disabled: all POS sale items must use the sale currency';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_pos_sale_item_currency_policy_on_sale_items ON public.sale_items;
CREATE TRIGGER enforce_pos_sale_item_currency_policy_on_sale_items
BEFORE INSERT ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_pos_sale_item_currency_policy();

CREATE OR REPLACE FUNCTION public.enforce_pos_sales_exchange_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_origin text;
  v_conversion_applied boolean;
BEGIN
  SELECT origin, currency_conversion_applied
  INTO v_origin, v_conversion_applied
  FROM public.sales
  WHERE id = NEW.sale_id
    AND workspace_id = NEW.workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found for sales exchange snapshot';
  END IF;

  IF COALESCE(v_origin, 'pos') = 'pos'
    AND NOT COALESCE(v_conversion_applied, true) THEN
    RAISE EXCEPTION 'Currency conversion is disabled for this workspace; exchange snapshots are not allowed';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_pos_sales_exchange_policy_on_sales_exchange ON public.sales_exchange;
CREATE TRIGGER enforce_pos_sales_exchange_policy_on_sales_exchange
BEFORE INSERT ON public.sales_exchange
FOR EACH ROW
EXECUTE FUNCTION public.enforce_pos_sales_exchange_policy();

GRANT EXECUTE ON FUNCTION public.capture_pos_currency_conversion_policy() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_pos_sale_item_currency_policy() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_pos_sales_exchange_policy() TO authenticated, service_role;
