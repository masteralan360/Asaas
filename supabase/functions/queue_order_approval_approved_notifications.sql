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
