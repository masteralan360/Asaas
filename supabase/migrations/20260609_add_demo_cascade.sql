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
    'public.sale_items',
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
    'public.product_barcodes',
    'public.workspace_branches'
  ];
BEGIN
  SELECT *
  INTO v_workspace_record
  FROM public.workspaces
  WHERE id = p_workspace_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found: %', p_workspace_id;
  END IF;

  DELETE FROM public.sale_items si
  USING public.sales s
  WHERE si.sale_id = s.id
    AND s.workspace_id = p_workspace_id;

  DELETE FROM public.payment_transactions
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.loan_payments
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.loan_installments
  WHERE workspace_id = p_workspace_id;

  DELETE FROM notifications.events
  WHERE workspace_id = p_workspace_id;

  DELETE FROM notifications.device_tokens
  WHERE workspace_id = p_workspace_id;

  DELETE FROM budget.payroll_statuses
  WHERE workspace_id = p_workspace_id;

  DELETE FROM budget.dividend_statuses
  WHERE workspace_id = p_workspace_id;

  DELETE FROM budget.expense_items
  WHERE workspace_id = p_workspace_id;

  DELETE FROM budget.expense_series
  WHERE workspace_id = p_workspace_id;

  DELETE FROM budget.budget_allocations
  WHERE workspace_id = p_workspace_id;

  DELETE FROM budget.budget_settings
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.marketplace_orders
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.marketplace_order_counters
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.invoices
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.inventory_transfer_transactions
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.reorder_transfer_rules
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.inventory
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.product_discounts
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.category_discounts
  WHERE workspace_id = p_workspace_id;

  DELETE FROM crm.sales_orders
  WHERE workspace_id = p_workspace_id;

  DELETE FROM crm.purchase_orders
  WHERE workspace_id = p_workspace_id;

  DELETE FROM crm.travel_agency_sales
  WHERE workspace_id = p_workspace_id;

  DELETE FROM crm.business_partner_merge_candidates
  WHERE workspace_id = p_workspace_id;

  DELETE FROM crm.customers
  WHERE workspace_id = p_workspace_id;

  DELETE FROM crm.suppliers
  WHERE workspace_id = p_workspace_id;

  DELETE FROM crm.business_partners
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.employees
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.workspace_contacts
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.loans
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.sales
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.products
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.categories
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.storages
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.clinical_presets
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.clinical_appointments
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.clinical_patients
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.fx_transactions
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.fx_safes
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.fx_profit_snapshots
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.fx_fee_rules
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.fx_exchange_pair_prices
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.real_estate_deals
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.real_estate_parties
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.real_estate_installment_schedules
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.real_estate_witnesses
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.real_estate_mediator_cashflows
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.custom_templates
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.custom_template_labels
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.workspace_permissions
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.workspace_access_overrides
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.product_barcodes
  WHERE workspace_id = p_workspace_id;

  DELETE FROM public.workspace_branches
  WHERE source_workspace_id = p_workspace_id OR branch_workspace_id = p_workspace_id;

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
    EXECUTE format(
      'DELETE FROM %I.%I WHERE workspace_id = $1',
      v_table.table_schema,
      v_table.table_name
    )
    USING p_workspace_id;
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
