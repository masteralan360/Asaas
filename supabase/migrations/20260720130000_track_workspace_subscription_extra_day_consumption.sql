-- Track how much of a temporary subscription extension has actually elapsed.
-- The subscription itself is extended immediately, but a renewal approval only
-- charges back the part of that extension which has not yet been used.
--
-- Time is measured precisely (rather than rounding a partial day up or down),
-- while the consumption table below retains one immutable entry for every
-- completed 24-hour temporary day. This makes the settlement fair even when a
-- renewal is approved part-way through a day.

ALTER TABLE billing.workspace_subscription_extra_days
  ADD COLUMN temporary_period_starts_at timestamptz,
  ADD COLUMN consumed_duration_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN last_consumption_recorded_at timestamptz NULL;

-- Pending rows created before this migration have already extended the source
-- workspace expiry by their full allowance, so its prior boundary is the
-- temporary-period start. There can only be one such pending row per workspace.
UPDATE billing.workspace_subscription_extra_days AS extra_days
SET temporary_period_starts_at = GREATEST(
  extra_days.granted_at,
  COALESCE(
    workspace_row.subscription_expires_at
      - make_interval(days => extra_days.extra_days),
    extra_days.granted_at
  )
)
FROM public.workspaces AS workspace_row
WHERE workspace_row.id = extra_days.workspace_id
  AND extra_days.temporary_period_starts_at IS NULL;

ALTER TABLE billing.workspace_subscription_extra_days
  ALTER COLUMN temporary_period_starts_at SET NOT NULL,
  ADD CONSTRAINT workspace_subscription_extra_days_consumed_duration_check
    CHECK (
      consumed_duration_seconds >= 0
      AND consumed_duration_seconds <= extra_days * 86400
    );

COMMENT ON COLUMN billing.workspace_subscription_extra_days.temporary_period_starts_at IS
  'The instant the temporary extension begins: the prior subscription expiry, or the grant time when already expired.';
COMMENT ON COLUMN billing.workspace_subscription_extra_days.consumed_duration_seconds IS
  'Elapsed temporary entitlement, updated continuously and capped at the granted number of days.';

-- These rows deliberately keep the grant UUID as an audit value rather than a
-- foreign key: the pending grant row is deleted atomically on settlement, but
-- completed-day history must remain available afterwards.
CREATE TABLE billing.workspace_subscription_extra_day_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extra_days_grant_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  day_number smallint NOT NULL,
  consumed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT workspace_subscription_extra_day_consumption_day_number_check
    CHECK (day_number BETWEEN 1 AND 6),
  CONSTRAINT workspace_subscription_extra_day_consumption_grant_day_unique
    UNIQUE (extra_days_grant_id, day_number)
);

COMMENT ON TABLE billing.workspace_subscription_extra_day_consumption IS
  'Immutable audit record for each completed 24-hour interval of a temporary subscription extension.';

CREATE TABLE billing.workspace_subscription_extra_day_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extra_days_grant_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  payment_transaction_id uuid NOT NULL UNIQUE,
  granted_extra_days smallint NOT NULL,
  consumed_duration_seconds integer NOT NULL,
  deducted_duration_seconds integer NOT NULL,
  temporary_period_starts_at timestamptz NOT NULL,
  granted_at timestamptz NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  settled_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT workspace_subscription_extra_day_settlements_granted_days_check
    CHECK (granted_extra_days BETWEEN 1 AND 6),
  CONSTRAINT workspace_subscription_extra_day_settlements_consumed_duration_check
    CHECK (
      consumed_duration_seconds >= 0
      AND consumed_duration_seconds <= granted_extra_days * 86400
    ),
  CONSTRAINT workspace_subscription_extra_day_settlements_deducted_duration_check
    CHECK (deducted_duration_seconds >= 0),
  CONSTRAINT workspace_subscription_extra_day_settlements_duration_balance_check
    CHECK (
      consumed_duration_seconds + deducted_duration_seconds
        = granted_extra_days * 86400
    )
);

COMMENT ON TABLE billing.workspace_subscription_extra_day_settlements IS
  'Permanent audit of the precise used and deducted portions of a settled temporary subscription extension.';

ALTER TABLE billing.workspace_subscription_extra_day_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.workspace_subscription_extra_day_settlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE billing.workspace_subscription_extra_day_consumption
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE billing.workspace_subscription_extra_day_settlements
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE billing.workspace_subscription_extra_day_consumption TO service_role;
GRANT SELECT ON TABLE billing.workspace_subscription_extra_day_settlements TO service_role;

CREATE OR REPLACE FUNCTION billing.sync_workspace_subscription_extra_day_consumption(
  p_workspace_id uuid DEFAULT NULL,
  p_observed_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_updated_count integer := 0;
BEGIN
  -- First persist every newly completed 24-hour interval, then update the
  -- precise elapsed duration. The unique grant/day key makes concurrent cron
  -- and approval executions idempotent.
  WITH consumption_targets AS (
    SELECT
      extra_days.id AS extra_days_grant_id,
      extra_days.workspace_id,
      extra_days.temporary_period_starts_at,
      extra_days.consumed_duration_seconds,
      LEAST(
        extra_days.extra_days::integer * 86400,
        GREATEST(
          0,
          FLOOR(
            EXTRACT(
              EPOCH FROM p_observed_at - extra_days.temporary_period_starts_at
            )
          )::integer
        )
      ) AS target_consumed_duration_seconds
    FROM billing.workspace_subscription_extra_days AS extra_days
    WHERE extra_days.status = 'pending'
      AND (p_workspace_id IS NULL OR extra_days.workspace_id = p_workspace_id)
  ),
  inserted_daily_consumption AS (
    INSERT INTO billing.workspace_subscription_extra_day_consumption (
      extra_days_grant_id,
      workspace_id,
      day_number,
      consumed_at,
      recorded_at
    )
    SELECT
      target.extra_days_grant_id,
      target.workspace_id,
      day_number::smallint,
      target.temporary_period_starts_at + make_interval(days => day_number),
      p_observed_at
    FROM consumption_targets AS target
    CROSS JOIN LATERAL generate_series(
      target.consumed_duration_seconds / 86400 + 1,
      target.target_consumed_duration_seconds / 86400
    ) AS daily_consumption(day_number)
    ON CONFLICT (extra_days_grant_id, day_number) DO NOTHING
    RETURNING id
  )
  UPDATE billing.workspace_subscription_extra_days AS extra_days
  SET
    consumed_duration_seconds = target.target_consumed_duration_seconds,
    last_consumption_recorded_at = p_observed_at
  FROM consumption_targets AS target
  WHERE extra_days.id = target.extra_days_grant_id
    AND extra_days.consumed_duration_seconds
      IS DISTINCT FROM target.target_consumed_duration_seconds;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$function$;

COMMENT ON FUNCTION billing.sync_workspace_subscription_extra_day_consumption(uuid, timestamptz) IS
  'Records current temporary-extension consumption precisely and emits an immutable row for each completed temporary day.';

-- The first implementation is now the internal base called by the
-- administrator-only wrapper. Record exactly where the temporary period starts
-- so consumption does not begin while an ordinary subscription is still valid.
CREATE OR REPLACE FUNCTION public.grant_workspace_subscription_extra_days_base(
  p_extra_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := public.current_workspace_id();
  v_billing_workspace_id uuid;
  v_configuration billing.workspace_payment_configurations;
  v_extra_days billing.workspace_subscription_extra_days;
  v_temporary_period_starts_at timestamptz;
  v_subscription_expires_at timestamptz;
BEGIN
  IF v_user_id IS NULL OR v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_authentication_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_extra_days IS NULL OR p_extra_days NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'invalid_workspace_subscription_extra_days'
      USING ERRCODE = '22023',
        DETAIL = 'Extra days must be an integer between 1 and 6.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'workspace-branch-payment-owner:' || v_workspace_id::text,
      0
    )
  );

  SELECT public.workspace_usage_owner_id(workspace_row.id)
  INTO v_billing_workspace_id
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_workspace_id
    AND workspace_row.deleted_at IS NULL;

  IF v_billing_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('workspace-payment:' || v_billing_workspace_id::text, 0)
  );

  SELECT configuration_row.*
  INTO v_configuration
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE configuration_row.workspace_id = v_workspace_id
  FOR UPDATE;

  IF v_configuration.id IS NULL THEN
    RAISE EXCEPTION 'workspace_payment_configuration_missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_configuration.usage_enabled THEN
    RAISE EXCEPTION 'workspace_subscription_extra_days_not_available_for_usage_billing'
      USING ERRCODE = '23514',
        DETAIL = 'Extra days can only be granted to subscription-based workspaces.';
  END IF;

  SELECT GREATEST(
    COALESCE(workspace_row.subscription_expires_at, now()),
    now()
  )
  INTO v_temporary_period_starts_at
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_billing_workspace_id
    AND workspace_row.deleted_at IS NULL
  FOR UPDATE;

  IF v_temporary_period_starts_at IS NULL THEN
    RAISE EXCEPTION 'billing_workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO billing.workspace_subscription_extra_days (
    workspace_id,
    extra_days,
    granted_by,
    temporary_period_starts_at
  )
  VALUES (
    v_billing_workspace_id,
    p_extra_days,
    v_user_id,
    v_temporary_period_starts_at
  )
  ON CONFLICT (workspace_id) DO NOTHING
  RETURNING * INTO v_extra_days;

  IF v_extra_days.id IS NULL THEN
    RAISE EXCEPTION 'workspace_subscription_extra_days_already_pending'
      USING ERRCODE = '23505',
        DETAIL = 'A temporary extra-days record already exists for this workspace.';
  END IF;

  UPDATE public.workspaces AS workspace_row
  SET
    subscription_expires_at = v_temporary_period_starts_at
      + make_interval(days => p_extra_days),
    locked_workspace = CASE
      WHEN workspace_row.subscription_expiry_locked THEN
        workspace_row.usage_limit_locked OR workspace_row.payment_renewal_locked
      ELSE workspace_row.locked_workspace
    END,
    subscription_expiry_locked = false
  WHERE workspace_row.id = v_billing_workspace_id
    AND workspace_row.deleted_at IS NULL
  RETURNING workspace_row.subscription_expires_at
  INTO v_subscription_expires_at;

  IF v_subscription_expires_at IS NULL THEN
    RAISE EXCEPTION 'billing_workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'id', v_extra_days.id,
    'workspace_id', v_extra_days.workspace_id,
    'extra_days', v_extra_days.extra_days,
    'status', v_extra_days.status,
    'granted_at', v_extra_days.granted_at,
    'temporary_period_starts_at', v_extra_days.temporary_period_starts_at,
    'consumed_duration_seconds', 0,
    'remaining_duration_seconds', p_extra_days * 86400,
    'subscription_expires_at', v_subscription_expires_at
  );
END;
$function$;

COMMENT ON FUNCTION public.grant_workspace_subscription_extra_days_base(integer) IS
  'Creates one temporary extension with a precise consumption start boundary. The public wrapper restricts grants to workspace administrators.';

CREATE OR REPLACE FUNCTION public.get_workspace_payment_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_result jsonb;
  v_workspace_id uuid := public.current_workspace_id();
  v_billing_workspace_id uuid;
  v_extra_days billing.workspace_subscription_extra_days;
BEGIN
  v_result := public.get_workspace_payment_summary_base();

  SELECT public.workspace_usage_owner_id(workspace_row.id)
  INTO v_billing_workspace_id
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_workspace_id
    AND workspace_row.deleted_at IS NULL;

  IF v_billing_workspace_id IS NOT NULL THEN
    PERFORM billing.sync_workspace_subscription_extra_day_consumption(
      v_billing_workspace_id,
      now()
    );
  END IF;

  SELECT extra_days.*
  INTO v_extra_days
  FROM billing.workspace_subscription_extra_days AS extra_days
  WHERE extra_days.workspace_id = v_billing_workspace_id
    AND extra_days.status = 'pending';

  RETURN v_result || jsonb_build_object(
    'pending_extra_days', CASE
      WHEN v_extra_days.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_extra_days.id,
        'workspace_id', v_extra_days.workspace_id,
        'extra_days', v_extra_days.extra_days,
        'granted_at', v_extra_days.granted_at,
        'temporary_period_starts_at', v_extra_days.temporary_period_starts_at,
        'consumed_duration_seconds', v_extra_days.consumed_duration_seconds,
        'remaining_duration_seconds',
          v_extra_days.extra_days::integer * 86400
            - v_extra_days.consumed_duration_seconds
      )
    END
  );
END;
$function$;

COMMENT ON FUNCTION public.get_workspace_payment_summary() IS
  'Returns the authenticated workspace billing state and the precise consumed and remaining portions of any pending temporary extension.';

-- Replace the original full-day debit wrapper. The payment base still performs
-- the approved subscription update; this wrapper then subtracts only the
-- unused temporary duration and deletes the pending grant in the same SQL
-- transaction. Any error rolls the approval, settlement, and deletion back.
ALTER FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text)
  RENAME TO admin_review_workspace_payment_transaction_extra_day_v1;

CREATE OR REPLACE FUNCTION public.admin_review_workspace_payment_transaction(
  p_transaction_id uuid,
  p_decision text,
  p_note text,
  p_reviewer_label text,
  p_provider_payment_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_decision text := lower(btrim(COALESCE(p_decision, '')));
  v_billing_workspace_id uuid;
  v_transaction billing.payment_transactions;
  v_extra_days billing.workspace_subscription_extra_days;
  v_remaining_duration_seconds integer;
  v_adjusted_subscription_expires_at timestamptz;
  v_result jsonb;
BEGIN
  SELECT transaction_row.billing_workspace_id
  INTO v_billing_workspace_id
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.id = p_transaction_id;

  IF v_billing_workspace_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'workspace-branch-payment-owner:' || v_billing_workspace_id::text,
        0
      )
    );
    PERFORM pg_advisory_xact_lock(
      hashtextextended('workspace-payment:' || v_billing_workspace_id::text, 0)
    );
  END IF;

  v_result := public.admin_review_workspace_payment_transaction_base(
    p_transaction_id,
    p_decision,
    p_note,
    p_reviewer_label,
    p_provider_payment_id
  );

  IF v_decision <> 'approved' THEN
    RETURN v_result;
  END IF;

  SELECT transaction_row.*
  INTO v_transaction
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.id = p_transaction_id
  FOR UPDATE;

  IF v_transaction.status <> 'approved'
    OR v_transaction.payment_type <> 'subscription' THEN
    RETURN v_result;
  END IF;

  -- Refresh at approval time, regardless of the cadence of the background
  -- sync job, so the settlement uses the exact elapsed temporary duration.
  PERFORM billing.sync_workspace_subscription_extra_day_consumption(
    v_transaction.billing_workspace_id,
    now()
  );

  SELECT extra_days.*
  INTO v_extra_days
  FROM billing.workspace_subscription_extra_days AS extra_days
  WHERE extra_days.workspace_id = v_transaction.billing_workspace_id
    AND extra_days.status = 'pending'
  FOR UPDATE;

  IF v_extra_days.id IS NULL THEN
    RETURN v_result;
  END IF;

  v_remaining_duration_seconds := v_extra_days.extra_days::integer * 86400
    - v_extra_days.consumed_duration_seconds;

  UPDATE public.workspaces AS workspace_row
  SET subscription_expires_at = workspace_row.subscription_expires_at
    - make_interval(secs => v_remaining_duration_seconds)
  WHERE workspace_row.id = v_transaction.billing_workspace_id
    AND workspace_row.deleted_at IS NULL
  RETURNING workspace_row.subscription_expires_at
  INTO v_adjusted_subscription_expires_at;

  IF v_adjusted_subscription_expires_at IS NULL THEN
    RAISE EXCEPTION 'billing_workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO billing.workspace_subscription_extra_day_settlements (
    extra_days_grant_id,
    workspace_id,
    payment_transaction_id,
    granted_extra_days,
    consumed_duration_seconds,
    deducted_duration_seconds,
    temporary_period_starts_at,
    granted_at,
    settled_by
  )
  VALUES (
    v_extra_days.id,
    v_extra_days.workspace_id,
    v_transaction.id,
    v_extra_days.extra_days,
    v_extra_days.consumed_duration_seconds,
    v_remaining_duration_seconds,
    v_extra_days.temporary_period_starts_at,
    v_extra_days.granted_at,
    auth.uid()
  );

  DELETE FROM billing.workspace_subscription_extra_days AS extra_days
  WHERE extra_days.id = v_extra_days.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_subscription_extra_days_delete_failed'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_result || jsonb_build_object(
    'subscription_expires_at', v_adjusted_subscription_expires_at,
    'extra_days_granted', v_extra_days.extra_days,
    'extra_days_consumed_duration_seconds', v_extra_days.consumed_duration_seconds,
    'extra_days_deducted_duration_seconds', v_remaining_duration_seconds
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text) IS
  'Atomically reviews a payment and settles a pending temporary extension by deducting only its unused duration.';

DROP FUNCTION public.admin_review_workspace_payment_transaction_extra_day_v1(
  uuid, text, text, text, text
);

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'sync-workspace-subscription-extra-day-consumption'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$do$;

SELECT cron.schedule(
  'sync-workspace-subscription-extra-day-consumption',
  '*/15 * * * *',
  $$SELECT billing.sync_workspace_subscription_extra_day_consumption(NULL, now());$$
);

REVOKE ALL ON FUNCTION billing.sync_workspace_subscription_extra_day_consumption(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
