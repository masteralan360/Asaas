CREATE OR REPLACE FUNCTION public.delete_demo_cascade(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, budget, notifications
AS $function$
DECLARE
  v_workspace_record public.workspaces%ROWTYPE;
  v_table record;
  v_managed_tables text[] := ARRAY[
    'public.payment_transactions',
    'public.loan_payments',
    'public.loan_installments',
    'notifications.events',
    'notifications.device_tokens',
    'budget.payroll_statuses',
    'budget.dividend_statuses',
    'budget.expense_items',
    'budget.expense_series',
    'budget.budget_allocations',
    'budget.budget_settings',
    'public.marketplace_orders',
    'public.marketplace_order_counters',
    'public.invoices',
    'public.inventory_transfer_transactions',
    'public.reorder_transfer_rules',
    'public.inventory',
    'public.product_discounts',
    'public.category_discounts',
    'crm.sales_orders',
    'crm.purchase_orders',
    'crm.travel_agency_sales',
    'crm.business_partner_merge_candidates',
    'crm.customers',
    'crm.suppliers',
    'crm.business_partners',
    'public.employees',
    'public.workspace_contacts',
    'public.loans',
    'public.sales',
    'public.products',
    'public.categories',
    'public.storages',
    'public.clinical_presets',
    'public.clinical_appointments',
    'public.clinical_patients',
    'public.fx_transactions',
    'public.fx_safes',
    'public.fx_profit_snapshots',
    'public.fx_fee_rules',
    'public.fx_exchange_pair_prices',
    'public.real_estate_deals',
    'public.real_estate_parties',
    'public.real_estate_installment_schedules',
    'public.real_estate_witnesses',
    'public.real_estate_mediator_cashflows',
    'public.custom_templates',
    'public.custom_template_labels',
    'public.workspace_permissions',
    'public.workspace_access_overrides',
    'public.product_barcodes'
  ];
  v_table_name text;
BEGIN
  SELECT *
  INTO v_workspace_record
  FROM public.workspaces
  WHERE id = p_workspace_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found: %', p_workspace_id;
  END IF;

  -- sale_items is special: it uses sale_id instead of workspace_id
  BEGIN
    DELETE FROM public.sale_items si
    USING public.sales s
    WHERE si.sale_id = s.id
      AND s.workspace_id = p_workspace_id;
  EXCEPTION WHEN undefined_table THEN
    -- skip if table doesn't exist
  END;

  -- Delete from all managed tables (those that need special handling like sale_items, or have workspace_id column)
  FOREACH v_table_name IN ARRAY v_managed_tables LOOP
    BEGIN
      EXECUTE format('DELETE FROM %s WHERE workspace_id = $1', v_table_name) USING p_workspace_id;
    EXCEPTION WHEN undefined_table THEN
      -- skip if the table doesn't exist in this project
    END;
  END LOOP;

  -- workspace_branches is special: uses source_workspace_id OR branch_workspace_id
  BEGIN
    DELETE FROM public.workspace_branches
    WHERE source_workspace_id = p_workspace_id OR branch_workspace_id = p_workspace_id;
  EXCEPTION WHEN undefined_table THEN
    -- skip if table doesn't exist
  END;

  -- Dynamically delete from any other table with a workspace_id column not yet covered
  FOR v_table IN
    SELECT DISTINCT
      c.table_schema,
      c.table_name
    FROM information_schema.columns c
    WHERE c.column_name = 'workspace_id'
      AND c.table_schema IN ('public', 'crm', 'budget', 'notifications')
      AND (c.table_schema || '.' || c.table_name) <> ALL (
        ARRAY['public.workspaces', 'public.profiles'] || v_managed_tables
      )
  LOOP
    BEGIN
      EXECUTE format(
        'DELETE FROM %I.%I WHERE workspace_id = $1',
        v_table.table_schema,
        v_table.table_name
      )
      USING p_workspace_id;
    EXCEPTION WHEN undefined_table THEN
      -- skip if table doesn't exist
    END;
  END LOOP;

  DELETE FROM public.profiles
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.workspaces
  WHERE id = p_workspace_id;

  RETURN jsonb_build_object(
    'success', true,
    'workspace_id', p_workspace_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_demo_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_demo_cascade(uuid) TO service_role;
