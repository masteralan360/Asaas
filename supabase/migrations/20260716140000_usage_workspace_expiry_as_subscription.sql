-- Migration: Make usage-based workspace expiry behave like normal subscription expiry
-- Adds usage_start_date tracking and maps renewal_due_at expiry to subscription_expired alerts

-- 1. Add usage_start_date column to workspace_payment_configurations
ALTER TABLE billing.workspace_payment_configurations
ADD COLUMN usage_start_date date NULL;

COMMENT ON COLUMN billing.workspace_payment_configurations.usage_start_date IS
  'Admin-settable start date for the current usage billing cycle. Updated on payment approval.';

-- 2. Update reconcile_workspace_payment_renewal_lock to set subscription_expiry_locked
--    for usage workspaces when renewal_due_at passes (instead of only payment_renewal_locked)
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
    (
      EXISTS (
        SELECT 1
        FROM billing.workspace_payment_configurations AS configuration_row
        WHERE configuration_row.usage_enabled = true
          AND public.workspace_usage_owner_id(configuration_row.workspace_id)
            = v_billing_workspace_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.workspace_usage_limits AS limits
        WHERE limits.workspace_id = v_billing_workspace_id
      )
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
    -- Subscription mode: unchanged from original
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

  -- Usage mode: renewal_due_at expiry now behaves like subscription expiry.
  -- When renewal is due, set subscription_expiry_locked = true so the client
  -- shows "subscription expired" instead of "renewal due".
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

-- 3. Update get_workspace_payment_summary to return usage_start_date
--    and treat usage renewal as subscription_expired
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

  v_is_usage_mode := CASE
    WHEN v_configuration.id IS NOT NULL THEN v_configuration.usage_enabled
    ELSE v_has_usage_limits
  END;

  IF v_is_usage_mode THEN
    v_usage_exhausted := v_effective_allowance IS NOT NULL
      AND COALESCE(v_usage.data_transfer_bytes, 0) >= v_effective_allowance;
    v_usage_renewal_due := COALESCE(v_configuration.usage_enabled, false)
      AND v_configuration.renewal_due_at <= now();

    -- Usage renewal now maps to subscription_expired for consistent UI behavior
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

-- 4. Update admin_list_workspace_payment_configurations to return usage_start_date
CREATE OR REPLACE FUNCTION public.admin_list_workspace_payment_configurations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'workspace_id', workspace_row.id,
        'workspace_name', workspace_row.name,
        'workspace_code', workspace_row.code,
        'billing_workspace_id', public.workspace_usage_owner_id(workspace_row.id),
        'id', configuration_row.id,
        'subscription_amount', configuration_row.subscription_amount::text,
        'currency', configuration_row.currency,
        'is_payment_enabled', configuration_row.is_payment_enabled,
        'usage_enabled', configuration_row.usage_enabled,
        'gb_per_payment', configuration_row.gb_per_payment::text,
        'renewal_due_at', configuration_row.renewal_due_at,
        'usage_start_date', configuration_row.usage_start_date,
        'created_at', configuration_row.created_at,
        'updated_at', configuration_row.updated_at
      )
      ORDER BY workspace_row.name, workspace_row.code, workspace_row.id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.workspaces AS workspace_row
  LEFT JOIN billing.workspace_payment_configurations AS configuration_row
    ON configuration_row.workspace_id = workspace_row.id
  WHERE workspace_row.deleted_at IS NULL;

  RETURN v_result;
END;
$function$;

-- 5. Update admin_upsert_workspace_payment_configuration to accept usage_start_date and renewal_due_at
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

  IF v_subscription_amount < 0
    OR (COALESCE(p_is_payment_enabled, false) AND v_subscription_amount <= 0) THEN
    RAISE EXCEPTION 'invalid_subscription_amount'
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

  -- Parse optional usage_start_date
  IF p_usage_start_date IS NOT NULL AND btrim(p_usage_start_date) != '' THEN
    BEGIN
      v_usage_start_date := btrim(p_usage_start_date)::date;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_usage_start_date'
          USING ERRCODE = '22023';
    END;
  END IF;

  -- Parse optional renewal_due_at
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
    -- Use admin-provided renewal_due_at if given, otherwise compute next boundary
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

  -- Propagate to family branches
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
  'Service-role-only validated create/update for a workspace billing configuration. Accepts optional usage_start_date and renewal_due_at for admin control of usage billing cycle dates.';

-- 6. Update payment approval to set usage_start_date on renewal
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
  v_base_allowance bigint;
  v_current_credit bigint;
  v_new_credit bigint;
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

  -- Subscription approval: extend expiry
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
    -- Usage approval: credit GB, advance renewal, update usage_start_date
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

    -- Update renewal_due_at and usage_start_date for the entire family
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

    SELECT
      limits.monthly_data_transfer_limit_bytes,
      usage_row.purchased_credit_bytes
    INTO
      v_base_allowance,
      v_current_credit
    FROM public.workspace_usage AS usage_row
    INNER JOIN public.workspace_usage_limits AS limits
      ON limits.workspace_id = usage_row.workspace_id
    WHERE usage_row.workspace_id = v_transaction.billing_workspace_id
    FOR UPDATE OF usage_row;

    IF NOT FOUND OR v_base_allowance IS NULL THEN
      RAISE EXCEPTION 'workspace_usage_state_missing'
        USING ERRCODE = 'P0002';
    END IF;

    IF v_current_credit::numeric + v_transaction.gb_added_bytes::numeric
        > 9223372036854775807::numeric
      OR v_base_allowance::numeric + v_current_credit::numeric
        + v_transaction.gb_added_bytes::numeric
        > 9223372036854775807::numeric THEN
      RAISE EXCEPTION 'workspace_usage_credit_overflow'
        USING ERRCODE = '22003';
    END IF;

    UPDATE public.workspace_usage AS usage_row
    SET
      purchased_credit_bytes = usage_row.purchased_credit_bytes
        + v_transaction.gb_added_bytes,
      updated_at = now()
    WHERE usage_row.workspace_id = v_transaction.billing_workspace_id
    RETURNING usage_row.purchased_credit_bytes
    INTO v_new_credit;

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
    'new_renewal_due_at', v_renewal_due_at,
    'new_credit_bytes', v_new_credit
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text) IS
  'Service-role-only approve/reject for pending workspace payments. Usage approvals now update usage_start_date to mark the new cycle start.';
