ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS plan text;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS pos boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS instant_pos boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS sales_history boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS crm boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS loans boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS net_revenue boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS budget boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS monthly_comparison boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS team_performance boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS products boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS discounts boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS storages boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS inventory_transfer boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS stock_adjustments boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoices_history boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS hr boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS members boolean DEFAULT true;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS file_mime_type text;

UPDATE public.workspaces
SET plan = 'enterprise'
WHERE plan IS NULL;

ALTER TABLE public.workspaces
  ALTER COLUMN plan SET DEFAULT 'basic',
  ALTER COLUMN plan SET NOT NULL;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_plan_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_plan_check
  CHECK (plan IN ('basic', 'business', 'enterprise'));

CREATE OR REPLACE FUNCTION public.normalize_workspace_plan(p_plan text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN lower(coalesce(p_plan, '')) IN ('basic', 'business', 'enterprise')
      THEN lower(p_plan)
    ELSE 'basic'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_plan_has_module(p_plan text, p_module text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_module, ''))
    WHEN 'pos' THEN true
    WHEN 'instant_pos' THEN true
    WHEN 'sales_history' THEN true
    WHEN 'products' THEN true
    WHEN 'storages' THEN true
    WHEN 'inventory_transfer' THEN true
    WHEN 'inventory_transactions' THEN true
    WHEN 'stock_adjustments' THEN true
    WHEN 'ledger' THEN true
    WHEN 'payments' THEN true
    WHEN 'direct_transactions' THEN true
    WHEN 'members' THEN true
    WHEN 'business_partners' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'customers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'suppliers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'orders' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'ecommerce' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'loans' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'installments' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'discounts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'revenue_analytics' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'team_performance' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'invoice_history' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'accounting' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'hr' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'expenses' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'payroll' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsapp' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    ELSE false
  END;
$function$;

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
    WHEN 'kds' THEN false
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_plan_max_members(p_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE public.normalize_workspace_plan(p_plan)
    WHEN 'enterprise' THEN 20
    WHEN 'business' THEN 10
    ELSE 3
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_plan_max_branches(p_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE public.normalize_workspace_plan(p_plan)
    WHEN 'enterprise' THEN 5
    WHEN 'business' THEN 2
    ELSE 0
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_plan_max_contacts(p_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE public.normalize_workspace_plan(p_plan)
    WHEN 'basic' THEN 1
    ELSE NULL::integer
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_plan_max_upload_bytes(p_plan text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE public.normalize_workspace_plan(p_plan)
    WHEN 'enterprise' THEN 1073741824::bigint
    WHEN 'business' THEN 104857600::bigint
    ELSE 0::bigint
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_plan_allows_upload_mime(p_plan text, p_mime text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE public.normalize_workspace_plan(p_plan)
    WHEN 'enterprise' THEN lower(coalesce(p_mime, '')) IN ('application/pdf', 'image/png', 'image/jpeg', 'audio/mpeg')
    WHEN 'business' THEN lower(coalesce(p_mime, '')) = 'application/pdf'
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_plan_allows_currency(p_plan text, p_currency text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE public.normalize_workspace_plan(p_plan)
    WHEN 'basic' THEN lower(coalesce(p_currency, '')) = 'usd'
    ELSE lower(coalesce(p_currency, '')) IN ('iqd', 'usd', 'eur', 'try')
  END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_workspace_upload_mime(p_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN lower(coalesce(p_path, '')) LIKE '%.pdf' THEN 'application/pdf'
    WHEN lower(coalesce(p_path, '')) LIKE '%.png' THEN 'image/png'
    WHEN lower(coalesce(p_path, '')) LIKE '%.jpg' THEN 'image/jpeg'
    WHEN lower(coalesce(p_path, '')) LIKE '%.jpeg' THEN 'image/jpeg'
    WHEN lower(coalesce(p_path, '')) LIKE '%.mp3' THEN 'audio/mpeg'
    ELSE NULL
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
  NEW.instant_pos := true;
  NEW.sales_history := true;
  NEW.products := true;
  NEW.storages := true;
  NEW.inventory_transfer := true;
  NEW.stock_adjustments := true;
  NEW.members := true;

  NEW.crm := public.workspace_plan_has_module(NEW.plan, 'customers');
  NEW.ecommerce := public.workspace_plan_has_module(NEW.plan, 'ecommerce');
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
  NEW.kds_enabled := false;
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

DROP TRIGGER IF EXISTS apply_workspace_plan_access_on_workspaces ON public.workspaces;

CREATE TRIGGER apply_workspace_plan_access_on_workspaces
BEFORE INSERT OR UPDATE ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.apply_workspace_plan_access();

UPDATE public.workspaces
SET plan = plan;

CREATE OR REPLACE FUNCTION public.enforce_workspace_member_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
  v_member_count integer;
BEGIN
  IF NEW.workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_member_count
  FROM public.profiles
  WHERE workspace_id = NEW.workspace_id
    AND id IS DISTINCT FROM NEW.id;

  IF v_member_count >= public.workspace_plan_max_members(v_plan) THEN
    RAISE EXCEPTION 'Workspace member limit reached for current plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_member_plan_limit_on_profiles ON public.profiles;

CREATE TRIGGER enforce_workspace_member_plan_limit_on_profiles
BEFORE INSERT OR UPDATE OF workspace_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_member_plan_limit();

CREATE OR REPLACE FUNCTION public.enforce_workspace_branch_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
  v_branch_count integer;
BEGIN
  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.source_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.workspace_plan_max_branches(v_plan) <= 0 THEN
    RAISE EXCEPTION 'Branches are not included in the current workspace plan'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_branch_count
  FROM public.workspace_branches
  WHERE source_workspace_id = NEW.source_workspace_id
    AND (TG_OP <> 'UPDATE' OR id IS DISTINCT FROM OLD.id);

  IF v_branch_count >= public.workspace_plan_max_branches(v_plan) THEN
    RAISE EXCEPTION 'Workspace branch limit reached for current plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_branch_plan_limit_on_workspace_branches ON public.workspace_branches;

CREATE TRIGGER enforce_workspace_branch_plan_limit_on_workspace_branches
BEFORE INSERT OR UPDATE OF source_workspace_id ON public.workspace_branches
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_branch_plan_limit();

CREATE OR REPLACE FUNCTION public.enforce_workspace_contact_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
  v_contact_count integer;
  v_max_contacts integer;
BEGIN
  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  v_max_contacts := public.workspace_plan_max_contacts(v_plan);
  IF v_max_contacts IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.is_primary := true;

  SELECT count(*) INTO v_contact_count
  FROM public.workspace_contacts
  WHERE workspace_id = NEW.workspace_id
    AND (TG_OP <> 'UPDATE' OR id IS DISTINCT FROM OLD.id);

  IF v_contact_count >= v_max_contacts THEN
    RAISE EXCEPTION 'Workspace contact limit reached for current plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_contact_plan_limit_on_workspace_contacts ON public.workspace_contacts;

CREATE TRIGGER enforce_workspace_contact_plan_limit_on_workspace_contacts
BEFORE INSERT OR UPDATE OF workspace_id, is_primary ON public.workspace_contacts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_contact_plan_limit();

CREATE OR REPLACE FUNCTION public.enforce_workspace_invoice_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
  v_is_upload boolean;
  v_upload_mime text;
  v_upload_limit bigint;
BEGIN
  IF NEW.workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.settlement_currency IS NOT NULL
    AND NOT public.workspace_plan_allows_currency(v_plan, NEW.settlement_currency::text) THEN
    RAISE EXCEPTION 'Currency % is not included in the current workspace plan', NEW.settlement_currency
      USING ERRCODE = '42501';
  END IF;

  v_is_upload :=
    lower(coalesce(NEW.origin, '')) = 'upload'
    OR coalesce(NEW.r2_path_a4, '') LIKE '%/uploads/%'
    OR coalesce(NEW.r2_path_receipt, '') LIKE '%/uploads/%';

  IF v_is_upload THEN
    v_upload_limit := public.workspace_plan_max_upload_bytes(v_plan);
    v_upload_mime := coalesce(
      nullif(lower(NEW.file_mime_type), ''),
      public.detect_workspace_upload_mime(NEW.r2_path_a4),
      public.detect_workspace_upload_mime(NEW.r2_path_receipt)
    );

    IF v_upload_limit <= 0 THEN
      RAISE EXCEPTION 'Workspace uploads are not included in the current plan'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.file_size IS NULL OR NEW.file_size <= 0 OR NEW.file_size > v_upload_limit THEN
      RAISE EXCEPTION 'Upload size exceeds the current workspace plan limit'
        USING ERRCODE = '42501';
    END IF;

    IF NOT public.workspace_plan_allows_upload_mime(v_plan, v_upload_mime) THEN
      RAISE EXCEPTION 'Upload file type is not included in the current workspace plan'
        USING ERRCODE = '42501';
    END IF;

    NEW.file_mime_type := v_upload_mime;
  END IF;

  IF NOT v_is_upload
    AND lower(coalesce(NEW.print_format, '')) = 'a4'
    AND NOT public.workspace_plan_has_capability(v_plan, 'a4PdfInvoices') THEN
    RAISE EXCEPTION 'A4 invoice generation is not included in the current workspace plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_invoice_plan_access_on_invoices ON public.invoices;

CREATE TRIGGER enforce_workspace_invoice_plan_access_on_invoices
BEFORE INSERT OR UPDATE OF workspace_id, origin, print_format, settlement_currency, r2_path_a4, r2_path_receipt, file_size, file_mime_type
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_invoice_plan_access();

CREATE OR REPLACE FUNCTION public.enforce_workspace_currency_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid;
  v_plan text;
  v_currency text;
BEGIN
  v_workspace_id := nullif(to_jsonb(NEW)->>'workspace_id', '')::uuid;
  v_currency := lower(coalesce(
    nullif(to_jsonb(NEW)->>'settlement_currency', ''),
    nullif(to_jsonb(NEW)->>'currency', '')
  ));

  IF v_workspace_id IS NULL OR v_currency IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = v_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NOT NULL AND NOT public.workspace_plan_allows_currency(v_plan, v_currency) THEN
    RAISE EXCEPTION 'Currency % is not included in the current workspace plan', v_currency
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_module_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid;
  v_plan text;
  v_module text;
BEGIN
  v_workspace_id := nullif(to_jsonb(NEW)->>'workspace_id', '')::uuid;
  v_module := TG_ARGV[0];

  IF v_workspace_id IS NULL OR v_module IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = v_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NOT NULL AND NOT public.workspace_plan_has_module(v_plan, v_module) THEN
    RAISE EXCEPTION 'Module % is not included in the current workspace plan', v_module
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.products',
    'public.sales',
    'public.sale_items',
    'public.invoices',
    'public.loans',
    'public.loan_payments',
    'public.payment_transactions',
    'crm.sales_orders',
    'crm.purchase_orders',
    'public.stock_batches',
    'public.real_estate_transactions',
    'public.marketplace_orders'
  ]
  LOOP
    IF to_regclass(v_table) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = to_regclass(v_table)
          AND attname = 'workspace_id'
          AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = to_regclass(v_table)
          AND attname IN ('currency', 'settlement_currency')
          AND NOT attisdropped
      ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS enforce_workspace_currency_plan_access ON %s', v_table);
      EXECUTE format(
        'CREATE TRIGGER enforce_workspace_currency_plan_access BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_currency_plan_access()',
        v_table
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  v_table text;
  v_module text;
BEGIN
  FOR v_table, v_module IN
    SELECT *
    FROM (VALUES
      ('crm.customers', 'customers'),
      ('crm.suppliers', 'suppliers'),
      ('crm.business_partners', 'business_partners'),
      ('crm.sales_orders', 'orders'),
      ('crm.purchase_orders', 'orders'),
      ('public.marketplace_orders', 'ecommerce'),
      ('public.loans', 'loans'),
      ('public.loan_installments', 'installments'),
      ('public.product_discounts', 'discounts'),
      ('public.category_discounts', 'discounts'),
      ('public.employees', 'hr'),
      ('budget.budget_settings', 'accounting'),
      ('budget.budget_allocations', 'accounting'),
      ('budget.expense_items', 'expenses'),
      ('budget.expense_series', 'expenses'),
      ('budget.payroll_statuses', 'payroll'),
      ('budget.dividend_statuses', 'payroll')
    ) AS module_tables(table_name, module_name)
  LOOP
    IF to_regclass(v_table) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = to_regclass(v_table)
          AND attname = 'workspace_id'
          AND NOT attisdropped
      ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON %s', v_table);
      EXECUTE format(
        'CREATE TRIGGER enforce_workspace_module_plan_access BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access(%L)',
        v_table,
        v_module
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_permissions_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
BEGIN
  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL OR NOT public.workspace_plan_has_capability(v_plan, 'workspaceManagementPermissions') THEN
    RAISE EXCEPTION 'Workspace management permissions are not included in the current workspace plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_permissions_plan_access_on_workspace_permissions ON public.workspace_permissions;

CREATE TRIGGER enforce_workspace_permissions_plan_access_on_workspace_permissions
BEFORE INSERT OR UPDATE ON public.workspace_permissions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_permissions_plan_access();

DROP POLICY IF EXISTS workspace_permissions_select ON public.workspace_permissions;
CREATE POLICY workspace_permissions_select
  ON public.workspace_permissions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND (
      user_uuid = auth.uid()
      OR public.current_user_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS workspace_permissions_insert ON public.workspace_permissions;
CREATE POLICY workspace_permissions_insert
  ON public.workspace_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND module = split_part(key, '.', 1)
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = workspace_permissions.user_uuid
        AND p.workspace_id = workspace_permissions.workspace_id
        AND p.role <> 'admin'
    )
  );

DROP POLICY IF EXISTS workspace_permissions_update ON public.workspace_permissions;
CREATE POLICY workspace_permissions_update
  ON public.workspace_permissions
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND module = split_part(key, '.', 1)
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = workspace_permissions.user_uuid
        AND p.workspace_id = workspace_permissions.workspace_id
        AND p.role <> 'admin'
    )
  );

DROP POLICY IF EXISTS workspace_permissions_delete ON public.workspace_permissions;
CREATE POLICY workspace_permissions_delete
  ON public.workspace_permissions
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
  );

DROP FUNCTION IF EXISTS public.lookup_workspace_by_code(text);

CREATE FUNCTION public.lookup_workspace_by_code(p_code text)
RETURNS TABLE(id uuid, name text, code text, plan text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT w.id, w.name, w.code, public.normalize_workspace_plan(w.plan) AS plan
  FROM public.workspaces w
  WHERE w.code = UPPER(TRIM(COALESCE(p_code, '')))
    AND w.deleted_at IS NULL
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.lookup_workspace_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_workspace_by_code(text) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.normalize_workspace_plan(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_has_capability(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_max_members(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_max_branches(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_max_contacts(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_max_upload_bytes(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_allows_upload_mime(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_allows_currency(text, text) TO authenticated, service_role;
