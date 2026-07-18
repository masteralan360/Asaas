-- Temporary subscription extensions that are charged back against the next
-- approved subscription period. The entitlement and its pending debit always
-- live on the billing/source workspace so branch workspaces cannot create
-- conflicting grants for their shared subscription.

CREATE TABLE billing.workspace_subscription_extra_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  extra_days smallint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  granted_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT workspace_subscription_extra_days_range_check
    CHECK (extra_days BETWEEN 1 AND 6),
  CONSTRAINT workspace_subscription_extra_days_pending_check
    CHECK (status = 'pending')
);

COMMENT ON TABLE billing.workspace_subscription_extra_days IS
  'One temporary subscription extension per billing workspace. The row is deleted atomically when its days are deducted from an approved subscription renewal.';
COMMENT ON COLUMN billing.workspace_subscription_extra_days.workspace_id IS
  'Source workspace that owns the shared subscription entitlement, including for branch-originated grants.';
COMMENT ON COLUMN billing.workspace_subscription_extra_days.granted_at IS
  'Timestamp at which the temporary days were applied to the workspace subscription expiry.';

ALTER TABLE billing.workspace_subscription_extra_days ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE billing.workspace_subscription_extra_days
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE billing.workspace_subscription_extra_days TO service_role;

CREATE OR REPLACE FUNCTION billing.prevent_usage_billing_with_pending_extra_days()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
BEGIN
  IF NEW.usage_enabled
    AND EXISTS (
      SELECT 1
      FROM billing.workspace_subscription_extra_days AS extra_days
      WHERE extra_days.workspace_id = public.workspace_usage_owner_id(NEW.workspace_id)
        AND extra_days.status = 'pending'
    ) THEN
    RAISE EXCEPTION 'workspace_subscription_extra_days_pending'
      USING ERRCODE = '23514',
        DETAIL = 'The workspace has temporary subscription days that must be deducted by approving a subscription renewal first.',
        HINT = 'Approve the subscription renewal or wait for the pending extra-day record to be consumed before enabling usage billing.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_usage_billing_with_pending_extra_days
  ON billing.workspace_payment_configurations;
CREATE TRIGGER prevent_usage_billing_with_pending_extra_days
BEFORE INSERT OR UPDATE OF usage_enabled
ON billing.workspace_payment_configurations
FOR EACH ROW
EXECUTE FUNCTION billing.prevent_usage_billing_with_pending_extra_days();

CREATE OR REPLACE FUNCTION public.grant_workspace_subscription_extra_days(
  p_extra_days integer
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
  v_configuration billing.workspace_payment_configurations;
  v_extra_days billing.workspace_subscription_extra_days;
  v_subscription_expires_at timestamptz;
BEGIN
  IF v_user_id IS NULL OR v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_authentication_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_extra_days IS NULL OR p_extra_days NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'invalid_workspace_subscription_extra_days'
      USING ERRCODE = '22023',
        DETAIL = 'Extra days must be an integer between 1 and 6.';
  END IF;

  -- Use the same lock order as payment submission and review. This prevents a
  -- branch-originated grant from racing the subscription approval that consumes
  -- it, or another branch trying to grant a second temporary extension.
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

  SELECT configuration_row.*
  INTO v_configuration
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE configuration_row.workspace_id = v_workspace_id
  FOR UPDATE;

  IF v_configuration.id IS NULL THEN
    RAISE EXCEPTION 'workspace_payment_configuration_missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_configuration.usage_enabled THEN
    RAISE EXCEPTION 'workspace_subscription_extra_days_not_available_for_usage_billing'
      USING ERRCODE = '23514',
        DETAIL = 'Extra days can only be granted to subscription-based workspaces.';
  END IF;

  INSERT INTO billing.workspace_subscription_extra_days (
    workspace_id,
    extra_days,
    granted_by
  )
  VALUES (
    v_billing_workspace_id,
    p_extra_days,
    v_user_id
  )
  ON CONFLICT (workspace_id) DO NOTHING
  RETURNING * INTO v_extra_days;

  IF v_extra_days.id IS NULL THEN
    RAISE EXCEPTION 'workspace_subscription_extra_days_already_pending'
      USING ERRCODE = '23505',
        DETAIL = 'A temporary extra-days record already exists for this workspace.';
  END IF;

  UPDATE public.workspaces AS workspace_row
  SET
    subscription_expires_at = GREATEST(
      COALESCE(workspace_row.subscription_expires_at, now()),
      now()
    ) + make_interval(days => p_extra_days),
    locked_workspace = CASE
      WHEN workspace_row.subscription_expiry_locked THEN
        workspace_row.usage_limit_locked OR workspace_row.payment_renewal_locked
      ELSE workspace_row.locked_workspace
    END,
    subscription_expiry_locked = false
  WHERE workspace_row.id = v_billing_workspace_id
    AND workspace_row.deleted_at IS NULL
  RETURNING workspace_row.subscription_expires_at
  INTO v_subscription_expires_at;

  IF v_subscription_expires_at IS NULL THEN
    RAISE EXCEPTION 'billing_workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'id', v_extra_days.id,
    'workspace_id', v_extra_days.workspace_id,
    'extra_days', v_extra_days.extra_days,
    'status', v_extra_days.status,
    'granted_at', v_extra_days.granted_at,
    'subscription_expires_at', v_subscription_expires_at
  );
END;
$function$;

COMMENT ON FUNCTION public.grant_workspace_subscription_extra_days(integer) IS
  'Applies one to six temporary subscription days and creates exactly one pending debit record for the billing workspace.';

-- Retain the established summary implementation as an internal function and
-- add the pending temporary-extension record to its public response.
ALTER FUNCTION public.get_workspace_payment_summary()
  RENAME TO get_workspace_payment_summary_base;

CREATE OR REPLACE FUNCTION public.get_workspace_payment_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_result jsonb;
  v_workspace_id uuid := public.current_workspace_id();
  v_billing_workspace_id uuid;
  v_extra_days billing.workspace_subscription_extra_days;
BEGIN
  v_result := public.get_workspace_payment_summary_base();

  SELECT public.workspace_usage_owner_id(workspace_row.id)
  INTO v_billing_workspace_id
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_workspace_id
    AND workspace_row.deleted_at IS NULL;

  SELECT extra_days.*
  INTO v_extra_days
  FROM billing.workspace_subscription_extra_days AS extra_days
  WHERE extra_days.workspace_id = v_billing_workspace_id
    AND extra_days.status = 'pending';

  RETURN v_result || jsonb_build_object(
    'pending_extra_days', CASE
      WHEN v_extra_days.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_extra_days.id,
        'workspace_id', v_extra_days.workspace_id,
        'extra_days', v_extra_days.extra_days,
        'granted_at', v_extra_days.granted_at
      )
    END
  );
END;
$function$;

COMMENT ON FUNCTION public.get_workspace_payment_summary() IS
  'Returns the authenticated user''s active workspace billing state, including any pending temporary subscription-day debit.';

-- The established approval function already owns the payment transition and
-- workspace renewal update. Keep it as an internal primitive, then wrap it so
-- the adjusted subscription expiry and tracking-row deletion happen in the
-- same SQL transaction. Any failure rolls back both the payment approval and
-- the extra-days record change.
ALTER FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text)
  RENAME TO admin_review_workspace_payment_transaction_base;

CREATE OR REPLACE FUNCTION public.admin_review_workspace_payment_transaction(
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
  v_decision text := lower(btrim(COALESCE(p_decision, '')));
  v_billing_workspace_id uuid;
  v_transaction billing.payment_transactions;
  v_extra_days billing.workspace_subscription_extra_days;
  v_adjusted_subscription_expires_at timestamptz;
  v_result jsonb;
BEGIN
  -- Acquire the same family locks before invoking the existing review flow.
  -- Transaction-scoped advisory locks are re-entrant in this transaction, so
  -- the internal function can safely acquire them again.
  SELECT transaction_row.billing_workspace_id
  INTO v_billing_workspace_id
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.id = p_transaction_id;

  IF v_billing_workspace_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'workspace-branch-payment-owner:' || v_billing_workspace_id::text,
        0
      )
    );
    PERFORM pg_advisory_xact_lock(
      hashtextextended('workspace-payment:' || v_billing_workspace_id::text, 0)
    );
  END IF;

  v_result := public.admin_review_workspace_payment_transaction_base(
    p_transaction_id,
    p_decision,
    p_note,
    p_reviewer_label,
    p_provider_payment_id
  );

  IF v_decision <> 'approved' THEN
    RETURN v_result;
  END IF;

  SELECT transaction_row.*
  INTO v_transaction
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.id = p_transaction_id
  FOR UPDATE;

  IF v_transaction.status <> 'approved'
    OR v_transaction.payment_type <> 'subscription' THEN
    RETURN v_result;
  END IF;

  SELECT extra_days.*
  INTO v_extra_days
  FROM billing.workspace_subscription_extra_days AS extra_days
  WHERE extra_days.workspace_id = v_transaction.billing_workspace_id
    AND extra_days.status = 'pending'
  FOR UPDATE;

  IF v_extra_days.id IS NULL THEN
    RETURN v_result;
  END IF;

  UPDATE public.workspaces AS workspace_row
  SET subscription_expires_at = workspace_row.subscription_expires_at
    - make_interval(days => v_extra_days.extra_days)
  WHERE workspace_row.id = v_transaction.billing_workspace_id
    AND workspace_row.deleted_at IS NULL
  RETURNING workspace_row.subscription_expires_at
  INTO v_adjusted_subscription_expires_at;

  IF v_adjusted_subscription_expires_at IS NULL THEN
    RAISE EXCEPTION 'billing_workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM billing.workspace_subscription_extra_days AS extra_days
  WHERE extra_days.id = v_extra_days.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_subscription_extra_days_delete_failed'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_result || jsonb_build_object(
    'subscription_expires_at', v_adjusted_subscription_expires_at,
    'extra_days_deducted', v_extra_days.extra_days
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text) IS
  'Atomically reviews a payment and, for an approved subscription, deducts and removes any pending temporary extra days.';

REVOKE ALL ON FUNCTION billing.prevent_usage_billing_with_pending_extra_days()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_workspace_payment_summary_base()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_workspace_payment_summary()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_payment_summary()
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_review_workspace_payment_transaction_base(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.grant_workspace_subscription_extra_days(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_workspace_subscription_extra_days(integer)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
