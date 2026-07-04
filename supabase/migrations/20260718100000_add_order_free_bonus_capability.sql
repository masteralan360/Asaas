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
    WHEN 'orderfreebonus' THEN false
    WHEN 'kds' THEN true
    ELSE false
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.workspace_plan_has_capability(text, text) TO authenticated, service_role;
