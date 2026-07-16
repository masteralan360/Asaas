-- Workspace subscription renewal and usage-credit billing.
--
-- The ERP already owns public.payment_transactions as its operational cashflow
-- ledger. Billing is intentionally isolated in a private schema so the requested
-- payment_transactions name does not collide with that ledger or its offline sync.

CREATE SCHEMA IF NOT EXISTS billing;

REVOKE ALL ON SCHEMA billing FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA billing TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA billing REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA billing REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA billing REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;

CREATE TABLE billing.workspace_payment_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subscription_amount numeric(20, 3) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD',
  is_payment_enabled boolean NOT NULL DEFAULT false,
  usage_enabled boolean NOT NULL DEFAULT false,
  gb_per_payment numeric(14, 6) NOT NULL DEFAULT 0,
  renewal_due_at timestamptz NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_label text NULL,
  updated_by_label text NULL,
  created_via text NULL,
  updated_via text NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT workspace_payment_configurations_amount_check
    CHECK (subscription_amount >= 0),
  CONSTRAINT workspace_payment_configurations_currency_check
    CHECK (currency = 'IQD'),
  CONSTRAINT workspace_payment_configurations_gb_check
    CHECK (gb_per_payment >= 0),
  CONSTRAINT workspace_payment_configurations_enabled_amount_check
    CHECK (NOT is_payment_enabled OR subscription_amount > 0),
  CONSTRAINT workspace_payment_configurations_usage_values_check
    CHECK (NOT usage_enabled OR (gb_per_payment > 0 AND renewal_due_at IS NOT NULL))
);

COMMENT ON TABLE billing.workspace_payment_configurations IS
  'Private per-workspace billing configuration. Exactly one row may exist for a workspace.';
COMMENT ON COLUMN billing.workspace_payment_configurations.subscription_amount IS
  'IQD amount copied into a payment transaction when the workspace user submits it.';
COMMENT ON COLUMN billing.workspace_payment_configurations.gb_per_payment IS
  'Decimal gigabytes copied into usage payments. One GB is exactly 1,000,000,000 bytes.';
COMMENT ON COLUMN billing.workspace_payment_configurations.renewal_due_at IS
  'Paid-through boundary for usage-billed workspaces; separate from subscription_expires_at, which anchors usage-cycle reset day.';

CREATE TABLE billing.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_name text NULL,
  submitted_by_email text NULL,
  provider text NOT NULL,
  provider_payment_id text NULL,
  payment_type text NOT NULL,
  amount numeric(20, 3) NOT NULL,
  currency text NOT NULL DEFAULT 'IQD',
  gb_added numeric(14, 6) NOT NULL DEFAULT 0,
  gb_added_bytes bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (timezone('utc', now()) + INTERVAL '7 days'),
  paid_at timestamptz NULL,
  provider_response jsonb NULL,
  reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by_label text NULL,
  reviewed_via text NULL,
  reviewed_at timestamptz NULL,
  review_note text NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT workspace_payment_transactions_provider_check
    CHECK (provider IN ('fib', 'qicard')),
  CONSTRAINT workspace_payment_transactions_type_check
    CHECK (payment_type IN ('subscription', 'usage')),
  CONSTRAINT workspace_payment_transactions_amount_check
    CHECK (amount > 0),
  CONSTRAINT workspace_payment_transactions_currency_check
    CHECK (currency = 'IQD'),
  CONSTRAINT workspace_payment_transactions_gb_check
    CHECK (
      gb_added >= 0
      AND gb_added_bytes >= 0
      AND gb_added * 1000000000::numeric = gb_added_bytes::numeric
    ),
  CONSTRAINT workspace_payment_transactions_type_values_check
    CHECK (
      (payment_type = 'subscription' AND gb_added = 0 AND gb_added_bytes = 0)
      OR (payment_type = 'usage' AND gb_added > 0 AND gb_added_bytes > 0)
    ),
  CONSTRAINT workspace_payment_transactions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  CONSTRAINT workspace_payment_transactions_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT workspace_payment_transactions_review_state_check
    CHECK (
      (status = 'pending' AND paid_at IS NULL AND reviewed_at IS NULL)
      OR (status = 'approved' AND paid_at IS NOT NULL AND reviewed_at IS NOT NULL)
      OR (status = 'rejected' AND paid_at IS NULL AND reviewed_at IS NOT NULL)
      OR (status = 'expired' AND paid_at IS NULL)
    )
);

COMMENT ON TABLE billing.payment_transactions IS
  'Manual workspace renewal/top-up submissions. Financial and entitlement values are immutable submission-time snapshots.';
COMMENT ON COLUMN billing.payment_transactions.workspace_id IS
  'Workspace whose configuration was used, including a branch workspace when that was active at submission.';
COMMENT ON COLUMN billing.payment_transactions.billing_workspace_id IS
  'Source workspace that owns the shared subscription and usage entitlement applied at approval.';
COMMENT ON COLUMN billing.payment_transactions.gb_added_bytes IS
  'Exact decimal-byte snapshot derived server-side from gb_added at submission.';

CREATE UNIQUE INDEX workspace_payment_transactions_one_pending_per_billing_workspace
  ON billing.payment_transactions (billing_workspace_id)
  WHERE status = 'pending';

CREATE INDEX workspace_payment_transactions_workspace_created_idx
  ON billing.payment_transactions (workspace_id, created_at DESC);

CREATE INDEX workspace_payment_transactions_user_created_idx
  ON billing.payment_transactions (user_id, created_at DESC);

CREATE INDEX workspace_payment_transactions_status_created_idx
  ON billing.payment_transactions (status, created_at DESC);

CREATE TABLE billing.workspace_payment_configuration_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  configuration_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  old_record jsonb NULL,
  new_record jsonb NULL,
  changed_by uuid NULL,
  changed_by_label text NULL,
  changed_via text NULL,
  changed_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX workspace_payment_configuration_audit_workspace_idx
  ON billing.workspace_payment_configuration_audit (workspace_id, changed_at DESC);

CREATE TABLE billing.payment_transaction_status_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  billing_workspace_id uuid NOT NULL,
  from_status text NULL,
  to_status text NOT NULL,
  changed_by uuid NULL,
  changed_by_label text NULL,
  changed_via text NULL,
  change_note text NULL,
  provider_payment_id text NULL,
  old_record jsonb NULL,
  new_record jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT payment_transaction_status_audit_from_status_check
    CHECK (from_status IS NULL OR from_status IN ('pending', 'approved', 'rejected', 'expired')),
  CONSTRAINT payment_transaction_status_audit_to_status_check
    CHECK (to_status IN ('pending', 'approved', 'rejected', 'expired'))
);

CREATE INDEX payment_transaction_status_audit_transaction_idx
  ON billing.payment_transaction_status_audit (transaction_id, changed_at DESC);

CREATE INDEX payment_transaction_status_audit_workspace_idx
  ON billing.payment_transaction_status_audit (billing_workspace_id, changed_at DESC);

ALTER TABLE billing.workspace_payment_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.workspace_payment_configuration_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.payment_transaction_status_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA billing FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA billing FROM PUBLIC, anon, authenticated;
-- Billing writes are RPC-only. Keeping service-role table access read-only
-- prevents callers from bypassing transition checks or inverting advisory/row
-- lock order with direct DML; SECURITY DEFINER billing RPCs perform all writes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA billing
  FROM service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA billing TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA billing TO service_role;

CREATE OR REPLACE FUNCTION billing.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.next_workspace_usage_renewal_due(
  p_workspace_id uuid,
  p_reference timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_billing_workspace_id uuid := public.workspace_usage_owner_id(p_workspace_id);
  v_reference timestamptz := COALESCE(p_reference, now());
  v_subscription_expires_at timestamptz;
  v_reset_day integer;
  v_month_start date;
  v_candidate_date date;
  v_candidate timestamptz;
BEGIN
  IF v_billing_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT workspace_row.subscription_expires_at
  INTO v_subscription_expires_at
  FROM public.workspaces AS workspace_row
  WHERE workspace_row.id = v_billing_workspace_id
    AND workspace_row.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_reset_day := COALESCE(
    EXTRACT(DAY FROM v_subscription_expires_at AT TIME ZONE 'utc')::integer,
    1
  );
  v_month_start := date_trunc(
    'month',
    (v_reference AT TIME ZONE 'utc')::date
  )::date;

  v_candidate_date := v_month_start + (
    LEAST(
      v_reset_day,
      EXTRACT(DAY FROM (v_month_start + INTERVAL '1 month - 1 day'))::integer
    ) - 1
  );
  v_candidate := v_candidate_date::timestamp AT TIME ZONE 'utc';

  IF v_candidate <= v_reference THEN
    v_month_start := (v_month_start + INTERVAL '1 month')::date;
    v_candidate_date := v_month_start + (
      LEAST(
        v_reset_day,
        EXTRACT(DAY FROM (v_month_start + INTERVAL '1 month - 1 day'))::integer
      ) - 1
    );
    v_candidate := v_candidate_date::timestamp AT TIME ZONE 'utc';
  END IF;

  RETURN v_candidate;
END;
$function$;

COMMENT ON FUNCTION billing.next_workspace_usage_renewal_due(uuid, timestamptz) IS
  'Returns the first UTC usage-renewal boundary after a reference time while preserving the source workspace reset day across short months.';

CREATE OR REPLACE FUNCTION billing.audit_workspace_payment_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $function$
DECLARE
  v_row billing.workspace_payment_configurations;
  v_action text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    v_action := 'delete';
  ELSIF TG_OP = 'INSERT' THEN
    v_row := NEW;
    v_action := 'insert';
  ELSE
    IF to_jsonb(OLD) = to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;
    v_row := NEW;
    v_action := 'update';
  END IF;

  INSERT INTO billing.workspace_payment_configuration_audit (
    configuration_id,
    workspace_id,
    action,
    old_record,
    new_record,
    changed_by,
    changed_by_label,
    changed_via
  )
  VALUES (
    v_row.id,
    v_row.workspace_id,
    v_action,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    CASE
      WHEN TG_OP = 'DELETE' THEN COALESCE(OLD.updated_by, OLD.created_by, auth.uid())
      ELSE COALESCE(NEW.updated_by, NEW.created_by, auth.uid())
    END,
    CASE
      WHEN TG_OP = 'DELETE' THEN COALESCE(OLD.updated_by_label, OLD.created_by_label)
      ELSE COALESCE(NEW.updated_by_label, NEW.created_by_label)
    END,
    CASE
      WHEN TG_OP = 'DELETE' THEN COALESCE(OLD.updated_via, OLD.created_via)
      ELSE COALESCE(NEW.updated_via, NEW.created_via)
    END
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.enforce_payment_transaction_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, billing
AS $function$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.billing_workspace_id IS DISTINCT FROM OLD.billing_workspace_id
    OR (
      NEW.user_id IS DISTINCT FROM OLD.user_id
      AND NOT (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL)
    )
    OR NEW.submitted_by_name IS DISTINCT FROM OLD.submitted_by_name
    OR NEW.submitted_by_email IS DISTINCT FROM OLD.submitted_by_email
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.gb_added IS DISTINCT FROM OLD.gb_added
    OR NEW.gb_added_bytes IS DISTINCT FROM OLD.gb_added_bytes
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'workspace_payment_transaction_snapshot_is_immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'pending'
      OR NEW.status NOT IN ('approved', 'rejected', 'expired') THEN
      RAISE EXCEPTION 'invalid_workspace_payment_status_transition'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status <> 'pending' AND (
    NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.reviewed_by_label IS DISTINCT FROM OLD.reviewed_by_label
    OR NEW.reviewed_via IS DISTINCT FROM OLD.reviewed_via
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.review_note IS DISTINCT FROM OLD.review_note
    OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
    OR NEW.provider_response IS DISTINCT FROM OLD.provider_response
  ) THEN
    RAISE EXCEPTION 'reviewed_workspace_payment_transaction_is_immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.audit_payment_transaction_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO billing.payment_transaction_status_audit (
    transaction_id,
    workspace_id,
    billing_workspace_id,
    from_status,
    to_status,
    changed_by,
    changed_by_label,
    changed_via,
    change_note,
    provider_payment_id,
    old_record,
    new_record
  )
  VALUES (
    NEW.id,
    NEW.workspace_id,
    NEW.billing_workspace_id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    CASE WHEN NEW.status = 'pending' THEN NEW.user_id ELSE NEW.reviewed_by END,
    NEW.reviewed_by_label,
    CASE WHEN NEW.status = 'pending' THEN 'workspace-user' ELSE NEW.reviewed_via END,
    NEW.review_note,
    NEW.provider_payment_id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.enforce_workspace_payment_configuration_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_billing_workspace_id uuid := public.workspace_usage_owner_id(NEW.workspace_id);
BEGIN
  IF v_billing_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- BEFORE INSERT runs before a configuration row is visible or locked. Taking
  -- the family lock here serializes first-time direct/service-role inserts so
  -- two siblings cannot concurrently establish opposite payment modes. UPDATE
  -- is intentionally excluded because PostgreSQL already locks that row before
  -- invoking this trigger, which would invert the admin RPC lock order.
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'workspace-payment-configuration:' || v_billing_workspace_id::text,
        0
      )
    );
  END IF;

  -- Branches share one entitlement and one lock state, so allowing different
  -- payment modes inside a family could leave one branch locked without a
  -- matching renewal action.
  IF NOT (
    auth.role() = 'service_role'
    AND current_setting(
      'atlas.trusted_workspace_payment_family_mode_update',
      true
    ) = 'on'
  ) AND EXISTS (
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

  -- Existing workspace usage limits are the platform's source of truth for a
  -- usage-billed workspace. They must be removed in the Usage tab before an
  -- administrator can convert the family back to subscription-only billing.
  IF NOT NEW.usage_enabled AND EXISTS (
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

CREATE OR REPLACE FUNCTION billing.enforce_workspace_usage_limit_payment_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_billing_workspace_id uuid;
BEGIN
  -- Branch attachment locks this same workspace key before it changes the
  -- usage owner. Resolve only after acquiring it so a visible, freshly-created
  -- branch workspace cannot receive a limit under an owner that goes stale
  -- while the relationship insert is in flight.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'workspace-branch-payment-owner:' || NEW.workspace_id::text,
      0
    )
  );

  v_billing_workspace_id := public.workspace_usage_owner_id(NEW.workspace_id);

  IF v_billing_workspace_id IS NOT NULL THEN
    -- Admin configuration writes take this lock before changing modes. Joining
    -- it here prevents a concurrent usage-limit insert from observing the old
    -- configuration and committing an invalid subscription/usage combination.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'workspace-payment-configuration:' || v_billing_workspace_id::text,
        0
      )
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM billing.workspace_payment_configurations AS configuration_row
    WHERE public.workspace_usage_owner_id(configuration_row.workspace_id)
        = v_billing_workspace_id
      AND configuration_row.usage_enabled = false
  ) THEN
    RAISE EXCEPTION 'workspace_payment_configuration_usage_mode_required'
      USING
        ERRCODE = '23514',
        HINT = 'Enable usage-based payments before adding workspace usage limits.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.provision_workspace_payment_configuration_for_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_billing_workspace_id uuid := public.workspace_usage_owner_id(NEW.source_workspace_id);
  v_source_configuration billing.workspace_payment_configurations;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'workspace-payment-configuration:' || v_billing_workspace_id::text,
      0
    )
  );

  SELECT configuration_row.*
  INTO v_source_configuration
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE public.workspace_usage_owner_id(configuration_row.workspace_id)
    = v_billing_workspace_id
  ORDER BY
    CASE
      WHEN configuration_row.workspace_id = NEW.source_workspace_id THEN 0
      WHEN configuration_row.workspace_id = v_billing_workspace_id THEN 1
      WHEN configuration_row.workspace_id = NEW.branch_workspace_id THEN 2
      ELSE 3
    END,
    configuration_row.workspace_id
  LIMIT 1;

  IF v_source_configuration.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM billing.workspace_payment_configurations AS configuration_row
    WHERE public.workspace_usage_owner_id(configuration_row.workspace_id)
        = v_billing_workspace_id
      AND configuration_row.usage_enabled
        IS DISTINCT FROM v_source_configuration.usage_enabled
  ) THEN
    RAISE EXCEPTION 'workspace_payment_family_usage_mode_mismatch'
      USING
        ERRCODE = '23514',
        HINT = 'Align payment modes before attaching this workspace branch family.';
  END IF;

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
    v_source_configuration.subscription_amount,
    'IQD',
    v_source_configuration.is_payment_enabled,
    v_source_configuration.usage_enabled,
    v_source_configuration.gb_per_payment,
    v_source_configuration.renewal_due_at,
    auth.uid(),
    auth.uid(),
    'System branch provisioning',
    'System branch provisioning',
    'branch-provisioning',
    'branch-provisioning'
  FROM public.workspaces AS family_workspace
  WHERE public.workspace_usage_owner_id(family_workspace.id)
      = v_billing_workspace_id
  ON CONFLICT (workspace_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.guard_workspace_branch_payment_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_previous_billing_workspace_id uuid;
  v_next_billing_workspace_id uuid;
  v_rechecked_previous_billing_workspace_id uuid;
  v_rechecked_next_billing_workspace_id uuid;
  v_lock_workspace_id uuid;
  v_previous_min_renewal_due_at timestamptz;
  v_previous_max_renewal_due_at timestamptz;
  v_next_min_renewal_due_at timestamptz;
  v_next_max_renewal_due_at timestamptz;
BEGIN
  -- Every relationship insert takes the same topology lock before resolving
  -- either owner. This serializes opposite and overlapping attachments so a
  -- waiter always observes the family committed by the winner.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('workspace-branch-payment-topology', 0)
  );

  v_previous_billing_workspace_id := public.workspace_usage_owner_id(
    NEW.branch_workspace_id
  );
  v_next_billing_workspace_id := public.workspace_usage_owner_id(
    NEW.source_workspace_id
  );

  IF v_previous_billing_workspace_id IS NULL
    OR v_next_billing_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_previous_billing_workspace_id = v_next_billing_workspace_id THEN
    RAISE EXCEPTION 'workspace_branch_cycle_or_same_family'
      USING
        ERRCODE = '23514',
        HINT = 'A workspace cannot be attached beneath a member of its existing branch family.';
  END IF;

  -- Submitting users take this workspace-specific lock before resolving their
  -- usage owner. Lock every member of both families in stable order so a
  -- submit either commits first (and blocks the merge) or resolves the new
  -- owner afterward.
  FOR v_lock_workspace_id IN
    SELECT workspace_row.id
    FROM public.workspaces AS workspace_row
    WHERE public.workspace_usage_owner_id(workspace_row.id) IN (
      v_previous_billing_workspace_id,
      v_next_billing_workspace_id
    )
    ORDER BY workspace_row.id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'workspace-branch-payment-owner:' || v_lock_workspace_id::text,
        0
      )
    );
  END LOOP;

  -- A privileged relationship delete or other out-of-band topology mutation
  -- does not participate in the advisory protocol. Re-resolve after the
  -- member locks and fail closed instead of applying stale owner snapshots.
  v_rechecked_previous_billing_workspace_id := public.workspace_usage_owner_id(
    NEW.branch_workspace_id
  );
  v_rechecked_next_billing_workspace_id := public.workspace_usage_owner_id(
    NEW.source_workspace_id
  );

  IF v_rechecked_previous_billing_workspace_id
      IS DISTINCT FROM v_previous_billing_workspace_id
    OR v_rechecked_next_billing_workspace_id
      IS DISTINCT FROM v_next_billing_workspace_id THEN
    RAISE EXCEPTION 'workspace_branch_topology_changed_retry'
      USING
        ERRCODE = '40001',
        HINT = 'Retry the branch attachment after the concurrent topology change completes.';
  END IF;

  -- Review/submission use family payment locks. Acquire both pre/post-merge
  -- owners in stable UUID order before checking the immutable snapshots.
  FOR v_lock_workspace_id IN
    SELECT DISTINCT owner_id
    FROM unnest(ARRAY[
      v_previous_billing_workspace_id,
      v_next_billing_workspace_id
    ]) AS owner(owner_id)
    ORDER BY owner_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'workspace-payment:' || v_lock_workspace_id::text,
        0
      )
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM billing.payment_transactions AS transaction_row
    WHERE transaction_row.status = 'pending'
      AND transaction_row.billing_workspace_id IN (
        v_previous_billing_workspace_id,
        v_next_billing_workspace_id
      )
  ) THEN
    RAISE EXCEPTION 'workspace_branch_pending_payment_conflict'
      USING
        ERRCODE = '23514',
        HINT = 'Review, reject, or expire pending workspace payments before attaching the branch.';
  END IF;

  -- Moving a family that has ever submitted a payment would strand its
  -- immutable transaction history under the former billing owner. Require an
  -- entitlement migration before such a relationship can be created.
  IF EXISTS (
    SELECT 1
    FROM billing.payment_transactions AS transaction_row
    WHERE transaction_row.billing_workspace_id
      = v_previous_billing_workspace_id
  )
    OR EXISTS (
      SELECT 1
      FROM billing.payment_transaction_status_audit AS audit_row
      WHERE audit_row.billing_workspace_id
        = v_previous_billing_workspace_id
  ) THEN
    RAISE EXCEPTION 'workspace_branch_payment_history_conflict'
      USING
        ERRCODE = '23514',
        HINT = 'Payment history must be migrated before attaching this workspace family.';
  END IF;

  -- Legacy/manual usage rows are owner-keyed just like purchased credits.
  -- Attaching them without migration would make allowances and counters
  -- disappear from the newly resolved owner.
  IF EXISTS (
      SELECT 1
      FROM public.workspace_usage_limits AS limits
      WHERE limits.workspace_id = v_previous_billing_workspace_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.workspace_usage AS usage_row
      WHERE usage_row.workspace_id = v_previous_billing_workspace_id
    ) THEN
    RAISE EXCEPTION 'workspace_branch_usage_state_conflict'
      USING
        ERRCODE = '23514',
        HINT = 'Usage limits and counters must be migrated before attaching this workspace family.';
  END IF;

  SELECT min(configuration_row.renewal_due_at),
         max(configuration_row.renewal_due_at)
  INTO v_previous_min_renewal_due_at, v_previous_max_renewal_due_at
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE configuration_row.usage_enabled
    AND public.workspace_usage_owner_id(configuration_row.workspace_id)
      = v_previous_billing_workspace_id;

  SELECT min(configuration_row.renewal_due_at),
         max(configuration_row.renewal_due_at)
  INTO v_next_min_renewal_due_at, v_next_max_renewal_due_at
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE configuration_row.usage_enabled
    AND public.workspace_usage_owner_id(configuration_row.workspace_id)
      = v_next_billing_workspace_id;

  IF v_previous_min_renewal_due_at
      IS DISTINCT FROM v_previous_max_renewal_due_at
    OR v_next_min_renewal_due_at
      IS DISTINCT FROM v_next_max_renewal_due_at
    OR (
      v_previous_min_renewal_due_at IS NOT NULL
      AND v_next_min_renewal_due_at IS NOT NULL
      AND v_previous_min_renewal_due_at
        IS DISTINCT FROM v_next_min_renewal_due_at
    ) THEN
    RAISE EXCEPTION 'workspace_payment_family_renewal_due_mismatch'
      USING
        ERRCODE = '23514',
        HINT = 'Align usage renewal dates before attaching the workspace families.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.prevent_workspace_branch_reparenting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.source_workspace_id IS DISTINCT FROM OLD.source_workspace_id
    OR NEW.branch_workspace_id IS DISTINCT FROM OLD.branch_workspace_id THEN
    RAISE EXCEPTION 'workspace_branch_relationship_ids_are_immutable'
      USING
        ERRCODE = '23514',
        HINT = 'Create a new branch relationship instead of reparenting an existing one.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_payment_configuration_mode
  ON billing.workspace_payment_configurations;
CREATE TRIGGER enforce_workspace_payment_configuration_mode
BEFORE INSERT OR UPDATE OF workspace_id, usage_enabled
ON billing.workspace_payment_configurations
FOR EACH ROW
EXECUTE FUNCTION billing.enforce_workspace_payment_configuration_mode();

DROP TRIGGER IF EXISTS enforce_workspace_usage_limit_payment_mode
  ON public.workspace_usage_limits;
CREATE TRIGGER enforce_workspace_usage_limit_payment_mode
BEFORE INSERT OR UPDATE OF workspace_id
ON public.workspace_usage_limits
FOR EACH ROW
EXECUTE FUNCTION billing.enforce_workspace_usage_limit_payment_mode();

DROP TRIGGER IF EXISTS provision_workspace_payment_configuration_for_branch
  ON public.workspace_branches;
CREATE TRIGGER provision_workspace_payment_configuration_for_branch
AFTER INSERT ON public.workspace_branches
FOR EACH ROW
EXECUTE FUNCTION billing.provision_workspace_payment_configuration_for_branch();

DROP TRIGGER IF EXISTS billing_00_guard_workspace_branch_payment_merge
  ON public.workspace_branches;
CREATE TRIGGER billing_00_guard_workspace_branch_payment_merge
BEFORE INSERT ON public.workspace_branches
FOR EACH ROW
EXECUTE FUNCTION billing.guard_workspace_branch_payment_merge();

DROP TRIGGER IF EXISTS billing_prevent_workspace_branch_reparenting
  ON public.workspace_branches;
CREATE TRIGGER billing_prevent_workspace_branch_reparenting
BEFORE UPDATE OF source_workspace_id, branch_workspace_id
ON public.workspace_branches
FOR EACH ROW
EXECUTE FUNCTION billing.prevent_workspace_branch_reparenting();

-- Branch creation and hard deletion are service-mediated operations. The
-- workspace-access function creates a fresh target workspace with service_role,
-- while normal removal uses archival. Direct PostgREST mutations could bypass
-- those ownership/topology checks and strand billing entitlements.
DROP POLICY IF EXISTS workspace_branches_insert ON public.workspace_branches;
DROP POLICY IF EXISTS workspace_branches_delete ON public.workspace_branches;
REVOKE INSERT, DELETE, TRUNCATE ON public.workspace_branches FROM authenticated;

DROP TRIGGER IF EXISTS touch_workspace_payment_configurations_updated_at
  ON billing.workspace_payment_configurations;
CREATE TRIGGER touch_workspace_payment_configurations_updated_at
BEFORE UPDATE ON billing.workspace_payment_configurations
FOR EACH ROW
EXECUTE FUNCTION billing.touch_updated_at();

DROP TRIGGER IF EXISTS audit_workspace_payment_configurations
  ON billing.workspace_payment_configurations;
CREATE TRIGGER audit_workspace_payment_configurations
AFTER INSERT OR UPDATE OR DELETE ON billing.workspace_payment_configurations
FOR EACH ROW
EXECUTE FUNCTION billing.audit_workspace_payment_configuration();

DROP TRIGGER IF EXISTS enforce_workspace_payment_transaction_transition
  ON billing.payment_transactions;
CREATE TRIGGER enforce_workspace_payment_transaction_transition
BEFORE UPDATE ON billing.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION billing.enforce_payment_transaction_transition();

DROP TRIGGER IF EXISTS touch_workspace_payment_transactions_updated_at
  ON billing.payment_transactions;
CREATE TRIGGER touch_workspace_payment_transactions_updated_at
BEFORE UPDATE ON billing.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION billing.touch_updated_at();

DROP TRIGGER IF EXISTS audit_workspace_payment_transaction_status
  ON billing.payment_transactions;
CREATE TRIGGER audit_workspace_payment_transaction_status
AFTER INSERT OR UPDATE OF status ON billing.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION billing.audit_payment_transaction_status();

REVOKE ALL ON ALL ROUTINES IN SCHEMA billing FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA billing TO service_role;

-- Purchased usage is a current-cycle credit. It augments the base recurring
-- allowance without permanently changing the workspace's plan limit.
ALTER TABLE public.workspace_usage
  ADD COLUMN IF NOT EXISTS purchased_credit_bytes bigint NOT NULL DEFAULT 0;

ALTER TABLE public.workspace_usage
  DROP CONSTRAINT IF EXISTS workspace_usage_purchased_credit_bytes_check;
ALTER TABLE public.workspace_usage
  ADD CONSTRAINT workspace_usage_purchased_credit_bytes_check
  CHECK (purchased_credit_bytes >= 0);

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS usage_limit_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS payment_renewal_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS subscription_expiry_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workspace_usage.purchased_credit_bytes IS
  'Approved one-time charged-usage credit for the current usage cycle, in decimal bytes.';
COMMENT ON COLUMN public.workspaces.usage_limit_locked IS
  'True only when locked_workspace was set by charged-usage exhaustion; permits safe automatic clearing without overriding a manual lock.';
COMMENT ON COLUMN public.workspaces.payment_renewal_locked IS
  'True only when a usage-billing renewal date is due; approval clears this lock without overriding unrelated lock reasons.';
COMMENT ON COLUMN public.workspaces.subscription_expiry_locked IS
  'True only when locked_workspace represents subscription expiry; renewal clears this lock without overriding unrelated lock reasons.';

-- Infer provenance for system locks created before the dedicated reason flags
-- existed. A locked workspace whose charged allowance is currently exhausted
-- is the strongest available upgrade-safe signal that the legacy usage trigger
-- created the lock.
UPDATE public.workspaces AS workspace_row
SET usage_limit_locked = true
FROM public.workspace_usage AS usage_row
INNER JOIN public.workspace_usage_limits AS limits
  ON limits.workspace_id = usage_row.workspace_id
WHERE workspace_row.id = usage_row.workspace_id
  AND workspace_row.locked_workspace = true
  AND workspace_row.usage_limit_locked = false
  AND limits.monthly_data_transfer_limit_bytes IS NOT NULL
  AND usage_row.data_transfer_bytes::numeric >= (
    limits.monthly_data_transfer_limit_bytes::numeric
    + COALESCE(usage_row.purchased_credit_bytes, 0)::numeric
  );

-- Non-usage workspaces historically used locked_workspace together with the
-- expiry timestamp. Preserve that reason so an approved renewal can clear only
-- the expiry lock while leaving a genuinely manual lock alone.
UPDATE public.workspaces AS workspace_row
SET subscription_expiry_locked = true
WHERE workspace_row.locked_workspace = true
  AND workspace_row.subscription_expiry_locked = false
  AND workspace_row.subscription_expires_at <= now()
  AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_usage_limits AS limits
    WHERE limits.workspace_id = public.workspace_usage_owner_id(workspace_row.id)
  );

CREATE OR REPLACE FUNCTION public.prevent_restricted_workspace_client_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  request_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
  trusted_lock_update text := current_setting('atlas.trusted_workspace_lock_update', true);
BEGIN
  IF request_role = 'authenticated'
    AND trusted_lock_update IS DISTINCT FROM 'on' THEN
    IF NEW.code IS DISTINCT FROM OLD.code
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.locked_workspace IS DISTINCT FROM OLD.locked_workspace
      OR NEW.usage_limit_locked IS DISTINCT FROM OLD.usage_limit_locked
      OR NEW.payment_renewal_locked IS DISTINCT FROM OLD.payment_renewal_locked
      OR NEW.subscription_expiry_locked IS DISTINCT FROM OLD.subscription_expiry_locked
      OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
      OR COALESCE(NEW.member_count, 0) IS DISTINCT FROM COALESCE(OLD.member_count, 0) THEN
      RAISE EXCEPTION 'Restricted workspace fields cannot be updated from the client';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_workspace_usage_lock_flags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  -- Existing admin clients may update only locked_workspace. Treat an explicit
  -- unlock from those clients as clearing every system-owned lock marker too.
  IF TG_OP = 'UPDATE'
    AND COALESCE(OLD.locked_workspace, false) = true
    AND COALESCE(NEW.locked_workspace, false) = false
    AND NEW.usage_limit_locked IS NOT DISTINCT FROM OLD.usage_limit_locked
    AND NEW.payment_renewal_locked IS NOT DISTINCT FROM OLD.payment_renewal_locked
    AND NEW.subscription_expiry_locked IS NOT DISTINCT FROM OLD.subscription_expiry_locked THEN
    NEW.usage_limit_locked := false;
    NEW.payment_renewal_locked := false;
    NEW.subscription_expiry_locked := false;
  END IF;

  IF COALESCE(NEW.usage_limit_locked, false)
    OR COALESCE(NEW.payment_renewal_locked, false)
    OR COALESCE(NEW.subscription_expiry_locked, false) THEN
    NEW.locked_workspace := true;
  ELSIF NOT COALESCE(NEW.locked_workspace, false) THEN
    NEW.usage_limit_locked := false;
    NEW.payment_renewal_locked := false;
    NEW.subscription_expiry_locked := false;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_workspace_usage_lock_flags_on_workspaces
  ON public.workspaces;
CREATE TRIGGER normalize_workspace_usage_lock_flags_on_workspaces
BEFORE INSERT OR UPDATE OF locked_workspace, usage_limit_locked, payment_renewal_locked, subscription_expiry_locked ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.normalize_workspace_usage_lock_flags();

-- Keep the new lock provenance synchronized with branches alongside the existing
-- source subscription and lock fields.
CREATE OR REPLACE FUNCTION public.sync_branch_workspace_status_from_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.workspaces AS branch_workspace
  SET
    locked_workspace = NEW.locked_workspace,
    usage_limit_locked = NEW.usage_limit_locked,
    payment_renewal_locked = NEW.payment_renewal_locked,
    subscription_expiry_locked = NEW.subscription_expiry_locked,
    subscription_expires_at = NEW.subscription_expires_at
  WHERE branch_workspace.id IN (
      SELECT branch.branch_workspace_id
      FROM public.workspace_branches AS branch
      WHERE branch.source_workspace_id = NEW.id
    )
    AND (
      branch_workspace.locked_workspace IS DISTINCT FROM NEW.locked_workspace
      OR branch_workspace.usage_limit_locked IS DISTINCT FROM NEW.usage_limit_locked
      OR branch_workspace.payment_renewal_locked IS DISTINCT FROM NEW.payment_renewal_locked
      OR branch_workspace.subscription_expiry_locked IS DISTINCT FROM NEW.subscription_expiry_locked
      OR branch_workspace.subscription_expires_at IS DISTINCT FROM NEW.subscription_expires_at
    );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_branch_workspace_status_from_source ON public.workspaces;
CREATE TRIGGER trg_sync_branch_workspace_status_from_source
AFTER UPDATE OF locked_workspace, usage_limit_locked, payment_renewal_locked, subscription_expiry_locked, subscription_expires_at ON public.workspaces
FOR EACH ROW
WHEN (
  NEW.locked_workspace IS DISTINCT FROM OLD.locked_workspace
  OR NEW.usage_limit_locked IS DISTINCT FROM OLD.usage_limit_locked
  OR NEW.payment_renewal_locked IS DISTINCT FROM OLD.payment_renewal_locked
  OR NEW.subscription_expiry_locked IS DISTINCT FROM OLD.subscription_expiry_locked
  OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
)
EXECUTE FUNCTION public.sync_branch_workspace_status_from_source();

CREATE OR REPLACE FUNCTION public.sync_new_branch_workspace_status_from_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.workspaces AS branch_workspace
  SET
    locked_workspace = source_workspace.locked_workspace,
    usage_limit_locked = source_workspace.usage_limit_locked,
    payment_renewal_locked = source_workspace.payment_renewal_locked,
    subscription_expiry_locked = source_workspace.subscription_expiry_locked,
    subscription_expires_at = source_workspace.subscription_expires_at
  FROM public.workspaces AS source_workspace
  WHERE branch_workspace.id = NEW.branch_workspace_id
    AND source_workspace.id = NEW.source_workspace_id
    AND (
      branch_workspace.locked_workspace IS DISTINCT FROM source_workspace.locked_workspace
      OR branch_workspace.usage_limit_locked IS DISTINCT FROM source_workspace.usage_limit_locked
      OR branch_workspace.payment_renewal_locked IS DISTINCT FROM source_workspace.payment_renewal_locked
      OR branch_workspace.subscription_expiry_locked IS DISTINCT FROM source_workspace.subscription_expiry_locked
      OR branch_workspace.subscription_expires_at IS DISTINCT FROM source_workspace.subscription_expires_at
    );

  RETURN NEW;
END;
$function$;

UPDATE public.workspaces AS branch_workspace
SET
  locked_workspace = source_workspace.locked_workspace,
  usage_limit_locked = source_workspace.usage_limit_locked,
  payment_renewal_locked = source_workspace.payment_renewal_locked,
  subscription_expiry_locked = source_workspace.subscription_expiry_locked,
  subscription_expires_at = source_workspace.subscription_expires_at
FROM public.workspace_branches AS branch
INNER JOIN public.workspaces AS source_workspace
  ON source_workspace.id = branch.source_workspace_id
WHERE branch_workspace.id = branch.branch_workspace_id
  AND (
    branch_workspace.locked_workspace IS DISTINCT FROM source_workspace.locked_workspace
    OR branch_workspace.usage_limit_locked IS DISTINCT FROM source_workspace.usage_limit_locked
    OR branch_workspace.payment_renewal_locked IS DISTINCT FROM source_workspace.payment_renewal_locked
    OR branch_workspace.subscription_expiry_locked IS DISTINCT FROM source_workspace.subscription_expiry_locked
    OR branch_workspace.subscription_expires_at IS DISTINCT FROM source_workspace.subscription_expires_at
  );

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

  -- Base allowance persists. Consumed transfer and purchased top-ups are both
  -- scoped to one cycle and reset together.
  UPDATE public.workspace_usage
  SET
    actual_data_transfer_bytes = 0,
    data_transfer_bytes = 0,
    purchased_credit_bytes = 0,
    transfer_period_start = v_period,
    transfer_updated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE workspace_id = v_usage_owner_id
    AND transfer_period_start IS DISTINCT FROM v_period;
END;
$function$;

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
  v_purchased_credit_bytes bigint;
  v_effective_allowance numeric;
  v_exhausted boolean := false;
BEGIN
  IF v_usage_owner_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('atlas.trusted_workspace_lock_update', 'on', true);

  SELECT
    usage.data_transfer_bytes,
    limits.monthly_data_transfer_limit_bytes,
    usage.purchased_credit_bytes
  INTO
    v_charged_usage_bytes,
    v_base_allowance_bytes,
    v_purchased_credit_bytes
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id
    AND usage.transfer_period_start = public.workspace_usage_period_start(v_usage_owner_id);

  IF FOUND AND v_base_allowance_bytes IS NOT NULL THEN
    v_effective_allowance := v_base_allowance_bytes::numeric
      + COALESCE(v_purchased_credit_bytes, 0)::numeric;
    v_exhausted := COALESCE(v_charged_usage_bytes, 0)::numeric >= v_effective_allowance;
  END IF;

  IF v_exhausted THEN
    -- A pre-existing manual/subscription lock remains manual. Only claim lock
    -- provenance when this function is the actor that changes unlocked -> locked.
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = true,
      usage_limit_locked = true
    WHERE workspace_row.id = v_usage_owner_id
      AND COALESCE(workspace_row.locked_workspace, false) = false;
  ELSE
    -- Clear access only when the lock is known to have originated from usage.
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = false,
      usage_limit_locked = false
    WHERE workspace_row.id = v_usage_owner_id
      AND workspace_row.usage_limit_locked = true;
  END IF;
END;
$function$;

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

  -- Configuration writes and payment approvals use this family-scoped lock
  -- before changing renewal_due_at. Reconciliation must join that order before
  -- reading due state so a waiter cannot later apply a stale lock decision.
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
    -- Subscription mode owns only the expiry marker. Remove obsolete usage
    -- markers and apply expiry without relabelling an unrelated manual lock.
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

  -- Usage mode supersedes subscription expiry. Clear only the known automatic
  -- expiry reason; a platform/manual lock has no marker and remains untouched.
  UPDATE public.workspaces AS workspace_row
  SET
    locked_workspace = workspace_row.usage_limit_locked
      OR workspace_row.payment_renewal_locked,
    subscription_expiry_locked = false
  WHERE workspace_row.id = v_billing_workspace_id
    AND workspace_row.subscription_expiry_locked = true;

  IF v_is_due THEN
    -- Do not relabel a pre-existing manual lock as renewal-owned. Other system
    -- markers are safe because their reason remains independently recorded.
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = true,
      payment_renewal_locked = true
    WHERE workspace_row.id = v_billing_workspace_id
      AND (
        workspace_row.locked_workspace IS DISTINCT FROM true
        OR workspace_row.payment_renewal_locked IS DISTINCT FROM true
      )
      AND (
        workspace_row.locked_workspace = false
        OR workspace_row.usage_limit_locked = true
        OR workspace_row.subscription_expiry_locked = true
        OR workspace_row.payment_renewal_locked = true
      );
  ELSE
    UPDATE public.workspaces AS workspace_row
    SET
      locked_workspace = workspace_row.usage_limit_locked,
      payment_renewal_locked = false
    WHERE workspace_row.id = v_billing_workspace_id
      AND workspace_row.payment_renewal_locked = true;
  END IF;

  PERFORM public.reconcile_workspace_usage_limit_lock(v_billing_workspace_id);
END;
$function$;

CREATE OR REPLACE FUNCTION billing.reconcile_all_workspace_payment_renewal_locks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
DECLARE
  v_workspace_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_workspace_id IN
    SELECT DISTINCT family.workspace_id
    FROM (
      SELECT public.workspace_usage_owner_id(configuration_row.workspace_id) AS workspace_id
      FROM billing.workspace_payment_configurations AS configuration_row
      UNION
      SELECT limits.workspace_id
      FROM public.workspace_usage_limits AS limits
      UNION
      SELECT workspace_row.id
      FROM public.workspaces AS workspace_row
      WHERE workspace_row.usage_limit_locked = true
        OR workspace_row.payment_renewal_locked = true
        OR workspace_row.subscription_expiry_locked = true
    ) AS family
    WHERE family.workspace_id IS NOT NULL
  LOOP
    PERFORM billing.reconcile_workspace_payment_renewal_lock(v_workspace_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION billing.reconcile_payment_renewal_lock_from_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, billing
AS $function$
BEGIN
  PERFORM billing.reconcile_workspace_payment_renewal_lock(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS reconcile_workspace_payment_renewal_lock_on_configuration
  ON billing.workspace_payment_configurations;
CREATE TRIGGER reconcile_workspace_payment_renewal_lock_on_configuration
AFTER INSERT OR UPDATE OF usage_enabled, renewal_due_at OR DELETE
ON billing.workspace_payment_configurations
FOR EACH ROW
EXECUTE FUNCTION billing.reconcile_payment_renewal_lock_from_configuration();

CREATE OR REPLACE FUNCTION public.lock_workspace_when_transfer_limit_reached(
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM public.reconcile_workspace_usage_limit_lock(p_workspace_id);
END;
$function$;

COMMENT ON FUNCTION public.reconcile_workspace_usage_limit_lock(uuid) IS
  'Reconciles only usage-owned workspace locks against charged usage and the effective allowance (base plus current-cycle purchased credit).';
COMMENT ON FUNCTION public.lock_workspace_when_transfer_limit_reached(uuid) IS
  'Compatibility wrapper that now safely sets or clears only usage-owned locks using the effective allowance.';

CREATE OR REPLACE FUNCTION public.enforce_workspace_transfer_limit_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM public.reconcile_workspace_usage_limit_lock(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_transfer_limit_lock_on_usage
  ON public.workspace_usage;
CREATE TRIGGER enforce_workspace_transfer_limit_lock_on_usage
AFTER INSERT OR UPDATE OR DELETE ON public.workspace_usage
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_transfer_limit_lock();

DROP TRIGGER IF EXISTS enforce_workspace_transfer_limit_lock_on_limits
  ON public.workspace_usage_limits;
CREATE TRIGGER enforce_workspace_transfer_limit_lock_on_limits
AFTER INSERT OR UPDATE OR DELETE ON public.workspace_usage_limits
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_transfer_limit_lock();

-- Replace the status APIs so legacy allowance consumers receive the effective
-- amount while newer clients can separately display base and purchased credit.
DROP FUNCTION IF EXISTS public.record_workspace_data_transfer(uuid, bigint, text);

CREATE FUNCTION public.record_workspace_data_transfer(
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
  base_monthly_data_transfer_limit_bytes bigint,
  purchased_credit_bytes bigint,
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
      NULL::bigint,
      0::bigint,
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
    CASE
      WHEN limits.monthly_data_transfer_limit_bytes IS NULL THEN NULL::bigint
      ELSE (limits.monthly_data_transfer_limit_bytes::numeric + usage.purchased_credit_bytes::numeric)::bigint
    END,
    limits.monthly_data_transfer_limit_bytes,
    usage.purchased_credit_bytes,
    CASE
      WHEN limits.monthly_data_transfer_limit_bytes IS NULL THEN NULL::bigint
      ELSE (limits.monthly_data_transfer_limit_bytes::numeric + usage.purchased_credit_bytes::numeric)::bigint
    END
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id;
END;
$function$;

COMMENT ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) IS
  'Records actual transfer, returns charged usage, base allowance, current-cycle purchased credit, and effective allowance.';

DROP FUNCTION IF EXISTS public.get_workspace_usage_status(uuid);

CREATE FUNCTION public.get_workspace_usage_status(
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
  base_monthly_data_transfer_limit_bytes bigint,
  purchased_credit_bytes bigint,
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
      0::bigint,
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
    CASE
      WHEN limits.monthly_data_transfer_limit_bytes IS NULL THEN NULL::bigint
      ELSE (limits.monthly_data_transfer_limit_bytes::numeric + usage.purchased_credit_bytes::numeric)::bigint
    END,
    usage.transfer_period_start,
    limits.monthly_data_transfer_limit_bytes,
    usage.purchased_credit_bytes,
    CASE
      WHEN limits.monthly_data_transfer_limit_bytes IS NULL THEN NULL::bigint
      ELSE (limits.monthly_data_transfer_limit_bytes::numeric + usage.purchased_credit_bytes::numeric)::bigint
    END,
    workspace_row.usage_limit_locked
  FROM public.workspace_usage AS usage
  INNER JOIN public.workspace_usage_limits AS limits
    ON limits.workspace_id = usage.workspace_id
  INNER JOIN public.workspaces AS workspace_row
    ON workspace_row.id = usage.workspace_id
  WHERE usage.workspace_id = v_usage_owner_id;
END;
$function$;

COMMENT ON FUNCTION public.get_workspace_usage_status(uuid) IS
  'Returns effective charged-usage allowance while exposing recurring base allowance and approved current-cycle credit separately.';

REVOKE ALL ON FUNCTION public.reconcile_workspace_usage_limit_lock(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_workspace_when_transfer_limit_reached(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_workspace_transfer_limit_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_usage_status(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reconcile_workspace_usage_limit_lock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_workspace_when_transfer_limit_reached(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_workspace_data_transfer(uuid, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_usage_status(uuid) TO authenticated, service_role;

-- Billing internals stay outside PostgREST's exposed schema. Only the curated
-- public RPCs below are callable by workspace users or the service-role admin.
CREATE OR REPLACE FUNCTION billing.expire_pending_payment_transactions(
  p_billing_workspace_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $function$
DECLARE
  v_expired_count integer;
BEGIN
  UPDATE billing.payment_transactions AS transaction_row
  SET
    status = 'expired',
    reviewed_by = NULL,
    reviewed_by_label = 'System',
    reviewed_via = 'system-expiry',
    reviewed_at = now(),
    review_note = COALESCE(transaction_row.review_note, 'Payment request expired before review')
  WHERE transaction_row.status = 'pending'
    AND transaction_row.expires_at <= now()
    AND (
      p_billing_workspace_id IS NULL
      OR transaction_row.billing_workspace_id = p_billing_workspace_id
    );

  GET DIAGNOSTICS v_expired_count = ROW_COUNT;
  RETURN v_expired_count;
END;
$function$;

COMMENT ON FUNCTION billing.expire_pending_payment_transactions(uuid) IS
  'Expires stale pending manual-payment submissions. Safe to call repeatedly.';

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
    'amount', p_transaction.amount::text,
    'currency', p_transaction.currency,
    'gb_added', p_transaction.gb_added::text,
    'payment_type', p_transaction.payment_type,
    'status', p_transaction.status,
    'expires_at', p_transaction.expires_at,
    'paid_at', p_transaction.paid_at,
    -- Rejection reasons are user-facing; approval verification notes remain
    -- private to the administrator and the billing audit trail.
    'review_note', CASE
      WHEN p_transaction.status = 'rejected' THEN p_transaction.review_note
      ELSE NULL
    END,
    'created_at', p_transaction.created_at,
    'updated_at', p_transaction.updated_at
  );
$function$;

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

  -- An explicit configuration is authoritative. The usage-limit fallback is
  -- only for legacy workspaces that do not have a payment configuration yet.
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
    WHEN v_usage_renewal_due THEN 'usage_renewal_due'
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
        'renewal_due_at', v_configuration.renewal_due_at
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

COMMENT ON FUNCTION public.get_workspace_payment_summary() IS
  'Returns the authenticated user''s active workspace billing configuration, eligibility, usage state, pending submission, and own recent transaction statuses.';

CREATE OR REPLACE FUNCTION public.submit_workspace_payment(
  p_provider text
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
  v_provider text := lower(btrim(COALESCE(p_provider, '')));
  v_configuration billing.workspace_payment_configurations;
  v_existing billing.payment_transactions;
  v_transaction billing.payment_transactions;
  v_payment_type text;
  v_gb_added numeric(14, 6) := 0;
  v_gb_added_bytes_numeric numeric := 0;
  v_gb_added_bytes bigint := 0;
  v_submitted_by_name text;
  v_submitted_by_email text;
BEGIN
  IF v_user_id IS NULL OR v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_authentication_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_provider NOT IN ('fib', 'qicard') THEN
    RAISE EXCEPTION 'unsupported_workspace_payment_provider'
      USING ERRCODE = '22023';
  END IF;

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

  -- Configurations are per active workspace, but branches share an entitlement.
  -- The advisory lock prevents two branches creating pending submissions for the
  -- same source workspace before the partial unique index sees either insert.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('workspace-payment:' || v_billing_workspace_id::text, 0)
  );

  PERFORM billing.expire_pending_payment_transactions(v_billing_workspace_id);

  SELECT configuration_row.*
  INTO v_configuration
  FROM billing.workspace_payment_configurations AS configuration_row
  WHERE configuration_row.workspace_id = v_workspace_id
  FOR UPDATE;

  IF v_configuration.id IS NULL THEN
    RAISE EXCEPTION 'workspace_payment_configuration_missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_configuration.is_payment_enabled THEN
    RAISE EXCEPTION 'workspace_payments_disabled'
      USING ERRCODE = '42501';
  END IF;

  IF v_configuration.currency <> 'IQD'
    OR v_configuration.subscription_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_workspace_payment_configuration'
      USING ERRCODE = '23514';
  END IF;

  SELECT transaction_row.*
  INTO v_existing
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.billing_workspace_id = v_billing_workspace_id
    AND transaction_row.status = 'pending'
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id = v_user_id THEN
      RETURN billing.payment_transaction_public_json(v_existing);
    END IF;

    RAISE EXCEPTION 'workspace_payment_already_pending_for_workspace'
      USING ERRCODE = '23505';
  END IF;

  v_payment_type := CASE
    WHEN v_configuration.usage_enabled THEN 'usage'
    ELSE 'subscription'
  END;

  IF v_payment_type = 'usage' THEN
    v_gb_added := v_configuration.gb_per_payment;
    v_gb_added_bytes_numeric := v_gb_added * 1000000000::numeric;

    IF v_gb_added <= 0
      OR trunc(v_gb_added_bytes_numeric) <> v_gb_added_bytes_numeric
      OR v_gb_added_bytes_numeric > 9223372036854775807::numeric THEN
      RAISE EXCEPTION 'invalid_workspace_payment_gb_configuration'
        USING ERRCODE = '22003';
    END IF;

    v_gb_added_bytes := v_gb_added_bytes_numeric::bigint;
  END IF;

  SELECT profile_row.name, auth_user.email
  INTO v_submitted_by_name, v_submitted_by_email
  FROM auth.users AS auth_user
  LEFT JOIN public.profiles AS profile_row
    ON profile_row.id = auth_user.id
  WHERE auth_user.id = v_user_id;

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
    gb_added_bytes
  )
  VALUES (
    v_workspace_id,
    v_billing_workspace_id,
    v_user_id,
    v_submitted_by_name,
    v_submitted_by_email,
    v_provider,
    v_payment_type,
    v_configuration.subscription_amount,
    v_configuration.currency,
    v_gb_added,
    v_gb_added_bytes
  )
  RETURNING * INTO v_transaction;

  RETURN billing.payment_transaction_public_json(v_transaction);
END;
$function$;

COMMENT ON FUNCTION public.submit_workspace_payment(text) IS
  'Creates one server-priced pending manual-payment submission for the authenticated user''s active workspace. Repeated submissions by the same user are idempotent while pending.';

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

COMMENT ON FUNCTION public.admin_list_workspace_payment_configurations() IS
  'Service-role-only list of all active workspaces, including workspaces that do not have billing configuration yet.';

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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'workspace-branch-payment-owner:' || p_workspace_id::text,
      0
    )
  );

  v_billing_workspace_id := public.workspace_usage_owner_id(p_workspace_id);
  -- Submission and review take the payment-family lock before the
  -- configuration-family lock. Mode changes join that same order so the
  -- pending snapshot check below is stable and cannot deadlock approval.
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

  -- Workspace status propagation locks source workspaces before descendants.
  -- Lock the complete family in that same root-to-leaf order. Locking only the
  -- owner and selected leaf can deadlock a concurrent update that already owns
  -- an intermediate branch row and is propagating status toward that leaf.
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

  -- A branch family shares entitlement and lock state. Permit the validated
  -- admin RPC to change that shared mode atomically; the row trigger still
  -- rejects partial/direct changes outside this controlled path.
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

  -- Saving any family member provisions every existing source/branch workspace
  -- with its own configuration. The copied values are only defaults; price,
  -- availability, and GB remain independently editable afterward.
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

  -- A mode toggle applies to the whole family in this transaction. Preserve
  -- each sibling's price and availability; when enabling usage, seed only a
  -- missing GB value and synchronize the paid-through boundary.
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

  -- Do not leave the trigger bypass enabled for a caller that wraps several
  -- administrative operations in one database transaction.
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

COMMENT ON FUNCTION public.admin_upsert_workspace_payment_configuration(uuid, text, boolean, boolean, text, text) IS
  'Service-role-only validated create/update for a workspace billing configuration. It provisions missing family configurations and changes the shared usage mode atomically.';

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

COMMENT ON FUNCTION public.admin_list_workspace_payment_transactions(text) IS
  'Service-role-only manual-payment review list with workspace and submitter labels.';

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
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_reviewer_label text := COALESCE(
    NULLIF(btrim(COALESCE(p_reviewer_label, '')), ''),
    'Platform administrator'
  );
  v_provider_payment_id text := NULLIF(btrim(COALESCE(p_provider_payment_id, '')), '');
  v_billing_workspace_id uuid;
  v_transaction billing.payment_transactions;
  v_base_allowance bigint;
  v_current_credit bigint;
  v_new_credit bigint;
  v_subscription_expires_at timestamptz;
  v_current_renewal_due_at timestamptz;
  v_renewal_due_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'workspace_payment_admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'payment_transaction_id_required'
      USING ERRCODE = '22023';
  END IF;

  IF v_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_workspace_payment_review_decision'
      USING ERRCODE = '22023';
  END IF;

  IF v_provider_payment_id IS NOT NULL AND length(v_provider_payment_id) > 255 THEN
    RAISE EXCEPTION 'provider_payment_id_too_long'
      USING ERRCODE = '22023';
  END IF;

  SELECT transaction_row.billing_workspace_id
  INTO v_billing_workspace_id
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.id = p_transaction_id;

  IF v_billing_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_payment_transaction_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Usage approval may insert a workspace_usage_limits row, whose trigger
  -- participates in branch-owner serialization. Take the owner/member lock
  -- before the family payment lock so review, submit, configuration, and
  -- branch attachment all use one acyclic lock order.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'workspace-branch-payment-owner:' || v_billing_workspace_id::text,
      0
    )
  );

  -- Submission takes this family-scoped lock before it locks configuration or
  -- transaction rows. Review must take the same lock first so a repeated
  -- confirmation racing an administrator review cannot invert row-lock order.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('workspace-payment:' || v_billing_workspace_id::text, 0)
  );

  SELECT transaction_row.*
  INTO v_transaction
  FROM billing.payment_transactions AS transaction_row
  WHERE transaction_row.id = p_transaction_id
  FOR UPDATE;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'workspace_payment_transaction_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_transaction.status = 'pending' AND v_transaction.expires_at <= now() THEN
    UPDATE billing.payment_transactions AS transaction_row
    SET
      status = 'expired',
      reviewed_by = auth.uid(),
      reviewed_by_label = v_reviewer_label,
      reviewed_via = 'admin-dashboard',
      reviewed_at = now(),
      review_note = COALESCE(v_note, 'Payment request expired before review'),
      provider_payment_id = COALESCE(v_provider_payment_id, transaction_row.provider_payment_id)
    WHERE transaction_row.id = v_transaction.id
    RETURNING * INTO v_transaction;

    RETURN billing.payment_transaction_public_json(v_transaction)
      || jsonb_build_object(
        'success', false,
        'entitlement_applied', false,
        'message', 'Payment request has expired'
      );
  END IF;

  IF v_transaction.status <> 'pending' THEN
    RAISE EXCEPTION 'workspace_payment_transaction_already_reviewed'
      USING ERRCODE = '23514',
        DETAIL = 'Only pending payment transactions can be approved or rejected.';
  END IF;

  IF v_decision = 'rejected' THEN
    UPDATE billing.payment_transactions AS transaction_row
    SET
      status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_by_label = v_reviewer_label,
      reviewed_via = 'admin-dashboard',
      reviewed_at = now(),
      review_note = v_note,
      provider_payment_id = COALESCE(v_provider_payment_id, transaction_row.provider_payment_id)
    WHERE transaction_row.id = v_transaction.id
    RETURNING * INTO v_transaction;

    RETURN billing.payment_transaction_public_json(v_transaction)
      || jsonb_build_object(
        'success', true,
        'entitlement_applied', false
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

    -- Metering and administrative usage writers lock workspace_usage before
    -- their AFTER trigger reconciles the workspace row (U -> W). Serialize a
    -- rare manual usage approval against those writers before this branch
    -- touches W. EXCLUSIVE is required because it also conflicts with the ROW
    -- SHARE lock taken by SELECT ... FOR UPDATE before a meter upgrades to an
    -- UPDATE; ordinary ACCESS SHARE readers remain available.
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

    -- Source and branch workspaces retain their own price/GB settings, while
    -- the paid-through boundary follows their shared usage entitlement.
    UPDATE billing.workspace_payment_configurations AS configuration_row
    SET
      renewal_due_at = v_renewal_due_at,
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
    reviewed_via = 'admin-dashboard',
    reviewed_at = now(),
    review_note = v_note,
    provider_payment_id = COALESCE(v_provider_payment_id, transaction_row.provider_payment_id)
  WHERE transaction_row.id = v_transaction.id
  RETURNING * INTO v_transaction;

  RETURN billing.payment_transaction_public_json(v_transaction)
    || jsonb_build_object(
      'success', true,
      'entitlement_applied', true,
      'subscription_expires_at', v_subscription_expires_at,
      'renewal_due_at', v_renewal_due_at,
      'purchased_credit_bytes', v_new_credit
    );
END;
$function$;

COMMENT ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text) IS
  'Atomically moves one pending payment to approved/rejected. Approval applies the transaction snapshot exactly once under a row lock.';

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'expire-workspace-payment-transactions',
      'reconcile-workspace-payment-renewal-locks'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$do$;

SELECT cron.schedule(
  'expire-workspace-payment-transactions',
  '*/15 * * * *',
  $$SELECT billing.expire_pending_payment_transactions(NULL);$$
);

SELECT cron.schedule(
  'reconcile-workspace-payment-renewal-locks',
  '*/15 * * * *',
  $$SELECT billing.reconcile_all_workspace_payment_renewal_locks();$$
);

REVOKE ALL ON FUNCTION billing.expire_pending_payment_transactions(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION billing.payment_transaction_public_json(billing.payment_transactions)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION billing.next_workspace_usage_renewal_due(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION billing.reconcile_workspace_payment_renewal_lock(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION billing.reconcile_all_workspace_payment_renewal_locks()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION billing.reconcile_payment_renewal_lock_from_configuration()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing.expire_pending_payment_transactions(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION billing.payment_transaction_public_json(billing.payment_transactions)
  TO service_role;
GRANT EXECUTE ON FUNCTION billing.next_workspace_usage_renewal_due(uuid, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION billing.reconcile_workspace_payment_renewal_lock(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION billing.reconcile_all_workspace_payment_renewal_locks()
  TO service_role;

REVOKE ALL ON FUNCTION public.get_workspace_payment_summary()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_workspace_payment(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_payment_summary()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_workspace_payment(text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_list_workspace_payment_configurations()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_workspace_payment_configuration(uuid, text, boolean, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_workspace_payment_transactions(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_list_workspace_payment_configurations()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_workspace_payment_configuration(uuid, text, boolean, boolean, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_workspace_payment_transactions(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_workspace_payment_transaction(uuid, text, text, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
