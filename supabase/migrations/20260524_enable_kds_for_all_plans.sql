CREATE OR REPLACE FUNCTION public.workspace_plan_has_capability(p_plan text, p_capability text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_capability, ''))
    WHEN 'receiptprinting' THEN true
    WHEN 'a4pdfinvoices' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'pdfinvoicegeneration' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'barcodescanner' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'thermalprinter' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'multipleworkspacecontacts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'marketplaceinquiries' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'marketplacestorefronts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'loaninstallmentinvoices' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'multicurrency' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'excelexportsales' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'excelexportledger' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'excelexportrevenue' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'workspacestorageuploads' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'workspacepdfuploads' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'workspaceimageuploads' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'workspaceaudiouploads' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'workspacemanagementpermissions' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsappintegration' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsappsharing' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'stockbatches' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'kds' THEN true
    ELSE false
  END;
$function$;

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

  NEW.pos := true;
  NEW.instant_pos := COALESCE(NEW.instant_pos, true);
  NEW.sales_history := true;
  NEW.products := true;
  NEW.storages := true;
  NEW.inventory_transfer := true;
  NEW.stock_adjustments := true;
  NEW.members := true;

  NEW.crm := public.workspace_plan_has_module(NEW.plan, 'customers');
  NEW.ecommerce := public.workspace_plan_has_module(NEW.plan, 'ecommerce');
  NEW.travel_agency := false;
  NEW.real_estate := false;
  NEW.loans := public.workspace_plan_has_module(NEW.plan, 'loans');
  NEW.net_revenue := public.workspace_plan_has_module(NEW.plan, 'revenue_analytics');
  NEW.budget := public.workspace_plan_has_module(NEW.plan, 'accounting');
  NEW.monthly_comparison := false;
  NEW.team_performance := public.workspace_plan_has_module(NEW.plan, 'team_performance');
  NEW.discounts := public.workspace_plan_has_module(NEW.plan, 'discounts');
  NEW.invoices_history := public.workspace_plan_has_module(NEW.plan, 'invoice_history');
  NEW.hr := public.workspace_plan_has_module(NEW.plan, 'hr');

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

UPDATE public.workspaces SET kds_enabled = true WHERE NOT kds_enabled;
UPDATE public.workspaces SET kds_enabled = false WHERE NOT instant_pos AND kds_enabled;
