-- Allow upload_limit_mb, real_estate, allow_whatsapp to be
-- edited directly in Supabase Dashboard despite the plan. They are only
-- reset to plan defaults when the plan column changes (or on INSERT).

CREATE OR REPLACE FUNCTION public.apply_workspace_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.instant_pos := COALESCE(NEW.instant_pos, true);

  IF TG_OP = 'INSERT' OR NEW.plan::text IS DISTINCT FROM OLD.plan::text THEN
    NEW.real_estate := false;
    NEW.allow_whatsapp := public.workspace_plan_has_capability(NEW.plan::text, 'whatsappIntegration');
    NEW.upload_limit_mb := CASE public.normalize_workspace_plan(NEW.plan::text)
      WHEN 'enterprise' THEN 1024
      WHEN 'business' THEN 100
      ELSE NULL
    END;
  END IF;

  IF NOT public.workspace_plan_allows_currency(NEW.plan::text, NEW.default_currency::text) THEN
    NEW.default_currency := 'usd';
  END IF;

  NEW.eur_conversion_enabled := public.workspace_plan_has_capability(NEW.plan::text, 'multiCurrency');
  NEW.try_conversion_enabled := public.workspace_plan_has_capability(NEW.plan::text, 'multiCurrency');
  NEW.kds_enabled := public.workspace_plan_has_capability(NEW.plan::text, 'kds')
    AND COALESCE(NEW.instant_pos, true)
    AND COALESCE(NEW.kds_enabled, true);

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
