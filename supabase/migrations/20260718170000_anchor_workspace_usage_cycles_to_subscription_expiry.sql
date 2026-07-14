-- A workspace with usage limits uses the day of subscription_expires_at as
-- its recurring usage-cycle boundary.  The timestamp is not an access expiry
-- for that workspace; it is the date on which its monthly transfer allowance
-- starts again.  Workspaces without a usage-limit row keep the existing
-- calendar-month behaviour.

CREATE OR REPLACE FUNCTION public.workspace_usage_period_start(
  p_workspace_id uuid
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_subscription_expires_at timestamptz;
  v_today date := timezone('utc', now())::date;
  v_month_start date;
  v_reset_day integer;
  v_period_start date;
BEGIN
  -- Usage is shared by source workspaces and their branches, so the source
  -- subscription date defines one common cycle for the whole family.
  IF v_usage_owner_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.workspace_usage_limits AS limits
      WHERE limits.workspace_id = v_usage_owner_id
    ) THEN
    RETURN date_trunc('month', v_today)::date;
  END IF;

  SELECT workspace_row.subscription_expires_at
  INTO v_subscription_expires_at
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_usage_owner_id;

  IF v_subscription_expires_at IS NULL THEN
    RETURN date_trunc('month', v_today)::date;
  END IF;

  v_reset_day := EXTRACT(DAY FROM v_subscription_expires_at AT TIME ZONE 'utc')::integer;
  v_month_start := date_trunc('month', v_today)::date;
  v_period_start := v_month_start + (
    LEAST(
      v_reset_day,
      EXTRACT(DAY FROM (v_month_start + INTERVAL '1 month - 1 day'))::integer
    ) - 1
  );

  IF v_today >= v_period_start THEN
    RETURN v_period_start;
  END IF;

  v_month_start := (v_month_start - INTERVAL '1 month')::date;
  RETURN v_month_start + (
    LEAST(
      v_reset_day,
      EXTRACT(DAY FROM (v_month_start + INTERVAL '1 month - 1 day'))::integer
    ) - 1
  );
END;
$function$;

COMMENT ON FUNCTION public.workspace_usage_period_start(uuid) IS
  'Returns the current usage-cycle start. Usage-limited workspaces reset on the UTC day of their subscription_expires_at value; other workspaces use the first day of the calendar month.';

-- Preserve the existing no-argument API for callers that use the current
-- workspace, while making it obey the new per-workspace cycle.
CREATE OR REPLACE FUNCTION public.current_workspace_usage_period_start()
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT public.workspace_usage_period_start(public.current_workspace_id());
$function$;

CREATE OR REPLACE FUNCTION public.ensure_workspace_usage_row(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_period date;
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

  v_period := public.workspace_usage_period_start(v_usage_owner_id);

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

  -- Storage is a current-state counter and is intentionally retained. Only
  -- transfer/charged-usage counters reset at the start of a new usage cycle.
  UPDATE public.workspace_usage
  SET
    actual_data_transfer_bytes = 0,
    data_transfer_bytes = 0,
    transfer_period_start = v_period,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = v_usage_owner_id
    AND transfer_period_start IS DISTINCT FROM v_period;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_workspace_usage_periods(
  p_workspace_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid;
BEGIN
  IF p_workspace_id IS NOT NULL THEN
    PERFORM public.ensure_workspace_usage_row(p_workspace_id);
    RETURN;
  END IF;

  FOR v_workspace_id IN
    SELECT limits.workspace_id
    FROM public.workspace_usage_limits AS limits
    ORDER BY limits.workspace_id
  LOOP
    PERFORM public.ensure_workspace_usage_row(v_workspace_id);
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.sync_workspace_usage_periods(uuid) IS
  'Lazily resets transfer counters for every usage-limited workspace whose subscription-anchored usage cycle has rolled over.';

-- Keep the persisted counters current even when a workspace is idle across its
-- reset day. The function itself is a no-op unless a cycle has changed.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'sync-workspace-usage-cycles'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$do$;

SELECT cron.schedule(
  'sync-workspace-usage-cycles',
  '*/5 * * * *',
  $$SELECT public.sync_workspace_usage_periods();$$
);

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
  v_charged_usage_bytes bigint;
  v_charged_usage_limit bigint;
BEGIN
  IF v_usage_owner_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    usage.data_transfer_bytes,
    limits.monthly_data_transfer_limit_bytes
  INTO
    v_charged_usage_bytes,
    v_charged_usage_limit
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id
    AND usage.transfer_period_start = public.workspace_usage_period_start(v_usage_owner_id);

  IF v_charged_usage_limit IS NOT NULL
    AND COALESCE(v_charged_usage_bytes, 0) >= v_charged_usage_limit THEN
    UPDATE public.workspaces AS workspace_row
    SET locked_workspace = true
    WHERE workspace_row.id = v_usage_owner_id
      AND COALESCE(workspace_row.locked_workspace, false) = false;
  END IF;
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
  actual_data_transfer_bytes bigint,
  data_transfer_bytes bigint,
  transfer_charge_multiplier bigint,
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

  PERFORM public.apply_workspace_data_transfer_usage(v_workspace_id, p_bytes);

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_usage_owner_id
  ) THEN
    RETURN QUERY
    SELECT
      v_usage_owner_id,
      public.workspace_usage_period_start(v_usage_owner_id),
      0::bigint,
      0::bigint,
      public.workspace_transfer_charge_multiplier(),
      NULL::bigint;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    usage.workspace_id,
    usage.transfer_period_start,
    usage.actual_data_transfer_bytes,
    usage.data_transfer_bytes,
    public.workspace_transfer_charge_multiplier(),
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
  actual_data_transfer_bytes bigint,
  data_transfer_bytes bigint,
  transfer_charge_multiplier bigint,
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
      0::bigint,
      public.workspace_transfer_charge_multiplier(),
      NULL::bigint,
      public.workspace_usage_period_start(v_usage_owner_id);
    RETURN;
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);

  RETURN QUERY
  SELECT
    usage.workspace_id,
    true AS has_limits,
    usage.storage_units,
    limits.storage_unit_limit,
    usage.actual_data_transfer_bytes,
    usage.data_transfer_bytes,
    public.workspace_transfer_charge_multiplier(),
    limits.monthly_data_transfer_limit_bytes,
    usage.transfer_period_start
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.workspace_usage_period_start(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_workspace_usage_periods(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_workspace_usage_row(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.workspace_usage_period_start(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_workspace_usage_periods(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_workspace_usage_row(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_usage_status(uuid) TO authenticated, service_role;
