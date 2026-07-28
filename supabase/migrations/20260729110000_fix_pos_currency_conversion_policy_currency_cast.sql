-- Some existing databases use the currency_code enum for default_currency.
-- Cast it before passing it to lower(), which only accepts text.
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
