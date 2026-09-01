-- Usage-based workspaces are governed entirely by renewal_due_at.  The
-- workspace subscription expiry remains for subscription billing only and is
-- no longer used as a usage-cycle/reset anchor.

-- Preserve existing usage schedules before removing the legacy anchor.  The
-- previous helper derives the next due date from subscription_expires_at.
UPDATE billing.workspace_payment_configurations AS configuration_row
SET renewal_due_at = billing.next_workspace_usage_renewal_due(
  configuration_row.workspace_id,
  now()
)
WHERE configuration_row.usage_enabled = true
  AND configuration_row.renewal_due_at IS NULL;

CREATE OR REPLACE FUNCTION billing.next_workspace_usage_renewal_due(
  p_workspace_id uuid,
  p_reference timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_billing_workspace_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_reference timestamptz := COALESCE(p_reference, now());
BEGIN
  IF v_billing_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_reference + INTERVAL '1 month';
END;
$function$;

COMMENT ON FUNCTION billing.next_workspace_usage_renewal_due(uuid, timestamptz) IS
  'Returns the next monthly usage-renewal deadline by advancing the current renewal due timestamp.';

CREATE OR REPLACE FUNCTION public.workspace_usage_period_start(
  p_workspace_id uuid
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_renewal_due_at timestamptz;
  v_today date := timezone('utc', now())::date;
  v_month_start date;
  v_reset_day integer;
  v_period_start date;
BEGIN
  IF v_usage_owner_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.workspace_usage_limits AS limits
      WHERE limits.workspace_id = v_usage_owner_id
    ) THEN
    RETURN date_trunc('month', v_today)::date;
  END IF;

  SELECT max(configuration_row.renewal_due_at)
  INTO v_renewal_due_at
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE configuration_row.usage_enabled = true
    AND public.workspace_usage_owner_id(configuration_row.workspace_id)
      = v_usage_owner_id;

  IF v_renewal_due_at IS NULL THEN
    RETURN date_trunc('month', v_today)::date;
  END IF;

  v_reset_day := EXTRACT(DAY FROM v_renewal_due_at AT TIME ZONE 'utc')::integer;
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
  'Returns the current usage-cycle start. Usage-limited workspaces reset on the UTC day of their authoritative renewal_due_at value; other workspaces use the first day of the calendar month.';

COMMENT ON FUNCTION public.sync_workspace_usage_periods(uuid) IS
  'Lazily resets transfer counters for every usage-limited workspace whose renewal-due-anchored cycle has rolled over.';
