-- Account identity is configuration, not a financial posting. Movements remain
-- derived exclusively from payment_transactions.

ALTER TABLE payment_accounts.accounts
  ADD COLUMN IF NOT EXISTS icon_key text NOT NULL DEFAULT 'cash_drawer',
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_default_for_payment_selector boolean NOT NULL DEFAULT false;

UPDATE payment_accounts.accounts
SET icon_key = CASE account_type
  WHEN 'bank_account' THEN 'bank'
  WHEN 'digital_wallet' THEN 'wallet'
  WHEN 'other' THEN 'card'
  ELSE 'cash_drawer'
END
WHERE icon_key = 'cash_drawer'
  AND account_type <> 'cash_drawer';

UPDATE payment_accounts.accounts
SET is_primary = false,
    is_default_for_payment_selector = false
WHERE is_deleted OR NOT is_active;

-- Make existing workspaces deterministic before applying the one-primary rule.
WITH ranked_accounts AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY workspace_id
           ORDER BY created_at ASC, name ASC, id ASC
         ) AS primary_position
  FROM payment_accounts.accounts
  WHERE NOT is_deleted AND is_active
)
UPDATE payment_accounts.accounts AS account
SET is_primary = ranked_accounts.primary_position = 1
FROM ranked_accounts
WHERE account.id = ranked_accounts.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_accounts_icon_key_check'
      AND conrelid = 'payment_accounts.accounts'::regclass
  ) THEN
    ALTER TABLE payment_accounts.accounts
      ADD CONSTRAINT payment_accounts_icon_key_check CHECK (
        icon_key IN (
          'cash_drawer', 'bank', 'wallet', 'card', 'phone', 'transfer', 'coins',
          'receipt', 'building', 'store', 'fib', 'qicard', 'zaincash', 'fastpay'
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_one_primary_per_workspace
  ON payment_accounts.accounts (workspace_id)
  WHERE is_primary AND is_active AND NOT is_deleted;

CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_one_selector_default_per_workspace
  ON payment_accounts.accounts (workspace_id)
  WHERE is_default_for_payment_selector AND is_active AND NOT is_deleted;

CREATE OR REPLACE FUNCTION payment_accounts.apply_account_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, payment_accounts
AS $$
BEGIN
  IF NEW.is_deleted OR NOT NEW.is_active THEN
    NEW.is_primary := false;
    NEW.is_default_for_payment_selector := false;
    RETURN NEW;
  END IF;

  IF NEW.is_primary THEN
    -- A primary switch is one logical operation. Suppress the fallback trigger
    -- while the previous primary is being cleared.
    PERFORM set_config('payment_accounts.primary_transfer', 'on', true);
    UPDATE payment_accounts.accounts
    SET is_primary = false
    WHERE workspace_id = NEW.workspace_id
      AND id <> NEW.id
      AND is_primary
      AND is_active
      AND NOT is_deleted;
    PERFORM set_config('payment_accounts.primary_transfer', '', true);
  ELSIF NOT EXISTS (
    SELECT 1
    FROM payment_accounts.accounts
    WHERE workspace_id = NEW.workspace_id
      AND id <> NEW.id
      AND is_primary
      AND is_active
      AND NOT is_deleted
  ) THEN
    -- The first usable account is primary automatically.
    NEW.is_primary := true;
  END IF;

  IF NEW.is_default_for_payment_selector THEN
    UPDATE payment_accounts.accounts
    SET is_default_for_payment_selector = false
    WHERE workspace_id = NEW.workspace_id
      AND id <> NEW.id
      AND is_default_for_payment_selector
      AND is_active
      AND NOT is_deleted;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION payment_accounts.restore_primary_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, payment_accounts
AS $$
DECLARE
  fallback_account_id uuid;
BEGIN
  IF current_setting('payment_accounts.primary_transfer', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payment_accounts.accounts
    WHERE workspace_id = NEW.workspace_id
      AND is_primary
      AND is_active
      AND NOT is_deleted
  ) THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO fallback_account_id
  FROM payment_accounts.accounts
  WHERE workspace_id = NEW.workspace_id
    AND is_active
    AND NOT is_deleted
  ORDER BY created_at ASC, name ASC, id ASC
  LIMIT 1;

  IF fallback_account_id IS NOT NULL THEN
    UPDATE payment_accounts.accounts
    SET is_primary = true
    WHERE id = fallback_account_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION payment_accounts.prevent_account_removal_with_open_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, payment_accounts
AS $$
BEGIN
  IF NEW.is_deleted
    AND NOT OLD.is_deleted
    AND EXISTS (
      SELECT 1
      FROM payment_accounts.cashier_shifts
      WHERE workspace_id = OLD.workspace_id
        AND account_id = OLD.id
        AND status = 'open'
        AND NOT is_deleted
    ) THEN
    RAISE EXCEPTION 'Close the open cashier shift before removing this account.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_accounts_apply_account_flags ON payment_accounts.accounts;
CREATE TRIGGER payment_accounts_apply_account_flags
  BEFORE INSERT OR UPDATE OF is_primary, is_default_for_payment_selector, is_active, is_deleted
  ON payment_accounts.accounts
  FOR EACH ROW
  EXECUTE FUNCTION payment_accounts.apply_account_flags();

DROP TRIGGER IF EXISTS payment_accounts_restore_primary_account ON payment_accounts.accounts;
CREATE TRIGGER payment_accounts_restore_primary_account
  AFTER INSERT OR UPDATE OF is_primary, is_active, is_deleted
  ON payment_accounts.accounts
  FOR EACH ROW
  EXECUTE FUNCTION payment_accounts.restore_primary_account();

DROP TRIGGER IF EXISTS payment_accounts_prevent_account_removal_with_open_shift ON payment_accounts.accounts;
CREATE TRIGGER payment_accounts_prevent_account_removal_with_open_shift
  BEFORE UPDATE OF is_deleted
  ON payment_accounts.accounts
  FOR EACH ROW
  EXECUTE FUNCTION payment_accounts.prevent_account_removal_with_open_shift();
