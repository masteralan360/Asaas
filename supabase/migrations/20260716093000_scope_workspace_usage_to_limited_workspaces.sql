-- Scope functional usage rows to workspaces with saved usage limits only.
-- Unlimited workspaces are represented by the absence of rows in both
-- workspace_usage_limits and workspace_usage.

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

COMMENT ON TABLE public.workspace_usage IS
  'Functional current workspace usage state for workspaces with saved usage limits. This is not an append-only ledger.';

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

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_workspace_id
  ) THEN
    RETURN QUERY
    SELECT
      v_workspace_id,
      public.current_workspace_usage_period_start(),
      0::bigint,
      NULL::bigint;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    usage.workspace_id,
    usage.transfer_period_start,
    usage.data_transfer_bytes,
    limits.monthly_data_transfer_limit_bytes
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_workspace_id
  ) THEN
    RETURN QUERY
    SELECT
      v_workspace_id,
      false,
      0::bigint,
      NULL::bigint,
      0::bigint,
      NULL::bigint,
      public.current_workspace_usage_period_start();
    RETURN;
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_workspace_id);

  RETURN QUERY
  SELECT
    usage.workspace_id,
    true AS has_limits,
    usage.storage_units,
    limits.storage_unit_limit,
    usage.data_transfer_bytes,
    limits.monthly_data_transfer_limit_bytes,
    usage.transfer_period_start
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_workspace_id;
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

GRANT EXECUTE ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_usage_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_workspace_storage_usage(uuid) TO service_role;

SELECT public.refresh_workspace_storage_usage();
