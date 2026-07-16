-- Migration: Allow admin RPC to toggle usage_enabled even when usage limits exist
-- Also: treat workspaces with usage limits but usage_enabled=false as subscription mode
-- Also: allow amount=0 in payment_transactions for free renewals

-- 0. Allow amount=0 in payment_transactions for free renewals
ALTER TABLE billing.payment_transactions
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_amount_check;

ALTER TABLE billing.payment_transactions
  ADD CONSTRAINT workspace_payment_transactions_amount_check
    CHECK (amount >= 0);

-- 0b. Allow 'free' provider in payment_transactions
ALTER TABLE billing.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_provider_check;

ALTER TABLE billing.payment_transactions
  ADD CONSTRAINT payment_transactions_provider_check
    CHECK (provider IN ('fib', 'qicard', 'free'));

-- 1. Fix trigger to bypass usage limits guard for admin RPC
CREATE OR REPLACE FUNCTION billing.enforce_workspace_payment_configuration_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_billing_workspace_id uuid := public.workspace_usage_owner_id(NEW.workspace_id);
  v_is_admin_update boolean := (
    auth.role() = 'service_role'
    AND current_setting(
      'atlas.trusted_workspace_payment_family_mode_update',
      true
    ) = 'on'
  );
BEGIN
  IF v_billing_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'workspace-payment-configuration:' || v_billing_workspace_id::text,
        0
      )
    );
  END IF;

  IF NOT v_is_admin_update AND EXISTS (
    SELECT 1
    FROM billing.workspace_payment_configurations AS configuration_row
    WHERE configuration_row.workspace_id IS DISTINCT FROM NEW.workspace_id
      AND public.workspace_usage_owner_id(configuration_row.workspace_id)
        = v_billing_workspace_id
      AND configuration_row.usage_enabled IS DISTINCT FROM NEW.usage_enabled
  ) THEN
    RAISE EXCEPTION 'workspace_payment_family_usage_mode_mismatch'
      USING
        ERRCODE = '23514',
        HINT = 'Use the same usage-payment mode for every configured workspace in the branch family.';
  END IF;

  IF NOT v_is_admin_update AND NOT NEW.usage_enabled AND EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = v_billing_workspace_id
  ) THEN
    RAISE EXCEPTION 'workspace_usage_limits_require_usage_payment_configuration'
      USING
        ERRCODE = '23514',
        HINT = 'Remove the workspace usage limits before disabling usage-based payments.';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Fix reconcile to only use usage_enabled from config, not usage limits existence
CREATE OR REPLACE FUNCTION billing.reconcile_workspace_payment_renewal_lock(
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_billing_workspace_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_usage_enabled boolean := false;
  v_is_due boolean := false;
  v_subscription_expired boolean := false;
BEGIN
  IF v_billing_workspace_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'workspace-payment-configuration:' || v_billing_workspace_id::text,
      0
    )
  );

  SELECT
    EXISTS (
      SELECT 1
      FROM billing.workspace_payment_configurations AS configuration_row
      WHERE configuration_row.usage_enabled = true
        AND public.workspace_usage_owner_id(configuration_row.workspace_id)
          = v_billing_workspace_id
    ),
    EXISTS (
      SELECT 1
      FROM billing.workspace_payment_configurations AS configuration_row
      WHERE configuration_row.usage_enabled = true
        AND configuration_row.renewal_due_at <= now()
        AND public.workspace_usage_owner_id(configuration_row.workspace_id)
          = v_billing_workspace_id
    )
  INTO
    v_usage_enabled,
    v_is_due;

  SELECT COALESCE(workspace_row.subscription_expires_at <= now(), false)
  INTO v_subscription_expired
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_billing_workspace_id;

  PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);

  IF NOT v_usage_enabled THEN
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = CASE
        WHEN v_subscription_expired THEN true
        WHEN workspace_row.usage_limit_locked
          OR workspace_row.payment_renewal_locked
          OR workspace_row.subscription_expiry_locked THEN false
        ELSE workspace_row.locked_workspace
      END,
      usage_limit_locked = false,
      payment_renewal_locked = false,
      subscription_expiry_locked = CASE
        WHEN NOT v_subscription_expired THEN false
        WHEN workspace_row.locked_workspace = false
          OR workspace_row.usage_limit_locked
          OR workspace_row.payment_renewal_locked
          OR workspace_row.subscription_expiry_locked THEN true
        ELSE false
      END
    WHERE workspace_row.id = v_billing_workspace_id
      AND (
        workspace_row.usage_limit_locked
        OR workspace_row.payment_renewal_locked
        OR workspace_row.subscription_expiry_locked IS DISTINCT FROM CASE
          WHEN NOT v_subscription_expired THEN false
          WHEN workspace_row.locked_workspace = false
            OR workspace_row.usage_limit_locked
            OR workspace_row.payment_renewal_locked
            OR workspace_row.subscription_expiry_locked THEN true
          ELSE false
        END
        OR workspace_row.locked_workspace IS DISTINCT FROM CASE
          WHEN v_subscription_expired THEN true
          WHEN workspace_row.usage_limit_locked
            OR workspace_row.payment_renewal_locked
            OR workspace_row.subscription_expiry_locked THEN false
          ELSE workspace_row.locked_workspace
        END
      );

    RETURN;
  END IF;

  IF v_is_due THEN
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = true,
      payment_renewal_locked = true,
      subscription_expiry_locked = true
    WHERE workspace_row.id = v_billing_workspace_id
      AND (
        workspace_row.locked_workspace IS DISTINCT FROM true
        OR workspace_row.payment_renewal_locked IS DISTINCT FROM true
        OR workspace_row.subscription_expiry_locked IS DISTINCT FROM true
      )
      AND (
        workspace_row.locked_workspace = false
        OR workspace_row.usage_limit_locked = true
        OR workspace_row.subscription_expiry_locked IS DISTINCT FROM true
        OR workspace_row.payment_renewal_locked IS DISTINCT FROM true
      );
  ELSE
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = workspace_row.usage_limit_locked,
      payment_renewal_locked = false,
      subscription_expiry_locked = false
    WHERE workspace_row.id = v_billing_workspace_id
      AND (
        workspace_row.payment_renewal_locked = true
        OR workspace_row.subscription_expiry_locked = true
      );
  END IF;

  PERFORM public.reconcile_workspace_usage_limit_lock(v_billing_workspace_id);
END;
$function$;

-- 3. Fix get_workspace_payment_summary to only use usage_enabled from config
CREATE OR REPLACE FUNCTION public.get_workspace_payment_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := public.current_workspace_id();
  v_billing_workspace_id uuid;
  v_workspace_name text;
  v_subscription_expires_at timestamptz;
  v_configuration billing.workspace_payment_configurations;
  v_usage public.workspace_usage;
  v_has_usage_limits boolean := false;
  v_is_usage_mode boolean := false;
  v_base_allowance bigint;
  v_effective_allowance bigint;
  v_usage_limit_locked boolean := false;
  v_subscription_expired boolean := false;
  v_usage_exhausted boolean := false;
  v_usage_renewal_due boolean := false;
  v_alert_reason text;
  v_pending billing.payment_transactions;
  v_transactions jsonb := '[]'::jsonb;
  v_has_workspace_pending boolean := false;
BEGIN
  IF v_user_id IS NULL OR v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_authentication_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    public.workspace_usage_owner_id(workspace_row.id),
    workspace_row.name
  INTO
    v_billing_workspace_id,
    v_workspace_name
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_workspace_id
    AND workspace_row.deleted_at IS NULL;

  IF v_billing_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM billing.expire_pending_payment_transactions(v_billing_workspace_id);

  SELECT configuration_row.*
  INTO v_configuration
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE configuration_row.workspace_id = v_workspace_id;

  PERFORM billing.reconcile_workspace_payment_renewal_lock(v_billing_workspace_id);

  SELECT
    workspace_row.subscription_expires_at,
    workspace_row.usage_limit_locked
  INTO
    v_subscription_expires_at,
    v_usage_limit_locked
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_billing_workspace_id;

  SELECT limits.monthly_data_transfer_limit_bytes
  INTO v_base_allowance
  FROM public.workspace_usage_limits AS limits
  WHERE limits.workspace_id = v_billing_workspace_id;

  v_has_usage_limits := FOUND;

  IF v_has_usage_limits THEN
    PERFORM public.ensure_workspace_usage_row(v_billing_workspace_id);

    SELECT usage_row.*
    INTO v_usage
    FROM public.workspace_usage AS usage_row
    WHERE usage_row.workspace_id = v_billing_workspace_id;

    IF v_base_allowance IS NOT NULL THEN
      v_effective_allowance := (
        v_base_allowance::numeric + COALESCE(v_usage.purchased_credit_bytes, 0)::numeric
      )::bigint;
    END IF;
  END IF;

  v_is_usage_mode := COALESCE(v_configuration.usage_enabled, false);

  IF v_is_usage_mode THEN
    v_usage_exhausted := v_effective_allowance IS NOT NULL
      AND COALESCE(v_usage.data_transfer_bytes, 0) >= v_effective_allowance;
    v_usage_renewal_due := COALESCE(v_configuration.usage_enabled, false)
      AND v_configuration.renewal_due_at <= now();

    IF v_usage_renewal_due THEN
      v_subscription_expired := true;
    END IF;
  ELSE
    v_subscription_expired := v_subscription_expires_at IS NOT NULL
      AND v_subscription_expires_at <= now();
  END IF;

  v_alert_reason := CASE
    WHEN v_usage_exhausted THEN 'usage_exhausted'
    WHEN v_usage_renewal_due THEN 'subscription_expired'
    WHEN v_subscription_expired THEN 'subscription_expired'
    ELSE NULL
  END;

  SELECT transaction_row.*
  INTO v_pending
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.billing_workspace_id = v_billing_workspace_id
    AND transaction_row.user_id = v_user_id
    AND transaction_row.status = 'pending'
  ORDER BY transaction_row.created_at DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM billing.payment_transactions AS transaction_row
    WHERE transaction_row.billing_workspace_id = v_billing_workspace_id
      AND transaction_row.status = 'pending'
  )
  INTO v_has_workspace_pending;

  SELECT COALESCE(
    jsonb_agg(
      billing.payment_transaction_public_json(transaction_row)
      ORDER BY transaction_row.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_transactions
  FROM (
    SELECT transaction_source.*
    FROM billing.payment_transactions AS transaction_source
    WHERE transaction_source.billing_workspace_id = v_billing_workspace_id
      AND transaction_source.user_id = v_user_id
    ORDER BY transaction_source.created_at DESC
    LIMIT 20
  ) AS transaction_row;

  RETURN jsonb_build_object(
    'workspace_id', v_workspace_id,
    'billing_workspace_id', v_billing_workspace_id,
    'workspace_name', v_workspace_name,
    'payment_enabled', COALESCE(v_configuration.is_payment_enabled, false),
    'subscription_expired', v_subscription_expired,
    'usage_exhausted', v_usage_exhausted,
    'usage_renewal_due', v_usage_renewal_due,
    'alert_reason', v_alert_reason,
    'should_alert', v_alert_reason IS NOT NULL,
    'has_workspace_pending_transaction', v_has_workspace_pending,
    'eligibility', jsonb_build_object(
      'subscription_expired', v_subscription_expired,
      'usage_exhausted', v_usage_exhausted,
      'usage_renewal_due', v_usage_renewal_due,
      'alert_reason', v_alert_reason,
      'payment_enabled', COALESCE(v_configuration.is_payment_enabled, false)
    ),
    'configuration', CASE
      WHEN v_configuration.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_configuration.id,
        'workspace_id', v_configuration.workspace_id,
        'subscription_amount', v_configuration.subscription_amount::text,
        'currency', v_configuration.currency,
        'is_payment_enabled', v_configuration.is_payment_enabled,
        'usage_enabled', v_configuration.usage_enabled,
        'gb_per_payment', v_configuration.gb_per_payment::text,
        'renewal_due_at', v_configuration.renewal_due_at,
        'usage_start_date', v_configuration.usage_start_date
      )
    END,
    'usage', jsonb_build_object(
      'has_limits', v_has_usage_limits,
      'charged_bytes', COALESCE(v_usage.data_transfer_bytes, 0),
      'base_allowance_bytes', v_base_allowance,
      'purchased_credit_bytes', COALESCE(v_usage.purchased_credit_bytes, 0),
      'effective_allowance_bytes', v_effective_allowance,
      'usage_limit_locked', v_usage_limit_locked,
      'subscription_expires_at', v_subscription_expires_at
    ),
    'pending_transaction', CASE
      WHEN v_pending.id IS NULL THEN NULL
      ELSE billing.payment_transaction_public_json(v_pending)
    END,
    'transactions', v_transactions
  );
END;
$function$;
