-- Fresh PAYG checkpoint correction, not a new pricing version.
-- Keep the existing pricing ID, version number, metadata, and all workspace data.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE billing.workspace_payment_configurations, billing.payg_cycles IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE billing.payg_pricing_versions IN ACCESS EXCLUSIVE MODE;

DO $guard$
DECLARE
  v_points jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM billing.workspace_payment_configurations WHERE payg_enabled OR pending_billing_mode = 'payg')
    OR EXISTS (SELECT 1 FROM billing.payg_cycles)
    OR EXISTS (SELECT 1 FROM billing.payment_transactions WHERE payment_type = 'payg') THEN
    RAISE EXCEPTION 'fresh_payg_anchor_change_requires_no_payg_workspaces_or_history';
  END IF;
  IF (SELECT count(*) FROM billing.payg_pricing_versions) <> 1
    OR NOT EXISTS (SELECT 1 FROM billing.payg_pricing_versions WHERE retired_at IS NULL)
    OR EXISTS (SELECT 1 FROM billing.payg_pricing_version_audit) THEN
    RAISE EXCEPTION 'fresh_payg_anchor_change_requires_initial_schedule';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('gb', point->'gb', 'amount_iqd', point->'amount_iqd') ORDER BY (point->>'gb')::numeric)
    INTO v_points
    FROM billing.payg_pricing_versions, LATERAL jsonb_array_elements(checkpoints) point
    WHERE retired_at IS NULL;
  IF v_points NOT IN (
    '[{"gb":1,"amount_iqd":0},{"gb":10,"amount_iqd":15000},{"gb":100,"amount_iqd":40000}]'::jsonb,
    '[{"gb":1,"amount_iqd":0},{"gb":15,"amount_iqd":10000},{"gb":100,"amount_iqd":40000}]'::jsonb
  ) OR v_points IS NULL THEN
    RAISE EXCEPTION 'fresh_payg_anchor_change_would_overwrite_custom_checkpoints';
  END IF;
END;
$guard$;

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
      'protected', ((checkpoint->>'gb')::numeric IN (1, 15, 100))
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
    WHERE (checkpoint->>'gb')::numeric = 15 AND (checkpoint->>'amount_iqd')::bigint = 10000
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_normalized) checkpoint
    WHERE (checkpoint->>'gb')::numeric = 100 AND (checkpoint->>'amount_iqd')::bigint = 40000
  ) THEN
    RAISE EXCEPTION 'protected_payg_pricing_checkpoints_required' USING ERRCODE = '23514';
  END IF;

  RETURN v_normalized;
END;
$function$;

-- Temporarily bypass ONLY the immutable-pricing trigger under an exclusive lock.
-- Both this change and trigger restoration roll back together on any failure.
ALTER TABLE billing.payg_pricing_versions DISABLE TRIGGER enforce_payg_pricing_version_transition;
UPDATE billing.payg_pricing_versions
SET checkpoints = billing.validate_payg_checkpoints(
  '[{"gb":1,"amount_iqd":0},{"gb":15,"amount_iqd":10000},{"gb":100,"amount_iqd":40000}]'::jsonb
)
WHERE retired_at IS NULL;
ALTER TABLE billing.payg_pricing_versions ENABLE TRIGGER enforce_payg_pricing_version_transition;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM billing.payg_pricing_versions
    WHERE billing.calculate_payg_amount_from_checkpoints(checkpoints, 15000000000) <> 10000
      OR billing.calculate_payg_amount_from_checkpoints(checkpoints, 100000000000) <> 40000
      OR billing.calculate_payg_amount_from_checkpoints(checkpoints, 1000000000) <> 0
      OR billing.calculate_payg_amount_from_checkpoints(checkpoints, 3000000000) <> 1429
  ) THEN
    RAISE EXCEPTION 'fresh_payg_anchor_verification_failed';
  END IF;
END;
$verify$;

COMMIT;
