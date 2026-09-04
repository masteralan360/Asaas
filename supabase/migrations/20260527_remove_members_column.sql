-- Drop members column from workspaces (always-on feature derived from plan).
-- Remove NEW.members assignment from trigger since column no longer exists.

ALTER TABLE public.workspaces
  DROP COLUMN IF EXISTS members;

CREATE OR REPLACE FUNCTION public.apply_workspace_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.instant_pos := COALESCE(NEW.instant_pos, true);
  NEW.real_estate := false;

  IF NOT public.workspace_plan_allows_currency(NEW.plan::text, NEW.default_currency::text) THEN
    NEW.default_currency := 'usd';
  END IF;

  NEW.eur_conversion_enabled := public.workspace_plan_has_capability(NEW.plan::text, 'multiCurrency');
  NEW.try_conversion_enabled := public.workspace_plan_has_capability(NEW.plan::text, 'multiCurrency');
  NEW.allow_whatsapp := public.workspace_plan_has_capability(NEW.plan::text, 'whatsappIntegration');
  NEW.kds_enabled := public.workspace_plan_has_capability(NEW.plan::text, 'kds')
    AND COALESCE(NEW.instant_pos, true)
    AND COALESCE(NEW.kds_enabled, true);
  NEW.upload_limit_mb := CASE public.normalize_workspace_plan(NEW.plan::text)
    WHEN 'enterprise' THEN 1024
    WHEN 'business' THEN 100
    ELSE NULL
  END;

  IF NOT public.workspace_plan_has_capability(NEW.plan::text, 'marketplaceStorefronts') THEN
    NEW.visibility := 'private';
    NEW.store_slug := NULL;
    NEW.store_description := NULL;
  END IF;

  IF NOT public.workspace_plan_has_capability(NEW.plan::text, 'a4PdfInvoices') THEN
    NEW.print_quality := 'low';
  END IF;

  RETURN NEW;
END;
$function$;
