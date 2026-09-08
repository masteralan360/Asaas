-- Capital pools are live reporting groups only. They never store a balance or
-- create a payment transaction; account_ids points at the payment accounts
-- whose current posted balances are projected by the client.
CREATE TABLE payment_accounts.capital_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  currency text NOT NULL,
  account_ids uuid[] NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT capital_pools_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT capital_pools_name_length CHECK (length(name) <= 120),
  CONSTRAINT capital_pools_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT capital_pools_minimum_accounts CHECK (is_deleted OR cardinality(account_ids) >= 2)
);

CREATE UNIQUE INDEX capital_pools_workspace_name_unique
  ON payment_accounts.capital_pools (workspace_id, lower(btrim(name)))
  WHERE NOT is_deleted;

CREATE INDEX capital_pools_workspace_currency
  ON payment_accounts.capital_pools (workspace_id, currency)
  WHERE NOT is_deleted;

CREATE INDEX capital_pools_account_ids_gin
  ON payment_accounts.capital_pools USING gin (account_ids)
  WHERE NOT is_deleted;

CREATE OR REPLACE FUNCTION payment_accounts.can_manage_capital_pools(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    public.current_user_role() = 'admin'
    OR (
      public.current_user_role() = 'staff'
      AND (
        NOT public.workspace_capability_allowed(
          p_workspace_id,
          (SELECT workspace.plan::text FROM public.workspaces workspace WHERE workspace.id = p_workspace_id),
          'workspaceManagementPermissions'
        )
        OR EXISTS (
          SELECT 1
          FROM public.workspace_permissions permission
          WHERE permission.workspace_id = p_workspace_id
            AND permission.user_uuid = auth.uid()
            AND permission.key = 'paymentAccounts.manageCapitalPools'
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION payment_accounts.can_manage_capital_pools(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION payment_accounts.can_manage_capital_pools(uuid) TO authenticated, service_role;

-- Resolve currency overrides with the same server-side visibility guarantees
-- as payment_accounts.module_allowed(). Client-side availability remains a
-- usability check; this function is the authoritative write boundary.
CREATE OR REPLACE FUNCTION payment_accounts.currency_allowed(
  p_workspace_id uuid,
  p_currency text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_plan text;
  v_override text;
BEGIN
  SELECT workspace.plan::text
  INTO v_plan
  FROM public.workspaces workspace
  WHERE workspace.id = p_workspace_id
    AND workspace.deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN false;
  END IF;

  SELECT override.value
  INTO v_override
  FROM public.workspace_access_overrides override
  WHERE override.workspace_id = p_workspace_id
    AND override.type = 'currency'
    AND lower(override.key) = lower(p_currency)
  LIMIT 1;

  IF FOUND THEN
    RETURN coalesce(v_override, 'grant') = 'grant';
  END IF;

  RETURN public.workspace_plan_allows_currency(v_plan, p_currency);
END;
$function$;

REVOKE ALL ON FUNCTION payment_accounts.currency_allowed(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION payment_accounts.currency_allowed(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION payment_accounts.validate_capital_pool()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, payment_accounts
AS $function$
DECLARE
  v_new_lock_key bigint;
  v_old_lock_key bigint;
  v_valid_account_count integer;
  v_conflicting_account_name text;
  v_conflicting_pool_name text;
  v_requires_currency_check boolean;
  v_account_id uuid;
  v_lock_account_ids uuid[];
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.currency := lower(NEW.currency);

  v_requires_currency_check := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    v_requires_currency_check :=
      NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR (OLD.is_deleted AND NOT NEW.is_deleted);
  END IF;

  IF v_requires_currency_check THEN
    IF NOT payment_accounts.currency_allowed(NEW.workspace_id, NEW.currency) THEN
      RAISE EXCEPTION 'CAPITAL_POOL_CURRENCY_DISABLED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Serialize every membership decision for a workspace and currency. When
  -- two clients race, the first committed save wins and the later one sees it.
  v_new_lock_key := hashtextextended(NEW.workspace_id::text || ':' || NEW.currency, 0);
  v_old_lock_key := CASE
    WHEN TG_OP = 'UPDATE'
    THEN hashtextextended(OLD.workspace_id::text || ':' || OLD.currency, 0)
    ELSE v_new_lock_key
  END;
  PERFORM pg_advisory_xact_lock(least(v_new_lock_key, v_old_lock_key));
  IF v_new_lock_key <> v_old_lock_key THEN
    PERFORM pg_advisory_xact_lock(greatest(v_new_lock_key, v_old_lock_key));
  END IF;

  -- Share per-account locks with the account-removal trigger. This closes the
  -- race where a pool save and an account deactivation could otherwise both
  -- validate an old snapshot and then commit incompatible states.
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(DISTINCT selected.account_id ORDER BY selected.account_id)
    INTO v_lock_account_ids
    FROM unnest(NEW.account_ids || OLD.account_ids) selected(account_id);
  ELSE
    SELECT array_agg(DISTINCT selected.account_id ORDER BY selected.account_id)
    INTO v_lock_account_ids
    FROM unnest(NEW.account_ids) selected(account_id);
  END IF;

  FOREACH v_account_id IN ARRAY coalesce(v_lock_account_ids, ARRAY[]::uuid[]) LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('capital-pool-account:' || NEW.workspace_id::text || ':' || v_account_id::text, 0)
    );
  END LOOP;

  -- A soft deletion immediately releases every membership and must remain
  -- possible even if an old record predates the current validation rules.
  IF NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.account_ids) selected(account_id)
    GROUP BY selected.account_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CAPITAL_POOL_DUPLICATE_ACCOUNT'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
  INTO v_valid_account_count
  FROM payment_accounts.accounts account
  WHERE account.id = ANY(NEW.account_ids)
    AND account.workspace_id = NEW.workspace_id
    AND account.is_active
    AND NOT account.is_deleted;

  IF v_valid_account_count <> cardinality(NEW.account_ids) THEN
    RAISE EXCEPTION 'CAPITAL_POOL_ACTIVE_ACCOUNTS_REQUIRED'
      USING ERRCODE = '23503';
  END IF;

  SELECT account.name, pool.name
  INTO v_conflicting_account_name, v_conflicting_pool_name
  FROM payment_accounts.capital_pools pool
  CROSS JOIN LATERAL unnest(pool.account_ids) member(account_id)
  JOIN payment_accounts.accounts account ON account.id = member.account_id
  WHERE pool.workspace_id = NEW.workspace_id
    AND pool.currency = NEW.currency
    AND pool.id <> NEW.id
    AND NOT pool.is_deleted
    AND member.account_id = ANY(NEW.account_ids)
  ORDER BY account.name, pool.name, pool.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'CAPITAL_POOL_ACCOUNT_CONFLICT',
      DETAIL = json_build_object(
        'account_name', v_conflicting_account_name,
        'pool_name', v_conflicting_pool_name,
        'currency', NEW.currency
      )::text;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER capital_pools_validate
  BEFORE INSERT OR UPDATE OF workspace_id, name, currency, account_ids, is_deleted
  ON payment_accounts.capital_pools
  FOR EACH ROW
  EXECUTE FUNCTION payment_accounts.validate_capital_pool();

CREATE OR REPLACE FUNCTION payment_accounts.prevent_pooled_account_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, payment_accounts
AS $function$
DECLARE
  v_pool_name text;
  v_pool_currency text;
BEGIN
  IF (OLD.is_active AND NOT NEW.is_active)
    OR (NOT OLD.is_deleted AND NEW.is_deleted)
  THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('capital-pool-account:' || OLD.workspace_id::text || ':' || OLD.id::text, 0)
    );

    SELECT pool.name, pool.currency
    INTO v_pool_name, v_pool_currency
    FROM payment_accounts.capital_pools pool
    WHERE pool.workspace_id = OLD.workspace_id
      AND OLD.id = ANY(pool.account_ids)
      AND NOT pool.is_deleted
    ORDER BY pool.name, pool.id
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'CAPITAL_POOL_ACCOUNT_IN_USE',
        DETAIL = json_build_object(
          'pool_name', v_pool_name,
          'currency', v_pool_currency
        )::text;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER payment_accounts_prevent_pooled_account_removal
  BEFORE UPDATE OF is_active, is_deleted
  ON payment_accounts.accounts
  FOR EACH ROW
  EXECUTE FUNCTION payment_accounts.prevent_pooled_account_removal();

ALTER TABLE payment_accounts.capital_pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY capital_pools_select
  ON payment_accounts.capital_pools
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
  );

CREATE POLICY capital_pools_insert
  ON payment_accounts.capital_pools
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.can_manage_capital_pools(workspace_id)
  );

CREATE POLICY capital_pools_update
  ON payment_accounts.capital_pools
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.can_manage_capital_pools(workspace_id)
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.can_manage_capital_pools(workspace_id)
  );

CREATE POLICY capital_pools_delete
  ON payment_accounts.capital_pools
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND payment_accounts.module_allowed(workspace_id, 'payment_accounts')
    AND payment_accounts.can_manage_capital_pools(workspace_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_accounts.capital_pools TO authenticated;
GRANT ALL ON payment_accounts.capital_pools TO service_role;

REVOKE ALL ON FUNCTION payment_accounts.validate_capital_pool() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION payment_accounts.prevent_pooled_account_removal() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
