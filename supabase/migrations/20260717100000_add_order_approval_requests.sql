ALTER TABLE crm.sales_orders
ADD COLUMN IF NOT EXISTS approval_status text NULL,
ADD COLUMN IF NOT EXISTS approval_requested_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS approval_requested_at timestamp with time zone NULL,
ADD COLUMN IF NOT EXISTS approval_reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS approval_reviewed_at timestamp with time zone NULL;

ALTER TABLE crm.purchase_orders
ADD COLUMN IF NOT EXISTS approval_status text NULL,
ADD COLUMN IF NOT EXISTS approval_requested_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS approval_requested_at timestamp with time zone NULL,
ADD COLUMN IF NOT EXISTS approval_reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS approval_reviewed_at timestamp with time zone NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crm_sales_orders_approval_status_check'
      AND conrelid = 'crm.sales_orders'::regclass
  ) THEN
    ALTER TABLE crm.sales_orders
    ADD CONSTRAINT crm_sales_orders_approval_status_check
    CHECK (approval_status IS NULL OR approval_status IN ('requested', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crm_purchase_orders_approval_status_check'
      AND conrelid = 'crm.purchase_orders'::regclass
  ) THEN
    ALTER TABLE crm.purchase_orders
    ADD CONSTRAINT crm_purchase_orders_approval_status_check
    CHECK (approval_status IS NULL OR approval_status IN ('requested', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_sales_orders_workspace_approval_status
  ON crm.sales_orders (workspace_id, approval_status, updated_at DESC)
  WHERE COALESCE(is_deleted, false) = false;

CREATE INDEX IF NOT EXISTS idx_crm_purchase_orders_workspace_approval_status
  ON crm.purchase_orders (workspace_id, approval_status, updated_at DESC)
  WHERE COALESCE(is_deleted, false) = false;

CREATE OR REPLACE FUNCTION crm.order_request_write_allowed(
  p_workspace_id uuid,
  p_permission_key text,
  p_approval_status text,
  p_approval_requested_by uuid,
  p_approval_requested_at timestamp with time zone
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT
    public.current_user_role() = 'admin'
    OR NOT public.workspace_capability_allowed(
      p_workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = p_workspace_id),
      'workspaceManagementPermissions'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.workspace_permissions permission
      WHERE permission.workspace_id = p_workspace_id
        AND permission.user_uuid = auth.uid()
        AND permission.key = p_permission_key
    )
    OR (
      p_approval_status = 'requested'
      AND p_approval_requested_by = auth.uid()
      AND p_approval_requested_at IS NOT NULL
    );
$function$;

REVOKE ALL ON FUNCTION crm.order_request_write_allowed(uuid, text, text, uuid, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.order_request_write_allowed(uuid, text, text, uuid, timestamp with time zone) TO authenticated, service_role;

DROP POLICY IF EXISTS crm_sales_orders_insert ON crm.sales_orders;
CREATE POLICY crm_sales_orders_insert
  ON crm.sales_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = sales_orders.workspace_id),
      'orders'
    )
    AND crm.order_request_write_allowed(
      sales_orders.workspace_id,
      'orders.requireSalesOrderRequest',
      sales_orders.approval_status,
      sales_orders.approval_requested_by,
      sales_orders.approval_requested_at
    )
  );

DROP POLICY IF EXISTS crm_sales_orders_update ON crm.sales_orders;
CREATE POLICY crm_sales_orders_update
  ON crm.sales_orders
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = sales_orders.workspace_id),
      'orders'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = sales_orders.workspace_id),
      'orders'
    )
    AND crm.order_request_write_allowed(
      sales_orders.workspace_id,
      'orders.requireSalesOrderRequest',
      sales_orders.approval_status,
      sales_orders.approval_requested_by,
      sales_orders.approval_requested_at
    )
  );

DROP POLICY IF EXISTS crm_purchase_orders_insert ON crm.purchase_orders;
CREATE POLICY crm_purchase_orders_insert
  ON crm.purchase_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = purchase_orders.workspace_id),
      'orders'
    )
    AND crm.order_request_write_allowed(
      purchase_orders.workspace_id,
      'orders.requirePurchaseOrderRequest',
      purchase_orders.approval_status,
      purchase_orders.approval_requested_by,
      purchase_orders.approval_requested_at
    )
  );

DROP POLICY IF EXISTS crm_purchase_orders_update ON crm.purchase_orders;
CREATE POLICY crm_purchase_orders_update
  ON crm.purchase_orders
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = purchase_orders.workspace_id),
      'orders'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = purchase_orders.workspace_id),
      'orders'
    )
    AND crm.order_request_write_allowed(
      purchase_orders.workspace_id,
      'orders.requirePurchaseOrderRequest',
      purchase_orders.approval_status,
      purchase_orders.approval_requested_by,
      purchase_orders.approval_requested_at
    )
  );

ALTER TABLE notifications.workspace_disabled_types
DROP CONSTRAINT IF EXISTS notifications_workspace_disabled_types_type_check;

ALTER TABLE notifications.workspace_disabled_types
ADD CONSTRAINT notifications_workspace_disabled_types_type_check CHECK (
  notification_type IN (
    'marketplace_order_pending',
    'order_approval_request',
    'order_approval_approved',
    'loan_installment_overdue',
    'expense_item_overdue',
    'payroll_overdue',
    'inventory_low_stock'
  )
);

CREATE OR REPLACE FUNCTION public.queue_order_approval_request_notifications(
  p_order_type text,
  p_order_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, notifications
AS $function$
DECLARE
  v_order_type text := LOWER(BTRIM(COALESCE(p_order_type, '')));
  v_workspace_id uuid;
  v_order_number text;
  v_partner_name text;
  v_amount numeric;
  v_currency text;
  v_item_count integer;
  v_requested_by uuid;
  v_requested_at timestamp with time zone;
  v_due_date date;
  v_title text;
  v_body text;
  v_count integer := 0;
BEGIN
  IF v_order_type IN ('sales', 'sale', 'sales_order') THEN
    v_order_type := 'sales';

    SELECT
      so.workspace_id,
      so.order_number,
      so.customer_name,
      so.total,
      so.currency,
      jsonb_array_length(COALESCE(so.items, '[]'::jsonb)),
      so.approval_requested_by,
      so.approval_requested_at
    INTO
      v_workspace_id,
      v_order_number,
      v_partner_name,
      v_amount,
      v_currency,
      v_item_count,
      v_requested_by,
      v_requested_at
    FROM crm.sales_orders so
    WHERE so.id = p_order_id
      AND so.approval_status = 'requested'
      AND COALESCE(so.is_deleted, false) = false;
  ELSIF v_order_type IN ('purchase', 'purchase_order') THEN
    v_order_type := 'purchase';

    SELECT
      po.workspace_id,
      po.order_number,
      po.supplier_name,
      po.total,
      po.currency,
      jsonb_array_length(COALESCE(po.items, '[]'::jsonb)),
      po.approval_requested_by,
      po.approval_requested_at
    INTO
      v_workspace_id,
      v_order_number,
      v_partner_name,
      v_amount,
      v_currency,
      v_item_count,
      v_requested_by,
      v_requested_at
    FROM crm.purchase_orders po
    WHERE po.id = p_order_id
      AND po.approval_status = 'requested'
      AND COALESCE(po.is_deleted, false) = false;
  ELSE
    RAISE EXCEPTION 'unsupported_order_type'
      USING ERRCODE = '22023';
  END IF;

  IF v_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  v_due_date := COALESCE((v_requested_at AT TIME ZONE 'UTC')::date, timezone('utc', now())::date);
  v_title := CASE
    WHEN v_order_type = 'purchase' THEN format('Purchase order request %s', v_order_number)
    ELSE format('Sales order request %s', v_order_number)
  END;
  v_body := concat_ws(
    ' | ',
    NULLIF(BTRIM(COALESCE(v_partner_name, '')), ''),
    CASE
      WHEN COALESCE(v_item_count, 0) > 0
        THEN format('%s item%s', v_item_count, CASE WHEN v_item_count = 1 THEN '' ELSE 's' END)
      ELSE NULL
    END,
    CASE
      WHEN v_amount IS NOT NULL
        THEN concat_ws(' ', trim(to_char(v_amount, 'FM999999999990.##')), UPPER(NULLIF(BTRIM(COALESCE(v_currency, '')), '')))
      ELSE NULL
    END
  );

  WITH targets AS (
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.workspace_id = v_workspace_id
      AND LOWER(BTRIM(COALESCE(p.role, ''))) = 'admin'
  ),
  queued AS (
    SELECT public.upsert_notification_event(
      v_workspace_id,
      targets.user_id,
      'order_approval_request',
      p_order_id::text,
      v_due_date,
      jsonb_strip_nulls(jsonb_build_object(
        'entity_type', 'order_approval_request',
        'order_type', v_order_type,
        'order_id', p_order_id,
        'order_number', v_order_number,
        'partner_name', v_partner_name,
        'amount', v_amount,
        'currency', COALESCE(NULLIF(BTRIM(COALESCE(v_currency, '')), ''), 'iqd'),
        'item_count', v_item_count,
        'requested_by', v_requested_by,
        'requested_at', v_requested_at,
        'due_date', v_due_date,
        'route', format('/orders/%s', p_order_id),
        'action_label', 'Review request',
        'scope', 'user',
        'priority', 'high',
        'title', v_title,
        'body', NULLIF(v_body, '')
      ))
    ) AS event_id
    FROM targets
  )
  SELECT COUNT(*)::integer
  INTO v_count
  FROM queued;

  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_order_approval_approved_notifications(
  p_order_type text,
  p_order_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, notifications
AS $function$
DECLARE
  v_order_type text := LOWER(BTRIM(COALESCE(p_order_type, '')));
  v_workspace_id uuid;
  v_order_number text;
  v_partner_name text;
  v_amount numeric;
  v_currency text;
  v_item_count integer;
  v_requested_by uuid;
  v_requested_at timestamp with time zone;
  v_reviewed_by uuid;
  v_reviewed_at timestamp with time zone;
  v_due_date date;
  v_title text;
  v_body text;
  v_count integer := 0;
BEGIN
  IF v_order_type IN ('sales', 'sale', 'sales_order') THEN
    v_order_type := 'sales';

    SELECT
      so.workspace_id,
      so.order_number,
      so.customer_name,
      so.total,
      so.currency,
      jsonb_array_length(COALESCE(so.items, '[]'::jsonb)),
      so.approval_requested_by,
      so.approval_requested_at,
      so.approval_reviewed_by,
      so.approval_reviewed_at
    INTO
      v_workspace_id,
      v_order_number,
      v_partner_name,
      v_amount,
      v_currency,
      v_item_count,
      v_requested_by,
      v_requested_at,
      v_reviewed_by,
      v_reviewed_at
    FROM crm.sales_orders so
    WHERE so.id = p_order_id
      AND so.approval_status = 'approved'
      AND so.approval_requested_by IS NOT NULL
      AND COALESCE(so.is_deleted, false) = false;
  ELSIF v_order_type IN ('purchase', 'purchase_order') THEN
    v_order_type := 'purchase';

    SELECT
      po.workspace_id,
      po.order_number,
      po.supplier_name,
      po.total,
      po.currency,
      jsonb_array_length(COALESCE(po.items, '[]'::jsonb)),
      po.approval_requested_by,
      po.approval_requested_at,
      po.approval_reviewed_by,
      po.approval_reviewed_at
    INTO
      v_workspace_id,
      v_order_number,
      v_partner_name,
      v_amount,
      v_currency,
      v_item_count,
      v_requested_by,
      v_requested_at,
      v_reviewed_by,
      v_reviewed_at
    FROM crm.purchase_orders po
    WHERE po.id = p_order_id
      AND po.approval_status = 'approved'
      AND po.approval_requested_by IS NOT NULL
      AND COALESCE(po.is_deleted, false) = false;
  ELSE
    RAISE EXCEPTION 'unsupported_order_type'
      USING ERRCODE = '22023';
  END IF;

  IF v_workspace_id IS NULL OR v_requested_by IS NULL THEN
    RETURN 0;
  END IF;

  v_due_date := COALESCE((v_reviewed_at AT TIME ZONE 'UTC')::date, timezone('utc', now())::date);
  v_title := CASE
    WHEN v_order_type = 'purchase' THEN format('Purchase order approved %s', v_order_number)
    ELSE format('Sales order approved %s', v_order_number)
  END;
  v_body := concat_ws(
    ' | ',
    NULLIF(BTRIM(COALESCE(v_partner_name, '')), ''),
    CASE
      WHEN COALESCE(v_item_count, 0) > 0
        THEN format('%s item%s', v_item_count, CASE WHEN v_item_count = 1 THEN '' ELSE 's' END)
      ELSE NULL
    END,
    CASE
      WHEN v_amount IS NOT NULL
        THEN concat_ws(' ', trim(to_char(v_amount, 'FM999999999990.##')), UPPER(NULLIF(BTRIM(COALESCE(v_currency, '')), '')))
      ELSE NULL
    END
  );

  WITH target AS (
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.id = v_requested_by
      AND p.workspace_id = v_workspace_id
  ),
  queued AS (
    SELECT public.upsert_notification_event(
      v_workspace_id,
      target.user_id,
      'order_approval_approved',
      p_order_id::text,
      v_due_date,
      jsonb_strip_nulls(jsonb_build_object(
        'entity_type', 'order_approval_approved',
        'order_type', v_order_type,
        'order_id', p_order_id,
        'order_number', v_order_number,
        'partner_name', v_partner_name,
        'amount', v_amount,
        'currency', COALESCE(NULLIF(BTRIM(COALESCE(v_currency, '')), ''), 'iqd'),
        'item_count', v_item_count,
        'requested_by', v_requested_by,
        'requested_at', v_requested_at,
        'reviewed_by', v_reviewed_by,
        'reviewed_at', v_reviewed_at,
        'due_date', v_due_date,
        'route', format('/orders/%s', p_order_id),
        'action_label', 'Open order',
        'scope', 'user',
        'priority', 'normal',
        'title', v_title,
        'body', NULLIF(v_body, '')
      ))
    ) AS event_id
    FROM target
  )
  SELECT COUNT(*)::integer
  INTO v_count
  FROM queued
  WHERE event_id IS NOT NULL;

  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_order_approval_notifications_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, notifications
AS $function$
BEGIN
  IF NEW.approval_status = 'requested'
    AND COALESCE(NEW.is_deleted, false) = false
  THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.queue_order_approval_request_notifications(
        CASE WHEN TG_TABLE_NAME = 'purchase_orders' THEN 'purchase' ELSE 'sales' END,
        NEW.id
      );
    ELSIF OLD.approval_status IS DISTINCT FROM NEW.approval_status
      OR OLD.approval_requested_at IS DISTINCT FROM NEW.approval_requested_at
    THEN
      PERFORM public.queue_order_approval_request_notifications(
        CASE WHEN TG_TABLE_NAME = 'purchase_orders' THEN 'purchase' ELSE 'sales' END,
        NEW.id
      );
    END IF;
  END IF;

  IF NEW.approval_status = 'approved'
    AND COALESCE(NEW.is_deleted, false) = false
    AND NEW.approval_requested_by IS NOT NULL
  THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.queue_order_approval_approved_notifications(
        CASE WHEN TG_TABLE_NAME = 'purchase_orders' THEN 'purchase' ELSE 'sales' END,
        NEW.id
      );
    ELSIF OLD.approval_status IS DISTINCT FROM NEW.approval_status
      OR OLD.approval_reviewed_at IS DISTINCT FROM NEW.approval_reviewed_at
    THEN
      PERFORM public.queue_order_approval_approved_notifications(
        CASE WHEN TG_TABLE_NAME = 'purchase_orders' THEN 'purchase' ELSE 'sales' END,
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS queue_sales_order_approval_request_notifications ON crm.sales_orders;
CREATE TRIGGER queue_sales_order_approval_request_notifications
AFTER INSERT OR UPDATE OF approval_status, approval_requested_at, approval_reviewed_at
ON crm.sales_orders
FOR EACH ROW
EXECUTE FUNCTION public.queue_order_approval_notifications_on_change();

DROP TRIGGER IF EXISTS queue_purchase_order_approval_request_notifications ON crm.purchase_orders;
CREATE TRIGGER queue_purchase_order_approval_request_notifications
AFTER INSERT OR UPDATE OF approval_status, approval_requested_at, approval_reviewed_at
ON crm.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.queue_order_approval_notifications_on_change();

REVOKE ALL ON FUNCTION public.queue_order_approval_request_notifications(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_order_approval_request_notifications(text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.queue_order_approval_approved_notifications(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_order_approval_approved_notifications(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_workspace_notification_type_disabled(
  p_notification_type text,
  p_disabled boolean DEFAULT true
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, notifications
AS $function$
DECLARE
  v_workspace_id uuid := public.current_workspace_id();
  v_notification_type text := NULLIF(BTRIM(COALESCE(p_notification_type, '')), '');
BEGIN
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_required'
      USING ERRCODE = '42501';
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'notification_settings_admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_notification_type NOT IN (
    'marketplace_order_pending',
    'order_approval_request',
    'order_approval_approved',
    'loan_installment_overdue',
    'expense_item_overdue',
    'payroll_overdue',
    'inventory_low_stock'
  ) THEN
    RAISE EXCEPTION 'unsupported_notification_type'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_disabled, true) THEN
    INSERT INTO notifications.workspace_disabled_types (
      workspace_id,
      notification_type,
      disabled_by
    )
    VALUES (
      v_workspace_id,
      v_notification_type,
      auth.uid()
    )
    ON CONFLICT (workspace_id, notification_type) DO UPDATE
    SET
      disabled_by = EXCLUDED.disabled_by,
      updated_at = now();
  ELSE
    DELETE FROM notifications.workspace_disabled_types
    WHERE workspace_id = v_workspace_id
      AND notification_type = v_notification_type;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_workspace_notification_type_disabled(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_workspace_notification_type_disabled(text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
