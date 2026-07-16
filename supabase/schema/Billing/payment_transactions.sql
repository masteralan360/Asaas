CREATE TABLE billing.payment_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  billing_workspace_id uuid NOT NULL,
  user_id uuid NULL,
  submitted_by_name text NULL,
  submitted_by_email text NULL,
  account_holder_name text NULL,
  provider text NOT NULL,
  provider_payment_id text NULL,
  payment_type text NOT NULL,
  amount numeric(20, 3) NOT NULL,
  currency text NOT NULL DEFAULT 'IQD'::text,
  gb_added numeric(14, 6) NOT NULL DEFAULT 0,
  gb_added_bytes bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'::text,
  expires_at timestamp with time zone NOT NULL DEFAULT (timezone('utc'::text, now()) + '7 days'::interval),
  paid_at timestamp with time zone NULL,
  provider_response jsonb NULL,
  reviewed_by uuid NULL,
  reviewed_by_label text NULL,
  reviewed_via text NULL,
  reviewed_at timestamp with time zone NULL,
  review_note text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT workspace_payment_transactions_provider_check CHECK (provider = ANY (ARRAY['fib'::text, 'qicard'::text])),
  CONSTRAINT workspace_payment_transactions_type_check CHECK (payment_type = ANY (ARRAY['subscription'::text, 'usage'::text])),
  CONSTRAINT workspace_payment_transactions_amount_check CHECK (amount > 0),
  CONSTRAINT workspace_payment_transactions_currency_check CHECK (currency = 'IQD'::text),
  CONSTRAINT workspace_payment_transactions_account_holder_name_length_check CHECK (
    account_holder_name IS NULL
    OR (
      char_length(account_holder_name) BETWEEN 1 AND 160
      AND cardinality(string_to_array(account_holder_name, ' ')) >= 3
    )
  ),
  CONSTRAINT workspace_payment_transactions_gb_check CHECK (
    gb_added >= 0
    AND gb_added_bytes >= 0
    AND gb_added * 1000000000::numeric = gb_added_bytes::numeric
  ),
  CONSTRAINT workspace_payment_transactions_type_values_check CHECK (
    (payment_type = 'subscription'::text AND gb_added = 0 AND gb_added_bytes = 0)
    OR (payment_type = 'usage'::text AND gb_added > 0 AND gb_added_bytes > 0)
  ),
  CONSTRAINT workspace_payment_transactions_status_check
    CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])),
  CONSTRAINT workspace_payment_transactions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT workspace_payment_transactions_review_state_check CHECK (
    (status = 'pending'::text AND paid_at IS NULL AND reviewed_at IS NULL)
    OR (status = 'approved'::text AND paid_at IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status = 'rejected'::text AND paid_at IS NULL AND reviewed_at IS NOT NULL)
    OR (status = 'expired'::text AND paid_at IS NULL)
  ),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (billing_workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX workspace_payment_transactions_one_pending_per_billing_workspace
  ON billing.payment_transactions (billing_workspace_id)
  WHERE status = 'pending'::text;

CREATE INDEX workspace_payment_transactions_workspace_created_idx
  ON billing.payment_transactions (workspace_id, created_at DESC);

CREATE INDEX workspace_payment_transactions_user_created_idx
  ON billing.payment_transactions (user_id, created_at DESC);

CREATE INDEX workspace_payment_transactions_user_account_holder_name_idx
  ON billing.payment_transactions (user_id, created_at DESC)
  WHERE account_holder_name IS NOT NULL;

CREATE INDEX workspace_payment_transactions_status_created_idx
  ON billing.payment_transactions (status, created_at DESC);
