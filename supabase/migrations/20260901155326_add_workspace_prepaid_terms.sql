-- First-class prepaid terms keep the monthly rate and allowance separate from
-- the amount and duration that were actually purchased. A prepaid term is
-- activated by the platform administrator after receiving payment; it is not
-- a PAYG cycle or a carry-forward usage-credit purchase.

ALTER TABLE billing.workspace_payment_configurations
  ADD COLUMN billing_interval text NOT NULL DEFAULT 'monthly',
  ADD COLUMN monthly_allowance_gb numeric(14, 6) NULL,
  ADD COLUMN prepaid_cycles smallint NULL,
  ADD COLUMN prepaid_amount numeric(20, 3) NULL,
  ADD COLUMN prepaid_term_started_at date NULL,
  ADD COLUMN prepaid_term_payment_transaction_id uuid NULL;

ALTER TABLE billing.payment_transactions
  ADD COLUMN monthly_list_price numeric(20, 3) NULL,
  ADD COLUMN monthly_allowance_gb numeric(14, 6) NULL,
  ADD COLUMN prepaid_cycles smallint NULL,
  ADD COLUMN term_started_at date NULL,
  ADD COLUMN term_paid_through_at timestamptz NULL;

ALTER TABLE billing.workspace_payment_configurations
  ADD CONSTRAINT workspace_payment_configurations_billing_interval_check
    CHECK (billing_interval IN ('monthly', 'prepaid_term')),
  ADD CONSTRAINT workspace_payment_configurations_prepaid_term_check
    CHECK (
      (
        billing_interval = 'monthly'
        AND monthly_allowance_gb IS NULL
        AND prepaid_cycles IS NULL
        AND prepaid_amount IS NULL
        AND prepaid_term_started_at IS NULL
        AND prepaid_term_payment_transaction_id IS NULL
      )
      OR (
        billing_interval = 'prepaid_term'
        AND usage_enabled
        AND NOT payg_enabled
        AND subscription_amount > 0
        AND monthly_allowance_gb > 0
        AND gb_per_payment = monthly_allowance_gb
        AND prepaid_cycles BETWEEN 1 AND 120
        AND prepaid_amount > 0
        AND prepaid_amount <= subscription_amount * prepaid_cycles
        AND prepaid_term_started_at IS NOT NULL
        AND prepaid_term_payment_transaction_id IS NOT NULL
        AND renewal_due_at IS NOT NULL
      )
    );

ALTER TABLE billing.payment_transactions
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_provider_check,
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_type_check,
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_type_values_check,
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_payg_values_check;

ALTER TABLE billing.payment_transactions
  ADD CONSTRAINT workspace_payment_transactions_provider_check
    CHECK (provider IN ('fib', 'qicard', 'free', 'manual')),
  ADD CONSTRAINT workspace_payment_transactions_type_check
    CHECK (payment_type IN ('subscription', 'usage', 'payg', 'prepaid_term')),
  ADD CONSTRAINT workspace_payment_transactions_type_values_check
    CHECK (
      (payment_type = 'subscription' AND gb_added = 0 AND gb_added_bytes = 0 AND payg_cycle_id IS NULL)
      OR (payment_type = 'usage' AND gb_added > 0 AND gb_added_bytes > 0 AND payg_cycle_id IS NULL)
      OR (payment_type = 'payg' AND gb_added = 0 AND gb_added_bytes = 0 AND payg_cycle_id IS NOT NULL)
      OR (payment_type = 'prepaid_term' AND gb_added = 0 AND gb_added_bytes = 0 AND payg_cycle_id IS NULL)
    ),
  ADD CONSTRAINT workspace_payment_transactions_payg_values_check
    CHECK (
      (payment_type <> 'payg' AND billed_usage_bytes = 0 AND billed_usage_gb = 0)
      OR (
        payment_type = 'payg'
        AND billed_usage_bytes > 1000000000
        AND billed_usage_gb = billed_usage_bytes::numeric / 1000000000::numeric
      )
    ),
  ADD CONSTRAINT workspace_payment_transactions_prepaid_term_check
    CHECK (
      (
        payment_type <> 'prepaid_term'
        AND monthly_list_price IS NULL
        AND monthly_allowance_gb IS NULL
        AND prepaid_cycles IS NULL
        AND term_started_at IS NULL
        AND term_paid_through_at IS NULL
      )
      OR (
        payment_type = 'prepaid_term'
        AND monthly_list_price > 0
        AND monthly_allowance_gb > 0
        AND prepaid_cycles BETWEEN 1 AND 120
        AND amount <= monthly_list_price * prepaid_cycles
        AND term_started_at IS NOT NULL
        AND term_paid_through_at IS NOT NULL
      )
    );

ALTER TABLE billing.workspace_payment_configurations
  ADD CONSTRAINT workspace_payment_configurations_prepaid_term_payment_fk
  FOREIGN KEY (prepaid_term_payment_transaction_id)
  REFERENCES billing.payment_transactions(id)
  ON DELETE RESTRICT;

CREATE INDEX workspace_payment_transactions_prepaid_term_history_idx
  ON billing.payment_transactions (billing_workspace_id, term_started_at DESC)
  WHERE payment_type = 'prepaid_term' AND status = 'approved';

COMMENT ON COLUMN billing.workspace_payment_configurations.billing_interval IS
  'monthly for the legacy renewal flow; prepaid_term for an administrator-activated multi-cycle term.';
COMMENT ON COLUMN billing.workspace_payment_configurations.monthly_allowance_gb IS
  'Non-rollover transfer allowance restored at every monthly usage-cycle boundary during an active prepaid term.';
COMMENT ON COLUMN billing.workspace_payment_configurations.prepaid_cycles IS
  'Number of monthly allowance cycles purchased by the active prepaid term.';
COMMENT ON COLUMN billing.workspace_payment_configurations.prepaid_amount IS
  'Actual IQD amount paid for the active prepaid term, including any discount from the monthly list price.';
COMMENT ON COLUMN billing.workspace_payment_configurations.prepaid_term_started_at IS
  'Inclusive start date of the active prepaid term.';
COMMENT ON COLUMN billing.workspace_payment_configurations.renewal_due_at IS
  'Exclusive paid-through boundary. For a prepaid term, payment is due again at this instant.';
COMMENT ON COLUMN billing.payment_transactions.monthly_list_price IS
  'Immutable monthly IQD list-price snapshot for a prepaid-term payment.';
COMMENT ON COLUMN billing.payment_transactions.monthly_allowance_gb IS
  'Immutable non-rollover monthly allowance snapshot for a prepaid-term payment.';

CREATE OR REPLACE FUNCTION billing.prepaid_term_paid_through(
  p_term_started_at date,
  p_prepaid_cycles integer
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT (
    p_term_started_at::timestamp
      + make_interval(months => p_prepaid_cycles)
  ) AT TIME ZONE 'UTC';
$function$;

REVOKE ALL ON FUNCTION billing.prepaid_term_paid_through(date, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing.prepaid_term_paid_through(date, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION billing.payment_transaction_public_json(
  p_transaction billing.payment_transactions
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, billing
AS $function$
  SELECT jsonb_build_object(
    'id', p_transaction.id,
    'workspace_id', p_transaction.workspace_id,
    'billing_workspace_id', p_transaction.billing_workspace_id,
    'provider', p_transaction.provider,
    'provider_payment_id', p_transaction.provider_payment_id,
    'account_holder_name', p_transaction.account_holder_name,
    'amount', p_transaction.amount::text,
    'currency', p_transaction.currency,
    'gb_added', p_transaction.gb_added::text,
    'payment_type', p_transaction.payment_type,
    'monthly_list_price', p_transaction.monthly_list_price::text,
    'monthly_allowance_gb', p_transaction.monthly_allowance_gb::text,
    'prepaid_cycles', p_transaction.prepaid_cycles,
    'term_started_at', p_transaction.term_started_at,
    'term_paid_through_at', p_transaction.term_paid_through_at,
    'status', p_transaction.status,
    'expires_at', p_transaction.expires_at,
    'paid_at', p_transaction.paid_at,
    'review_note', CASE
      WHEN p_transaction.status = 'rejected' THEN p_transaction.review_note
      ELSE NULL
    END,
    'created_at', p_transaction.created_at,
    'updated_at', p_transaction.updated_at
  );
$function$;

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
    OR NEW.account_holder_name IS DISTINCT FROM OLD.account_holder_name
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
    OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.gb_added IS DISTINCT FROM OLD.gb_added OR NEW.gb_added_bytes IS DISTINCT FROM OLD.gb_added_bytes
    OR NEW.payg_cycle_id IS DISTINCT FROM OLD.payg_cycle_id
    OR NEW.billed_usage_bytes IS DISTINCT FROM OLD.billed_usage_bytes
    OR NEW.billed_usage_gb IS DISTINCT FROM OLD.billed_usage_gb
    OR NEW.monthly_list_price IS DISTINCT FROM OLD.monthly_list_price
    OR NEW.monthly_allowance_gb IS DISTINCT FROM OLD.monthly_allowance_gb
    OR NEW.prepaid_cycles IS DISTINCT FROM OLD.prepaid_cycles
    OR NEW.term_started_at IS DISTINCT FROM OLD.term_started_at
    OR NEW.term_paid_through_at IS DISTINCT FROM OLD.term_paid_through_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
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

CREATE OR REPLACE FUNCTION public.admin_activate_workspace_prepaid_term(
  p_workspace_id uuid,
  p_monthly_list_price text,
  p_monthly_allowance_gb text,
  p_prepaid_cycles integer,
  p_amount_paid text,
  p_term_started_at text,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_owner_id uuid;
  v_owner_config billing.workspace_payment_configurations;
  v_monthly_list_price numeric(20, 3);
  v_monthly_allowance_gb numeric(14, 6);
  v_amount_paid numeric(20, 3);
  v_prepaid_cycles smallint;
  v_term_started_at date;
  v_term_paid_through_at timestamptz;
  v_allowance_bytes_numeric numeric;
  v_allowance_bytes bigint;
  v_actor text := COALESCE(NULLIF(btrim(COALESCE(p_actor, '')), ''), 'Platform administrator');
  v_existing billing.payment_transactions;
  v_transaction billing.payment_transactions;
  v_configuration_result jsonb;
  v_is_new_payment boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_prepaid_cycles IS NULL OR p_prepaid_cycles NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_prepaid_cycles' USING ERRCODE = '22023';
  END IF;
  IF btrim(COALESCE(p_monthly_list_price, '')) !~ '^[0-9]{1,17}(\.[0-9]{1,3})?$'
    OR btrim(COALESCE(p_monthly_allowance_gb, '')) !~ '^[0-9]{1,8}(\.[0-9]{1,6})?$'
    OR btrim(COALESCE(p_amount_paid, '')) !~ '^[0-9]{1,17}(\.[0-9]{1,3})?$'
    OR btrim(COALESCE(p_term_started_at, '')) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'invalid_prepaid_term_configuration' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_monthly_list_price := btrim(COALESCE(p_monthly_list_price, ''))::numeric;
    v_monthly_allowance_gb := btrim(COALESCE(p_monthly_allowance_gb, ''))::numeric;
    v_amount_paid := btrim(COALESCE(p_amount_paid, ''))::numeric;
    v_prepaid_cycles := p_prepaid_cycles::smallint;
    v_term_started_at := btrim(COALESCE(p_term_started_at, ''))::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_prepaid_term_configuration' USING ERRCODE = '22023';
  END;

  IF v_monthly_list_price <= 0
    OR v_monthly_allowance_gb <= 0
    OR v_amount_paid <= 0
    OR v_amount_paid > v_monthly_list_price * v_prepaid_cycles THEN
    RAISE EXCEPTION 'invalid_prepaid_term_configuration' USING ERRCODE = '23514';
  END IF;

  v_allowance_bytes_numeric := v_monthly_allowance_gb * 1000000000::numeric;
  IF trunc(v_allowance_bytes_numeric) <> v_allowance_bytes_numeric
    OR v_allowance_bytes_numeric > 9223372036854775807::numeric THEN
    RAISE EXCEPTION 'workspace_prepaid_term_allowance_out_of_range' USING ERRCODE = '22003';
  END IF;
  v_allowance_bytes := v_allowance_bytes_numeric::bigint;
  v_term_paid_through_at := billing.prepaid_term_paid_through(v_term_started_at, v_prepaid_cycles);

  IF v_term_started_at > timezone('utc', now())::date
    OR v_term_paid_through_at <= now() THEN
    RAISE EXCEPTION 'prepaid_term_must_be_current' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('workspace-branch-payment-owner:' || p_workspace_id::text, 0)
  );
  v_owner_id := public.workspace_usage_owner_id(p_workspace_id);
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_workspace_id <> v_owner_id THEN
    RAISE EXCEPTION 'prepaid_term_is_managed_by_source_workspace' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payment:' || v_owner_id::text, 0));
  SELECT * INTO v_owner_config
  FROM billing.workspace_payment_configurations
  WHERE workspace_id = v_owner_id
  FOR UPDATE;

  IF COALESCE(v_owner_config.payg_enabled, false) THEN
    RAISE EXCEPTION 'settle_or_disable_payg_before_prepaid_term' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM billing.payment_transactions
    WHERE billing_workspace_id = v_owner_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'workspace_payment_already_pending_for_workspace' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_existing
  FROM billing.payment_transactions
  WHERE billing_workspace_id = v_owner_id
    AND payment_type = 'prepaid_term'
    AND status = 'approved'
    AND monthly_list_price = v_monthly_list_price
    AND monthly_allowance_gb = v_monthly_allowance_gb
    AND prepaid_cycles = v_prepaid_cycles
    AND amount = v_amount_paid
    AND term_started_at = v_term_started_at
    AND term_paid_through_at = v_term_paid_through_at
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing.id IS NULL AND EXISTS (
    SELECT 1 FROM billing.payment_transactions
    WHERE billing_workspace_id = v_owner_id
      AND payment_type = 'prepaid_term'
      AND status = 'approved'
      AND term_started_at < (v_term_paid_through_at AT TIME ZONE 'UTC')::date
      AND term_paid_through_at > v_term_started_at::timestamp AT TIME ZONE 'UTC'
  ) THEN
    RAISE EXCEPTION 'prepaid_term_overlaps_existing_term' USING ERRCODE = '23514';
  END IF;

  -- An expired term may be replaced with different monthly terms. Clear only
  -- its active configuration snapshot before applying the replacement; the
  -- approved payment transaction remains immutable history.
  IF v_existing.id IS NULL THEN
    PERFORM set_config('atlas.trusted_workspace_payment_family_mode_update', 'on', true);
    UPDATE billing.workspace_payment_configurations AS configuration_row
    SET
      billing_interval = 'monthly',
      monthly_allowance_gb = NULL,
      prepaid_cycles = NULL,
      prepaid_amount = NULL,
      prepaid_term_started_at = NULL,
      prepaid_term_payment_transaction_id = NULL,
      updated_at = now()
    WHERE public.workspace_usage_owner_id(configuration_row.workspace_id) = v_owner_id
      AND configuration_row.billing_interval = 'prepaid_term';
  END IF;

  -- Match the lock order used by ordinary usage-payment approval before any
  -- usage-limit row or charged counter is changed.
  LOCK TABLE public.workspace_usage IN EXCLUSIVE MODE;

  v_configuration_result := public.admin_upsert_workspace_payment_configuration_v2(
    v_owner_id,
    v_monthly_list_price::text,
    true,
    true,
    false,
    v_monthly_allowance_gb::text,
    v_term_paid_through_at::text,
    v_actor,
    v_term_started_at::text
  );
  IF COALESCE((v_configuration_result ->> 'staged')::boolean, false) THEN
    RAISE EXCEPTION 'prepaid_term_cannot_be_staged' USING ERRCODE = '23514';
  END IF;

  IF v_existing.id IS NULL THEN
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
      gb_added_bytes,
      monthly_list_price,
      monthly_allowance_gb,
      prepaid_cycles,
      term_started_at,
      term_paid_through_at,
      status,
      paid_at,
      reviewed_by,
      reviewed_by_label,
      reviewed_via,
      reviewed_at
    ) VALUES (
      v_owner_id,
      v_owner_id,
      auth.uid(),
      v_actor,
      NULL,
      'manual',
      'prepaid_term',
      v_amount_paid,
      'IQD',
      0,
      0,
      v_monthly_list_price,
      v_monthly_allowance_gb,
      v_prepaid_cycles,
      v_term_started_at,
      v_term_paid_through_at,
      'approved',
      now(),
      auth.uid(),
      v_actor,
      'admin-console',
      now()
    ) RETURNING * INTO v_transaction;
    v_is_new_payment := true;
  ELSE
    v_transaction := v_existing;
  END IF;

  PERFORM set_config('atlas.trusted_workspace_payment_family_mode_update', 'on', true);
  UPDATE billing.workspace_payment_configurations AS configuration_row
  SET
    subscription_amount = v_monthly_list_price,
    is_payment_enabled = true,
    usage_enabled = true,
    payg_enabled = false,
    gb_per_payment = v_monthly_allowance_gb,
    billing_interval = 'prepaid_term',
    monthly_allowance_gb = v_monthly_allowance_gb,
    prepaid_cycles = v_prepaid_cycles,
    prepaid_amount = v_amount_paid,
    prepaid_term_started_at = v_term_started_at,
    prepaid_term_payment_transaction_id = v_transaction.id,
    renewal_due_at = v_term_paid_through_at,
    usage_start_date = v_term_started_at,
    updated_by = auth.uid(),
    updated_by_label = v_actor,
    updated_via = 'admin-prepaid-term-activation',
    updated_at = now()
  WHERE public.workspace_usage_owner_id(configuration_row.workspace_id) = v_owner_id;

  INSERT INTO public.workspace_usage_limits (
    workspace_id,
    monthly_data_transfer_limit_bytes,
    tracking_only,
    notes
  ) VALUES (
    v_owner_id,
    v_allowance_bytes,
    false,
    'Non-rollover monthly allowance for an approved prepaid term.'
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    monthly_data_transfer_limit_bytes = EXCLUDED.monthly_data_transfer_limit_bytes,
    tracking_only = false,
    notes = EXCLUDED.notes,
    updated_at = now();

  PERFORM public.ensure_workspace_usage_row(v_owner_id);
  IF v_is_new_payment THEN
    UPDATE public.workspace_usage
    SET
      data_transfer_bytes = 0,
      purchased_credit_bytes = 0,
      updated_at = now()
    WHERE workspace_id = v_owner_id;
  END IF;

  PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);
  UPDATE public.workspaces
  SET
    locked_workspace = false,
    payment_renewal_locked = false,
    usage_limit_locked = false,
    subscription_expiry_locked = false
  WHERE id = v_owner_id;

  RETURN billing.payment_transaction_public_json(v_transaction)
    || jsonb_build_object(
      'success', true,
      'idempotent', NOT v_is_new_payment,
      'billing_interval', 'prepaid_term',
      'list_amount', (v_monthly_list_price * v_prepaid_cycles)::text,
      'discount_amount', (v_monthly_list_price * v_prepaid_cycles - v_amount_paid)::text
    );
END;
$function$;

COMMENT ON FUNCTION public.admin_activate_workspace_prepaid_term(uuid, text, text, integer, text, text, text) IS
  'Records one approved prepaid-term payment and atomically applies its non-rollover monthly allowance and paid-through boundary.';

CREATE OR REPLACE FUNCTION public.admin_upsert_workspace_payment_configuration_v3(
  p_workspace_id uuid,
  p_subscription_amount text,
  p_is_payment_enabled boolean,
  p_usage_enabled boolean,
  p_payg_enabled boolean,
  p_gb_per_payment text,
  p_renewal_due_at text,
  p_actor text,
  p_usage_start_date text DEFAULT NULL,
  p_billing_interval text DEFAULT 'monthly'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(NULLIF(btrim(p_billing_interval), ''), 'monthly') <> 'monthly' THEN
    RAISE EXCEPTION 'prepaid_terms_must_use_activation_workflow' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('workspace-branch-payment-owner:' || p_workspace_id::text, 0)
  );
  v_owner_id := public.workspace_usage_owner_id(p_workspace_id);
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-payment:' || v_owner_id::text, 0));

  -- Clear only the active configuration. Approved prepaid-term transactions
  -- remain immutable history when the workspace returns to monthly or PAYG.
  PERFORM set_config('atlas.trusted_workspace_payment_family_mode_update', 'on', true);
  UPDATE billing.workspace_payment_configurations AS configuration_row
  SET
    billing_interval = 'monthly',
    monthly_allowance_gb = NULL,
    prepaid_cycles = NULL,
    prepaid_amount = NULL,
    prepaid_term_started_at = NULL,
    prepaid_term_payment_transaction_id = NULL,
    updated_at = now()
  WHERE public.workspace_usage_owner_id(configuration_row.workspace_id) = v_owner_id
    AND configuration_row.billing_interval = 'prepaid_term';

  RETURN public.admin_upsert_workspace_payment_configuration_v2(
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
    'billing_interval', COALESCE(owner_config.billing_interval, 'monthly'),
    'monthly_allowance_gb', owner_config.monthly_allowance_gb::text,
    'prepaid_cycles', owner_config.prepaid_cycles,
    'prepaid_amount', owner_config.prepaid_amount::text,
    'prepaid_term_started_at', owner_config.prepaid_term_started_at,
    'prepaid_term_payment_transaction_id', owner_config.prepaid_term_payment_transaction_id,
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
      transaction_row.monthly_list_price::text, transaction_row.monthly_allowance_gb::text,
      transaction_row.prepaid_cycles, transaction_row.term_started_at,
      transaction_row.term_paid_through_at,
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

ALTER FUNCTION public.get_workspace_payment_summary()
  RENAME TO get_workspace_payment_summary_without_prepaid_term;

CREATE FUNCTION public.get_workspace_payment_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_result jsonb;
  v_workspace_id uuid := public.current_workspace_id();
  v_config billing.workspace_payment_configurations;
BEGIN
  v_result := public.get_workspace_payment_summary_without_prepaid_term();
  SELECT * INTO v_config
  FROM billing.workspace_payment_configurations
  WHERE workspace_id = v_workspace_id;

  IF COALESCE(v_config.billing_interval, 'monthly') <> 'prepaid_term' THEN
    RETURN v_result;
  END IF;

  RETURN v_result || jsonb_build_object(
    'configuration', COALESCE(v_result -> 'configuration', '{}'::jsonb) || jsonb_build_object(
      'billing_interval', 'prepaid_term',
      'monthly_list_price', v_config.subscription_amount::text,
      'monthly_allowance_gb', v_config.monthly_allowance_gb::text,
      'prepaid_cycles', v_config.prepaid_cycles,
      'prepaid_amount', v_config.prepaid_amount::text,
      'prepaid_term_started_at', v_config.prepaid_term_started_at,
      'renewal_due_at', v_config.renewal_due_at,
      'rollover_enabled', false,
      'is_payment_enabled', false
    ),
    'eligibility', COALESCE(v_result -> 'eligibility', '{}'::jsonb) || jsonb_build_object(
      'payment_enabled', false
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_workspace_payment(
  p_provider text,
  p_account_holder_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing, auth
AS $function$
DECLARE
  v_workspace_id uuid := public.current_workspace_id();
  v_billing_interval text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'workspace_payment_workspace_admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT billing_interval INTO v_billing_interval
  FROM billing.workspace_payment_configurations
  WHERE workspace_id = v_workspace_id;

  IF v_billing_interval = 'prepaid_term' THEN
    RAISE EXCEPTION 'prepaid_term_is_admin_managed' USING ERRCODE = '23514';
  END IF;

  RETURN public.submit_workspace_payment_base(p_provider, p_account_holder_name);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_activate_workspace_prepaid_term(uuid, text, text, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_workspace_payment_configuration_v3(uuid, text, boolean, boolean, boolean, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_workspace_payment_configurations_v2()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_workspace_payment_transactions_v2(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_workspace_payment_summary_without_prepaid_term()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_workspace_payment_summary()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_workspace_payment(text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_activate_workspace_prepaid_term(uuid, text, text, integer, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_workspace_payment_configuration_v3(uuid, text, boolean, boolean, boolean, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_workspace_payment_configurations_v2()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_workspace_payment_transactions_v2(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_payment_summary()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_workspace_payment(text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
