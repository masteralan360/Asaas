BEGIN;

-- An immediate termination finalizes the open cycle at the native meter before
-- it disables PAYG. A non-zero final amount remains visible and payable via the
-- established cycle/payment transaction flow; it never starts another cycle.
CREATE OR REPLACE FUNCTION public.admin_terminate_workspace_payg(
  p_workspace_id uuid,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_owner_id uuid;
  v_config billing.workspace_payment_configurations;
  v_cycle billing.payg_cycles;
  v_usage_bytes bigint := 0;
  v_amount numeric := 0;
  v_actor text := COALESCE(NULLIF(btrim(p_actor), ''), 'Platform administrator');
BEGIN
  IF (COALESCE(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('workspace-branch-payment-owner:' || p_workspace_id::text, 0)
  );
  v_owner_id := public.workspace_usage_owner_id(p_workspace_id);
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_workspace_id IS DISTINCT FROM v_owner_id THEN
    RAISE EXCEPTION 'payg_is_managed_by_source_workspace' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payment:' || v_owner_id::text, 0));
  SELECT * INTO v_config
  FROM billing.workspace_payment_configurations
  WHERE workspace_id = v_owner_id
  FOR UPDATE;
  IF NOT COALESCE(v_config.payg_enabled, false) THEN
    RAISE EXCEPTION 'payg_is_not_enabled' USING ERRCODE = '23514';
  END IF;
  IF v_config.pending_billing_mode IS NOT NULL THEN
    RAISE EXCEPTION 'payg_termination_is_already_pending' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_cycle
  FROM billing.payg_cycles
  WHERE billing_workspace_id = v_owner_id
    AND status = 'open'
  FOR UPDATE;
  IF v_cycle.id IS NULL THEN
    RAISE EXCEPTION 'payg_termination_requires_open_cycle' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(data_transfer_bytes, 0) INTO v_usage_bytes
  FROM public.workspace_usage
  WHERE workspace_id = v_owner_id
  FOR UPDATE;
  v_amount := billing.calculate_payg_amount_from_checkpoints(v_cycle.pricing_snapshot, v_usage_bytes);

  -- Retain PAYG configuration until a chargeable final cycle settles. That
  -- keeps the exact charge visible and permits the existing payment dialog,
  -- while the awaiting-payment cycle blocks any additional metered usage.
  UPDATE billing.workspace_payment_configurations
  SET
    pending_billing_mode = 'monthly',
    pending_subscription_amount = 0,
    pending_gb_per_payment = 0,
    pending_payment_enabled = false,
    pending_renewal_due_at = NULL,
    pending_usage_start_date = NULL,
    updated_by = auth.uid(),
    updated_by_label = v_actor,
    updated_via = 'admin-console',
    updated_at = now()
  WHERE workspace_id = v_owner_id;

  UPDATE billing.payg_cycles
  SET
    period_ended_at = now(),
    charged_usage_bytes = v_usage_bytes,
    charged_usage_gb = v_usage_bytes::numeric / 1000000000::numeric,
    amount_iqd = v_amount,
    status = CASE WHEN v_amount = 0 THEN 'no_payment_required' ELSE 'awaiting_payment' END,
    closed_at = now(),
    settled_at = CASE WHEN v_amount = 0 THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = v_cycle.id
  RETURNING * INTO v_cycle;

  IF v_amount > 0 THEN
    PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);
    UPDATE public.workspaces
    SET locked_workspace = true, payment_renewal_locked = true
    WHERE id = v_owner_id;
    RETURN jsonb_build_object(
      'success', true,
      'payment_required', true,
      'cycle_id', v_cycle.id,
      'charged_usage_bytes', v_cycle.charged_usage_bytes,
      'amount_iqd', v_cycle.amount_iqd::text,
      'status', v_cycle.status
    );
  END IF;

  -- Free final cycles settle at once. The immutable cycle remains the audit
  -- record, but PAYG and its tracking-only usage limit are removed now.
  UPDATE public.workspace_usage
  SET data_transfer_bytes = 0, updated_at = now()
  WHERE workspace_id = v_owner_id;
  PERFORM set_config('atlas.trusted_workspace_payment_family_mode_update', 'on', true);
  UPDATE billing.workspace_payment_configurations AS family_config
  SET
    payg_enabled = false,
    usage_enabled = false,
    updated_by = auth.uid(),
    updated_by_label = v_actor,
    updated_via = 'admin-console',
    updated_at = now()
  WHERE family_config.workspace_id <> v_owner_id
    AND public.workspace_usage_owner_id(family_config.workspace_id) = v_owner_id;
  UPDATE billing.workspace_payment_configurations
  SET
    payg_enabled = false,
    usage_enabled = false,
    subscription_amount = 0,
    is_payment_enabled = false,
    gb_per_payment = 0,
    pending_billing_mode = NULL,
    pending_subscription_amount = NULL,
    pending_gb_per_payment = NULL,
    pending_payment_enabled = NULL,
    pending_renewal_due_at = NULL,
    pending_usage_start_date = NULL,
    payg_cycle_started_at = NULL,
    updated_by = auth.uid(),
    updated_by_label = v_actor,
    updated_via = 'admin-console',
    updated_at = now()
  WHERE workspace_id = v_owner_id;
  DELETE FROM public.workspace_usage_limits
  WHERE workspace_id = v_owner_id
    AND tracking_only
    AND storage_unit_limit IS NULL
    AND monthly_data_transfer_limit_bytes IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'payment_required', false,
    'cycle_id', v_cycle.id,
    'charged_usage_bytes', v_cycle.charged_usage_bytes,
    'amount_iqd', v_cycle.amount_iqd::text,
    'status', v_cycle.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_terminate_workspace_payg(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_terminate_workspace_payg(uuid, text) TO service_role;

COMMIT;
