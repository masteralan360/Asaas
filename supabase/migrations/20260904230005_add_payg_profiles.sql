BEGIN;

CREATE TABLE billing.payg_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  currency text NOT NULL DEFAULT 'IQD' CHECK (currency = 'IQD'),
  checkpoints jsonb NOT NULL CHECK (jsonb_typeof(checkpoints) = 'array'),
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX payg_profiles_name_key
  ON billing.payg_profiles ((lower(btrim(name))));
CREATE UNIQUE INDEX payg_profiles_one_default
  ON billing.payg_profiles (is_default)
  WHERE is_default;

ALTER TABLE billing.payg_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing.payg_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON billing.payg_profiles TO service_role;

CREATE OR REPLACE FUNCTION billing.enforce_payg_profile_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, billing
AS $function$
BEGIN
  RAISE EXCEPTION 'payg_profile_is_immutable' USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER enforce_payg_profile_transition
BEFORE UPDATE OR DELETE ON billing.payg_profiles
FOR EACH ROW EXECUTE FUNCTION billing.enforce_payg_profile_transition();

CREATE OR REPLACE FUNCTION billing.validate_payg_profile_checkpoints(p_checkpoints jsonb)
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
      'protected', ((checkpoint->>'gb')::numeric IN (1, 100))
    ) ORDER BY (checkpoint->>'gb')::numeric
  ), count(*)
  INTO v_normalized, v_count
  FROM jsonb_array_elements(p_checkpoints) AS checkpoint
  WHERE checkpoint ? 'gb'
    AND checkpoint ? 'amount_iqd'
    AND checkpoint->>'gb' ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
    AND checkpoint->>'amount_iqd' ~ '^(0|[1-9][0-9]*)$';

  IF v_count <> jsonb_array_length(p_checkpoints) OR v_count < 2 THEN
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
    WHERE (checkpoint->>'gb')::numeric = 100
  ) THEN
    RAISE EXCEPTION 'required_payg_pricing_checkpoints_missing' USING ERRCODE = '23514';
  END IF;

  RETURN v_normalized;
END;
$function$;

-- Preserve the old name for internal callers while moving its rules to the
-- profile model. The legacy versions remain historical data only.
CREATE OR REPLACE FUNCTION billing.validate_payg_checkpoints(p_checkpoints jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, billing
AS $function$
  SELECT billing.validate_payg_profile_checkpoints(p_checkpoints);
$function$;

INSERT INTO billing.payg_profiles (name, checkpoints, is_default, created_by_label)
SELECT
  'Legacy PAYG Schedule',
  billing.validate_payg_profile_checkpoints(version_row.checkpoints),
  false,
  'System migration'
FROM billing.payg_pricing_versions version_row
WHERE version_row.retired_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM billing.payg_profiles profile
    WHERE lower(btrim(profile.name)) = lower('Legacy PAYG Schedule')
  )
ORDER BY version_row.version_number DESC
LIMIT 1;

INSERT INTO billing.payg_profiles (name, checkpoints, is_default, created_by_label)
SELECT
  'Standard PAYG',
  billing.validate_payg_profile_checkpoints(
    '[
      {"gb":1,"amount_iqd":0},
      {"gb":2,"amount_iqd":1000},
      {"gb":10,"amount_iqd":9000},
      {"gb":11,"amount_iqd":10000},
      {"gb":50,"amount_iqd":49000},
      {"gb":100,"amount_iqd":99000}
    ]'::jsonb
  ),
  true,
  'System migration'
WHERE NOT EXISTS (
  SELECT 1 FROM billing.payg_profiles profile
  WHERE lower(btrim(profile.name)) = lower('Standard PAYG')
);

ALTER TABLE billing.workspace_payment_configurations
  ADD COLUMN IF NOT EXISTS payg_profile_id uuid NULL;

ALTER TABLE billing.workspace_payment_configurations
  ADD CONSTRAINT workspace_payment_configurations_payg_profile_fk
  FOREIGN KEY (payg_profile_id)
  REFERENCES billing.payg_profiles(id)
  ON DELETE RESTRICT;

UPDATE billing.workspace_payment_configurations configuration_row
SET payg_profile_id = legacy_profile.id
FROM billing.payg_profiles legacy_profile
WHERE configuration_row.payg_enabled
  AND configuration_row.payg_profile_id IS NULL
  AND legacy_profile.name = 'Legacy PAYG Schedule';

CREATE INDEX workspace_payment_configurations_payg_profile_id_idx
  ON billing.workspace_payment_configurations (payg_profile_id)
  WHERE payg_profile_id IS NOT NULL;

ALTER TABLE billing.payg_cycles
  ADD COLUMN IF NOT EXISTS pricing_profile_id uuid NULL,
  ADD COLUMN IF NOT EXISTS pricing_profile_name text NULL;

UPDATE billing.payg_cycles cycle
SET
  pricing_profile_id = legacy_profile.id,
  pricing_profile_name = legacy_profile.name
FROM billing.payg_profiles legacy_profile
WHERE cycle.pricing_profile_id IS NULL
  AND legacy_profile.name = 'Legacy PAYG Schedule';

ALTER TABLE billing.payg_cycles
  ALTER COLUMN pricing_profile_id SET NOT NULL,
  ALTER COLUMN pricing_profile_name SET NOT NULL,
  ADD CONSTRAINT payg_cycles_pricing_profile_fk
    FOREIGN KEY (pricing_profile_id)
    REFERENCES billing.payg_profiles(id)
    ON DELETE RESTRICT;

CREATE INDEX payg_cycles_pricing_profile_id_idx
  ON billing.payg_cycles (pricing_profile_id);

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
    OR NEW.pricing_profile_id IS DISTINCT FROM OLD.pricing_profile_id
    OR NEW.pricing_profile_name IS DISTINCT FROM OLD.pricing_profile_name
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
  v_checkpoints := billing.validate_payg_profile_checkpoints(v_checkpoints);
  IF v_usage_gb <= 1 THEN RETURN 0; END IF;
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
  v_legacy_version billing.payg_pricing_versions;
  v_profile billing.payg_profiles;
  v_cycle billing.payg_cycles;
BEGIN
  SELECT profile.* INTO v_profile
  FROM billing.workspace_payment_configurations configuration_row
  JOIN billing.payg_profiles profile ON profile.id = configuration_row.payg_profile_id
  WHERE configuration_row.workspace_id = p_billing_workspace_id;

  IF v_profile.id IS NULL THEN
    SELECT * INTO v_profile FROM billing.payg_profiles
    WHERE is_default
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'default_payg_profile_missing' USING ERRCODE = 'P0002';
  END IF;

  UPDATE billing.workspace_payment_configurations
  SET payg_profile_id = v_profile.id, updated_at = now()
  WHERE workspace_id = p_billing_workspace_id
    AND payg_profile_id IS NULL;

  SELECT * INTO v_legacy_version FROM billing.payg_pricing_versions
  WHERE retired_at IS NULL ORDER BY version_number DESC LIMIT 1;
  IF v_legacy_version.id IS NULL THEN
    RAISE EXCEPTION 'active_payg_pricing_version_missing' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO billing.payg_cycles (
    billing_workspace_id, pricing_version_id, pricing_version_number,
    pricing_profile_id, pricing_profile_name, pricing_snapshot,
    period_started_at, renewal_due_at
  ) VALUES (
    p_billing_workspace_id, v_legacy_version.id, v_legacy_version.version_number,
    v_profile.id, v_profile.name, v_profile.checkpoints,
    p_started_at, p_renewal_due_at
  ) RETURNING * INTO v_cycle;
  RETURN v_cycle;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_payg_profiles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF (COALESCE(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'checkpoints', profile.checkpoints,
    'is_default', profile.is_default,
    'created_at', profile.created_at,
    'created_by_label', profile.created_by_label
  ) ORDER BY profile.is_default DESC, profile.created_at ASC), '[]'::jsonb)
  INTO v_result
  FROM billing.payg_profiles profile;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_payg_profile(
  p_name text,
  p_checkpoints jsonb,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_actor text := COALESCE(NULLIF(btrim(p_actor), ''), 'Platform administrator');
  v_checkpoints jsonb;
  v_profile billing.payg_profiles;
BEGIN
  IF (COALESCE(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_payg_profile_name' USING ERRCODE = '22023';
  END IF;
  v_checkpoints := billing.validate_payg_profile_checkpoints(p_checkpoints);
  INSERT INTO billing.payg_profiles (name, checkpoints, created_by, created_by_label)
  VALUES (v_name, v_checkpoints, auth.uid(), v_actor)
  RETURNING * INTO v_profile;
  RETURN jsonb_build_object(
    'id', v_profile.id,
    'name', v_profile.name,
    'checkpoints', v_profile.checkpoints,
    'is_default', v_profile.is_default,
    'created_at', v_profile.created_at,
    'created_by_label', v_profile.created_by_label
  );
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'payg_profile_name_already_exists' USING ERRCODE = '23505';
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_upsert_workspace_payment_configuration_v3(uuid, text, boolean, boolean, boolean, text, text, text, text, text);

CREATE FUNCTION public.admin_upsert_workspace_payment_configuration_v3(
  p_workspace_id uuid,
  p_subscription_amount text,
  p_is_payment_enabled boolean,
  p_usage_enabled boolean,
  p_payg_enabled boolean,
  p_gb_per_payment text,
  p_renewal_due_at text,
  p_actor text,
  p_usage_start_date text DEFAULT NULL,
  p_billing_interval text DEFAULT 'monthly',
  p_payg_profile_id uuid DEFAULT NULL,
  p_payg_profile_change_timing text DEFAULT 'next_cycle'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_owner_id uuid;
  v_config billing.workspace_payment_configurations;
  v_target_profile billing.payg_profiles;
  v_open_cycle billing.payg_cycles;
  v_result jsonb;
  v_change_timing text := lower(btrim(COALESCE(p_payg_profile_change_timing, 'next_cycle')));
  v_profile_changed boolean := false;
BEGIN
  IF (COALESCE(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(NULLIF(btrim(p_billing_interval), ''), 'monthly') <> 'monthly' THEN
    RAISE EXCEPTION 'prepaid_terms_must_use_activation_workflow' USING ERRCODE = '23514';
  END IF;
  IF v_change_timing NOT IN ('next_cycle', 'immediate') THEN
    RAISE EXCEPTION 'invalid_payg_profile_change_timing' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('workspace-branch-payment-owner:' || p_workspace_id::text, 0)
  );
  v_owner_id := public.workspace_usage_owner_id(p_workspace_id);
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(p_payg_enabled, false) AND p_workspace_id <> v_owner_id THEN
    RAISE EXCEPTION 'payg_is_managed_by_source_workspace' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payment:' || v_owner_id::text, 0));

  SELECT * INTO v_config
  FROM billing.workspace_payment_configurations
  WHERE workspace_id = v_owner_id
  FOR UPDATE;

  IF COALESCE(p_payg_enabled, false) THEN
    IF p_payg_profile_id IS NOT NULL THEN
      SELECT * INTO v_target_profile FROM billing.payg_profiles
      WHERE id = p_payg_profile_id;
    ELSIF COALESCE(v_config.payg_enabled, false) AND v_config.payg_profile_id IS NOT NULL THEN
      SELECT * INTO v_target_profile FROM billing.payg_profiles
      WHERE id = v_config.payg_profile_id;
    ELSE
      SELECT * INTO v_target_profile FROM billing.payg_profiles
      WHERE is_default
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;
    IF v_target_profile.id IS NULL THEN
      RAISE EXCEPTION 'payg_profile_not_found' USING ERRCODE = 'P0002';
    END IF;

    v_profile_changed := COALESCE(v_config.payg_enabled, false)
      AND v_config.payg_profile_id IS DISTINCT FROM v_target_profile.id;
    IF v_profile_changed AND v_change_timing = 'immediate' THEN
      SELECT * INTO v_open_cycle
      FROM billing.payg_cycles
      WHERE billing_workspace_id = v_owner_id
        AND status IN ('open', 'awaiting_payment')
      FOR UPDATE;
      IF v_open_cycle.id IS NULL OR v_open_cycle.status <> 'open' THEN
        RAISE EXCEPTION 'payg_profile_change_requires_open_cycle' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('atlas.trusted_workspace_payment_family_mode_update', 'on', true);
  UPDATE billing.workspace_payment_configurations AS configuration_row
  SET
    billing_interval = 'monthly',
    monthly_allowance_gb = NULL,
    prepaid_cycles = NULL,
    prepaid_amount = NULL,
    prepaid_term_started_at = NULL,
    prepaid_term_payment_transaction_id = NULL,
    prepaid_allowance_mode = NULL,
    term_allowance_gb = NULL,
    updated_at = now()
  WHERE public.workspace_usage_owner_id(configuration_row.workspace_id) = v_owner_id
    AND configuration_row.billing_interval = 'prepaid_term';

  v_result := public.admin_upsert_workspace_payment_configuration_v2(
    p_workspace_id,
    p_subscription_amount,
    p_is_payment_enabled,
    p_usage_enabled,
    p_payg_enabled,
    p_gb_per_payment,
    p_renewal_due_at,
    p_actor,
    p_usage_start_date
  );

  IF COALESCE(p_payg_enabled, false) THEN
    UPDATE billing.workspace_payment_configurations
    SET payg_profile_id = v_target_profile.id, updated_at = now()
    WHERE workspace_id = v_owner_id;

    IF NOT COALESCE(v_config.payg_enabled, false)
      OR (v_profile_changed AND v_change_timing = 'immediate') THEN
      UPDATE billing.payg_cycles
      SET
        pricing_profile_id = v_target_profile.id,
        pricing_profile_name = v_target_profile.name,
        pricing_snapshot = v_target_profile.checkpoints,
        updated_at = now()
      WHERE billing_workspace_id = v_owner_id
        AND status = 'open';
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object(
    'payg_profile_id', CASE WHEN COALESCE(p_payg_enabled, false) THEN v_target_profile.id ELSE NULL END,
    'payg_profile_name', CASE WHEN COALESCE(p_payg_enabled, false) THEN v_target_profile.name ELSE NULL END,
    'payg_profile_change_timing', CASE WHEN COALESCE(p_payg_enabled, false) THEN v_change_timing ELSE NULL END
  );
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
  IF (COALESCE(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
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
    'payg_profile_id', COALESCE(owner_config.payg_profile_id, cycle.pricing_profile_id),
    'payg_profile_name', COALESCE(profile.name, cycle.pricing_profile_name),
    'payg_profile_change_available', cycle.status = 'open',
    'pending_billing_mode', owner_config.pending_billing_mode,
    'billing_interval', COALESCE(owner_config.billing_interval, 'monthly'),
    'monthly_allowance_gb', owner_config.monthly_allowance_gb::text,
    'prepaid_cycles', owner_config.prepaid_cycles,
    'prepaid_amount', owner_config.prepaid_amount::text,
    'prepaid_term_started_at', owner_config.prepaid_term_started_at,
    'prepaid_term_payment_transaction_id', owner_config.prepaid_term_payment_transaction_id,
    'prepaid_allowance_mode', owner_config.prepaid_allowance_mode,
    'term_allowance_gb', owner_config.term_allowance_gb::text,
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
  LEFT JOIN billing.payg_profiles profile ON profile.id = owner_config.payg_profile_id
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
    'pricing_profile_id', history.pricing_profile_id,
    'pricing_profile_name', history.pricing_profile_name,
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
    'pricing_profile_id', v_cycle.pricing_profile_id, 'pricing_profile_name', v_cycle.pricing_profile_name,
    'pricing_checkpoints', v_cycle.pricing_snapshot,
    'pending_billing_mode', v_config.pending_billing_mode,
    'last_updated_at', now(), 'history', v_history, 'payment_history', v_payment_history
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_payg_pricing_profiles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_workspace_id() IS NULL THEN
    RAISE EXCEPTION 'workspace_authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'checkpoints', profile.checkpoints,
    'is_default', profile.is_default,
    'created_at', profile.created_at
  ) ORDER BY profile.is_default DESC, profile.created_at ASC), '[]'::jsonb)
  INTO v_result
  FROM billing.payg_profiles profile;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_payg_profiles() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_payg_profile(text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_workspace_payment_configuration_v3(uuid, text, boolean, boolean, boolean, text, text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payg_pricing_profiles() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_payg_profiles() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_payg_profile(text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_workspace_payment_configuration_v3(uuid, text, boolean, boolean, boolean, text, text, text, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payg_pricing_profiles() TO authenticated;

COMMIT;
