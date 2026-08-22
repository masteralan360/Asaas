-- Usage is a single, immediate counter. Do not retain one row per metered
-- request: the event log added an extra insert and index write to every CRUD
-- operation, while it is not used to calculate or display usage.

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
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
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

  UPDATE public.workspace_usage
  SET
    data_transfer_bytes = data_transfer_bytes + p_charged_usage_bytes,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = v_usage_owner_id;

  RETURN p_charged_usage_bytes;
END;
$function$;

-- This RPC exists for its side effect only. The caller needs an error status
-- for a rejected/locked charge, not a second payload containing the usage
-- counter it can retrieve through get_workspace_usage_status when needed.
DROP FUNCTION IF EXISTS public.record_workspace_data_transfer(uuid, bigint, text, text, uuid);

CREATE FUNCTION public.record_workspace_data_transfer(
  p_workspace_id uuid,
  p_bytes bigint,
  p_source text DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS void
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
BEGIN
  IF v_workspace_id IS NULL OR v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_usage_owner_id IS DISTINCT FROM v_current_usage_owner_id THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  -- Only the server-held Web Live credential may select the web rate.
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

  -- p_source and p_request_id remain accepted for older clients, but are not
  -- persisted. Usage is intentionally one counter, not a request ledger.
  PERFORM public.apply_workspace_charged_usage(
    v_workspace_id,
    v_charged_delta::bigint,
    v_channel,
    p_source,
    p_request_id
  );
END;
$function$;

DROP TABLE IF EXISTS billing.workspace_usage_charge_events;

COMMENT ON FUNCTION public.apply_workspace_charged_usage(uuid, bigint, text, text, uuid) IS
  'Atomically increments the one charged workspace-usage counter. Request metadata is not persisted.';
COMMENT ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text, text, uuid) IS
  'Measures bytes transiently, applies the server-owned request rate, and increments the one charged usage counter without returning a usage payload.';

REVOKE ALL ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_workspace_charged_usage(uuid, bigint, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_workspace_charged_usage(uuid, bigint, text, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
