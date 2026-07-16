CREATE OR REPLACE FUNCTION public.admin_list_workspace_payment_configurations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'workspace_id', workspace_row.id,
        'workspace_name', workspace_row.name,
        'workspace_code', workspace_row.code,
        'billing_workspace_id', public.workspace_usage_owner_id(workspace_row.id),
        'is_branch', (branch_row.branch_workspace_id IS NOT NULL),
        'source_workspace_id', branch_row.source_workspace_id,
        'id', configuration_row.id,
        'subscription_amount', configuration_row.subscription_amount::text,
        'currency', configuration_row.currency,
        'is_payment_enabled', configuration_row.is_payment_enabled,
        'usage_enabled', configuration_row.usage_enabled,
        'gb_per_payment', configuration_row.gb_per_payment::text,
        'renewal_due_at', configuration_row.renewal_due_at,
        'usage_start_date', configuration_row.usage_start_date,
        'created_at', configuration_row.created_at,
        'updated_at', configuration_row.updated_at
      )
      ORDER BY
        CASE WHEN branch_row.source_workspace_id IS NULL THEN workspace_row.created_at ELSE source_workspace_row.created_at END DESC NULLS LAST,
        CASE WHEN branch_row.source_workspace_id IS NULL THEN 0 ELSE 1 END,
        workspace_row.created_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.workspaces AS workspace_row
  LEFT JOIN billing.workspace_payment_configurations AS configuration_row
    ON configuration_row.workspace_id = workspace_row.id
  LEFT JOIN public.workspace_branches AS branch_row
    ON branch_row.branch_workspace_id = workspace_row.id
  LEFT JOIN public.workspaces AS source_workspace_row
    ON source_workspace_row.id = branch_row.source_workspace_id
  WHERE workspace_row.deleted_at IS NULL;

  RETURN v_result;
END;
$function$;
