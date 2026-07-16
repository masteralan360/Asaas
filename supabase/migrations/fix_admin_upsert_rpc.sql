-- Fix the live admin_upsert_workspace_payment_configuration to allow amount=0 for free packages
-- This only changes the validation check, nothing else

CREATE OR REPLACE FUNCTION public.admin_upsert_workspace_payment_configuration(
  p_workspace_id uuid,
  p_subscription_amount text,
  p_is_payment_enabled boolean,
  p_usage_enabled boolean,
  p_gb_per_payment text,
  p_actor text
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
    v_renewal_due_at := COALESCE(
      v_owner_renewal_due_at,
      v_family_renewal_due_at,
      billing.next_workspace_usage_renewal_due(v_billing_workspace_id, now())
    );
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
    renewal_due_at = EXCLUDED.renewal_due_at,
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
      WHEN COALESCE(p_usage_enabled, false) THEN v_renewal_due_at
      ELSE configuration_row.renewal_due_at
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
    'created_at', v_configuration.created_at,
    'updated_at', v_configuration.updated_at
  );
END;
$function$;
