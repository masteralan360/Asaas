-- Activities is an Admin-granted workspace module.  Its business data lives
-- outside public alongside the other workspace-scoped modules.
CREATE SCHEMA IF NOT EXISTS activities;

REVOKE ALL ON SCHEMA activities FROM anon;
GRANT USAGE ON SCHEMA activities TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA activities TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA activities TO authenticated, service_role;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA activities TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA activities REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA activities REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA activities REVOKE ALL ON ROUTINES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA activities GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA activities GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA activities GRANT EXECUTE ON ROUTINES TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS activities.activity_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  default_unit_price numeric NOT NULL,
  currency text NOT NULL,
  is_infinite boolean NOT NULL DEFAULT true,
  available_quantity numeric NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT activity_catalog_name_not_blank CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT activity_catalog_price_nonnegative CHECK (default_unit_price >= 0),
  CONSTRAINT activity_catalog_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT activity_catalog_availability_check CHECK (
    (is_infinite = true AND available_quantity IS NULL)
    OR (is_infinite = false AND available_quantity IS NOT NULL AND available_quantity >= 0)
  )
);

CREATE TABLE IF NOT EXISTS activities.activity_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  transaction_no text NOT NULL,
  name text NOT NULL,
  customer_name text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  currency text NOT NULL,
  payment_method text NOT NULL,
  subtotal_amount numeric NOT NULL,
  total_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz NULL,
  refunded_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT activity_transactions_no_not_blank CHECK (char_length(btrim(transaction_no)) > 0),
  CONSTRAINT activity_transactions_name_not_blank CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT activity_transactions_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT activity_transactions_amount_check CHECK (subtotal_amount >= 0 AND total_amount > 0),
  CONSTRAINT activity_transactions_status_check CHECK (status IN ('completed', 'cancelled', 'refunded')),
  CONSTRAINT activity_transactions_cancelled_at_check CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT activity_transactions_refunded_at_check CHECK (status <> 'refunded' OR refunded_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS activities.activity_transaction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES activities.activity_transactions(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES activities.activity_catalog(id) ON DELETE RESTRICT,
  activity_name_snapshot text NOT NULL,
  catalog_unit_price_snapshot numeric NOT NULL,
  unit_price numeric NOT NULL,
  price_overridden boolean NOT NULL DEFAULT false,
  quantity numeric NOT NULL,
  line_total numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT activity_transaction_lines_name_not_blank CHECK (char_length(btrim(activity_name_snapshot)) > 0),
  CONSTRAINT activity_transaction_lines_price_nonnegative CHECK (catalog_unit_price_snapshot >= 0 AND unit_price >= 0),
  CONSTRAINT activity_transaction_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT activity_transaction_lines_total_nonnegative CHECK (line_total >= 0),
  CONSTRAINT activity_transaction_lines_total_matches_unit_price CHECK (line_total = unit_price * quantity)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_activity_transactions_workspace_no
  ON activities.activity_transactions (workspace_id, transaction_no)
  WHERE is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS ux_activity_catalog_workspace_active_name
  ON activities.activity_catalog (workspace_id, lower(btrim(name)))
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_activity_catalog_workspace_active
  ON activities.activity_catalog (workspace_id, is_active)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_activity_transactions_workspace_occurred
  ON activities.activity_transactions (workspace_id, occurred_at DESC)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_activity_transactions_workspace_status
  ON activities.activity_transactions (workspace_id, status)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_activity_transaction_lines_transaction
  ON activities.activity_transaction_lines (transaction_id)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_activity_transaction_lines_workspace_activity
  ON activities.activity_transaction_lines (workspace_id, activity_id)
  WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION activities.module_allowed(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.workspace_module_allowed(
    p_workspace_id,
    (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = p_workspace_id),
    'activities'
  );
$function$;

CREATE OR REPLACE FUNCTION activities.permission_allowed(p_workspace_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    activities.module_allowed(p_workspace_id)
    AND (
      public.current_user_role() = 'admin'
      OR NOT public.workspace_capability_allowed(
        p_workspace_id,
        (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = p_workspace_id),
        'workspaceManagementPermissions'
      )
      OR EXISTS (
        SELECT 1
        FROM public.workspace_permissions AS permission
        WHERE permission.workspace_id = p_workspace_id
          AND permission.user_uuid = auth.uid()
          AND permission.key = p_permission_key
      )
    );
$function$;

CREATE OR REPLACE FUNCTION activities.enforce_line_workspace_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, activities
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM activities.activity_transactions AS transaction
    WHERE transaction.id = NEW.transaction_id
      AND transaction.workspace_id = NEW.workspace_id
      AND transaction.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Activity line must reference a transaction in the same workspace' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM activities.activity_catalog AS activity
    WHERE activity.id = NEW.activity_id
      AND activity.workspace_id = NEW.workspace_id
      AND activity.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Activity line must reference an activity in the same workspace' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION activities.adjust_activity_availability(
  p_workspace_id uuid,
  p_activity_id uuid,
  p_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, activities
AS $function$
DECLARE
  v_is_infinite boolean;
BEGIN
  SELECT is_infinite INTO v_is_infinite
  FROM activities.activity_catalog
  WHERE id = p_activity_id
    AND workspace_id = p_workspace_id
    AND is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity is not available' USING ERRCODE = '23514';
  END IF;
  IF v_is_infinite THEN
    RETURN;
  END IF;

  UPDATE activities.activity_catalog
  SET available_quantity = available_quantity + p_delta,
      updated_at = now(),
      version = version + 1
  WHERE id = p_activity_id
    AND workspace_id = p_workspace_id
    AND available_quantity + p_delta >= 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient activity availability' USING ERRCODE = '23514';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION activities.apply_line_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, activities
AS $function$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status
    FROM activities.activity_transactions
    WHERE id = OLD.transaction_id;
  ELSE
    SELECT status INTO v_status
    FROM activities.activity_transactions
    WHERE id = NEW.transaction_id;
  END IF;

  IF v_status IS DISTINCT FROM 'completed' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM activities.adjust_activity_availability(NEW.workspace_id, NEW.activity_id, -NEW.quantity);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM activities.adjust_activity_availability(OLD.workspace_id, OLD.activity_id, OLD.quantity);
    RETURN OLD;
  END IF;

  IF NEW.activity_id IS DISTINCT FROM OLD.activity_id OR NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    PERFORM activities.adjust_activity_availability(OLD.workspace_id, OLD.activity_id, OLD.quantity);
    PERFORM activities.adjust_activity_availability(NEW.workspace_id, NEW.activity_id, -NEW.quantity);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION activities.apply_transaction_status_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, activities
AS $function$
DECLARE
  line_item record;
BEGIN
  IF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
    FOR line_item IN
      SELECT activity_id, quantity FROM activities.activity_transaction_lines
      WHERE transaction_id = OLD.id AND is_deleted = false
    LOOP
      PERFORM activities.adjust_activity_availability(OLD.workspace_id, line_item.activity_id, line_item.quantity);
    END LOOP;
  ELSIF OLD.status <> 'completed' AND NEW.status = 'completed' THEN
    FOR line_item IN
      SELECT activity_id, quantity FROM activities.activity_transaction_lines
      WHERE transaction_id = NEW.id AND is_deleted = false
    LOOP
      PERFORM activities.adjust_activity_availability(NEW.workspace_id, line_item.activity_id, -line_item.quantity);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION activities.restore_transaction_availability_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, activities
AS $function$
DECLARE
  line_item record;
BEGIN
  IF OLD.status = 'completed' THEN
    FOR line_item IN
      SELECT activity_id, quantity FROM activities.activity_transaction_lines
      WHERE transaction_id = OLD.id AND is_deleted = false
    LOOP
      PERFORM activities.adjust_activity_availability(OLD.workspace_id, line_item.activity_id, line_item.quantity);
    END LOOP;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION activities.enforce_workspace_default_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, activities
AS $function$
DECLARE
  v_default_currency text;
BEGIN
  SELECT default_currency::text INTO v_default_currency
  FROM public.workspaces
  WHERE id = NEW.workspace_id;

  IF v_default_currency IS NULL OR NEW.currency <> v_default_currency THEN
    RAISE EXCEPTION 'Activities must use the workspace default currency' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_activity_line_workspace_links ON activities.activity_transaction_lines;
CREATE TRIGGER enforce_activity_line_workspace_links
  BEFORE INSERT OR UPDATE ON activities.activity_transaction_lines
  FOR EACH ROW EXECUTE FUNCTION activities.enforce_line_workspace_links();
DROP TRIGGER IF EXISTS apply_activity_line_availability ON activities.activity_transaction_lines;
CREATE TRIGGER apply_activity_line_availability
  AFTER INSERT OR UPDATE OR DELETE ON activities.activity_transaction_lines
  FOR EACH ROW EXECUTE FUNCTION activities.apply_line_availability();
DROP TRIGGER IF EXISTS apply_activity_transaction_status_availability ON activities.activity_transactions;
CREATE TRIGGER apply_activity_transaction_status_availability
  AFTER UPDATE OF status ON activities.activity_transactions
  FOR EACH ROW EXECUTE FUNCTION activities.apply_transaction_status_availability();
DROP TRIGGER IF EXISTS restore_activity_transaction_availability_before_delete ON activities.activity_transactions;
CREATE TRIGGER restore_activity_transaction_availability_before_delete
  BEFORE DELETE ON activities.activity_transactions
  FOR EACH ROW EXECUTE FUNCTION activities.restore_transaction_availability_before_delete();
DROP TRIGGER IF EXISTS enforce_activity_catalog_workspace_currency ON activities.activity_catalog;
CREATE TRIGGER enforce_activity_catalog_workspace_currency
  BEFORE INSERT OR UPDATE OF currency, workspace_id ON activities.activity_catalog
  FOR EACH ROW EXECUTE FUNCTION activities.enforce_workspace_default_currency();
DROP TRIGGER IF EXISTS enforce_activity_transaction_workspace_currency ON activities.activity_transactions;
CREATE TRIGGER enforce_activity_transaction_workspace_currency
  BEFORE INSERT OR UPDATE OF currency, workspace_id ON activities.activity_transactions
  FOR EACH ROW EXECUTE FUNCTION activities.enforce_workspace_default_currency();

DROP TRIGGER IF EXISTS update_activity_catalog_updated_at ON activities.activity_catalog;
CREATE TRIGGER update_activity_catalog_updated_at BEFORE UPDATE ON activities.activity_catalog
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_activity_transactions_updated_at ON activities.activity_transactions;
CREATE TRIGGER update_activity_transactions_updated_at BEFORE UPDATE ON activities.activity_transactions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_activity_transaction_lines_updated_at ON activities.activity_transaction_lines;
CREATE TRIGGER update_activity_transaction_lines_updated_at BEFORE UPDATE ON activities.activity_transaction_lines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enforce_activities_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF (
    (TG_OP = 'DELETE' AND OLD.type = 'module' AND lower(OLD.key) = 'activities')
    OR (TG_OP <> 'DELETE' AND NEW.type = 'module' AND lower(NEW.key) = 'activities')
  ) AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Activities module access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_activities_override_admin_console ON public.workspace_access_overrides;
CREATE TRIGGER enforce_activities_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_activities_override_admin_console();

ALTER TABLE activities.activity_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities.activity_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities.activity_transaction_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY activity_catalog_select ON activities.activity_catalog FOR SELECT TO authenticated
USING (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.access'));
CREATE POLICY activity_catalog_insert ON activities.activity_catalog FOR INSERT TO authenticated
WITH CHECK (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.manageCatalog'));
CREATE POLICY activity_catalog_update ON activities.activity_catalog FOR UPDATE TO authenticated
USING (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.manageCatalog'))
WITH CHECK (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.manageCatalog'));
CREATE POLICY activity_catalog_delete ON activities.activity_catalog FOR DELETE TO authenticated
USING (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.manageCatalog'));

CREATE POLICY activity_transactions_select ON activities.activity_transactions FOR SELECT TO authenticated
USING (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.viewHistory'));
CREATE POLICY activity_transactions_insert ON activities.activity_transactions FOR INSERT TO authenticated
WITH CHECK (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.createTransaction'));
CREATE POLICY activity_transactions_update ON activities.activity_transactions FOR UPDATE TO authenticated
USING (workspace_id = public.current_workspace_id() AND (
  activities.permission_allowed(workspace_id, 'activities.editTransaction')
  OR activities.permission_allowed(workspace_id, 'activities.refundTransaction')
))
WITH CHECK (workspace_id = public.current_workspace_id() AND (
  activities.permission_allowed(workspace_id, 'activities.editTransaction')
  OR activities.permission_allowed(workspace_id, 'activities.refundTransaction')
));
CREATE POLICY activity_transactions_delete ON activities.activity_transactions FOR DELETE TO authenticated
USING (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.deleteTransaction'));

CREATE POLICY activity_transaction_lines_select ON activities.activity_transaction_lines FOR SELECT TO authenticated
USING (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.viewHistory'));
CREATE POLICY activity_transaction_lines_insert ON activities.activity_transaction_lines FOR INSERT TO authenticated
WITH CHECK (workspace_id = public.current_workspace_id() AND (
  activities.permission_allowed(workspace_id, 'activities.createTransaction')
  OR activities.permission_allowed(workspace_id, 'activities.editTransaction')
));
CREATE POLICY activity_transaction_lines_update ON activities.activity_transaction_lines FOR UPDATE TO authenticated
USING (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.editTransaction'))
WITH CHECK (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.editTransaction'));
CREATE POLICY activity_transaction_lines_delete ON activities.activity_transaction_lines FOR DELETE TO authenticated
USING (workspace_id = public.current_workspace_id() AND activities.permission_allowed(workspace_id, 'activities.editTransaction'));

INSERT INTO public.workspace_usage_record_sources (schema_name, table_name, description, enabled)
VALUES ('activities', 'activity_transactions', 'Activities transaction parent records', true)
ON CONFLICT (schema_name, table_name) DO UPDATE
SET description = EXCLUDED.description, enabled = EXCLUDED.enabled, updated_at = timezone('utc', now());

GRANT EXECUTE ON FUNCTION activities.module_allowed(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION activities.permission_allowed(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION activities.adjust_activity_availability(uuid, uuid, numeric) TO authenticated, service_role;
