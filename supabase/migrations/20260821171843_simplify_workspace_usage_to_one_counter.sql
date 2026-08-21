-- Unified workspace usage: one canonical charged counter.
--
-- Channel is a transient request attribute used to choose a rate. It is not a
-- persisted usage dimension. The only durable request-audit data is an
-- idempotency key and the charged delta; raw bytes, channel, and source are
-- intentionally discarded after the request is charged.

ALTER TABLE public.workspace_usage
  DROP CONSTRAINT IF EXISTS workspace_usage_transfer_counters_consistent_check;

CREATE TABLE IF NOT EXISTS billing.workspace_usage_charge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  transfer_period_start date NOT NULL,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  charged_usage_bytes bigint NOT NULL CHECK (charged_usage_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT workspace_usage_charge_events_workspace_request_key UNIQUE (workspace_id, request_id)
);

CREATE INDEX IF NOT EXISTS workspace_usage_charge_events_workspace_period_idx
  ON billing.workspace_usage_charge_events (workspace_id, transfer_period_start, created_at DESC);

ALTER TABLE billing.workspace_usage_charge_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE billing.workspace_usage_charge_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE billing.workspace_usage_charge_events TO service_role;

COMMENT ON TABLE billing.workspace_usage_charge_events IS
  'Idempotency audit for charged usage only. It stores a request id and charged delta, never raw bytes, source, or channel.';

CREATE OR REPLACE FUNCTION public.workspace_usage_charge_rate(p_channel text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT CASE lower(COALESCE(p_channel, ''))
    WHEN 'tauri' THEN 10::bigint
    WHEN 'web_live' THEN 20::bigint
    ELSE NULL::bigint
  END;
$function$;

COMMENT ON FUNCTION public.workspace_usage_charge_rate(text) IS
  'Returns the transient server-owned request rate: Tauri is 10x and Web Live is 20x.';

REVOKE ALL ON FUNCTION public.workspace_usage_charge_rate(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.ensure_workspace_usage_row(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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

    PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = false,
      usage_limit_locked = false
    WHERE workspace_row.id = v_usage_owner_id
      AND workspace_row.usage_limit_locked = true;
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

  UPDATE public.workspace_usage
  SET
    data_transfer_bytes = 0,
    purchased_credit_bytes = 0,
    transfer_period_start = v_period,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = v_usage_owner_id
    AND transfer_period_start IS DISTINCT FROM v_period;
END;
$function$;

-- Keep the internal compatibility signature, but no longer persist which
-- channel supplied a delta. p_channel and p_source are transient inputs only.
CREATE OR REPLACE FUNCTION public.apply_workspace_charged_usage(
  p_workspace_id uuid,
  p_charged_usage_bytes bigint,
  p_channel text,
  p_source text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_request_id uuid := COALESCE(p_request_id, gen_random_uuid());
  v_recorded_delta bigint;
BEGIN
  IF v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF COALESCE(p_charged_usage_bytes, 0) < 0 THEN
    RAISE EXCEPTION 'Usage bytes must be non-negative';
  END IF;

  IF COALESCE(p_charged_usage_bytes, 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_usage_owner_id
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO billing.workspace_usage_charge_events (
    workspace_id,
    transfer_period_start,
    request_id,
    charged_usage_bytes
  )
  VALUES (
    v_usage_owner_id,
    public.workspace_usage_period_start(v_usage_owner_id),
    v_request_id,
    p_charged_usage_bytes
  )
  ON CONFLICT (workspace_id, request_id) DO NOTHING
  RETURNING charged_usage_bytes INTO v_recorded_delta;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE public.workspace_usage
  SET
    data_transfer_bytes = data_transfer_bytes + v_recorded_delta,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = v_usage_owner_id;

  RETURN v_recorded_delta;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_workspace_data_transfer_usage(
  p_workspace_id uuid,
  p_bytes bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_rate bigint := public.workspace_usage_charge_rate('tauri');
BEGIN
  IF COALESCE(p_bytes, 0) <= 0 THEN
    RETURN;
  END IF;

  PERFORM public.apply_workspace_charged_usage(
    p_workspace_id,
    (p_bytes::numeric * v_rate::numeric)::bigint,
    'tauri',
    NULL,
    NULL
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.record_workspace_data_transfer(uuid, bigint, text);
DROP FUNCTION IF EXISTS public.record_workspace_data_transfer(uuid, bigint, text, text, uuid);

CREATE FUNCTION public.record_workspace_data_transfer(
  p_workspace_id uuid,
  p_bytes bigint,
  p_source text DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS TABLE (
  workspace_id uuid,
  transfer_period_start date,
  charged_usage_bytes bigint,
  monthly_data_transfer_limit_bytes bigint,
  base_monthly_data_transfer_limit_bytes bigint,
  purchased_credit_bytes bigint,
  effective_monthly_data_transfer_limit_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_workspace_id uuid := COALESCE(p_workspace_id, public.current_workspace_id());
  v_usage_owner_id uuid := public.workspace_usage_owner_id(COALESCE(p_workspace_id, public.current_workspace_id()));
  v_current_usage_owner_id uuid := public.workspace_usage_owner_id(public.current_workspace_id());
  v_channel text;
  v_rate bigint;
  v_charged_delta numeric;
  v_request_id uuid;
BEGIN
  IF v_workspace_id IS NULL OR v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_usage_owner_id IS DISTINCT FROM v_current_usage_owner_id THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  -- An authenticated caller always receives the Tauri rate. Only trusted
  -- service-role code at the Web Live gateway can select web_live.
  v_channel := CASE
    WHEN auth.role() = 'service_role' THEN lower(COALESCE(p_channel, 'tauri'))
    ELSE 'tauri'
  END;
  v_rate := public.workspace_usage_charge_rate(v_channel);
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Unsupported workspace usage channel';
  END IF;

  IF COALESCE(p_bytes, 0) < 0 THEN
    RAISE EXCEPTION 'Usage bytes must be non-negative';
  END IF;

  v_charged_delta := COALESCE(p_bytes, 0)::numeric * v_rate::numeric;
  IF v_charged_delta > 9223372036854775807::numeric THEN
    RAISE EXCEPTION 'Workspace usage counter overflow';
  END IF;

  v_request_id := CASE
    WHEN auth.role() = 'service_role' THEN COALESCE(p_request_id, gen_random_uuid())
    ELSE gen_random_uuid()
  END;

  PERFORM public.apply_workspace_charged_usage(
    v_workspace_id,
    v_charged_delta::bigint,
    v_channel,
    p_source,
    v_request_id
  );

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
      NULL::bigint,
      NULL::bigint,
      0::bigint,
      NULL::bigint;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    usage.workspace_id,
    usage.transfer_period_start,
    usage.data_transfer_bytes,
    CASE
      WHEN limits.monthly_data_transfer_limit_bytes IS NULL THEN NULL::bigint
      ELSE (limits.monthly_data_transfer_limit_bytes::numeric + usage.purchased_credit_bytes::numeric)::bigint
    END,
    limits.monthly_data_transfer_limit_bytes,
    usage.purchased_credit_bytes,
    CASE
      WHEN limits.monthly_data_transfer_limit_bytes IS NULL THEN NULL::bigint
      ELSE (limits.monthly_data_transfer_limit_bytes::numeric + usage.purchased_credit_bytes::numeric)::bigint
    END
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.get_workspace_usage_status(uuid);

CREATE FUNCTION public.get_workspace_usage_status(
  p_workspace_id uuid DEFAULT NULL
)
RETURNS TABLE (
  workspace_id uuid,
  has_limits boolean,
  storage_units bigint,
  storage_unit_limit bigint,
  charged_usage_bytes bigint,
  monthly_data_transfer_limit_bytes bigint,
  transfer_period_start date,
  base_monthly_data_transfer_limit_bytes bigint,
  purchased_credit_bytes bigint,
  effective_monthly_data_transfer_limit_bytes bigint,
  usage_limit_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
      public.workspace_usage_period_start(v_usage_owner_id),
      NULL::bigint,
      0::bigint,
      NULL::bigint,
      false;
    RETURN;
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);
  PERFORM public.reconcile_workspace_usage_limit_lock(v_usage_owner_id);

  RETURN QUERY
  SELECT
    usage.workspace_id,
    true AS has_limits,
    usage.storage_units,
    limits.storage_unit_limit,
    usage.data_transfer_bytes,
    CASE
      WHEN limits.monthly_data_transfer_limit_bytes IS NULL THEN NULL::bigint
      ELSE (limits.monthly_data_transfer_limit_bytes::numeric + usage.purchased_credit_bytes::numeric)::bigint
    END,
    usage.transfer_period_start,
    limits.monthly_data_transfer_limit_bytes,
    usage.purchased_credit_bytes,
    CASE
      WHEN limits.monthly_data_transfer_limit_bytes IS NULL THEN NULL::bigint
      ELSE (limits.monthly_data_transfer_limit_bytes::numeric + usage.purchased_credit_bytes::numeric)::bigint
    END,
    workspace_row.usage_limit_locked
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  INNER JOIN public.workspaces AS workspace_row
    ON workspace_row.id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id;
END;
$function$;

ALTER TABLE public.workspace_usage
  DROP COLUMN IF EXISTS actual_data_transfer_bytes,
  DROP COLUMN IF EXISTS tauri_charged_usage_bytes,
  DROP COLUMN IF EXISTS web_live_charged_usage_bytes,
  DROP COLUMN IF EXISTS manual_charged_usage_bytes;

COMMENT ON COLUMN public.workspace_usage.data_transfer_bytes IS
  'The only persisted transfer counter: total charged workspace usage for the current period.';
COMMENT ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text, text, uuid) IS
  'Measures bytes transiently, applies the server-owned request rate, and atomically increments the single charged usage counter.';
COMMENT ON FUNCTION public.get_workspace_usage_status(uuid) IS
  'Returns the single charged-usage total and its effective allowance. No raw or channel-specific counters are persisted.';

REVOKE ALL ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_usage_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_workspace_charged_usage(uuid, bigint, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_workspace_data_transfer_usage(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_usage_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_workspace_charged_usage(uuid, bigint, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_workspace_data_transfer_usage(uuid, bigint) TO service_role;

NOTIFY pgrst, 'reload schema';
