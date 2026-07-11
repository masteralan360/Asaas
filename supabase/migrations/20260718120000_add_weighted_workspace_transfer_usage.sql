-- Workspace transfer accounting intentionally keeps two different counters:
--
--   actual_data_transfer_bytes = real measured upload/download payload bytes
--   data_transfer_bytes        = charged usage after the commercial 10x weight
--
-- Existing callers continue sending actual bytes. Only
-- apply_workspace_data_transfer_usage() applies the weight, exactly once.

ALTER TABLE public.workspace_usage
  ADD COLUMN actual_data_transfer_bytes bigint NOT NULL DEFAULT 0;

ALTER TABLE public.workspace_usage
  DROP CONSTRAINT IF EXISTS workspace_usage_actual_transfer_nonnegative_check;

ALTER TABLE public.workspace_usage
  ADD CONSTRAINT workspace_usage_actual_transfer_nonnegative_check
  CHECK (actual_data_transfer_bytes >= 0);

-- The old standard allowances were advertised as 100 MB, 10 GB, 25 GB,
-- 50 GB, 100 GB, and 200 GB. Recognize both decimal marketing units and
-- the binary values that older application code may have saved. New charged
-- allowances intentionally use decimal GB: 1/6/15/30/60/120 GB.
--
-- Exact matches are presumed to be standard commercial tiers. Non-matching
-- custom values and NULL (unlimited) are deliberately left unchanged because
-- workspace_usage_limits does not store a pricing-tier identifier from which a
-- safer remap could be inferred.
--
-- Disable both one-way lock triggers while limits and counters are converted.
-- They are re-enabled before a final lock check; this migration never unlocks a
-- workspace because locked_workspace also represents manual/subscription locks.
ALTER TABLE public.workspace_usage
  DISABLE TRIGGER enforce_workspace_transfer_limit_lock_on_usage;

ALTER TABLE public.workspace_usage_limits
  DISABLE TRIGGER enforce_workspace_transfer_limit_lock_on_limits;

UPDATE public.workspace_usage_limits
SET monthly_data_transfer_limit_bytes = CASE
  WHEN monthly_data_transfer_limit_bytes IN (100000000::bigint, 104857600::bigint)
    THEN 1000000000::bigint
  WHEN monthly_data_transfer_limit_bytes IN (10000000000::bigint, 10737418240::bigint)
    THEN 6000000000::bigint
  WHEN monthly_data_transfer_limit_bytes IN (25000000000::bigint, 26843545600::bigint)
    THEN 15000000000::bigint
  WHEN monthly_data_transfer_limit_bytes IN (50000000000::bigint, 53687091200::bigint)
    THEN 30000000000::bigint
  WHEN monthly_data_transfer_limit_bytes IN (100000000000::bigint, 107374182400::bigint)
    THEN 60000000000::bigint
  WHEN monthly_data_transfer_limit_bytes IN (200000000000::bigint, 214748364800::bigint)
    THEN 120000000000::bigint
  ELSE monthly_data_transfer_limit_bytes
END
WHERE monthly_data_transfer_limit_bytes IN (
  100000000::bigint,
  104857600::bigint,
  10000000000::bigint,
  10737418240::bigint,
  25000000000::bigint,
  26843545600::bigint,
  50000000000::bigint,
  53687091200::bigint,
  100000000000::bigint,
  107374182400::bigint,
  200000000000::bigint,
  214748364800::bigint
);

-- workspace_usage resets lazily. Discard counters from finished periods before
-- conversion so an old month cannot be weighted and permanently lock a family.
UPDATE public.workspace_usage
SET
  actual_data_transfer_bytes = 0,
  data_transfer_bytes = 0,
  transfer_period_start = public.current_workspace_usage_period_start(),
  transfer_updated_at = timezone('utc', now()),
  updated_at = timezone('utc', now())
WHERE transfer_period_start IS DISTINCT FROM public.current_workspace_usage_period_start();

-- Before this migration data_transfer_bytes contained actual bytes. Preserve that
-- measurement, then convert the compatibility/enforcement column to charged usage.
-- Refuse impossible legacy values instead of silently saturating and breaking the
-- exact actual-to-charged relationship.
DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.workspace_usage AS usage
    WHERE usage.data_transfer_bytes > 922337203685477580::bigint
  ) THEN
    RAISE EXCEPTION 'Existing workspace data transfer counter cannot be weighted without bigint overflow';
  END IF;
END;
$block$;

UPDATE public.workspace_usage
SET
  actual_data_transfer_bytes = data_transfer_bytes,
  data_transfer_bytes = (data_transfer_bytes::numeric * 10::numeric)::bigint;

ALTER TABLE public.workspace_usage
  DROP CONSTRAINT IF EXISTS workspace_usage_transfer_counters_consistent_check;

-- Both counters are cumulative within the same monthly period, so charged usage
-- must always be exactly ten times the raw measured transfer counter. The literal
-- 10 is intentional: changing the multiplier function without a matching counter
-- migration must fail loudly instead of silently corrupting the relationship.
ALTER TABLE public.workspace_usage
  ADD CONSTRAINT workspace_usage_transfer_counters_consistent_check
  CHECK (
    data_transfer_bytes::numeric
      = actual_data_transfer_bytes::numeric * 10::numeric
  );

ALTER TABLE public.workspace_usage_limits
  ENABLE TRIGGER enforce_workspace_transfer_limit_lock_on_limits;

ALTER TABLE public.workspace_usage
  ENABLE TRIGGER enforce_workspace_transfer_limit_lock_on_usage;

COMMENT ON COLUMN public.workspace_usage.actual_data_transfer_bytes IS
  'Real measured request/response and file payload bytes for the current transfer period. Never weighted.';

COMMENT ON COLUMN public.workspace_usage.data_transfer_bytes IS
  'Charged workspace usage for limit enforcement. Equals actual_data_transfer_bytes multiplied by workspace_transfer_charge_multiplier().';

COMMENT ON COLUMN public.workspace_usage_limits.monthly_data_transfer_limit_bytes IS
  'Monthly charged-usage allowance in byte-equivalent units. Compare with workspace_usage.data_transfer_bytes, not actual_data_transfer_bytes.';

CREATE OR REPLACE FUNCTION public.workspace_transfer_charge_multiplier()
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT 10::bigint;
$function$;

COMMENT ON FUNCTION public.workspace_transfer_charge_multiplier() IS
  'Commercial usage weight. One actual transferred byte consumes ten charged byte-equivalent units.';

-- Lock only the usage owner. The existing workspace status trigger propagates
-- the lock from a source workspace through its branch hierarchy. Updating the
-- same branches here as well can make PostgreSQL update a trigger-modified tuple
-- twice in one statement.
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
    AND usage.transfer_period_start = public.current_workspace_usage_period_start();

  IF v_charged_usage_limit IS NOT NULL
    AND COALESCE(v_charged_usage_bytes, 0) >= v_charged_usage_limit THEN
    UPDATE public.workspaces AS workspace_row
    SET locked_workspace = true
    WHERE workspace_row.id = v_usage_owner_id
      AND COALESCE(workspace_row.locked_workspace, false) = false;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.lock_workspace_when_transfer_limit_reached(uuid) IS
  'Locks the source usage owner when current charged usage reaches its charged allowance; workspace status triggers propagate the lock to branches.';

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
    actual_data_transfer_bytes = 0,
    data_transfer_bytes = 0,
    transfer_period_start = v_period,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = v_usage_owner_id
    AND transfer_period_start IS DISTINCT FROM v_period;
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
  v_actual_current bigint;
  v_multiplier bigint := public.workspace_transfer_charge_multiplier();
  v_actual_next numeric;
  v_charged_next numeric;
BEGIN
  IF v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  -- p_bytes is always ACTUAL measured transfer. Do not pre-multiply in callers.
  IF p_bytes IS NULL THEN
    RAISE EXCEPTION 'Actual data transfer bytes are required'
      USING ERRCODE = '22004';
  END IF;

  IF p_bytes < 0 THEN
    RAISE EXCEPTION 'Actual data transfer bytes must be zero or greater';
  END IF;

  IF v_multiplier IS NULL OR v_multiplier <= 0 THEN
    RAISE EXCEPTION 'Workspace transfer charge multiplier must be greater than zero';
  END IF;

  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);

  SELECT usage.actual_data_transfer_bytes
  INTO v_actual_current
  FROM public.workspace_usage AS usage
  WHERE usage.workspace_id = v_usage_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_actual_next := v_actual_current::numeric + p_bytes::numeric;
  v_charged_next := v_actual_next * v_multiplier::numeric;

  IF v_actual_next < 0::numeric
    OR v_actual_next > 9223372036854775807::numeric
    OR v_charged_next < 0::numeric
    OR v_charged_next > 9223372036854775807::numeric THEN
    RAISE EXCEPTION 'Workspace data transfer counter overflow';
  END IF;

  UPDATE public.workspace_usage
  SET
    actual_data_transfer_bytes = v_actual_next::bigint,
    data_transfer_bytes = v_charged_next::bigint,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = v_usage_owner_id;
END;
$function$;

COMMENT ON FUNCTION public.apply_workspace_data_transfer_usage(uuid, bigint) IS
  'Accepts actual measured bytes, stores them unchanged, and adds 10x charged usage to data_transfer_bytes.';

DROP FUNCTION IF EXISTS public.record_workspace_data_transfer(uuid, bigint, text);

CREATE FUNCTION public.record_workspace_data_transfer(
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

  -- p_bytes is actual transfer. The centralized apply function validates it and
  -- performs weighting exactly once.
  PERFORM public.apply_workspace_data_transfer_usage(v_workspace_id, p_bytes);

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

COMMENT ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) IS
  'Records p_bytes as actual transfer. Returns both actual_data_transfer_bytes and weighted data_transfer_bytes (charged usage).';

DROP FUNCTION IF EXISTS public.get_workspace_usage_status(uuid);

CREATE FUNCTION public.get_workspace_usage_status(
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

COMMENT ON FUNCTION public.get_workspace_usage_status(uuid) IS
  'Returns actual transfer separately from charged usage. Limits and locking use charged data_transfer_bytes.';

REVOKE ALL ON FUNCTION public.workspace_transfer_charge_multiplier() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_usage_status(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_usage_status(uuid) TO authenticated, service_role;

-- Evaluate locks only after every recognized standard allowance and every
-- current-period counter has its final charged-unit value. This is intentionally
-- one-way: never clear locked_workspace here because other lock reasons share it.
SELECT public.lock_workspace_when_transfer_limit_reached(usage.workspace_id)
FROM public.workspace_usage AS usage
INNER JOIN public.workspace_usage_limits AS limits
  ON limits.workspace_id = usage.workspace_id
WHERE limits.monthly_data_transfer_limit_bytes IS NOT NULL
  AND usage.transfer_period_start = public.current_workspace_usage_period_start()
  AND usage.data_transfer_bytes >= limits.monthly_data_transfer_limit_bytes;
