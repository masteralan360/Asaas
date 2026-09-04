CREATE TABLE IF NOT EXISTS public.workspace_usage_limits (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  storage_unit_limit bigint NULL,
  monthly_data_transfer_limit_bytes bigint NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT workspace_usage_limits_storage_unit_limit_check
    CHECK (storage_unit_limit IS NULL OR storage_unit_limit >= 0),
  CONSTRAINT workspace_usage_limits_transfer_limit_check
    CHECK (monthly_data_transfer_limit_bytes IS NULL OR monthly_data_transfer_limit_bytes >= 0),
  CONSTRAINT workspace_usage_limits_has_limit_check
    CHECK (storage_unit_limit IS NOT NULL OR monthly_data_transfer_limit_bytes IS NOT NULL)
);

COMMENT ON TABLE public.workspace_usage_limits IS
  'Optional per-workspace usage policy. A missing row means the workspace has unlimited usage.';
COMMENT ON COLUMN public.workspace_usage_limits.storage_unit_limit IS
  'Maximum counted parent/business records for the workspace. NULL means unlimited for this metric.';
COMMENT ON COLUMN public.workspace_usage_limits.monthly_data_transfer_limit_bytes IS
  'Maximum current-month data transfer bytes. NULL means unlimited for this metric.';

CREATE TABLE IF NOT EXISTS public.workspace_usage (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspace_usage_limits(workspace_id) ON DELETE CASCADE,
  storage_units bigint NOT NULL DEFAULT 0,
  data_transfer_bytes bigint NOT NULL DEFAULT 0,
  transfer_period_start date NOT NULL DEFAULT date_trunc('month', timezone('utc', now()))::date,
  storage_updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  transfer_updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT workspace_usage_storage_units_check CHECK (storage_units >= 0),
  CONSTRAINT workspace_usage_data_transfer_bytes_check CHECK (data_transfer_bytes >= 0)
);

COMMENT ON TABLE public.workspace_usage IS
  'Functional current workspace usage state for workspaces with saved usage limits. This is not an append-only ledger.';
COMMENT ON COLUMN public.workspace_usage.storage_units IS
  'Current counted parent/business records for the workspace.';
COMMENT ON COLUMN public.workspace_usage.data_transfer_bytes IS
  'Current transfer_period_start month data transfer bytes.';

DELETE FROM public.workspace_usage_limits
WHERE storage_unit_limit IS NULL
  AND monthly_data_transfer_limit_bytes IS NULL;

DELETE FROM public.workspace_usage AS usage
WHERE NOT EXISTS (
  SELECT 1
  FROM public.workspace_usage_limits AS limits
  WHERE limits.workspace_id = usage.workspace_id
);

ALTER TABLE public.workspace_usage_limits
  DROP CONSTRAINT IF EXISTS workspace_usage_limits_has_limit_check;

ALTER TABLE public.workspace_usage_limits
  ADD CONSTRAINT workspace_usage_limits_has_limit_check
  CHECK (storage_unit_limit IS NOT NULL OR monthly_data_transfer_limit_bytes IS NOT NULL);

ALTER TABLE public.workspace_usage
  DROP CONSTRAINT IF EXISTS workspace_usage_workspace_id_fkey;

ALTER TABLE public.workspace_usage
  ADD CONSTRAINT workspace_usage_workspace_id_fkey
  FOREIGN KEY (workspace_id)
  REFERENCES public.workspace_usage_limits(workspace_id)
  ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.workspace_usage_record_sources (
  schema_name text NOT NULL,
  table_name text NOT NULL,
  description text NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (schema_name, table_name),
  CONSTRAINT workspace_usage_record_sources_schema_name_check
    CHECK (schema_name ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT workspace_usage_record_sources_table_name_check
    CHECK (table_name ~ '^[a-z][a-z0-9_]*$')
);

COMMENT ON TABLE public.workspace_usage_record_sources IS
  'Explicit list of parent/business tables that contribute one storage unit per active row.';

CREATE OR REPLACE FUNCTION public.current_workspace_usage_period_start()
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT date_trunc('month', timezone('utc', now()))::date;
$function$;

CREATE OR REPLACE FUNCTION public.touch_workspace_usage_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS touch_workspace_usage_limits_updated_at
  ON public.workspace_usage_limits;

CREATE TRIGGER touch_workspace_usage_limits_updated_at
BEFORE UPDATE ON public.workspace_usage_limits
FOR EACH ROW
EXECUTE FUNCTION public.touch_workspace_usage_updated_at();

DROP TRIGGER IF EXISTS touch_workspace_usage_record_sources_updated_at
  ON public.workspace_usage_record_sources;

CREATE TRIGGER touch_workspace_usage_record_sources_updated_at
BEFORE UPDATE ON public.workspace_usage_record_sources
FOR EACH ROW
EXECUTE FUNCTION public.touch_workspace_usage_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_workspace_usage_row(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_period date := public.current_workspace_usage_period_start();
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = p_workspace_id
  ) THEN
    DELETE FROM public.workspace_usage AS usage
    WHERE usage.workspace_id = p_workspace_id;

    RETURN;
  END IF;

  INSERT INTO public.workspace_usage (
    workspace_id,
    transfer_period_start,
    storage_updated_at,
    transfer_updated_at,
    updated_at
  )
  VALUES (
    p_workspace_id,
    v_period,
    timezone('utc', now()),
    timezone('utc', now()),
    timezone('utc', now())
  )
  ON CONFLICT (workspace_id) DO NOTHING;

  UPDATE public.workspace_usage
  SET
    data_transfer_bytes = 0,
    transfer_period_start = v_period,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = p_workspace_id
    AND transfer_period_start IS DISTINCT FROM v_period;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_workspace_storage_usage(
  p_workspace_id uuid,
  p_delta bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current bigint;
  v_limit bigint;
  v_next bigint;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF p_delta = 0 THEN
    RETURN;
  END IF;

  PERFORM public.ensure_workspace_usage_row(p_workspace_id);

  SELECT usage.storage_units
  INTO v_current
  FROM public.workspace_usage AS usage
  WHERE usage.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_next := GREATEST(0, COALESCE(v_current, 0) + p_delta);

  SELECT limits.storage_unit_limit
  INTO v_limit
  FROM public.workspace_usage_limits AS limits
  WHERE limits.workspace_id = p_workspace_id;

  IF p_delta > 0 AND v_limit IS NOT NULL AND v_next > v_limit THEN
    RAISE EXCEPTION 'Workspace storage limit exceeded'
      USING
        ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'workspace_id', p_workspace_id,
          'metric', 'storage_units',
          'current', COALESCE(v_current, 0),
          'requested_delta', p_delta,
          'limit', v_limit
        )::text,
        HINT = 'Delete records or increase the workspace usage limit.';
  END IF;

  UPDATE public.workspace_usage
  SET
    storage_units = v_next,
    storage_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = p_workspace_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_workspace_data_transfer_usage(
  p_workspace_id uuid,
  p_bytes bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current bigint;
  v_limit bigint;
  v_next bigint;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF p_bytes < 0 THEN
    RAISE EXCEPTION 'Data transfer bytes must be zero or greater';
  END IF;

  PERFORM public.ensure_workspace_usage_row(p_workspace_id);

  SELECT usage.data_transfer_bytes
  INTO v_current
  FROM public.workspace_usage AS usage
  WHERE usage.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_next := COALESCE(v_current, 0) + p_bytes;

  SELECT limits.monthly_data_transfer_limit_bytes
  INTO v_limit
  FROM public.workspace_usage_limits AS limits
  WHERE limits.workspace_id = p_workspace_id;

  IF v_limit IS NOT NULL AND v_next > v_limit THEN
    RAISE EXCEPTION 'Workspace monthly data transfer limit exceeded'
      USING
        ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'workspace_id', p_workspace_id,
          'metric', 'data_transfer_bytes',
          'period_start', public.current_workspace_usage_period_start(),
          'current', COALESCE(v_current, 0),
          'requested_delta', p_bytes,
          'limit', v_limit
        )::text,
        HINT = 'Wait until the next monthly period or increase the workspace usage limit.';
  END IF;

  UPDATE public.workspace_usage
  SET
    data_transfer_bytes = v_next,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = p_workspace_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_workspace_data_transfer(
  p_workspace_id uuid,
  p_bytes bigint,
  p_source text DEFAULT NULL
)
RETURNS TABLE (
  workspace_id uuid,
  transfer_period_start date,
  data_transfer_bytes bigint,
  monthly_data_transfer_limit_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid := COALESCE(p_workspace_id, public.current_workspace_id());
BEGIN
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  PERFORM public.apply_workspace_data_transfer_usage(v_workspace_id, COALESCE(p_bytes, 0));

  RETURN QUERY
  SELECT
    usage.workspace_id,
    usage.transfer_period_start,
    usage.data_transfer_bytes,
    limits.monthly_data_transfer_limit_bytes
  FROM public.workspace_usage AS usage
  LEFT JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_workspace_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_workspace_usage_status(
  p_workspace_id uuid DEFAULT NULL
)
RETURNS TABLE (
  workspace_id uuid,
  has_limits boolean,
  storage_units bigint,
  storage_unit_limit bigint,
  data_transfer_bytes bigint,
  monthly_data_transfer_limit_bytes bigint,
  transfer_period_start date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid := COALESCE(p_workspace_id, public.current_workspace_id());
BEGIN
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_workspace_id);

  RETURN QUERY
  SELECT
    usage.workspace_id,
    limits.workspace_id IS NOT NULL AS has_limits,
    usage.storage_units,
    limits.storage_unit_limit,
    usage.data_transfer_bytes,
    limits.monthly_data_transfer_limit_bytes,
    usage.transfer_period_start
  FROM public.workspace_usage AS usage
  LEFT JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_workspace_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_storage_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old_row jsonb;
  v_new_row jsonb;
  v_old_workspace_id uuid;
  v_new_workspace_id uuid;
  v_old_counts boolean := false;
  v_new_counts boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old_row := to_jsonb(OLD);
    v_old_workspace_id := NULLIF(v_old_row->>'workspace_id', '')::uuid;
    v_old_counts := COALESCE((v_old_row->>'is_deleted')::boolean, false) = false;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_row := to_jsonb(NEW);
    v_new_workspace_id := NULLIF(v_new_row->>'workspace_id', '')::uuid;
    v_new_counts := COALESCE((v_new_row->>'is_deleted')::boolean, false) = false;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_new_counts THEN
      PERFORM public.adjust_workspace_storage_usage(v_new_workspace_id, 1);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_old_counts
      AND (NOT v_new_counts OR v_old_workspace_id IS DISTINCT FROM v_new_workspace_id) THEN
      PERFORM public.adjust_workspace_storage_usage(v_old_workspace_id, -1);
    END IF;

    IF v_new_counts
      AND (NOT v_old_counts OR v_old_workspace_id IS DISTINCT FROM v_new_workspace_id) THEN
      PERFORM public.adjust_workspace_storage_usage(v_new_workspace_id, 1);
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_old_counts THEN
      PERFORM public.adjust_workspace_storage_usage(v_old_workspace_id, -1);
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

INSERT INTO public.workspace_usage_record_sources (schema_name, table_name, description, enabled)
VALUES
  ('public', 'categories', 'Product category records', true),
  ('public', 'employees', 'Employee records', true),
  ('public', 'products', 'Product records', true),
  ('public', 'storages', 'Storage/location records', true),
  ('public', 'reorder_transfer_rules', 'Inventory reorder rules', true),
  ('public', 'inventory_transfer_transactions', 'Inventory transfer records', true),
  ('public', 'stock_adjustments', 'Stock adjustment records', true),
  ('public', 'sales', 'Sale parent records', true),
  ('public', 'sale_returns', 'Sale return parent records', true),
  ('public', 'invoices', 'Invoice parent records', true),
  ('public', 'loans', 'Loan parent records', true),
  ('public', 'payment_transactions', 'Payment transaction records', true),
  ('public', 'workspace_contacts', 'Workspace contact records', true),
  ('public', 'marketplace_orders', 'Marketplace order parent records', true),
  ('public', 'product_discounts', 'Product discount rules', true),
  ('public', 'category_discounts', 'Category discount rules', true),
  ('crm', 'customers', 'CRM customer records', true),
  ('crm', 'suppliers', 'CRM supplier records', true),
  ('crm', 'business_partners', 'CRM business partner records', true),
  ('crm', 'agents', 'Agent records', true),
  ('crm', 'sales_orders', 'Sales order parent records', true),
  ('crm', 'purchase_orders', 'Purchase order parent records', true),
  ('clinics', 'clinical_patients', 'Clinical patient records', true),
  ('clinics', 'clinical_appointments', 'Clinical appointment records', true),
  ('real_estate', 'real_estate_transactions', 'Real estate transaction parent records', true),
  ('budget', 'budget_allocations', 'Budget allocation records', true),
  ('budget', 'expense_series', 'Recurring expense parent records', true),
  ('fx', 'exchange_transactions', 'Currency exchange transaction records', true),
  ('fx', 'fx_safes', 'Currency exchange safe records', true),
  ('fleet', 'fleet_vehicles', 'Fleet vehicle records', true)
ON CONFLICT (schema_name, table_name) DO UPDATE
SET
  description = EXCLUDED.description,
  enabled = EXCLUDED.enabled,
  updated_at = timezone('utc', now());

CREATE OR REPLACE FUNCTION public.install_workspace_storage_usage_triggers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  source record;
  v_regclass regclass;
  v_has_workspace_id boolean;
BEGIN
  FOR source IN
    SELECT schema_name, table_name
    FROM public.workspace_usage_record_sources
    WHERE enabled = true
    ORDER BY schema_name, table_name
  LOOP
    v_regclass := to_regclass(format('%I.%I', source.schema_name, source.table_name));

    IF v_regclass IS NULL THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = source.schema_name
        AND table_name = source.table_name
        AND column_name = 'workspace_id'
    )
    INTO v_has_workspace_id;

    IF NOT v_has_workspace_id THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS workspace_storage_usage_enforce ON %I.%I',
      source.schema_name,
      source.table_name
    );

    EXECUTE format(
      'CREATE TRIGGER workspace_storage_usage_enforce AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_storage_usage()',
      source.schema_name,
      source.table_name
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_workspace_storage_usage(
  p_workspace_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  source record;
  v_regclass regclass;
  v_has_workspace_id boolean;
  v_has_is_deleted boolean;
  v_where text;
  v_sql text;
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin')
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  IF p_workspace_id IS NULL THEN
    DELETE FROM public.workspace_usage AS usage
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.workspace_usage_limits AS limits
      WHERE limits.workspace_id = usage.workspace_id
    );

    INSERT INTO public.workspace_usage (
      workspace_id,
      transfer_period_start,
      storage_updated_at,
      transfer_updated_at,
      updated_at
    )
    SELECT
      limits.workspace_id,
      public.current_workspace_usage_period_start(),
      timezone('utc', now()),
      timezone('utc', now()),
      timezone('utc', now())
    FROM public.workspace_usage_limits AS limits
    INNER JOIN public.workspaces AS workspace_row
      ON workspace_row.id = limits.workspace_id
    ON CONFLICT (workspace_id) DO NOTHING;

    UPDATE public.workspace_usage
    SET
      storage_units = 0,
      storage_updated_at = timezone('utc', now()),
      updated_at = timezone('utc', now());
  ELSE
    PERFORM public.ensure_workspace_usage_row(p_workspace_id);

    IF NOT EXISTS (
      SELECT 1
      FROM public.workspace_usage AS usage
      WHERE usage.workspace_id = p_workspace_id
    ) THEN
      RETURN;
    END IF;

    UPDATE public.workspace_usage
    SET
      storage_units = 0,
      storage_updated_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    WHERE workspace_id = p_workspace_id;
  END IF;

  FOR source IN
    SELECT schema_name, table_name
    FROM public.workspace_usage_record_sources
    WHERE enabled = true
    ORDER BY schema_name, table_name
  LOOP
    v_regclass := to_regclass(format('%I.%I', source.schema_name, source.table_name));

    IF v_regclass IS NULL THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = source.schema_name
        AND table_name = source.table_name
        AND column_name = 'workspace_id'
    )
    INTO v_has_workspace_id;

    IF NOT v_has_workspace_id THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = source.schema_name
        AND table_name = source.table_name
        AND column_name = 'is_deleted'
    )
    INTO v_has_is_deleted;

    v_where := 'source_rows.workspace_id IS NOT NULL AND workspace_row.deleted_at IS NULL';

    IF v_has_is_deleted THEN
      v_where := v_where || ' AND COALESCE(source_rows.is_deleted, false) = false';
    END IF;

    IF p_workspace_id IS NOT NULL THEN
      v_where := v_where || ' AND source_rows.workspace_id = $1';
    END IF;

    v_sql := format(
      'INSERT INTO public.workspace_usage AS usage (workspace_id, storage_units, transfer_period_start, storage_updated_at, updated_at)
       SELECT source_rows.workspace_id, COUNT(*)::bigint, public.current_workspace_usage_period_start(), timezone(''utc'', now()), timezone(''utc'', now())
       FROM %I.%I AS source_rows
       INNER JOIN public.workspaces AS workspace_row
         ON workspace_row.id = source_rows.workspace_id
       INNER JOIN public.workspace_usage_limits AS limits
         ON limits.workspace_id = source_rows.workspace_id
       WHERE %s
       GROUP BY source_rows.workspace_id
       ON CONFLICT (workspace_id) DO UPDATE
       SET storage_units = usage.storage_units + EXCLUDED.storage_units,
           storage_updated_at = timezone(''utc'', now()),
           updated_at = timezone(''utc'', now())',
      source.schema_name,
      source.table_name,
      v_where
    );

    IF p_workspace_id IS NULL THEN
      EXECUTE v_sql;
    ELSE
      EXECUTE v_sql USING p_workspace_id;
    END IF;
  END LOOP;
END;
$function$;

ALTER TABLE public.workspace_usage_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_usage_record_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_usage_limits_select_current
  ON public.workspace_usage_limits;

CREATE POLICY workspace_usage_limits_select_current
  ON public.workspace_usage_limits
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS workspace_usage_select_current
  ON public.workspace_usage;

CREATE POLICY workspace_usage_select_current
  ON public.workspace_usage
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

REVOKE ALL ON public.workspace_usage_limits FROM anon, authenticated;
REVOKE ALL ON public.workspace_usage FROM anon, authenticated;
REVOKE ALL ON public.workspace_usage_record_sources FROM anon, authenticated;

GRANT SELECT ON public.workspace_usage_limits TO authenticated;
GRANT SELECT ON public.workspace_usage TO authenticated;
GRANT ALL ON public.workspace_usage_limits TO service_role;
GRANT ALL ON public.workspace_usage TO service_role;
GRANT ALL ON public.workspace_usage_record_sources TO service_role;

REVOKE ALL ON FUNCTION public.current_workspace_usage_period_start() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_workspace_usage_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_workspace_usage_row(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_workspace_storage_usage(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_workspace_data_transfer_usage(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_usage_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_workspace_storage_usage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.install_workspace_storage_usage_triggers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_workspace_storage_usage(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_workspace_usage_period_start() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_usage_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_workspace_storage_usage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.install_workspace_storage_usage_triggers() TO service_role;

SELECT public.install_workspace_storage_usage_triggers();
SELECT public.refresh_workspace_storage_usage();
