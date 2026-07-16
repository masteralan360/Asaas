-- Remove purchased_credit_bytes concept entirely.
-- On payment approval: clear usage counters, then set
--   data_transfer_bytes = gb_added_bytes
--   actual_data_transfer_bytes = gb_added_bytes / 10
-- (satisfies CHECK constraint data_transfer_bytes = actual * 10)
-- Effective allowance is just monthly_data_transfer_limit_bytes (no more + credit).

-- 1. admin_review_workspace_payment_transaction: replace purchased_credit_bytes with data_transfer reset
DROP FUNCTION IF EXISTS public.admin_review_workspace_payment_transaction(uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION public.admin_review_workspace_payment_transaction(
  p_transaction_id uuid,
  p_decision text,
  p_reviewer_label text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_provider_payment_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_transaction billing.payment_transactions;
  v_reviewer_label text := COALESCE(NULLIF(btrim(p_reviewer_label), ''), 'Platform administrator');
  v_workspace_name text;
  v_subscription_expires_at timestamptz;
  v_current_renewal_due_at timestamptz;
  v_renewal_due_at timestamptz;
  v_approval_timestamp timestamptz := now();
  v_audit_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'transaction_id_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision IS NULL
    OR upper(btrim(p_decision)) NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'invalid_decision'
      USING ERRCODE = '22023';
  END IF;

  SELECT transaction_row.*
  INTO v_transaction
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.id = p_transaction_id
  FOR UPDATE OF transaction_row;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'transaction_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_transaction.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'transaction_already_reviewed'
      USING ERRCODE = '23514';
  END IF;

  IF v_transaction.expires_at IS NOT NULL AND v_transaction.expires_at < now() THEN
    UPDATE billing.payment_transactions AS transaction_row
    SET
      status = 'expired',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      reviewed_by_label = v_reviewer_label,
      review_note = COALESCE(v_audit_note, 'Auto-expired before review')
    WHERE transaction_row.id = p_transaction_id;

    PERFORM billing.log_payment_transaction_status_change(
      p_transaction_id,
      'pending',
      'expired',
      auth.uid(),
      v_reviewer_label,
      COALESCE(v_audit_note, 'Auto-expired before review')
    );

    RETURN jsonb_build_object(
      'id', v_transaction.id,
      'status', 'expired',
      'message', 'Transaction had already expired.'
    );
  END IF;

  SELECT workspace_row.name
  INTO v_workspace_name
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_transaction.billing_workspace_id;

  IF upper(btrim(p_decision)) = 'REJECTED' THEN
    UPDATE billing.payment_transactions AS transaction_row
    SET
      status = 'rejected',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      reviewed_by_label = v_reviewer_label,
      review_note = v_audit_note
    WHERE transaction_row.id = p_transaction_id;

    PERFORM billing.log_payment_transaction_status_change(
      p_transaction_id,
      'pending',
      'rejected',
      auth.uid(),
      v_reviewer_label,
      v_audit_note
    );

    RETURN jsonb_build_object(
      'id', v_transaction.id,
      'status', 'rejected',
      'workspace_name', v_workspace_name
    );
  END IF;

  IF v_transaction.payment_type = 'subscription' THEN
    UPDATE public.workspaces AS workspace_row
    SET
      subscription_expires_at = GREATEST(
        COALESCE(workspace_row.subscription_expires_at, now()),
        now()
      ) + INTERVAL '1 month',
      locked_workspace = CASE
        WHEN workspace_row.subscription_expiry_locked THEN
          workspace_row.usage_limit_locked OR workspace_row.payment_renewal_locked
        ELSE workspace_row.locked_workspace
      END,
      subscription_expiry_locked = false
    WHERE workspace_row.id = v_transaction.billing_workspace_id
      AND workspace_row.deleted_at IS NULL
    RETURNING workspace_row.subscription_expires_at
    INTO v_subscription_expires_at;

    IF v_subscription_expires_at IS NULL THEN
      RAISE EXCEPTION 'billing_workspace_not_found'
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    IF v_transaction.gb_added_bytes <= 0 OR v_transaction.gb_added <= 0 THEN
      RAISE EXCEPTION 'invalid_usage_payment_snapshot'
        USING ERRCODE = '23514';
    END IF;

    LOCK TABLE public.workspace_usage IN EXCLUSIVE MODE;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'workspace-payment-configuration:' || v_transaction.billing_workspace_id::text,
        0
      )
    );

    SELECT max(configuration_row.renewal_due_at)
    INTO v_current_renewal_due_at
    FROM billing.workspace_payment_configurations AS configuration_row
    WHERE public.workspace_usage_owner_id(configuration_row.workspace_id)
      = v_transaction.billing_workspace_id;

    PERFORM billing.reconcile_workspace_payment_renewal_lock(
      v_transaction.billing_workspace_id
    );

    v_renewal_due_at := billing.next_workspace_usage_renewal_due(
      v_transaction.billing_workspace_id,
      GREATEST(COALESCE(v_current_renewal_due_at, now()), now())
    );

    UPDATE billing.workspace_payment_configurations AS configuration_row
    SET
      renewal_due_at = v_renewal_due_at,
      usage_start_date = now()::date,
      updated_by = auth.uid(),
      updated_by_label = v_reviewer_label,
      updated_via = 'payment-approval'
    WHERE public.workspace_usage_owner_id(configuration_row.workspace_id)
      = v_transaction.billing_workspace_id;

    INSERT INTO public.workspace_usage_limits (
      workspace_id,
      monthly_data_transfer_limit_bytes,
      notes
    )
    VALUES (
      v_transaction.billing_workspace_id,
      0,
      'Usage billing enabled by an approved workspace payment.'
    )
    ON CONFLICT (workspace_id) DO UPDATE
    SET
      monthly_data_transfer_limit_bytes = COALESCE(
        workspace_usage_limits.monthly_data_transfer_limit_bytes,
        0
      ),
      updated_at = now();

    PERFORM public.ensure_workspace_usage_row(v_transaction.billing_workspace_id);

    -- Deduct the approved GB from current usage counters
    UPDATE public.workspace_usage AS usage_row
    SET
      data_transfer_bytes = GREATEST(usage_row.data_transfer_bytes - v_transaction.gb_added_bytes, 0),
      actual_data_transfer_bytes = GREATEST(usage_row.data_transfer_bytes - v_transaction.gb_added_bytes, 0) / 10,
      updated_at = now()
    WHERE usage_row.workspace_id = v_transaction.billing_workspace_id;

    PERFORM public.reconcile_workspace_usage_limit_lock(
      v_transaction.billing_workspace_id
    );

    SELECT workspace_row.subscription_expires_at
    INTO v_subscription_expires_at
    FROM public.workspaces AS workspace_row
    WHERE workspace_row.id = v_transaction.billing_workspace_id;
  END IF;

  UPDATE billing.payment_transactions AS transaction_row
  SET
    status = 'approved',
    paid_at = now(),
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    reviewed_by_label = v_reviewer_label,
    review_note = v_audit_note,
    provider_payment_id = COALESCE(
      NULLIF(btrim(p_provider_payment_id), ''),
      transaction_row.provider_payment_id
    )
  WHERE transaction_row.id = p_transaction_id;

  PERFORM billing.log_payment_transaction_status_change(
    p_transaction_id,
    'pending',
    'approved',
    auth.uid(),
    v_reviewer_label,
    v_audit_note
  );

  RETURN jsonb_build_object(
    'id', v_transaction.id,
    'status', 'approved',
    'workspace_name', v_workspace_name,
    'payment_type', v_transaction.payment_type,
    'amount', v_transaction.amount::text,
    'gb_added', v_transaction.gb_added::text,
    'new_expiry', v_subscription_expires_at,
    'new_renewal_due_at', v_renewal_due_at
  );
END;
$function$;

-- 2. reconcile_workspace_usage_limit_lock: remove purchased_credit_bytes
CREATE OR REPLACE FUNCTION public.reconcile_workspace_usage_limit_lock(
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_usage_owner_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_charged_usage_bytes bigint;
  v_base_allowance_bytes bigint;
  v_effective_allowance numeric;
  v_exhausted boolean := false;
BEGIN
  IF v_usage_owner_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);

  SELECT
    usage.data_transfer_bytes,
    limits.monthly_data_transfer_limit_bytes
  INTO
    v_charged_usage_bytes,
    v_base_allowance_bytes
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id
    AND usage.transfer_period_start = public.workspace_usage_period_start(v_usage_owner_id);

  IF FOUND AND v_base_allowance_bytes IS NOT NULL THEN
    v_effective_allowance := v_base_allowance_bytes::numeric;
    v_exhausted := COALESCE(v_charged_usage_bytes, 0)::numeric >= v_effective_allowance;
  END IF;

  IF v_exhausted THEN
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = true,
      usage_limit_locked = true
    WHERE workspace_row.id = v_usage_owner_id
      AND COALESCE(workspace_row.locked_workspace, false) = false;
  ELSE
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = false,
      usage_limit_locked = false
    WHERE workspace_row.id = v_usage_owner_id
      AND workspace_row.usage_limit_locked = true;
  END IF;
END;
$function$;

-- 3. ensure_workspace_usage_row: remove purchased_credit_bytes from reset
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
    actual_data_transfer_bytes = 0,
    data_transfer_bytes = 0,
    transfer_period_start = v_period,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = v_usage_owner_id
    AND transfer_period_start IS DISTINCT FROM v_period;
END;
$function$;

-- 4. get_workspace_payment_summary: remove purchased_credit_bytes from allowance and response
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
      v_effective_allowance := v_base_allowance::bigint;
    END IF;
  END IF;

  v_is_usage_mode := CASE
    WHEN v_configuration.id IS NOT NULL THEN v_configuration.usage_enabled
    ELSE v_has_usage_limits
  END;

  IF v_is_usage_mode THEN
    v_usage_exhausted := v_effective_allowance IS NOT NULL
      AND COALESCE(v_usage.data_transfer_bytes, 0) >= v_effective_allowance;
    v_usage_renewal_due := COALESCE(v_configuration.usage_enabled, false)
      AND v_configuration.renewal_due_at <= now();
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

-- 5. record_workspace_data_transfer: remove purchased_credit_bytes from return
DROP FUNCTION IF EXISTS public.record_workspace_data_transfer(uuid, bigint, text);
CREATE OR REPLACE FUNCTION public.record_workspace_data_transfer(
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
  monthly_data_transfer_limit_bytes bigint,
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
BEGIN
  IF v_workspace_id IS NULL OR v_usage_owner_id IS NULL THEN
    RAISE EXCEPTION 'Workspace is required';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_usage_owner_id IS DISTINCT FROM v_current_usage_owner_id THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  PERFORM public.apply_workspace_data_transfer_usage(v_workspace_id, p_bytes);

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
      0::bigint,
      public.workspace_transfer_charge_multiplier(),
      NULL::bigint,
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
    limits.monthly_data_transfer_limit_bytes,
    limits.monthly_data_transfer_limit_bytes
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id;
END;
$function$;

-- 6. get_workspace_usage_status: remove purchased_credit_bytes from return
CREATE OR REPLACE FUNCTION public.get_workspace_usage_status(
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
  transfer_period_start date,
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
      0::bigint,
      public.workspace_transfer_charge_multiplier(),
      NULL::bigint,
      public.workspace_usage_period_start(v_usage_owner_id),
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
    usage.actual_data_transfer_bytes,
    usage.data_transfer_bytes,
    public.workspace_transfer_charge_multiplier(),
    limits.monthly_data_transfer_limit_bytes,
    usage.transfer_period_start,
    limits.monthly_data_transfer_limit_bytes,
    workspace_row.usage_limit_locked
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  INNER JOIN public.workspaces AS workspace_row
    ON workspace_row.id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id;
END;
$function$;

-- 7. Update the backfill lock check in enforce_workspace_payment_configuration_mode
-- (this was a one-time migration but the function it updates already replaced above)
