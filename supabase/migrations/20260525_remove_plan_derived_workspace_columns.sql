-- Remove plan-derived boolean columns from workspaces table.
-- These features are now determined entirely by workspace plan via
-- workspace_plan_has_module() / workspace_plan_has_capability() in the frontend.
-- User-toggleable columns (instant_pos, kds_enabled) are preserved.

ALTER TABLE public.workspaces
  DROP COLUMN pos,
  DROP COLUMN sales_history,
  DROP COLUMN crm,
  DROP COLUMN ecommerce,
  DROP COLUMN loans,
  DROP COLUMN net_revenue,
  DROP COLUMN budget,
  DROP COLUMN monthly_comparison,
  DROP COLUMN team_performance,
  DROP COLUMN products,
  DROP COLUMN discounts,
  DROP COLUMN storages,
  DROP COLUMN inventory_transfer,
  DROP COLUMN stock_adjustments,
  DROP COLUMN invoices_history,
  DROP COLUMN hr;

CREATE OR REPLACE FUNCTION public.apply_workspace_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_member_count integer;
  v_branch_count integer;
  v_contact_count integer;
  v_max_contacts integer;
BEGIN
  NEW.plan := public.normalize_workspace_plan(NEW.plan);

  IF TG_OP = 'UPDATE' AND NEW.plan IS DISTINCT FROM OLD.plan THEN
    SELECT count(*) INTO v_member_count
    FROM public.profiles
    WHERE workspace_id = NEW.id;

    IF v_member_count > public.workspace_plan_max_members(NEW.plan) THEN
      RAISE EXCEPTION 'Workspace member count exceeds the % plan limit', NEW.plan
        USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_branch_count
    FROM public.workspace_branches
    WHERE source_workspace_id = NEW.id;

    IF v_branch_count > public.workspace_plan_max_branches(NEW.plan) THEN
      RAISE EXCEPTION 'Workspace branch count exceeds the % plan limit', NEW.plan
        USING ERRCODE = '42501';
    END IF;

    v_max_contacts := public.workspace_plan_max_contacts(NEW.plan);
    IF v_max_contacts IS NOT NULL THEN
      SELECT count(*) INTO v_contact_count
      FROM public.workspace_contacts
      WHERE workspace_id = NEW.id;

      IF v_contact_count > v_max_contacts THEN
        RAISE EXCEPTION 'Workspace contact count exceeds the % plan limit', NEW.plan
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  NEW.instant_pos := COALESCE(NEW.instant_pos, true);
  NEW.members := true;

  NEW.real_estate := false;

  IF NOT public.workspace_plan_allows_currency(NEW.plan, NEW.default_currency::text) THEN
    NEW.default_currency := 'usd';
  END IF;

  NEW.eur_conversion_enabled := public.workspace_plan_has_capability(NEW.plan, 'multiCurrency');
  NEW.try_conversion_enabled := public.workspace_plan_has_capability(NEW.plan, 'multiCurrency');
  NEW.allow_whatsapp := public.workspace_plan_has_capability(NEW.plan, 'whatsappIntegration');
  NEW.kds_enabled := public.workspace_plan_has_capability(NEW.plan, 'kds')
    AND COALESCE(NEW.instant_pos, true)
    AND COALESCE(NEW.kds_enabled, true);
  NEW.upload_limit_mb := CASE public.normalize_workspace_plan(NEW.plan)
    WHEN 'enterprise' THEN 1024
    WHEN 'business' THEN 100
    ELSE NULL
  END;

  IF NOT public.workspace_plan_has_capability(NEW.plan, 'marketplaceStorefronts') THEN
    NEW.visibility := 'private';
    NEW.store_slug := NULL;
    NEW.store_description := NULL;
  END IF;

  IF NOT public.workspace_plan_has_capability(NEW.plan, 'a4PdfInvoices') THEN
    NEW.print_quality := 'low';
  END IF;

  RETURN NEW;
END;
$function$;
