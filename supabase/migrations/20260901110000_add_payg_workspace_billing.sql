-- Versioned pay-as-you-go billing for the native charged-usage counter.
-- PAYG is family-owned: source workspaces and branches share one counter,
-- renewal boundary, cycle, payment submission, and approval result.

ALTER TABLE billing.workspace_payment_configurations
  ADD COLUMN IF NOT EXISTS payg_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pending_billing_mode text NULL,
  ADD COLUMN IF NOT EXISTS pending_subscription_amount numeric(20, 3) NULL,
  ADD COLUMN IF NOT EXISTS pending_gb_per_payment numeric(14, 6) NULL,
  ADD COLUMN IF NOT EXISTS pending_payment_enabled boolean NULL,
  ADD COLUMN IF NOT EXISTS pending_renewal_due_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pending_usage_start_date date NULL,
  ADD COLUMN IF NOT EXISTS payg_cycle_started_at timestamptz NULL;

ALTER TABLE billing.workspace_payment_configurations
  DROP CONSTRAINT IF EXISTS workspace_payment_configurations_usage_values_check,
  DROP CONSTRAINT IF EXISTS workspace_payment_configurations_enabled_amount_check,
  DROP CONSTRAINT IF EXISTS workspace_payment_configurations_payg_mode_check,
  DROP CONSTRAINT IF EXISTS workspace_payment_configurations_pending_mode_check;

ALTER TABLE billing.workspace_payment_configurations
  ADD CONSTRAINT workspace_payment_configurations_usage_values_check
    CHECK (NOT usage_enabled OR (gb_per_payment > 0 AND renewal_due_at IS NOT NULL)),
  ADD CONSTRAINT workspace_payment_configurations_enabled_amount_check
    CHECK (NOT is_payment_enabled OR subscription_amount >= 0),
  ADD CONSTRAINT workspace_payment_configurations_payg_mode_check
    CHECK (
      NOT payg_enabled
      OR (
        is_payment_enabled
        AND NOT usage_enabled
        AND renewal_due_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT workspace_payment_configurations_pending_mode_check
    CHECK (pending_billing_mode IS NULL OR pending_billing_mode IN ('monthly', 'prepaid_usage'));

ALTER TABLE public.workspace_usage_limits
  ADD COLUMN IF NOT EXISTS tracking_only boolean NOT NULL DEFAULT false,
  DROP CONSTRAINT IF EXISTS workspace_usage_limits_has_limit_check;

ALTER TABLE public.workspace_usage_limits
  ADD CONSTRAINT workspace_usage_limits_has_limit_check
  CHECK (
    storage_unit_limit IS NOT NULL
    OR monthly_data_transfer_limit_bytes IS NOT NULL
    OR tracking_only
  );

CREATE TABLE billing.payg_pricing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  currency text NOT NULL DEFAULT 'IQD' CHECK (currency = 'IQD'),
  checkpoints jsonb NOT NULL,
  published_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  published_by_label text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  retired_at timestamptz NULL,
  CHECK (jsonb_typeof(checkpoints) = 'array')
);

CREATE UNIQUE INDEX payg_pricing_versions_one_active
  ON billing.payg_pricing_versions ((retired_at IS NULL))
  WHERE retired_at IS NULL;

CREATE TABLE billing.payg_pricing_version_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pricing_version_id uuid NOT NULL REFERENCES billing.payg_pricing_versions(id),
  version_number bigint NOT NULL,
  before_checkpoints jsonb NULL,
  after_checkpoints jsonb NOT NULL,
  changed_by uuid NULL,
  changed_by_label text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE billing.payg_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  pricing_version_id uuid NOT NULL REFERENCES billing.payg_pricing_versions(id) ON DELETE RESTRICT,
  pricing_version_number bigint NOT NULL,
  pricing_snapshot jsonb NOT NULL,
  period_started_at timestamptz NOT NULL,
  renewal_due_at timestamptz NOT NULL,
  period_ended_at timestamptz NULL,
  charged_usage_bytes bigint NOT NULL DEFAULT 0 CHECK (charged_usage_bytes >= 0),
  charged_usage_gb numeric(20, 9) NOT NULL DEFAULT 0 CHECK (charged_usage_gb >= 0),
  included_free_gb numeric(14, 6) NOT NULL DEFAULT 1,
  amount_iqd numeric(20, 0) NOT NULL DEFAULT 0 CHECK (amount_iqd >= 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'awaiting_payment', 'paid', 'no_payment_required')),
  payment_transaction_id uuid NULL,
  closed_at timestamptz NULL,
  settled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CHECK (jsonb_typeof(pricing_snapshot) = 'array'),
  CHECK (
    (status = 'open' AND period_ended_at IS NULL AND closed_at IS NULL)
    OR (status <> 'open' AND period_ended_at IS NOT NULL AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX payg_cycles_one_unsettled_per_family
  ON billing.payg_cycles (billing_workspace_id)
  WHERE status IN ('open', 'awaiting_payment');

CREATE INDEX payg_cycles_family_history
  ON billing.payg_cycles (billing_workspace_id, period_started_at DESC);

ALTER TABLE billing.payment_transactions
  ADD COLUMN IF NOT EXISTS payg_cycle_id uuid NULL REFERENCES billing.payg_cycles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS billed_usage_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billed_usage_gb numeric(20, 9) NOT NULL DEFAULT 0;

ALTER TABLE billing.payg_cycles
  ADD CONSTRAINT payg_cycles_payment_transaction_fk
  FOREIGN KEY (payment_transaction_id)
  REFERENCES billing.payment_transactions(id)
  ON DELETE RESTRICT;

ALTER TABLE billing.payment_transactions
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_type_check,
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_type_values_check,
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_payg_values_check;

ALTER TABLE billing.payment_transactions
  ADD CONSTRAINT workspace_payment_transactions_type_check
    CHECK (payment_type IN ('subscription', 'usage', 'payg')),
  ADD CONSTRAINT workspace_payment_transactions_type_values_check
    CHECK (
      (payment_type = 'subscription' AND gb_added = 0 AND gb_added_bytes = 0 AND payg_cycle_id IS NULL)
      OR (payment_type = 'usage' AND gb_added > 0 AND gb_added_bytes > 0 AND payg_cycle_id IS NULL)
      OR (payment_type = 'payg' AND gb_added = 0 AND gb_added_bytes = 0 AND payg_cycle_id IS NOT NULL)
    ),
  ADD CONSTRAINT workspace_payment_transactions_payg_values_check
    CHECK (
      (payment_type <> 'payg' AND billed_usage_bytes = 0 AND billed_usage_gb = 0)
      OR (
        payment_type = 'payg'
        AND billed_usage_bytes > 1000000000
        AND billed_usage_gb = billed_usage_bytes::numeric / 1000000000::numeric
      )
    );

CREATE UNIQUE INDEX workspace_payment_transactions_one_per_payg_cycle
  ON billing.payment_transactions (payg_cycle_id)
  WHERE payg_cycle_id IS NOT NULL AND status IN ('pending', 'approved');

ALTER TABLE billing.payg_pricing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.payg_pricing_version_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.payg_cycles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON billing.payg_pricing_versions,
  billing.payg_pricing_version_audit,
  billing.payg_cycles
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON billing.payg_pricing_versions,
  billing.payg_pricing_version_audit,
  billing.payg_cycles
  TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA billing TO service_role;

CREATE OR REPLACE FUNCTION billing.enforce_payg_cycle_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, billing
AS $function$
BEGIN
  IF OLD.status IN ('paid', 'no_payment_required') AND to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RAISE EXCEPTION 'settled_payg_cycle_is_immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'awaiting_payment' AND (
    NEW.billing_workspace_id IS DISTINCT FROM OLD.billing_workspace_id
    OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
    OR NEW.pricing_version_number IS DISTINCT FROM OLD.pricing_version_number
    OR NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot
    OR NEW.period_started_at IS DISTINCT FROM OLD.period_started_at
    OR NEW.renewal_due_at IS DISTINCT FROM OLD.renewal_due_at
    OR NEW.period_ended_at IS DISTINCT FROM OLD.period_ended_at
    OR NEW.charged_usage_bytes IS DISTINCT FROM OLD.charged_usage_bytes
    OR NEW.charged_usage_gb IS DISTINCT FROM OLD.charged_usage_gb
    OR NEW.included_free_gb IS DISTINCT FROM OLD.included_free_gb
    OR NEW.amount_iqd IS DISTINCT FROM OLD.amount_iqd
    OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
  ) THEN
    RAISE EXCEPTION 'closed_payg_cycle_snapshot_is_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER enforce_payg_cycle_transition
BEFORE UPDATE ON billing.payg_cycles
FOR EACH ROW EXECUTE FUNCTION billing.enforce_payg_cycle_transition();

CREATE OR REPLACE FUNCTION billing.enforce_payg_pricing_version_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, billing
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.checkpoints IS DISTINCT FROM OLD.checkpoints
    OR NEW.published_by IS DISTINCT FROM OLD.published_by
    OR NEW.published_by_label IS DISTINCT FROM OLD.published_by_label
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR OLD.retired_at IS NOT NULL
    OR NEW.retired_at IS NULL THEN
    RAISE EXCEPTION 'payg_pricing_version_is_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER enforce_payg_pricing_version_transition
BEFORE UPDATE ON billing.payg_pricing_versions
FOR EACH ROW EXECUTE FUNCTION billing.enforce_payg_pricing_version_transition();

CREATE OR REPLACE FUNCTION billing.validate_payg_checkpoints(p_checkpoints jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_normalized jsonb;
  v_count integer;
BEGIN
  IF jsonb_typeof(p_checkpoints) <> 'array' THEN
    RAISE EXCEPTION 'payg_checkpoints_must_be_an_array' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'gb', (checkpoint->>'gb')::numeric,
      'amount_iqd', (checkpoint->>'amount_iqd')::bigint,
      'protected', ((checkpoint->>'gb')::numeric IN (1, 10, 100))
    ) ORDER BY (checkpoint->>'gb')::numeric
  ), count(*)
  INTO v_normalized, v_count
  FROM jsonb_array_elements(p_checkpoints) AS checkpoint
  WHERE checkpoint ? 'gb'
    AND checkpoint ? 'amount_iqd'
    AND checkpoint->>'gb' ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
    AND checkpoint->>'amount_iqd' ~ '^(0|[1-9][0-9]*)$';

  IF v_count <> jsonb_array_length(p_checkpoints) OR v_count < 3 THEN
    RAISE EXCEPTION 'invalid_payg_pricing_checkpoint' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(DISTINCT (checkpoint->>'gb')::numeric) FROM jsonb_array_elements(v_normalized) checkpoint) <> v_count
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_normalized) checkpoint
      WHERE (checkpoint->>'gb')::numeric < 1 OR (checkpoint->>'gb')::numeric > 100
    )
    OR EXISTS (
      SELECT 1
      FROM (
        SELECT
          (checkpoint->>'amount_iqd')::numeric AS amount_iqd,
          lag((checkpoint->>'amount_iqd')::numeric) OVER (ORDER BY (checkpoint->>'gb')::numeric) AS previous_amount
        FROM jsonb_array_elements(v_normalized) checkpoint
      ) ordered
      WHERE previous_amount IS NOT NULL AND amount_iqd < previous_amount
    ) THEN
    RAISE EXCEPTION 'invalid_payg_pricing_schedule' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_normalized) checkpoint
    WHERE (checkpoint->>'gb')::numeric = 1 AND (checkpoint->>'amount_iqd')::bigint = 0
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_normalized) checkpoint
    WHERE (checkpoint->>'gb')::numeric = 10 AND (checkpoint->>'amount_iqd')::bigint = 15000
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_normalized) checkpoint
    WHERE (checkpoint->>'gb')::numeric = 100 AND (checkpoint->>'amount_iqd')::bigint = 40000
  ) THEN
    RAISE EXCEPTION 'protected_payg_pricing_checkpoints_required' USING ERRCODE = '23514';
  END IF;

  RETURN v_normalized;
END;
$function$;

INSERT INTO billing.payg_pricing_versions (checkpoints, published_by_label)
SELECT billing.validate_payg_checkpoints(
  '[{"gb":1,"amount_iqd":0},{"gb":10,"amount_iqd":15000},{"gb":100,"amount_iqd":40000}]'::jsonb
), 'System default'
WHERE NOT EXISTS (SELECT 1 FROM billing.payg_pricing_versions);

CREATE OR REPLACE FUNCTION billing.calculate_payg_amount_from_checkpoints(
  p_checkpoints jsonb,
  p_charged_usage_bytes bigint
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, billing
AS $function$
DECLARE
  v_usage_gb numeric := GREATEST(COALESCE(p_charged_usage_bytes, 0), 0)::numeric / 1000000000::numeric;
  v_checkpoints jsonb := p_checkpoints;
  v_lower_gb numeric;
  v_lower_amount numeric;
  v_upper_gb numeric;
  v_upper_amount numeric;
BEGIN
  IF v_checkpoints IS NULL THEN
    RAISE EXCEPTION 'payg_pricing_snapshot_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_checkpoints := billing.validate_payg_checkpoints(v_checkpoints);
  IF v_usage_gb <= 1 THEN RETURN 0; END IF;
  -- The configured PAYG curve ends at 100 GB. Atlas does not lock, upgrade, or
  -- otherwise enforce an enterprise workflow above that point; it simply uses
  -- the final published checkpoint while the administrator handles contact-only plans.
  v_usage_gb := LEAST(v_usage_gb, 100);

  SELECT (checkpoint->>'gb')::numeric, (checkpoint->>'amount_iqd')::numeric
  INTO v_lower_gb, v_lower_amount
  FROM jsonb_array_elements(v_checkpoints) checkpoint
  WHERE (checkpoint->>'gb')::numeric <= v_usage_gb
  ORDER BY (checkpoint->>'gb')::numeric DESC LIMIT 1;

  SELECT (checkpoint->>'gb')::numeric, (checkpoint->>'amount_iqd')::numeric
  INTO v_upper_gb, v_upper_amount
  FROM jsonb_array_elements(v_checkpoints) checkpoint
  WHERE (checkpoint->>'gb')::numeric >= v_usage_gb
  ORDER BY (checkpoint->>'gb')::numeric ASC LIMIT 1;

  IF v_lower_gb = v_upper_gb THEN RETURN round(v_lower_amount); END IF;
  RETURN round(v_lower_amount + ((v_usage_gb - v_lower_gb) * (v_upper_amount - v_lower_amount) / (v_upper_gb - v_lower_gb)));
END;
$function$;

CREATE OR REPLACE FUNCTION billing.calculate_payg_amount(
  p_pricing_version_id uuid,
  p_charged_usage_bytes bigint
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $function$
DECLARE v_checkpoints jsonb;
BEGIN
  SELECT checkpoints INTO v_checkpoints
  FROM billing.payg_pricing_versions
  WHERE id = p_pricing_version_id;
  IF v_checkpoints IS NULL THEN
    RAISE EXCEPTION 'payg_pricing_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN billing.calculate_payg_amount_from_checkpoints(v_checkpoints, p_charged_usage_bytes);
END;
$function$;

CREATE OR REPLACE FUNCTION billing.start_payg_cycle(
  p_billing_workspace_id uuid,
  p_started_at timestamptz,
  p_renewal_due_at timestamptz
)
RETURNS billing.payg_cycles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $function$
DECLARE
  v_version billing.payg_pricing_versions;
  v_cycle billing.payg_cycles;
BEGIN
  SELECT * INTO v_version FROM billing.payg_pricing_versions
  WHERE retired_at IS NULL ORDER BY version_number DESC LIMIT 1;
  IF v_version.id IS NULL THEN
    RAISE EXCEPTION 'active_payg_pricing_version_missing' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO billing.payg_cycles (
    billing_workspace_id, pricing_version_id, pricing_version_number,
    pricing_snapshot, period_started_at, renewal_due_at
  ) VALUES (
    p_billing_workspace_id, v_version.id, v_version.version_number,
    v_version.checkpoints, p_started_at, p_renewal_due_at
  ) RETURNING * INTO v_cycle;
  RETURN v_cycle;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.close_due_payg_cycle(p_billing_workspace_id uuid)
RETURNS billing.payg_cycles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_cycle billing.payg_cycles;
  v_usage_bytes bigint := 0;
  v_amount numeric := 0;
  v_next_due timestamptz;
  v_pending_mode text;
  v_pending_amount numeric;
  v_pending_gb numeric;
  v_pending_enabled boolean;
  v_pending_due timestamptz;
  v_pending_start date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payg:' || p_billing_workspace_id::text, 0));
  SELECT * INTO v_cycle FROM billing.payg_cycles
  WHERE billing_workspace_id = p_billing_workspace_id AND status IN ('open', 'awaiting_payment')
  FOR UPDATE;

  IF v_cycle.id IS NULL OR v_cycle.status = 'awaiting_payment' OR v_cycle.renewal_due_at > now() THEN
    RETURN v_cycle;
  END IF;

  SELECT COALESCE(data_transfer_bytes, 0) INTO v_usage_bytes
  FROM public.workspace_usage WHERE workspace_id = p_billing_workspace_id FOR UPDATE;
  v_amount := billing.calculate_payg_amount_from_checkpoints(v_cycle.pricing_snapshot, v_usage_bytes);

  UPDATE billing.payg_cycles SET
    period_ended_at = v_cycle.renewal_due_at,
    charged_usage_bytes = v_usage_bytes,
    charged_usage_gb = v_usage_bytes::numeric / 1000000000::numeric,
    amount_iqd = v_amount,
    status = CASE WHEN v_amount = 0 THEN 'no_payment_required' ELSE 'awaiting_payment' END,
    closed_at = now(),
    settled_at = CASE WHEN v_amount = 0 THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = v_cycle.id RETURNING * INTO v_cycle;

  IF v_amount > 0 THEN
    PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);
    UPDATE public.workspaces SET locked_workspace = true, payment_renewal_locked = true
    WHERE id = p_billing_workspace_id;
  END IF;

  IF v_amount = 0 THEN
    UPDATE public.workspace_usage SET data_transfer_bytes = 0, updated_at = now()
    WHERE workspace_id = p_billing_workspace_id;
    v_next_due := billing.next_workspace_usage_renewal_due(
      p_billing_workspace_id,
      GREATEST(v_cycle.renewal_due_at, now())
    );
    SELECT pending_billing_mode, pending_subscription_amount,
      pending_gb_per_payment, pending_payment_enabled, pending_renewal_due_at,
      pending_usage_start_date
    INTO v_pending_mode, v_pending_amount, v_pending_gb,
      v_pending_enabled, v_pending_due, v_pending_start
    FROM billing.workspace_payment_configurations WHERE workspace_id = p_billing_workspace_id FOR UPDATE;
    IF v_pending_mode IS NOT NULL THEN
      PERFORM set_config('atlas.trusted_workspace_payment_family_mode_update', 'on', true);
      UPDATE billing.workspace_payment_configurations AS family_config SET
        payg_enabled = false,
        usage_enabled = v_pending_mode = 'prepaid_usage',
        gb_per_payment = CASE
          WHEN v_pending_mode = 'prepaid_usage' AND family_config.gb_per_payment <= 0 THEN v_pending_gb
          ELSE family_config.gb_per_payment
        END,
        renewal_due_at = CASE WHEN v_pending_mode = 'prepaid_usage' THEN v_next_due ELSE family_config.renewal_due_at END,
        usage_start_date = CASE WHEN v_pending_mode = 'prepaid_usage' THEN COALESCE(v_pending_start, now()::date) ELSE family_config.usage_start_date END,
        updated_at = now()
      WHERE family_config.workspace_id <> p_billing_workspace_id
        AND public.workspace_usage_owner_id(family_config.workspace_id) = p_billing_workspace_id;
      UPDATE billing.workspace_payment_configurations SET
        payg_enabled = false,
        usage_enabled = v_pending_mode = 'prepaid_usage',
        subscription_amount = v_pending_amount,
        gb_per_payment = CASE WHEN v_pending_mode = 'prepaid_usage' THEN v_pending_gb ELSE 0 END,
        is_payment_enabled = v_pending_enabled,
        pending_billing_mode = NULL,
        pending_subscription_amount = NULL,
        pending_gb_per_payment = NULL,
        pending_payment_enabled = NULL,
        pending_renewal_due_at = NULL,
        pending_usage_start_date = NULL,
        payg_cycle_started_at = NULL,
        renewal_due_at = CASE WHEN v_pending_mode = 'prepaid_usage' THEN v_next_due ELSE COALESCE(v_pending_due, renewal_due_at) END,
        usage_start_date = CASE WHEN v_pending_mode = 'prepaid_usage' THEN COALESCE(v_pending_start, now()::date) ELSE usage_start_date END,
        updated_at = now()
      WHERE workspace_id = p_billing_workspace_id;
      UPDATE public.workspace_usage_limits SET
        tracking_only = false,
        monthly_data_transfer_limit_bytes = COALESCE(monthly_data_transfer_limit_bytes, 0),
        updated_at = now()
      WHERE workspace_id = p_billing_workspace_id AND v_pending_mode = 'prepaid_usage';
      DELETE FROM public.workspace_usage_limits
      WHERE workspace_id = p_billing_workspace_id
        AND v_pending_mode = 'monthly'
        AND tracking_only
        AND storage_unit_limit IS NULL
        AND monthly_data_transfer_limit_bytes IS NULL;
      RETURN v_cycle;
    END IF;
    UPDATE billing.workspace_payment_configurations SET
      renewal_due_at = v_next_due, payg_cycle_started_at = now(), updated_at = now()
    WHERE workspace_id = p_billing_workspace_id;
    PERFORM billing.start_payg_cycle(p_billing_workspace_id, now(), v_next_due);
    SELECT * INTO v_cycle FROM billing.payg_cycles
    WHERE billing_workspace_id = p_billing_workspace_id AND status = 'open';
  END IF;
  RETURN v_cycle;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_workspace_usage_row(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_period date;
  v_payg_enabled boolean := false;
BEGIN
  IF v_usage_owner_id IS NULL THEN RAISE EXCEPTION 'Workspace is required'; END IF;
  IF p_workspace_id IS DISTINCT FROM v_usage_owner_id THEN
    DELETE FROM public.workspace_usage WHERE workspace_id = p_workspace_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_usage_limits WHERE workspace_id = v_usage_owner_id) THEN
    DELETE FROM public.workspace_usage WHERE workspace_id = v_usage_owner_id;
    PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);
    UPDATE public.workspaces SET locked_workspace = false, usage_limit_locked = false
    WHERE id = v_usage_owner_id AND usage_limit_locked = true;
    RETURN;
  END IF;

  SELECT COALESCE(payg_enabled, false) INTO v_payg_enabled
  FROM billing.workspace_payment_configurations WHERE workspace_id = v_usage_owner_id;
  IF v_payg_enabled THEN
    PERFORM billing.close_due_payg_cycle(v_usage_owner_id);
    SELECT COALESCE(payg_cycle_started_at::date, timezone('utc', now())::date)
    INTO v_period FROM billing.workspace_payment_configurations WHERE workspace_id = v_usage_owner_id;
    INSERT INTO public.workspace_usage (
      workspace_id, transfer_period_start, storage_updated_at, transfer_updated_at, updated_at
    ) VALUES (v_usage_owner_id, v_period, now(), now(), now())
    ON CONFLICT (workspace_id) DO NOTHING;
    UPDATE public.workspace_usage SET transfer_period_start = v_period, updated_at = now()
    WHERE workspace_id = v_usage_owner_id AND transfer_period_start IS DISTINCT FROM v_period;
    RETURN;
  END IF;

  v_period := public.workspace_usage_period_start(v_usage_owner_id);
  INSERT INTO public.workspace_usage (
    workspace_id, transfer_period_start, storage_updated_at, transfer_updated_at, updated_at
  ) VALUES (v_usage_owner_id, v_period, now(), now(), now())
  ON CONFLICT (workspace_id) DO NOTHING;
  UPDATE public.workspace_usage SET
    data_transfer_bytes = 0, purchased_credit_bytes = 0,
    transfer_period_start = v_period, transfer_updated_at = now(), updated_at = now()
  WHERE workspace_id = v_usage_owner_id AND transfer_period_start IS DISTINCT FROM v_period;
END;
$function$;

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
  v_payg_cycle_status text;
BEGIN
  IF v_usage_owner_id IS NULL THEN RAISE EXCEPTION 'Workspace is required'; END IF;
  IF COALESCE(p_charged_usage_bytes, 0) < 0 THEN RAISE EXCEPTION 'Usage bytes must be non-negative'; END IF;
  IF COALESCE(p_charged_usage_bytes, 0) = 0 THEN RETURN 0; END IF;

  PERFORM public.ensure_workspace_usage_row(v_usage_owner_id);
  SELECT cycle.status INTO v_payg_cycle_status
  FROM billing.payg_cycles cycle
  JOIN billing.workspace_payment_configurations config
    ON config.workspace_id = cycle.billing_workspace_id AND config.payg_enabled
  WHERE cycle.billing_workspace_id = v_usage_owner_id
    AND cycle.status IN ('open', 'awaiting_payment');
  IF v_payg_cycle_status = 'awaiting_payment' THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_usage_limits WHERE workspace_id = v_usage_owner_id) THEN RETURN 0; END IF;

  UPDATE public.workspace_usage SET
    data_transfer_bytes = data_transfer_bytes + p_charged_usage_bytes,
    transfer_updated_at = now(), updated_at = now()
  WHERE workspace_id = v_usage_owner_id;
  RETURN p_charged_usage_bytes;
END;
$function$;

ALTER FUNCTION billing.reconcile_workspace_payment_renewal_lock(uuid)
  RENAME TO reconcile_workspace_payment_renewal_lock_legacy;

CREATE FUNCTION billing.reconcile_workspace_payment_renewal_lock(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_payg_enabled boolean := false;
  v_awaiting_payment boolean := false;
BEGIN
  IF v_owner_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(payg_enabled, false) INTO v_payg_enabled
  FROM billing.workspace_payment_configurations WHERE workspace_id = v_owner_id;
  IF NOT v_payg_enabled THEN
    PERFORM billing.reconcile_workspace_payment_renewal_lock_legacy(v_owner_id);
    RETURN;
  END IF;
  PERFORM billing.close_due_payg_cycle(v_owner_id);
  SELECT EXISTS (
    SELECT 1 FROM billing.payg_cycles
    WHERE billing_workspace_id = v_owner_id AND status = 'awaiting_payment'
  ) INTO v_awaiting_payment;
  PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);
  UPDATE public.workspaces workspace_row SET
    locked_workspace = CASE
      WHEN v_awaiting_payment THEN true
      WHEN workspace_row.payment_renewal_locked THEN workspace_row.usage_limit_locked
      ELSE workspace_row.locked_workspace
    END,
    payment_renewal_locked = v_awaiting_payment,
    subscription_expiry_locked = false
  WHERE workspace_row.id = v_owner_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_publish_payg_pricing_schedule(
  p_checkpoints jsonb,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_before billing.payg_pricing_versions;
  v_after billing.payg_pricing_versions;
  v_actor text := COALESCE(NULLIF(btrim(p_actor), ''), 'Platform administrator');
  v_checkpoints jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payg-pricing-publish', 0));
  v_checkpoints := billing.validate_payg_checkpoints(p_checkpoints);
  SELECT * INTO v_before FROM billing.payg_pricing_versions WHERE retired_at IS NULL FOR UPDATE;
  UPDATE billing.payg_pricing_versions SET retired_at = now() WHERE id = v_before.id;
  INSERT INTO billing.payg_pricing_versions (checkpoints, published_by, published_by_label)
  VALUES (v_checkpoints, auth.uid(), v_actor) RETURNING * INTO v_after;
  INSERT INTO billing.payg_pricing_version_audit (
    pricing_version_id, version_number, before_checkpoints, after_checkpoints,
    changed_by, changed_by_label
  ) VALUES (
    v_after.id, v_after.version_number, v_before.checkpoints, v_after.checkpoints,
    auth.uid(), v_actor
  );
  RETURN jsonb_build_object(
    'id', v_after.id, 'version_number', v_after.version_number,
    'checkpoints', v_after.checkpoints, 'published_at', v_after.published_at,
    'published_by_label', v_after.published_by_label
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_payg_pricing_schedule()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE v_version billing.payg_pricing_versions;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_version FROM billing.payg_pricing_versions
  WHERE retired_at IS NULL ORDER BY version_number DESC LIMIT 1;
  RETURN jsonb_build_object(
    'id', v_version.id, 'version_number', v_version.version_number,
    'checkpoints', v_version.checkpoints, 'published_at', v_version.published_at,
    'published_by_label', v_version.published_by_label
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_upsert_workspace_payment_configuration_v2(
  p_workspace_id uuid,
  p_subscription_amount text,
  p_is_payment_enabled boolean,
  p_usage_enabled boolean,
  p_payg_enabled boolean,
  p_gb_per_payment text,
  p_renewal_due_at text,
  p_actor text,
  p_usage_start_date text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_owner_id uuid;
  v_workspace public.workspaces;
  v_config billing.workspace_payment_configurations;
  v_usage_bytes bigint := 0;
  v_amount numeric;
  v_gb numeric;
  v_due timestamptz;
  v_usage_start_date date;
  v_actor text := COALESCE(NULLIF(btrim(p_actor), ''), 'Platform administrator');
  v_is_activation boolean := false;
  v_legacy_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_workspace FROM public.workspaces WHERE id = p_workspace_id AND deleted_at IS NULL;
  IF v_workspace.id IS NULL THEN RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0002'; END IF;
  v_owner_id := public.workspace_usage_owner_id(p_workspace_id);
  IF COALESCE(p_payg_enabled, false) AND p_workspace_id <> v_owner_id THEN
    RAISE EXCEPTION 'payg_is_managed_by_source_workspace' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_payg_enabled, false) AND v_workspace.data_mode::text NOT IN ('cloud', 'hybrid') THEN
    RAISE EXCEPTION 'payg_requires_cloud_or_hybrid_workspace' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_payg_enabled, false) AND EXISTS (
    SELECT 1 FROM public.workspaces AS family_workspace
    WHERE public.workspace_usage_owner_id(family_workspace.id) = v_owner_id
      AND family_workspace.deleted_at IS NULL
      AND family_workspace.data_mode::text NOT IN ('cloud', 'hybrid')
  ) THEN
    RAISE EXCEPTION 'payg_requires_cloud_or_hybrid_workspace' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_payg_enabled, false) AND COALESCE(p_usage_enabled, false) THEN
    RAISE EXCEPTION 'payg_and_prepaid_usage_are_exclusive' USING ERRCODE = '23514';
  END IF;
  BEGIN
    v_amount := COALESCE(NULLIF(btrim(p_subscription_amount), ''), '0')::numeric;
    v_gb := COALESCE(NULLIF(btrim(p_gb_per_payment), ''), '0')::numeric;
    v_due := NULLIF(btrim(COALESCE(p_renewal_due_at, '')), '')::timestamptz;
    v_usage_start_date := NULLIF(btrim(COALESCE(p_usage_start_date, '')), '')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_workspace_payment_configuration' USING ERRCODE = '22023';
  END;
  IF v_amount < 0 OR v_gb < 0
    OR (p_is_payment_enabled AND NOT p_payg_enabled AND v_amount <= 0)
    OR (p_usage_enabled AND (v_gb <= 0 OR v_due IS NULL))
    OR (p_payg_enabled AND v_due IS NULL) THEN
    RAISE EXCEPTION 'invalid_workspace_payment_configuration' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payment:' || v_owner_id::text, 0));
  SELECT * INTO v_config FROM billing.workspace_payment_configurations
  WHERE workspace_id = v_owner_id FOR UPDATE;
  SELECT COALESCE(data_transfer_bytes, 0) INTO v_usage_bytes
  FROM public.workspace_usage WHERE workspace_id = v_owner_id FOR UPDATE;

  IF COALESCE(p_payg_enabled, false) AND NOT COALESCE(v_config.payg_enabled, false)
    AND EXISTS (
      SELECT 1 FROM billing.payment_transactions
      WHERE billing_workspace_id = v_owner_id AND status = 'pending'
    ) THEN
    RAISE EXCEPTION 'workspace_payment_pending_transaction_mode_conflict' USING ERRCODE = '23514';
  END IF;

  IF NOT COALESCE(v_config.payg_enabled, false) AND NOT COALESCE(p_payg_enabled, false) THEN
    v_legacy_result := public.admin_upsert_workspace_payment_configuration(
      p_workspace_id, v_amount::text, p_is_payment_enabled,
      p_usage_enabled, v_gb::text, v_actor
    );
    IF p_usage_enabled AND v_due IS NOT NULL THEN
      PERFORM set_config('atlas.trusted_workspace_payment_family_mode_update', 'on', true);
      UPDATE billing.workspace_payment_configurations AS family_config
      SET renewal_due_at = v_due, updated_at = now()
      WHERE public.workspace_usage_owner_id(family_config.workspace_id) = v_owner_id;
    END IF;
    IF p_usage_enabled AND v_usage_start_date IS NOT NULL THEN
      UPDATE billing.workspace_payment_configurations
      SET usage_start_date = v_usage_start_date, updated_at = now()
      WHERE workspace_id = p_workspace_id;
    END IF;
    RETURN v_legacy_result || jsonb_build_object(
      'success', true, 'staged', false,
      'effective_mode', CASE WHEN p_usage_enabled THEN 'prepaid_usage' ELSE 'monthly' END
    );
  END IF;

  IF COALESCE(v_config.payg_enabled, false) AND p_workspace_id <> v_owner_id THEN
    RAISE EXCEPTION 'payg_is_managed_by_source_workspace' USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_config.payg_enabled, false)
    AND v_config.pending_billing_mode IS NOT NULL
    AND COALESCE(p_payg_enabled, false) THEN
    RAISE EXCEPTION 'payg_billing_mode_change_is_already_staged' USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_config.payg_enabled, false) AND NOT COALESCE(p_payg_enabled, false) AND v_usage_bytes > 0 THEN
    UPDATE billing.workspace_payment_configurations SET
      pending_billing_mode = CASE WHEN p_usage_enabled THEN 'prepaid_usage' ELSE 'monthly' END,
      pending_subscription_amount = v_amount,
      pending_gb_per_payment = v_gb,
      pending_payment_enabled = p_is_payment_enabled,
      pending_renewal_due_at = v_due,
      pending_usage_start_date = v_usage_start_date,
      updated_by = auth.uid(), updated_by_label = v_actor, updated_via = 'admin-console', updated_at = now()
    WHERE workspace_id = v_owner_id;
    RETURN jsonb_build_object('success', true, 'staged', true, 'effective_mode', 'payg');
  END IF;

  v_is_activation := COALESCE(p_payg_enabled, false) AND NOT COALESCE(v_config.payg_enabled, false);
  IF COALESCE(v_config.payg_enabled, false) AND NOT COALESCE(p_payg_enabled, false) THEN
    UPDATE billing.payg_cycles SET
      period_ended_at = now(), charged_usage_bytes = 0, charged_usage_gb = 0,
      amount_iqd = 0, status = 'no_payment_required', closed_at = now(), settled_at = now(), updated_at = now()
    WHERE billing_workspace_id = v_owner_id AND status = 'open';
    DELETE FROM public.workspace_usage_limits
    WHERE workspace_id = v_owner_id
      AND NOT COALESCE(p_usage_enabled, false)
      AND tracking_only
      AND storage_unit_limit IS NULL
      AND monthly_data_transfer_limit_bytes IS NULL;
  END IF;
  PERFORM set_config('atlas.trusted_workspace_payment_family_mode_update', 'on', true);
  INSERT INTO billing.workspace_payment_configurations (
    workspace_id, subscription_amount, currency, is_payment_enabled, usage_enabled,
    payg_enabled, gb_per_payment, renewal_due_at, usage_start_date, payg_cycle_started_at,
    created_by, updated_by, created_by_label, updated_by_label, created_via, updated_via
  ) VALUES (
    v_owner_id, CASE WHEN p_payg_enabled THEN 0 ELSE v_amount END, 'IQD',
    CASE WHEN p_payg_enabled THEN true ELSE COALESCE(p_is_payment_enabled, false) END,
    CASE WHEN p_payg_enabled THEN false ELSE COALESCE(p_usage_enabled, false) END,
    COALESCE(p_payg_enabled, false), CASE WHEN p_payg_enabled THEN 0 ELSE v_gb END,
    v_due,
    CASE WHEN p_payg_enabled THEN NULL WHEN p_usage_enabled THEN COALESCE(v_usage_start_date, now()::date) ELSE NULL END,
    CASE WHEN p_payg_enabled THEN now() ELSE NULL END,
    auth.uid(), auth.uid(), v_actor, v_actor, 'admin-console', 'admin-console'
  ) ON CONFLICT (workspace_id) DO UPDATE SET
    subscription_amount = EXCLUDED.subscription_amount,
    is_payment_enabled = EXCLUDED.is_payment_enabled,
    usage_enabled = EXCLUDED.usage_enabled,
    payg_enabled = EXCLUDED.payg_enabled,
    gb_per_payment = EXCLUDED.gb_per_payment,
    renewal_due_at = EXCLUDED.renewal_due_at,
    usage_start_date = EXCLUDED.usage_start_date,
    payg_cycle_started_at = CASE WHEN v_is_activation THEN now() ELSE billing.workspace_payment_configurations.payg_cycle_started_at END,
    pending_billing_mode = NULL,
    pending_subscription_amount = NULL,
    pending_gb_per_payment = NULL,
    pending_payment_enabled = NULL,
    pending_renewal_due_at = NULL,
    pending_usage_start_date = NULL,
    updated_by = auth.uid(), updated_by_label = v_actor, updated_via = 'admin-console';

  IF v_is_activation THEN
    PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);
    UPDATE public.workspaces SET
      locked_workspace = false,
      payment_renewal_locked = false,
      usage_limit_locked = false,
      subscription_expiry_locked = false
    WHERE id = v_owner_id;
    INSERT INTO public.workspace_usage_limits (workspace_id, monthly_data_transfer_limit_bytes, tracking_only, notes)
    VALUES (v_owner_id, NULL, true, 'Native charged-usage tracking for PAYG billing.')
    ON CONFLICT (workspace_id) DO UPDATE SET
      monthly_data_transfer_limit_bytes = NULL,
      tracking_only = true,
      updated_at = now();
    PERFORM public.ensure_workspace_usage_row(v_owner_id);
    UPDATE public.workspace_usage SET data_transfer_bytes = 0, updated_at = now() WHERE workspace_id = v_owner_id;
    DELETE FROM billing.payg_cycles WHERE billing_workspace_id = v_owner_id AND status = 'open';
    PERFORM billing.start_payg_cycle(v_owner_id, now(), v_due);
  END IF;

  IF COALESCE(v_config.payg_enabled, false) AND COALESCE(p_payg_enabled, false) THEN
    UPDATE billing.payg_cycles
    SET renewal_due_at = v_due, updated_at = now()
    WHERE billing_workspace_id = v_owner_id AND status = 'open';
  END IF;

  IF COALESCE(v_config.payg_enabled, false) AND NOT COALESCE(p_payg_enabled, false) THEN
    UPDATE billing.workspace_payment_configurations AS family_config SET
      payg_enabled = false,
      usage_enabled = COALESCE(p_usage_enabled, false),
      gb_per_payment = CASE
        WHEN COALESCE(p_usage_enabled, false) AND family_config.gb_per_payment <= 0 THEN v_gb
        ELSE family_config.gb_per_payment
      END,
      renewal_due_at = CASE WHEN COALESCE(p_usage_enabled, false) THEN v_due ELSE family_config.renewal_due_at END,
      usage_start_date = CASE
        WHEN COALESCE(p_usage_enabled, false) THEN COALESCE(v_usage_start_date, family_config.usage_start_date, now()::date)
        ELSE family_config.usage_start_date
      END,
      updated_by = auth.uid(), updated_by_label = v_actor, updated_via = 'admin-console', updated_at = now()
    WHERE family_config.workspace_id <> v_owner_id
      AND public.workspace_usage_owner_id(family_config.workspace_id) = v_owner_id;
    UPDATE public.workspace_usage_limits SET
      tracking_only = false,
      monthly_data_transfer_limit_bytes = COALESCE(monthly_data_transfer_limit_bytes, 0),
      updated_at = now()
    WHERE workspace_id = v_owner_id AND COALESCE(p_usage_enabled, false);
  END IF;

  RETURN jsonb_build_object('success', true, 'staged', false, 'effective_mode',
    CASE WHEN p_payg_enabled THEN 'payg' WHEN p_usage_enabled THEN 'prepaid_usage' ELSE 'monthly' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_workspace_payment_configurations_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM billing.close_due_payg_cycle(owner.id)
  FROM public.workspaces owner
  JOIN billing.workspace_payment_configurations config ON config.workspace_id = owner.id
  WHERE config.payg_enabled;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'workspace_id', workspace_row.id, 'workspace_name', workspace_row.name,
    'workspace_code', workspace_row.code, 'data_mode', workspace_row.data_mode::text,
    'billing_workspace_id', owner.id, 'is_branch', workspace_row.id <> owner.id,
    'source_workspace_id', CASE WHEN workspace_row.id <> owner.id THEN owner.id ELSE NULL END,
    'id', own_config.id, 'subscription_amount', own_config.subscription_amount::text,
    'currency', COALESCE(own_config.currency, 'IQD'),
    'is_payment_enabled', COALESCE(own_config.is_payment_enabled, false),
    'usage_enabled', COALESCE(own_config.usage_enabled, false),
    'payg_enabled', COALESCE(owner_config.payg_enabled, false),
    'payg_inherited', workspace_row.id <> owner.id AND COALESCE(owner_config.payg_enabled, false),
    'pending_billing_mode', owner_config.pending_billing_mode,
    'gb_per_payment', COALESCE(own_config.gb_per_payment, 0)::text,
    'renewal_due_at', CASE WHEN owner_config.payg_enabled THEN cycle.renewal_due_at ELSE own_config.renewal_due_at END,
    'usage_start_date', CASE
      WHEN COALESCE(owner_config.payg_enabled, false) THEN owner_config.payg_cycle_started_at::text
      ELSE own_config.usage_start_date::text
    END,
    'charged_usage_bytes', COALESCE(usage_row.data_transfer_bytes, 0),
    'charged_usage_gb', (COALESCE(usage_row.data_transfer_bytes, 0)::numeric / 1000000000::numeric)::text,
    'payg_amount_iqd', CASE
      WHEN cycle.status = 'awaiting_payment' THEN cycle.amount_iqd
      WHEN cycle.status = 'open' THEN billing.calculate_payg_amount_from_checkpoints(cycle.pricing_snapshot, COALESCE(usage_row.data_transfer_bytes, 0))
      ELSE 0 END::text,
    'payg_cycle_status', cycle.status, 'payg_pricing_version', cycle.pricing_version_number,
    'created_at', own_config.created_at, 'updated_at', own_config.updated_at
  ) ORDER BY owner.created_at DESC NULLS LAST, (workspace_row.id <> owner.id), workspace_row.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM public.workspaces workspace_row
  JOIN public.workspaces owner ON owner.id = public.workspace_usage_owner_id(workspace_row.id)
  LEFT JOIN billing.workspace_payment_configurations own_config ON own_config.workspace_id = workspace_row.id
  LEFT JOIN billing.workspace_payment_configurations owner_config ON owner_config.workspace_id = owner.id
  LEFT JOIN public.workspace_usage usage_row ON usage_row.workspace_id = owner.id
  LEFT JOIN billing.payg_cycles cycle ON cycle.billing_workspace_id = owner.id AND cycle.status IN ('open', 'awaiting_payment')
  WHERE workspace_row.deleted_at IS NULL;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_workspace_payg_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_workspace_id uuid := public.current_workspace_id();
  v_owner_id uuid;
  v_config billing.workspace_payment_configurations;
  v_cycle billing.payg_cycles;
  v_usage_bytes bigint := 0;
  v_amount numeric := 0;
  v_history jsonb := '[]'::jsonb;
  v_payment_history jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_authentication_required' USING ERRCODE = '42501';
  END IF;
  v_owner_id := public.workspace_usage_owner_id(v_workspace_id);
  SELECT * INTO v_config FROM billing.workspace_payment_configurations WHERE workspace_id = v_owner_id;
  IF NOT COALESCE(v_config.payg_enabled, false) THEN
    RETURN jsonb_build_object('enabled', false, 'workspace_id', v_workspace_id, 'billing_workspace_id', v_owner_id);
  END IF;
  v_cycle := billing.close_due_payg_cycle(v_owner_id);
  SELECT COALESCE(data_transfer_bytes, 0) INTO v_usage_bytes FROM public.workspace_usage WHERE workspace_id = v_owner_id;
  IF v_cycle.status = 'open' THEN
    v_amount := billing.calculate_payg_amount_from_checkpoints(v_cycle.pricing_snapshot, v_usage_bytes);
  ELSE
    v_usage_bytes := v_cycle.charged_usage_bytes;
    v_amount := v_cycle.amount_iqd;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', history.id, 'period_started_at', history.period_started_at,
    'period_ended_at', history.period_ended_at, 'charged_usage_bytes', history.charged_usage_bytes,
    'charged_usage_gb', history.charged_usage_gb::text, 'amount_iqd', history.amount_iqd::text,
    'status', history.status, 'pricing_version', history.pricing_version_number,
    'payment_transaction_id', history.payment_transaction_id
  ) ORDER BY history.period_started_at DESC), '[]'::jsonb)
  INTO v_history FROM (SELECT * FROM billing.payg_cycles WHERE billing_workspace_id = v_owner_id ORDER BY period_started_at DESC LIMIT 20) history;
  SELECT COALESCE(jsonb_agg(
    billing.payment_transaction_public_json(payment_row)
      || jsonb_build_object('payg_cycle_id', payment_row.payg_cycle_id)
    ORDER BY payment_row.created_at DESC
  ), '[]'::jsonb)
  INTO v_payment_history
  FROM (SELECT * FROM billing.payment_transactions WHERE billing_workspace_id = v_owner_id AND payment_type = 'payg' ORDER BY created_at DESC LIMIT 20) payment_row;
  RETURN jsonb_build_object(
    'enabled', true, 'workspace_id', v_workspace_id, 'billing_workspace_id', v_owner_id,
    'is_inherited', v_workspace_id <> v_owner_id, 'can_submit_payment', public.current_user_role() = 'admin',
    'cycle_id', v_cycle.id, 'cycle_status', v_cycle.status,
    'cycle_started_at', v_cycle.period_started_at, 'renewal_due_at', v_cycle.renewal_due_at,
    'charged_usage_bytes', v_usage_bytes, 'charged_usage_gb', (v_usage_bytes::numeric / 1000000000::numeric)::text,
    'amount_iqd', v_amount::text, 'currency', 'IQD',
    'pricing_version_id', v_cycle.pricing_version_id, 'pricing_version', v_cycle.pricing_version_number,
    'pricing_checkpoints', v_cycle.pricing_snapshot,
    'pending_billing_mode', v_config.pending_billing_mode,
    'last_updated_at', now(), 'history', v_history, 'payment_history', v_payment_history
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_workspace_payg_payment(
  p_provider text,
  p_account_holder_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_workspace_id uuid := public.current_workspace_id();
  v_owner_id uuid;
  v_cycle billing.payg_cycles;
  v_existing billing.payment_transactions;
  v_transaction billing.payment_transactions;
  v_name text;
  v_email text;
  v_provider text := lower(btrim(COALESCE(p_provider, '')));
  v_account_holder_name text := upper(
    btrim(regexp_replace(COALESCE(p_account_holder_name, ''), '[[:space:]]+', ' ', 'g'))
  );
BEGIN
  IF auth.uid() IS NULL OR v_workspace_id IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'workspace_payment_workspace_admin_required' USING ERRCODE = '42501';
  END IF;
  IF v_provider NOT IN ('fib', 'qicard') THEN
    RAISE EXCEPTION 'unsupported_workspace_payment_provider' USING ERRCODE = '22023';
  END IF;
  IF v_account_holder_name = ''
    OR cardinality(string_to_array(v_account_holder_name, ' ')) < 3
    OR char_length(v_account_holder_name) > 160 THEN
    RAISE EXCEPTION 'invalid_workspace_payment_account_holder_name' USING ERRCODE = '22023';
  END IF;
  v_owner_id := public.workspace_usage_owner_id(v_workspace_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payment:' || v_owner_id::text, 0));
  v_cycle := billing.close_due_payg_cycle(v_owner_id);
  IF v_cycle.status <> 'awaiting_payment' OR v_cycle.amount_iqd <= 0 THEN
    RAISE EXCEPTION 'payg_payment_is_not_due' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_existing FROM billing.payment_transactions
  WHERE billing_workspace_id = v_owner_id AND status = 'pending' FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id = auth.uid() THEN
      RETURN billing.payment_transaction_public_json(v_existing) || jsonb_build_object(
        'payg_cycle_id', v_existing.payg_cycle_id,
        'billed_usage_bytes', v_existing.billed_usage_bytes,
        'billed_usage_gb', v_existing.billed_usage_gb::text
      );
    END IF;
    RAISE EXCEPTION 'workspace_payment_already_pending_for_workspace' USING ERRCODE = '23505';
  END IF;
  IF v_cycle.payment_transaction_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM billing.payment_transactions WHERE id = v_cycle.payment_transaction_id;
    IF v_existing.status = 'approved' THEN RAISE EXCEPTION 'payg_cycle_already_paid' USING ERRCODE = '23514'; END IF;
    UPDATE billing.payg_cycles SET payment_transaction_id = NULL, updated_at = now() WHERE id = v_cycle.id;
  END IF;
  SELECT profile.name, auth_user.email INTO v_name, v_email
  FROM auth.users auth_user LEFT JOIN public.profiles profile ON profile.id = auth_user.id
  WHERE auth_user.id = auth.uid();
  INSERT INTO billing.payment_transactions (
    workspace_id, billing_workspace_id, user_id, submitted_by_name, submitted_by_email,
    provider, account_holder_name, payment_type, amount, currency,
    payg_cycle_id, billed_usage_bytes, billed_usage_gb
  ) VALUES (
    v_workspace_id, v_owner_id, auth.uid(), v_name, v_email,
    v_provider, v_account_holder_name, 'payg', v_cycle.amount_iqd, 'IQD',
    v_cycle.id, v_cycle.charged_usage_bytes, v_cycle.charged_usage_gb
  ) RETURNING * INTO v_transaction;
  UPDATE billing.payg_cycles SET payment_transaction_id = v_transaction.id, updated_at = now() WHERE id = v_cycle.id;
  RETURN billing.payment_transaction_public_json(v_transaction) || jsonb_build_object(
    'payg_cycle_id', v_cycle.id, 'billed_usage_bytes', v_cycle.charged_usage_bytes,
    'billed_usage_gb', v_cycle.charged_usage_gb::text
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_workspace_payment_transaction_v2(
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
  v_transaction billing.payment_transactions;
  v_cycle billing.payg_cycles;
  v_config billing.workspace_payment_configurations;
  v_decision text := lower(btrim(COALESCE(p_decision, '')));
  v_next_due timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_transaction FROM billing.payment_transactions WHERE id = p_transaction_id;
  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'workspace_payment_transaction_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_transaction.payment_type <> 'payg' THEN
    RETURN public.admin_review_workspace_payment_transaction(
      p_transaction_id, p_decision, p_note, p_reviewer_label, p_provider_payment_id
    );
  END IF;
  IF v_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_workspace_payment_review_decision' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payment:' || v_transaction.billing_workspace_id::text, 0));
  SELECT * INTO v_transaction FROM billing.payment_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_transaction.status <> 'pending' OR v_transaction.expires_at <= now() THEN
    RAISE EXCEPTION 'workspace_payment_no_longer_pending' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_cycle FROM billing.payg_cycles WHERE id = v_transaction.payg_cycle_id FOR UPDATE;
  IF v_cycle.status <> 'awaiting_payment'
    OR v_transaction.amount <> v_cycle.amount_iqd
    OR v_transaction.billed_usage_bytes <> v_cycle.charged_usage_bytes THEN
    RAISE EXCEPTION 'payg_payment_snapshot_mismatch' USING ERRCODE = '23514';
  END IF;
  UPDATE billing.payment_transactions SET
    status = v_decision,
    paid_at = CASE WHEN v_decision = 'approved' THEN now() ELSE NULL END,
    reviewed_at = now(), reviewed_by = auth.uid(),
    reviewed_by_label = COALESCE(NULLIF(btrim(p_reviewer_label), ''), 'Platform administrator'),
    reviewed_via = 'admin-console', review_note = NULLIF(btrim(p_note), ''),
    provider_payment_id = NULLIF(btrim(p_provider_payment_id), '')
  WHERE id = v_transaction.id RETURNING * INTO v_transaction;
  IF v_decision = 'rejected' THEN
    UPDATE billing.payg_cycles SET payment_transaction_id = NULL, updated_at = now() WHERE id = v_cycle.id;
    RETURN billing.payment_transaction_public_json(v_transaction) || jsonb_build_object('success', true);
  END IF;

  UPDATE billing.payg_cycles SET status = 'paid', settled_at = now(), updated_at = now() WHERE id = v_cycle.id;
  UPDATE public.workspace_usage SET data_transfer_bytes = 0, updated_at = now()
  WHERE workspace_id = v_transaction.billing_workspace_id;
  PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);
  UPDATE public.workspaces SET
    locked_workspace = false,
    payment_renewal_locked = false,
    usage_limit_locked = false,
    subscription_expiry_locked = false
  WHERE id = v_transaction.billing_workspace_id;
  SELECT * INTO v_config FROM billing.workspace_payment_configurations
  WHERE workspace_id = v_transaction.billing_workspace_id FOR UPDATE;
  v_next_due := billing.next_workspace_usage_renewal_due(
    v_transaction.billing_workspace_id, GREATEST(v_cycle.renewal_due_at, now())
  );
  IF v_config.pending_billing_mode IS NULL THEN
    UPDATE billing.workspace_payment_configurations SET
      renewal_due_at = v_next_due, payg_cycle_started_at = now(), updated_at = now()
    WHERE workspace_id = v_transaction.billing_workspace_id;
    PERFORM billing.start_payg_cycle(v_transaction.billing_workspace_id, now(), v_next_due);
  ELSE
    PERFORM set_config('atlas.trusted_workspace_payment_family_mode_update', 'on', true);
    UPDATE billing.workspace_payment_configurations AS family_config SET
      payg_enabled = false,
      usage_enabled = v_config.pending_billing_mode = 'prepaid_usage',
      gb_per_payment = CASE
        WHEN v_config.pending_billing_mode = 'prepaid_usage' AND family_config.gb_per_payment <= 0
          THEN v_config.pending_gb_per_payment
        ELSE family_config.gb_per_payment
      END,
      renewal_due_at = CASE
        WHEN v_config.pending_billing_mode = 'prepaid_usage' THEN v_next_due
        ELSE family_config.renewal_due_at
      END,
      usage_start_date = CASE
        WHEN v_config.pending_billing_mode = 'prepaid_usage' THEN COALESCE(v_config.pending_usage_start_date, family_config.usage_start_date, now()::date)
        ELSE family_config.usage_start_date
      END,
      updated_at = now()
    WHERE family_config.workspace_id <> v_transaction.billing_workspace_id
      AND public.workspace_usage_owner_id(family_config.workspace_id) = v_transaction.billing_workspace_id;
    UPDATE billing.workspace_payment_configurations SET
      payg_enabled = false,
      usage_enabled = pending_billing_mode = 'prepaid_usage',
      subscription_amount = pending_subscription_amount,
      gb_per_payment = CASE WHEN pending_billing_mode = 'prepaid_usage' THEN pending_gb_per_payment ELSE 0 END,
      is_payment_enabled = pending_payment_enabled,
      pending_billing_mode = NULL,
      pending_subscription_amount = NULL,
      pending_gb_per_payment = NULL,
      pending_payment_enabled = NULL,
      pending_renewal_due_at = NULL,
      pending_usage_start_date = NULL,
      payg_cycle_started_at = NULL,
      renewal_due_at = CASE
        WHEN pending_billing_mode = 'prepaid_usage' THEN v_next_due
        ELSE COALESCE(pending_renewal_due_at, renewal_due_at)
      END,
      usage_start_date = CASE
        WHEN pending_billing_mode = 'prepaid_usage' THEN COALESCE(pending_usage_start_date, usage_start_date, now()::date)
        ELSE usage_start_date
      END,
      updated_at = now()
    WHERE workspace_id = v_transaction.billing_workspace_id;
    UPDATE public.workspace_usage_limits SET
      tracking_only = false,
      monthly_data_transfer_limit_bytes = COALESCE(monthly_data_transfer_limit_bytes, 0),
      updated_at = now()
    WHERE workspace_id = v_transaction.billing_workspace_id
      AND v_config.pending_billing_mode = 'prepaid_usage';
    DELETE FROM public.workspace_usage_limits
    WHERE workspace_id = v_transaction.billing_workspace_id
      AND v_config.pending_billing_mode = 'monthly'
      AND tracking_only
      AND storage_unit_limit IS NULL
      AND monthly_data_transfer_limit_bytes IS NULL;
  END IF;
  RETURN billing.payment_transaction_public_json(v_transaction) || jsonb_build_object(
    'success', true, 'renewal_due_at', v_next_due, 'payg_reset', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_workspace_payment_transactions_v2(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM billing.expire_pending_payment_transactions(NULL);
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.created_at DESC), '[]'::jsonb)
  INTO v_result FROM (
    SELECT transaction_row.id, transaction_row.workspace_id, workspace_row.name AS workspace_name,
      transaction_row.billing_workspace_id, transaction_row.user_id,
      transaction_row.submitted_by_name AS user_name, transaction_row.submitted_by_email AS user_email,
      transaction_row.provider, transaction_row.provider_payment_id, transaction_row.account_holder_name,
      transaction_row.payment_type, transaction_row.amount::text, transaction_row.currency,
      transaction_row.gb_added::text, transaction_row.billed_usage_bytes,
      transaction_row.billed_usage_gb::text, transaction_row.payg_cycle_id,
      cycle.pricing_version_number AS payg_pricing_version,
      cycle.pricing_snapshot AS payg_pricing_snapshot,
      transaction_row.status, transaction_row.expires_at, transaction_row.paid_at,
      transaction_row.reviewed_at, transaction_row.reviewed_by_label,
      transaction_row.review_note, transaction_row.created_at, transaction_row.updated_at
    FROM billing.payment_transactions transaction_row
    JOIN public.workspaces workspace_row ON workspace_row.id = transaction_row.workspace_id
    LEFT JOIN billing.payg_cycles cycle ON cycle.id = transaction_row.payg_cycle_id
    WHERE p_status IS NULL OR transaction_row.status = lower(p_status)
  ) row_data;
  RETURN v_result;
END;
$function$;

-- PAYG usage-limit rows are tracking-only and must coexist with a non-prepaid mode.
CREATE OR REPLACE FUNCTION billing.enforce_workspace_payment_configuration_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE v_billing_workspace_id uuid := public.workspace_usage_owner_id(NEW.workspace_id);
BEGIN
  IF v_billing_workspace_id IS NULL THEN RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0002'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payment-configuration:' || v_billing_workspace_id::text, 0));
  END IF;
  IF NOT (auth.role() = 'service_role' AND current_setting('atlas.trusted_workspace_payment_family_mode_update', true) = 'on')
    AND EXISTS (
      SELECT 1 FROM billing.workspace_payment_configurations configuration_row
      WHERE configuration_row.workspace_id IS DISTINCT FROM NEW.workspace_id
        AND public.workspace_usage_owner_id(configuration_row.workspace_id) = v_billing_workspace_id
        AND (configuration_row.usage_enabled, configuration_row.payg_enabled)
          IS DISTINCT FROM (NEW.usage_enabled, NEW.payg_enabled)
    ) THEN
    RAISE EXCEPTION 'workspace_payment_family_usage_mode_mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT NEW.usage_enabled AND NOT NEW.payg_enabled AND EXISTS (
    SELECT 1 FROM public.workspace_usage_limits limits
    WHERE limits.workspace_id = v_billing_workspace_id AND NOT limits.tracking_only
  ) THEN
    RAISE EXCEPTION 'workspace_usage_limits_require_usage_payment_configuration' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.enforce_workspace_usage_limit_payment_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE v_billing_workspace_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-branch-payment-owner:' || NEW.workspace_id::text, 0));
  v_billing_workspace_id := public.workspace_usage_owner_id(NEW.workspace_id);
  IF v_billing_workspace_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payment-configuration:' || v_billing_workspace_id::text, 0));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM billing.workspace_payment_configurations configuration_row
    WHERE configuration_row.workspace_id = v_billing_workspace_id
      AND (configuration_row.usage_enabled OR configuration_row.payg_enabled)
  ) THEN
    RAISE EXCEPTION 'workspace_payment_configuration_usage_mode_required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

-- Protect new PAYG transaction snapshot columns along with the legacy snapshot.
CREATE OR REPLACE FUNCTION billing.enforce_payment_transaction_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, billing
AS $function$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.billing_workspace_id IS DISTINCT FROM OLD.billing_workspace_id
    OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NOT (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL))
    OR NEW.submitted_by_name IS DISTINCT FROM OLD.submitted_by_name
    OR NEW.submitted_by_email IS DISTINCT FROM OLD.submitted_by_email
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
    OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.gb_added IS DISTINCT FROM OLD.gb_added OR NEW.gb_added_bytes IS DISTINCT FROM OLD.gb_added_bytes
    OR NEW.payg_cycle_id IS DISTINCT FROM OLD.payg_cycle_id
    OR NEW.billed_usage_bytes IS DISTINCT FROM OLD.billed_usage_bytes
    OR NEW.billed_usage_gb IS DISTINCT FROM OLD.billed_usage_gb
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'workspace_payment_transaction_snapshot_is_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('approved', 'rejected', 'expired') THEN
      RAISE EXCEPTION 'invalid_workspace_payment_status_transition' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status <> 'pending' AND (
    NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.reviewed_by_label IS DISTINCT FROM OLD.reviewed_by_label OR NEW.reviewed_via IS DISTINCT FROM OLD.reviewed_via
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.review_note IS DISTINCT FROM OLD.review_note
    OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id OR NEW.provider_response IS DISTINCT FROM OLD.provider_response
  ) THEN
    RAISE EXCEPTION 'reviewed_workspace_payment_transaction_is_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.get_workspace_payment_summary()
  RENAME TO get_workspace_payment_summary_legacy;

CREATE FUNCTION public.get_workspace_payment_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_result jsonb;
  v_workspace_id uuid := public.current_workspace_id();
  v_owner_id uuid;
  v_config billing.workspace_payment_configurations;
  v_cycle billing.payg_cycles;
  v_due boolean := false;
BEGIN
  v_result := public.get_workspace_payment_summary_legacy();
  v_owner_id := public.workspace_usage_owner_id(v_workspace_id);
  SELECT * INTO v_config FROM billing.workspace_payment_configurations WHERE workspace_id = v_owner_id;
  IF NOT COALESCE(v_config.payg_enabled, false) THEN RETURN v_result; END IF;
  v_cycle := billing.close_due_payg_cycle(v_owner_id);
  v_due := v_cycle.status = 'awaiting_payment';
  RETURN v_result
    || jsonb_build_object(
      'subscription_expired', false,
      'usage_exhausted', false,
      'usage_renewal_due', v_due,
      'alert_reason', CASE WHEN v_due THEN 'usage_renewal_due' ELSE NULL END,
      'should_alert', v_due
    )
    || jsonb_build_object('eligibility', jsonb_build_object(
      'subscription_expired', false,
      'usage_exhausted', false,
      'usage_renewal_due', v_due,
      'alert_reason', CASE WHEN v_due THEN 'usage_renewal_due' ELSE NULL END,
      'payment_enabled', true
    ))
    || jsonb_build_object('configuration', COALESCE(v_result->'configuration', '{}'::jsonb) || jsonb_build_object(
      'workspace_id', v_owner_id,
      'subscription_amount', CASE WHEN v_cycle.status = 'awaiting_payment' THEN v_cycle.amount_iqd::text ELSE '0' END,
      'is_payment_enabled', true,
      'usage_enabled', false,
      'payg_enabled', true,
      'renewal_due_at', v_cycle.renewal_due_at
    ));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_workspace_payg_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_payment_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_workspace_payg_payment(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_payg_pricing_schedule() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_publish_payg_pricing_schedule(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_workspace_payment_configuration_v2(uuid, text, boolean, boolean, boolean, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_workspace_payment_configurations_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_review_workspace_payment_transaction_v2(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_workspace_payment_transactions_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_payg_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_payment_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_workspace_payg_payment(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_payg_pricing_schedule() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_publish_payg_pricing_schedule(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_workspace_payment_configuration_v2(uuid, text, boolean, boolean, boolean, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_workspace_payment_configurations_v2() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_workspace_payment_transaction_v2(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_workspace_payment_transactions_v2(text) TO service_role;

NOTIFY pgrst, 'reload schema';
