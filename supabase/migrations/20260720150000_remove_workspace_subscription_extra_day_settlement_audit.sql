-- Settlement history is optional audit data. The functional state remains in
-- the pending extra-days row, so remove this table and stop writing to it.

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
  v_remaining_duration_seconds integer;
  v_adjusted_subscription_expires_at timestamptz;
  v_result jsonb;
BEGIN
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

  PERFORM billing.sync_workspace_subscription_extra_day_consumption(
    v_transaction.billing_workspace_id,
    now()
  );

  SELECT extra_days.*
  INTO v_extra_days
  FROM billing.workspace_subscription_extra_days AS extra_days
  WHERE extra_days.workspace_id = v_transaction.billing_workspace_id
    AND extra_days.status = 'pending'
  FOR UPDATE;

  IF v_extra_days.id IS NULL THEN
    RETURN v_result;
  END IF;

  v_remaining_duration_seconds := v_extra_days.extra_days::integer * 86400
    - v_extra_days.consumed_duration_seconds;

  PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);

  UPDATE public.workspaces AS workspace_row
  SET subscription_expires_at = workspace_row.subscription_expires_at
    - make_interval(secs => v_remaining_duration_seconds)
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
    'extra_days_granted', v_extra_days.extra_days,
    'extra_days_consumed_duration_seconds', v_extra_days.consumed_duration_seconds,
    'extra_days_deducted_duration_seconds', v_remaining_duration_seconds
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text) IS
  'Atomically reviews a payment and settles a pending temporary extension by deducting only its unused duration.';

DROP TABLE billing.workspace_subscription_extra_day_settlements;

NOTIFY pgrst, 'reload schema';
