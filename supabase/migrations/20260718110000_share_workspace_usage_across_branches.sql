-- Branch workspaces share the source workspace usage policy and counters.
-- workspace_usage_limits and workspace_usage remain functional current-state
-- tables; the owning row is always the source workspace for a branch family.

CREATE OR REPLACE FUNCTION public.workspace_usage_owner_id(p_workspace_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH RECURSIVE usage_owner(id, depth, path) AS (
    SELECT p_workspace_id, 0, ARRAY[p_workspace_id]
    WHERE p_workspace_id IS NOT NULL

    UNION ALL

    SELECT branch.source_workspace_id, usage_owner.depth + 1, usage_owner.path || branch.source_workspace_id
    FROM usage_owner
    INNER JOIN public.workspace_branches AS branch
      ON branch.branch_workspace_id = usage_owner.id
    WHERE usage_owner.depth < 16
      AND branch.source_workspace_id IS NOT NULL
      AND NOT branch.source_workspace_id = ANY(usage_owner.path)
  )
  SELECT id
  FROM usage_owner
  ORDER BY depth DESC
  LIMIT 1;
$function$;

COMMENT ON FUNCTION public.workspace_usage_owner_id(uuid) IS
  'Returns the workspace id that owns usage limits and counters. Branch workspaces resolve to their source workspace.';

CREATE OR REPLACE FUNCTION public.normalize_workspace_usage_limit_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_usage_owner_id uuid;
BEGIN
  v_usage_owner_id := public.workspace_usage_owner_id(NEW.workspace_id);

  IF v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  NEW.workspace_id := v_usage_owner_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_workspace_usage_limits_owner
  ON public.workspace_usage_limits;

CREATE TRIGGER normalize_workspace_usage_limits_owner
BEFORE INSERT OR UPDATE OF workspace_id ON public.workspace_usage_limits
FOR EACH ROW
EXECUTE FUNCTION public.normalize_workspace_usage_limit_owner();

CREATE OR REPLACE FUNCTION public.normalize_workspace_usage_state_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_usage_owner_id uuid;
BEGIN
  v_usage_owner_id := public.workspace_usage_owner_id(NEW.workspace_id);

  IF v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  NEW.workspace_id := v_usage_owner_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_workspace_usage_owner
  ON public.workspace_usage;

CREATE TRIGGER normalize_workspace_usage_owner
BEFORE INSERT OR UPDATE OF workspace_id ON public.workspace_usage
FOR EACH ROW
EXECUTE FUNCTION public.normalize_workspace_usage_state_owner();

WITH limit_candidates AS (
  SELECT
    owner_row.usage_owner_id,
    limits.storage_unit_limit,
    limits.monthly_data_transfer_limit_bytes,
    limits.notes,
    limits.created_at,
    limits.updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY owner_row.usage_owner_id
      ORDER BY
        (limits.workspace_id = owner_row.usage_owner_id) DESC,
        limits.updated_at DESC,
        limits.created_at DESC
    ) AS candidate_rank
  FROM public.workspace_usage_limits AS limits
  CROSS JOIN LATERAL (
    SELECT public.workspace_usage_owner_id(limits.workspace_id) AS usage_owner_id
  ) AS owner_row
  WHERE owner_row.usage_owner_id IS NOT NULL
)
INSERT INTO public.workspace_usage_limits (
  workspace_id,
  storage_unit_limit,
  monthly_data_transfer_limit_bytes,
  notes,
  created_at,
  updated_at
)
SELECT
  usage_owner_id,
  storage_unit_limit,
  monthly_data_transfer_limit_bytes,
  notes,
  COALESCE(created_at, timezone('utc', now())),
  COALESCE(updated_at, timezone('utc', now()))
FROM limit_candidates
WHERE candidate_rank = 1
ON CONFLICT (workspace_id) DO NOTHING;

WITH usage_rollup AS (
  SELECT
    owner_row.usage_owner_id,
    SUM(COALESCE(usage.storage_units, 0))::bigint AS storage_units,
    SUM(
      CASE
        WHEN usage.transfer_period_start = public.current_workspace_usage_period_start()
          THEN COALESCE(usage.data_transfer_bytes, 0)
        ELSE 0
      END
    )::bigint AS data_transfer_bytes,
    MAX(usage.storage_updated_at) AS storage_updated_at,
    MAX(usage.transfer_updated_at) AS transfer_updated_at,
    MAX(usage.updated_at) AS updated_at
  FROM public.workspace_usage AS usage
  CROSS JOIN LATERAL (
    SELECT public.workspace_usage_owner_id(usage.workspace_id) AS usage_owner_id
  ) AS owner_row
  WHERE owner_row.usage_owner_id IS NOT NULL
  GROUP BY owner_row.usage_owner_id
)
INSERT INTO public.workspace_usage (
  workspace_id,
  storage_units,
  data_transfer_bytes,
  transfer_period_start,
  storage_updated_at,
  transfer_updated_at,
  updated_at
)
SELECT
  rollup.usage_owner_id,
  rollup.storage_units,
  rollup.data_transfer_bytes,
  public.current_workspace_usage_period_start(),
  COALESCE(rollup.storage_updated_at, timezone('utc', now())),
  COALESCE(rollup.transfer_updated_at, timezone('utc', now())),
  COALESCE(rollup.updated_at, timezone('utc', now()))
FROM usage_rollup AS rollup
INNER JOIN public.workspace_usage_limits AS limits
  ON limits.workspace_id = rollup.usage_owner_id
ON CONFLICT (workspace_id) DO UPDATE
SET
  storage_units = EXCLUDED.storage_units,
  data_transfer_bytes = EXCLUDED.data_transfer_bytes,
  transfer_period_start = EXCLUDED.transfer_period_start,
  storage_updated_at = EXCLUDED.storage_updated_at,
  transfer_updated_at = EXCLUDED.transfer_updated_at,
  updated_at = EXCLUDED.updated_at;

DELETE FROM public.workspace_usage_limits AS limits
WHERE limits.workspace_id IS DISTINCT FROM public.workspace_usage_owner_id(limits.workspace_id);

DELETE FROM public.workspace_usage AS usage
WHERE usage.workspace_id IS DISTINCT FROM public.workspace_usage_owner_id(usage.workspace_id)
  OR NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = usage.workspace_id
  );

COMMENT ON TABLE public.workspace_usage_limits IS
  'Optional usage policy for usage-owner workspaces. Branches inherit the source workspace policy. A missing source policy means unlimited usage.';

COMMENT ON TABLE public.workspace_usage IS
  'Functional current usage state for usage-owner workspaces. Branch usage is aggregated into the source workspace row. This is not an append-only ledger.';

CREATE OR REPLACE FUNCTION public.ensure_workspace_usage_row(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_period date := public.current_workspace_usage_period_start();
BEGIN
  IF v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF p_workspace_id IS DISTINCT FROM v_usage_owner_id THEN
    DELETE FROM public.workspace_usage AS usage
    WHERE usage.workspace_id = p_workspace_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_usage_owner_id
  ) THEN
    DELETE FROM public.workspace_usage AS usage
    WHERE usage.workspace_id = v_usage_owner_id;

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
    v_usage_owner_id,
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
  WHERE workspace_id = v_usage_owner_id
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
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_current bigint;
  v_limit bigint;
  v_next bigint;
BEGIN
  IF v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF p_delta = 0 THEN
    RETURN;
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);

  SELECT usage.storage_units
  INTO v_current
  FROM public.workspace_usage AS usage
  WHERE usage.workspace_id = v_usage_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_next := GREATEST(0, COALESCE(v_current, 0) + p_delta);

  SELECT limits.storage_unit_limit
  INTO v_limit
  FROM public.workspace_usage_limits AS limits
  WHERE limits.workspace_id = v_usage_owner_id;

  IF p_delta > 0 AND v_limit IS NOT NULL AND v_next > v_limit THEN
    RAISE EXCEPTION 'Workspace storage limit exceeded'
      USING
        ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'workspace_id', p_workspace_id,
          'usage_workspace_id', v_usage_owner_id,
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
  WHERE workspace_id = v_usage_owner_id;
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
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_current bigint;
  v_next bigint;
BEGIN
  IF v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF COALESCE(p_bytes, 0) < 0 THEN
    RAISE EXCEPTION 'Data transfer bytes must be zero or greater';
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);

  SELECT usage.data_transfer_bytes
  INTO v_current
  FROM public.workspace_usage AS usage
  WHERE usage.workspace_id = v_usage_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_next := COALESCE(v_current, 0) + COALESCE(p_bytes, 0);

  UPDATE public.workspace_usage
  SET
    data_transfer_bytes = v_next,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = v_usage_owner_id;
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
  v_usage_owner_id uuid := public.workspace_usage_owner_id(COALESCE(p_workspace_id, public.current_workspace_id()));
  v_current_usage_owner_id uuid := public.workspace_usage_owner_id(public.current_workspace_id());
BEGIN
  IF v_workspace_id IS NULL OR v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_usage_owner_id IS DISTINCT FROM v_current_usage_owner_id THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  PERFORM public.apply_workspace_data_transfer_usage(v_workspace_id, COALESCE(p_bytes, 0));

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_usage_owner_id
  ) THEN
    RETURN QUERY
    SELECT
      v_usage_owner_id,
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
  WHERE usage.workspace_id = v_usage_owner_id;
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
  v_usage_owner_id uuid := public.workspace_usage_owner_id(COALESCE(p_workspace_id, public.current_workspace_id()));
  v_current_usage_owner_id uuid := public.workspace_usage_owner_id(public.current_workspace_id());
BEGIN
  IF v_workspace_id IS NULL OR v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_usage_owner_id IS DISTINCT FROM v_current_usage_owner_id THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_usage_owner_id
  ) THEN
    RETURN QUERY
    SELECT
      v_usage_owner_id,
      false,
      0::bigint,
      NULL::bigint,
      0::bigint,
      NULL::bigint,
      public.current_workspace_usage_period_start();
    RETURN;
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);

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
  WHERE usage.workspace_id = v_usage_owner_id;
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
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_where text;
  v_sql text;
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin')
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  IF p_workspace_id IS NULL THEN
    DELETE FROM public.workspace_usage AS usage
    WHERE usage.workspace_id IS DISTINCT FROM public.workspace_usage_owner_id(usage.workspace_id)
      OR NOT EXISTS (
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
    WHERE limits.workspace_id = public.workspace_usage_owner_id(limits.workspace_id)
    ON CONFLICT (workspace_id) DO NOTHING;

    UPDATE public.workspace_usage
    SET
      storage_units = 0,
      storage_updated_at = timezone('utc', now()),
      updated_at = timezone('utc', now());
  ELSE
    IF v_usage_owner_id IS NULL THEN
      RAISE EXCEPTION 'Workspace is required';
    END IF;

    PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);

    IF NOT EXISTS (
      SELECT 1
      FROM public.workspace_usage AS usage
      WHERE usage.workspace_id = v_usage_owner_id
    ) THEN
      RETURN;
    END IF;

    UPDATE public.workspace_usage
    SET
      storage_units = 0,
      storage_updated_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    WHERE workspace_id = v_usage_owner_id;
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

    v_where := 'source_rows.workspace_id IS NOT NULL AND workspace_row.deleted_at IS NULL AND usage_owner.workspace_id IS NOT NULL';

    IF v_has_is_deleted THEN
      v_where := v_where || ' AND COALESCE(source_rows.is_deleted, false) = false';
    END IF;

    IF p_workspace_id IS NOT NULL THEN
      v_where := v_where || ' AND usage_owner.workspace_id = $1';
    END IF;

    v_sql := format(
      'INSERT INTO public.workspace_usage AS usage (workspace_id, storage_units, transfer_period_start, storage_updated_at, updated_at)
       SELECT usage_owner.workspace_id, COUNT(*)::bigint, public.current_workspace_usage_period_start(), timezone(''utc'', now()), timezone(''utc'', now())
       FROM %I.%I AS source_rows
       INNER JOIN public.workspaces AS workspace_row
         ON workspace_row.id = source_rows.workspace_id
       CROSS JOIN LATERAL (
         SELECT public.workspace_usage_owner_id(source_rows.workspace_id) AS workspace_id
       ) AS usage_owner
       INNER JOIN public.workspace_usage_limits AS limits
         ON limits.workspace_id = usage_owner.workspace_id
       WHERE %s
       GROUP BY usage_owner.workspace_id
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
      EXECUTE v_sql USING v_usage_owner_id;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lock_workspace_when_transfer_limit_reached(
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_data_transfer_bytes bigint;
  v_transfer_limit bigint;
BEGIN
  IF v_usage_owner_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    usage.data_transfer_bytes,
    limits.monthly_data_transfer_limit_bytes
  INTO
    v_data_transfer_bytes,
    v_transfer_limit
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id;

  IF v_transfer_limit IS NOT NULL
    AND COALESCE(v_data_transfer_bytes, 0) >= v_transfer_limit THEN
    UPDATE public.workspaces AS workspace_row
    SET locked_workspace = true
    WHERE COALESCE(workspace_row.locked_workspace, false) = false
      AND (
        workspace_row.id = v_usage_owner_id
        OR EXISTS (
          SELECT 1
          FROM public.workspace_branches AS branch
          WHERE branch.source_workspace_id = v_usage_owner_id
            AND branch.branch_workspace_id = workspace_row.id
        )
      );
  END IF;
END;
$function$;

DROP POLICY IF EXISTS workspace_usage_limits_select_current
  ON public.workspace_usage_limits;

CREATE POLICY workspace_usage_limits_select_current
  ON public.workspace_usage_limits
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.workspace_usage_owner_id(public.current_workspace_id()));

DROP POLICY IF EXISTS workspace_usage_select_current
  ON public.workspace_usage;

CREATE POLICY workspace_usage_select_current
  ON public.workspace_usage
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.workspace_usage_owner_id(public.current_workspace_id()));

REVOKE ALL ON FUNCTION public.workspace_usage_owner_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_workspace_usage_limit_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_workspace_usage_state_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_workspace_usage_row(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_workspace_storage_usage(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_workspace_data_transfer_usage(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_usage_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_workspace_storage_usage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_workspace_when_transfer_limit_reached(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.workspace_usage_owner_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_usage_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_workspace_storage_usage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_workspace_data_transfer_usage(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_workspace_when_transfer_limit_reached(uuid) TO service_role;

SELECT public.refresh_workspace_storage_usage();

SELECT public.lock_workspace_when_transfer_limit_reached(usage.workspace_id)
FROM public.workspace_usage AS usage
INNER JOIN public.workspace_usage_limits AS limits
  ON limits.workspace_id = usage.workspace_id
WHERE limits.monthly_data_transfer_limit_bytes IS NOT NULL
  AND usage.data_transfer_bytes >= limits.monthly_data_transfer_limit_bytes;
