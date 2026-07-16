-- Capture the account/card holder name supplied with a manual workspace payment
-- and expose only the authenticated user's previously submitted names.

ALTER TABLE billing.payment_transactions
  ADD COLUMN IF NOT EXISTS account_holder_name text NULL;

ALTER TABLE billing.payment_transactions
  DROP CONSTRAINT IF EXISTS workspace_payment_transactions_account_holder_name_length_check;

ALTER TABLE billing.payment_transactions
  ADD CONSTRAINT workspace_payment_transactions_account_holder_name_length_check
    CHECK (
      account_holder_name IS NULL
      OR (
        char_length(account_holder_name) BETWEEN 1 AND 160
        AND cardinality(string_to_array(account_holder_name, ' ')) >= 3
      )
    );

CREATE INDEX IF NOT EXISTS workspace_payment_transactions_user_account_holder_name_idx
  ON billing.payment_transactions (user_id, created_at DESC)
  WHERE account_holder_name IS NOT NULL;

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

CREATE OR REPLACE FUNCTION public.list_workspace_payment_account_holder_names()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth, billing
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_names jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'workspace_authentication_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(saved_name.account_holder_name ORDER BY saved_name.last_used_at DESC, saved_name.account_holder_name),
    '[]'::jsonb
  )
  INTO v_names
  FROM (
    SELECT
      transaction_row.account_holder_name,
      max(transaction_row.created_at) AS last_used_at
    FROM billing.payment_transactions AS transaction_row
    WHERE transaction_row.user_id = v_user_id
      AND transaction_row.account_holder_name IS NOT NULL
      AND cardinality(string_to_array(transaction_row.account_holder_name, ' ')) >= 3
    GROUP BY transaction_row.account_holder_name
    ORDER BY max(transaction_row.created_at) DESC, transaction_row.account_holder_name
    LIMIT 20
  ) AS saved_name;

  RETURN v_names;
END;
$function$;

COMMENT ON FUNCTION public.list_workspace_payment_account_holder_names() IS
  'Returns only the authenticated user''s previously submitted manual-payment account holder names.';

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
  v_user_id uuid := auth.uid();
  v_provider text := lower(btrim(COALESCE(p_provider, '')));
  v_account_holder_name text := upper(
    btrim(regexp_replace(COALESCE(p_account_holder_name, ''), '[[:space:]]+', ' ', 'g'))
  );
  v_result jsonb;
  v_transaction_id uuid;
  v_stored_account_holder_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'workspace_authentication_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_provider NOT IN ('fib', 'qicard', 'free') THEN
    RAISE EXCEPTION 'unsupported_workspace_payment_provider'
      USING ERRCODE = '22023';
  END IF;

  IF v_provider <> 'free' AND v_account_holder_name = '' THEN
    RAISE EXCEPTION 'account_holder_name_required'
      USING ERRCODE = '22023';
  END IF;

  IF v_provider <> 'free'
    AND cardinality(string_to_array(v_account_holder_name, ' ')) < 3 THEN
    RAISE EXCEPTION 'account_holder_name_must_have_three_words'
      USING ERRCODE = '22023';
  END IF;

  IF v_provider <> 'free' AND char_length(v_account_holder_name) > 160 THEN
    RAISE EXCEPTION 'account_holder_name_too_long'
      USING ERRCODE = '22023';
  END IF;

  v_result := public.submit_workspace_payment(v_provider);

  IF v_provider = 'free' THEN
    RETURN v_result || jsonb_build_object('account_holder_name', NULL);
  END IF;

  v_transaction_id := NULLIF(v_result ->> 'id', '')::uuid;

  IF v_transaction_id IS NULL THEN
    RAISE EXCEPTION 'workspace_payment_transaction_invalid'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT transaction_row.account_holder_name
  INTO v_stored_account_holder_name
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.id = v_transaction_id
    AND transaction_row.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_payment_transaction_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_stored_account_holder_name IS NULL THEN
    UPDATE billing.payment_transactions
    SET account_holder_name = v_account_holder_name
    WHERE id = v_transaction_id
    RETURNING account_holder_name INTO v_stored_account_holder_name;
  END IF;

  RETURN v_result || jsonb_build_object('account_holder_name', v_stored_account_holder_name);
END;
$function$;

COMMENT ON FUNCTION public.submit_workspace_payment(text, text) IS
  'Creates a manual workspace payment for the authenticated user and requires a normalized FIB/QiCard account holder name.';

CREATE OR REPLACE FUNCTION public.admin_list_workspace_payment_transactions(
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing, auth
AS $function$
DECLARE
  v_status text := NULLIF(lower(btrim(COALESCE(p_status, ''))), '');
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_status IS NOT NULL
    AND v_status NOT IN ('pending', 'approved', 'rejected', 'expired') THEN
    RAISE EXCEPTION 'invalid_workspace_payment_status_filter'
      USING ERRCODE = '22023';
  END IF;

  PERFORM billing.expire_pending_payment_transactions(NULL);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', transaction_row.id,
        'workspace_id', transaction_row.workspace_id,
        'workspace_name', workspace_row.name,
        'workspace_code', workspace_row.code,
        'billing_workspace_id', transaction_row.billing_workspace_id,
        'billing_workspace_name', billing_workspace.name,
        'user_id', transaction_row.user_id,
        'user_name', COALESCE(profile_row.name, transaction_row.submitted_by_name),
        'user_email', COALESCE(auth_user.email, transaction_row.submitted_by_email),
        'provider', transaction_row.provider,
        'provider_payment_id', transaction_row.provider_payment_id,
        'account_holder_name', transaction_row.account_holder_name,
        'payment_type', transaction_row.payment_type,
        'amount', transaction_row.amount::text,
        'currency', transaction_row.currency,
        'gb_added', transaction_row.gb_added::text,
        'status', transaction_row.status,
        'submission_date', transaction_row.created_at,
        'created_at', transaction_row.created_at,
        'payment_date', transaction_row.paid_at,
        'paid_at', transaction_row.paid_at,
        'expires_at', transaction_row.expires_at,
        'reviewed_by', transaction_row.reviewed_by,
        'reviewed_by_label', transaction_row.reviewed_by_label,
        'reviewed_at', transaction_row.reviewed_at,
        'review_note', transaction_row.review_note,
        'updated_at', transaction_row.updated_at
      )
      ORDER BY transaction_row.created_at DESC, transaction_row.id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM billing.payment_transactions AS transaction_row
  INNER JOIN public.workspaces AS workspace_row
    ON workspace_row.id = transaction_row.workspace_id
  INNER JOIN public.workspaces AS billing_workspace
    ON billing_workspace.id = transaction_row.billing_workspace_id
  LEFT JOIN public.profiles AS profile_row
    ON profile_row.id = transaction_row.user_id
  LEFT JOIN auth.users AS auth_user
    ON auth_user.id = transaction_row.user_id
  WHERE v_status IS NULL OR transaction_row.status = v_status;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_workspace_payment_account_holder_names()
  FROM PUBLIC, anon;
-- Paid submissions must use the two-argument function so the holder name
-- cannot be bypassed by an older client-side RPC call. service_role retains
-- its existing access to the internal one-argument function.
REVOKE ALL ON FUNCTION public.submit_workspace_payment(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_workspace_payment(text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_workspace_payment_account_holder_names()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_workspace_payment(text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
