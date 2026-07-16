-- Migration: Allow free subscription (amount=0) and add 'free' payment provider
-- Workspaces with subscription_amount=0 can use a "Free Renewal" flow

-- 1. Drop the constraint that forces subscription_amount > 0 when payments are enabled
ALTER TABLE billing.workspace_payment_configurations
  DROP CONSTRAINT IF EXISTS workspace_payment_configurations_enabled_amount_check;

-- 2. Recreate allowing amount = 0 for free packages
ALTER TABLE billing.workspace_payment_configurations
  ADD CONSTRAINT workspace_payment_configurations_enabled_amount_check
    CHECK (NOT is_payment_enabled OR subscription_amount >= 0);

-- 3. Update submit_workspace_payment to accept 'free' as a provider
CREATE OR REPLACE FUNCTION public.submit_workspace_payment(
  p_provider text
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
  v_provider text := lower(btrim(COALESCE(p_provider, '')));
  v_configuration billing.workspace_payment_configurations;
  v_existing billing.payment_transactions;
  v_transaction billing.payment_transactions;
  v_payment_type text;
  v_gb_added numeric(14, 6) := 0;
  v_gb_added_bytes_numeric numeric := 0;
  v_gb_added_bytes bigint := 0;
  v_submitted_by_name text;
  v_submitted_by_email text;
BEGIN
  IF v_user_id IS NULL OR v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_authentication_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_provider NOT IN ('fib', 'qicard', 'free') THEN
    RAISE EXCEPTION 'unsupported_workspace_payment_provider'
      USING ERRCODE = '22023';
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

  PERFORM billing.expire_pending_payment_transactions(v_billing_workspace_id);

  SELECT configuration_row.*
  INTO v_configuration
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE configuration_row.workspace_id = v_workspace_id
  FOR UPDATE;

  IF v_configuration.id IS NULL THEN
    RAISE EXCEPTION 'workspace_payment_configuration_missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_configuration.is_payment_enabled THEN
    RAISE EXCEPTION 'workspace_payments_disabled'
      USING ERRCODE = '42501';
  END IF;

  -- For paid providers (fib, qicard), require positive amount
  -- For free provider, require amount = 0
  IF v_provider IN ('fib', 'qicard') THEN
    IF v_configuration.currency <> 'IQD'
      OR v_configuration.subscription_amount <= 0 THEN
      RAISE EXCEPTION 'invalid_workspace_payment_configuration'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_provider = 'free' THEN
    IF v_configuration.subscription_amount <> 0 THEN
      RAISE EXCEPTION 'free_renewal_requires_zero_amount'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT transaction_row.*
  INTO v_existing
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.billing_workspace_id = v_billing_workspace_id
    AND transaction_row.status = 'pending'
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id = v_user_id THEN
      RETURN billing.payment_transaction_public_json(v_existing);
    END IF;

    RAISE EXCEPTION 'workspace_payment_already_pending_for_workspace'
      USING ERRCODE = '23505';
  END IF;

  v_payment_type := CASE
    WHEN v_configuration.usage_enabled THEN 'usage'
    ELSE 'subscription'
  END;

  IF v_payment_type = 'usage' THEN
    v_gb_added := v_configuration.gb_per_payment;
    v_gb_added_bytes_numeric := v_gb_added * 1000000000::numeric;

    IF v_gb_added <= 0
      OR trunc(v_gb_added_bytes_numeric) <> v_gb_added_bytes_numeric
      OR v_gb_added_bytes_numeric > 9223372036854775807::numeric THEN
      RAISE EXCEPTION 'invalid_workspace_payment_gb_configuration'
        USING ERRCODE = '22003';
    END IF;

    v_gb_added_bytes := v_gb_added_bytes_numeric::bigint;
  END IF;

  SELECT profile_row.name, auth_user.email
  INTO v_submitted_by_name, v_submitted_by_email
  FROM auth.users AS auth_user
  LEFT JOIN public.profiles AS profile_row
    ON profile_row.id = auth_user.id
  WHERE auth_user.id = v_user_id;

  INSERT INTO billing.payment_transactions (
    workspace_id,
    billing_workspace_id,
    user_id,
    submitted_by_name,
    submitted_by_email,
    provider,
    payment_type,
    amount,
    currency,
    gb_added,
    gb_added_bytes
  )
  VALUES (
    v_workspace_id,
    v_billing_workspace_id,
    v_user_id,
    v_submitted_by_name,
    v_submitted_by_email,
    v_provider,
    v_payment_type,
    v_configuration.subscription_amount,
    v_configuration.currency,
    v_gb_added,
    v_gb_added_bytes
  )
  RETURNING * INTO v_transaction;

  RETURN billing.payment_transaction_public_json(v_transaction);
END;
$function$;

COMMENT ON FUNCTION public.submit_workspace_payment(text) IS
  'Creates one server-priced pending manual-payment submission for the authenticated user''s active workspace. Supports fib, qicard, and free providers. Repeated submissions by the same user are idempotent while pending.';

-- 4. Update the payment_transactions provider CHECK to include 'free'
ALTER TABLE billing.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_provider_check;

ALTER TABLE billing.payment_transactions
  ADD CONSTRAINT payment_transactions_provider_check
    CHECK (provider IN ('fib', 'qicard', 'free'));

-- 5. Update admin_upsert_workspace_payment_configuration to allow amount=0 when payment enabled
CREATE OR REPLACE FUNCTION public.admin_upsert_workspace_payment_configuration(
  p_workspace_id uuid,
  p_subscription_amount text,
  p_is_payment_enabled boolean,
  p_usage_enabled boolean,
  p_gb_per_payment text,
  p_actor text,
  p_usage_start_date text DEFAULT NULL,
  p_renewal_due_at text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_workspace public.workspaces;
  v_existing billing.workspace_payment_configurations;
  v_configuration billing.workspace_payment_configurations;
  v_billing_workspace_id uuid;
  v_family_workspace_id uuid;
  v_subscription_amount numeric(20, 3);
  v_gb_per_payment numeric(14, 6);
  v_gb_bytes numeric;
  v_owner_renewal_due_at timestamptz;
  v_family_renewal_due_at timestamptz;
  v_renewal_due_at timestamptz;
  v_usage_start_date date;
  v_previous_family_mode_setting text := current_setting(
    'atlas.trusted_workspace_payment_family_mode_update',
    true
  );
  v_actor text := COALESCE(NULLIF(btrim(p_actor), ''), 'Platform administrator');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_subscription_amount IS NULL
    OR btrim(p_subscription_amount) !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$' THEN
    RAISE EXCEPTION 'invalid_subscription_amount'
      USING ERRCODE = '22023';
  END IF;

  IF p_gb_per_payment IS NULL
    OR btrim(p_gb_per_payment) !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$' THEN
    RAISE EXCEPTION 'invalid_gb_per_payment'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_subscription_amount := btrim(p_subscription_amount)::numeric;
    v_gb_per_payment := btrim(p_gb_per_payment)::numeric;
  EXCEPTION
    WHEN numeric_value_out_of_range OR invalid_text_representation THEN
      RAISE EXCEPTION 'workspace_payment_configuration_value_out_of_range'
        USING ERRCODE = '22003';
  END;

  IF v_subscription_amount < 0 THEN
    RAISE EXCEPTION 'invalid_subscription_amount'
      USING ERRCODE = '22023';
  END IF;

  -- Allow amount=0 for free packages; only require > 0 for paid usage mode
  IF COALESCE(p_is_payment_enabled, false)
    AND COALESCE(p_usage_enabled, false)
    AND v_subscription_amount <= 0 THEN
    RAISE EXCEPTION 'usage_billing_requires_positive_amount'
      USING ERRCODE = '22023';
  END IF;

  IF v_gb_per_payment < 0
    OR (COALESCE(p_usage_enabled, false) AND v_gb_per_payment <= 0) THEN
    RAISE EXCEPTION 'invalid_gb_per_payment'
      USING ERRCODE = '22023';
  END IF;

  v_gb_bytes := v_gb_per_payment * 1000000000::numeric;
  IF trunc(v_gb_bytes) <> v_gb_bytes
    OR v_gb_bytes > 9223372036854775807::numeric THEN
    RAISE EXCEPTION 'workspace_payment_gb_value_out_of_range'
      USING ERRCODE = '22003';
  END IF;

  IF p_usage_start_date IS NOT NULL AND btrim(p_usage_start_date) != '' THEN
    BEGIN
      v_usage_start_date := btrim(p_usage_start_date)::date;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_usage_start_date'
          USING ERRCODE = '22023';
    END;
  END IF;

  IF p_renewal_due_at IS NOT NULL AND btrim(p_renewal_due_at) != '' THEN
    BEGIN
      v_renewal_due_at := btrim(p_renewal_due_at)::timestamptz;
    EXCEPTION
      WHEN invalid_text_representation OR datetime_field_overflow THEN
        RAISE EXCEPTION 'invalid_renewal_due_at'
          USING ERRCODE = '22023';
    END;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'workspace-branch-payment-owner:' || p_workspace_id::text,
      0
    )
  );

  v_billing_workspace_id := public.workspace_usage_owner_id(p_workspace_id);
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'workspace-payment:' || COALESCE(v_billing_workspace_id, p_workspace_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'workspace-payment-configuration:' || COALESCE(v_billing_workspace_id, p_workspace_id)::text,
      0
    )
  );

  FOR v_family_workspace_id IN
    WITH RECURSIVE family(workspace_id, depth, path) AS (
      SELECT
        v_billing_workspace_id,
        0,
        ARRAY[v_billing_workspace_id]

      UNION ALL

      SELECT
        relationship.branch_workspace_id,
        family.depth + 1,
        family.path || relationship.branch_workspace_id
      FROM family
      INNER JOIN public.workspace_branches AS relationship
        ON relationship.source_workspace_id = family.workspace_id
      WHERE family.depth < 16
        AND NOT relationship.branch_workspace_id = ANY(family.path)
    )
    SELECT family.workspace_id
    FROM family
    INNER JOIN public.workspaces AS family_workspace
      ON family_workspace.id = family.workspace_id
    GROUP BY family.workspace_id
    ORDER BY min(family.depth), family.workspace_id
  LOOP
    PERFORM 1
    FROM public.workspaces AS family_workspace
    WHERE family_workspace.id = v_family_workspace_id
    FOR UPDATE;
  END LOOP;

  SELECT workspace_row.*
  INTO v_workspace
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = p_workspace_id
    AND workspace_row.deleted_at IS NULL
  FOR UPDATE;

  IF v_workspace.id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT configuration_row.*
  INTO v_existing
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE configuration_row.workspace_id = p_workspace_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM billing.payment_transactions AS transaction_row
    WHERE transaction_row.billing_workspace_id = v_billing_workspace_id
      AND transaction_row.status = 'pending'
      AND transaction_row.payment_type IS DISTINCT FROM CASE
        WHEN COALESCE(p_usage_enabled, false) THEN 'usage'
        ELSE 'subscription'
      END
  ) THEN
    RAISE EXCEPTION 'workspace_payment_pending_transaction_mode_conflict'
      USING
        ERRCODE = '23514',
        HINT = 'Approve, reject, or expire the pending payment before changing the family billing mode.';
  END IF;

  SELECT
    max(configuration_row.renewal_due_at) FILTER (
      WHERE configuration_row.workspace_id = v_billing_workspace_id
    ),
    min(configuration_row.renewal_due_at)
  INTO
    v_owner_renewal_due_at,
    v_family_renewal_due_at
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE public.workspace_usage_owner_id(configuration_row.workspace_id)
    = v_billing_workspace_id;

  IF COALESCE(p_usage_enabled, false) THEN
    IF v_renewal_due_at IS NOT NULL THEN
      v_renewal_due_at := v_renewal_due_at;
    ELSE
      v_renewal_due_at := COALESCE(
        v_owner_renewal_due_at,
        v_family_renewal_due_at,
        billing.next_workspace_usage_renewal_due(v_billing_workspace_id, now())
      );
    END IF;
  ELSE
    v_renewal_due_at := v_existing.renewal_due_at;
  END IF;

  PERFORM set_config(
    'atlas.trusted_workspace_payment_family_mode_update',
    'on',
    true
  );

  INSERT INTO billing.workspace_payment_configurations (
    workspace_id,
    subscription_amount,
    currency,
    is_payment_enabled,
    usage_enabled,
    gb_per_payment,
    renewal_due_at,
    usage_start_date,
    created_by,
    updated_by,
    created_by_label,
    updated_by_label,
    created_via,
    updated_via
  )
  VALUES (
    p_workspace_id,
    v_subscription_amount,
    'IQD',
    COALESCE(p_is_payment_enabled, false),
    COALESCE(p_usage_enabled, false),
    v_gb_per_payment,
    v_renewal_due_at,
    v_usage_start_date,
    auth.uid(),
    auth.uid(),
    v_actor,
    v_actor,
    'admin-dashboard',
    'admin-dashboard'
  )
  ON CONFLICT (workspace_id) DO UPDATE
  SET
    subscription_amount = EXCLUDED.subscription_amount,
    currency = 'IQD',
    is_payment_enabled = EXCLUDED.is_payment_enabled,
    usage_enabled = EXCLUDED.usage_enabled,
    gb_per_payment = EXCLUDED.gb_per_payment,
    renewal_due_at = CASE
      WHEN v_renewal_due_at IS NOT NULL THEN EXCLUDED.renewal_due_at
      ELSE workspace_payment_configurations.renewal_due_at
    END,
    usage_start_date = CASE
      WHEN v_usage_start_date IS NOT NULL THEN EXCLUDED.usage_start_date
      ELSE workspace_payment_configurations.usage_start_date
    END,
    updated_by = auth.uid(),
    updated_by_label = v_actor,
    updated_via = 'admin-dashboard'
  RETURNING * INTO v_configuration;

  INSERT INTO billing.workspace_payment_configurations (
    workspace_id,
    subscription_amount,
    currency,
    is_payment_enabled,
    usage_enabled,
    gb_per_payment,
    renewal_due_at,
    usage_start_date,
    created_by,
    updated_by,
    created_by_label,
    updated_by_label,
    created_via,
    updated_via
  )
  SELECT
    family_workspace.id,
    v_subscription_amount,
    'IQD',
    COALESCE(p_is_payment_enabled, false),
    COALESCE(p_usage_enabled, false),
    v_gb_per_payment,
    v_renewal_due_at,
    v_usage_start_date,
    auth.uid(),
    auth.uid(),
    v_actor,
    v_actor,
    'admin-dashboard-family-default',
    'admin-dashboard-family-default'
  FROM public.workspaces AS family_workspace
  WHERE public.workspace_usage_owner_id(family_workspace.id)
      = v_billing_workspace_id
  ON CONFLICT (workspace_id) DO NOTHING;

  UPDATE billing.workspace_payment_configurations AS configuration_row
  SET
    usage_enabled = COALESCE(p_usage_enabled, false),
    gb_per_payment = CASE
      WHEN COALESCE(p_usage_enabled, false)
        AND configuration_row.gb_per_payment <= 0 THEN v_gb_per_payment
      ELSE configuration_row.gb_per_payment
    END,
    renewal_due_at = CASE
      WHEN COALESCE(p_usage_enabled, false) AND v_renewal_due_at IS NOT NULL THEN v_renewal_due_at
      ELSE configuration_row.renewal_due_at
    END,
    usage_start_date = CASE
      WHEN v_usage_start_date IS NOT NULL THEN v_usage_start_date
      ELSE configuration_row.usage_start_date
    END,
    updated_by = auth.uid(),
    updated_by_label = v_actor,
    updated_via = 'admin-dashboard-family-mode'
  WHERE configuration_row.workspace_id IS DISTINCT FROM p_workspace_id
    AND public.workspace_usage_owner_id(configuration_row.workspace_id)
      = v_billing_workspace_id
    AND (
      configuration_row.usage_enabled IS DISTINCT FROM COALESCE(p_usage_enabled, false)
      OR (
        COALESCE(p_usage_enabled, false)
        AND configuration_row.renewal_due_at IS DISTINCT FROM v_renewal_due_at
      )
      OR (
        v_usage_start_date IS NOT NULL
        AND configuration_row.usage_start_date IS DISTINCT FROM v_usage_start_date
      )
    );

  PERFORM set_config(
    'atlas.trusted_workspace_payment_family_mode_update',
    COALESCE(v_previous_family_mode_setting, 'off'),
    true
  );

  RETURN jsonb_build_object(
    'workspace_id', v_workspace.id,
    'workspace_name', v_workspace.name,
    'workspace_code', v_workspace.code,
    'id', v_configuration.id,
    'subscription_amount', v_configuration.subscription_amount::text,
    'currency', v_configuration.currency,
    'is_payment_enabled', v_configuration.is_payment_enabled,
    'usage_enabled', v_configuration.usage_enabled,
    'gb_per_payment', v_configuration.gb_per_payment::text,
    'renewal_due_at', v_configuration.renewal_due_at,
    'usage_start_date', v_configuration.usage_start_date,
    'created_at', v_configuration.created_at,
    'updated_at', v_configuration.updated_at
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_upsert_workspace_payment_configuration(uuid, text, boolean, boolean, text, text, text, text) IS
  'Service-role-only validated create/update for a workspace billing configuration. Accepts optional usage_start_date and renewal_due_at. Free packages (amount=0) are allowed.';
