-- PostgREST upserts execute BEFORE INSERT triggers even when the row resolves
-- to ON CONFLICT DO UPDATE. Keep the already-assigned number in that path so
-- ordinary edits cannot consume or replace a workspace sequence value.
CREATE OR REPLACE FUNCTION crm.assign_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, crm
AS $function$
DECLARE
  v_order_type text;
  v_prefix text;
  v_year integer;
  v_sequence bigint;
  v_requested_number text := NULLIF(BTRIM(COALESCE(NEW.order_number, '')), '');
  v_existing_number text;
BEGIN
  IF NEW.workspace_id IS NULL THEN
    RAISE EXCEPTION 'Orders require a workspace';
  END IF;

  -- The table policy performs the same authorization check. Keep it here as
  -- well because this function intentionally has privileged counter access.
  IF NEW.workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Order workspace does not match the authenticated workspace';
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'sales_orders' THEN
      v_order_type := 'sales';
      v_prefix := 'SO';
      SELECT existing.order_number
      INTO v_existing_number
      FROM crm.sales_orders AS existing
      WHERE existing.id = NEW.id;
    WHEN 'purchase_orders' THEN
      v_order_type := 'purchase';
      v_prefix := 'PO';
      SELECT existing.order_number
      INTO v_existing_number
      FROM crm.purchase_orders AS existing
      WHERE existing.id = NEW.id;
    ELSE
      RAISE EXCEPTION 'Unsupported order table: %', TG_TABLE_NAME;
  END CASE;

  IF v_existing_number IS NOT NULL THEN
    NEW.order_number := v_existing_number;
    RETURN NEW;
  END IF;

  v_year := EXTRACT(YEAR FROM COALESCE(NEW.created_at, timezone('utc', now())))::integer;

  -- A blank value, a previous client-generated number, or an offline
  -- placeholder is always replaced with the next workspace-wide number.
  IF v_requested_number IS NULL
    OR v_requested_number ~ format('^%s-[0-9]{4}-[0-9]+$', v_prefix)
    OR v_requested_number ~ format('^%s-PENDING-[A-Z0-9-]+$', v_prefix)
  THEN
    INSERT INTO crm.order_number_counters AS counters (
      workspace_id,
      order_type,
      order_year,
      last_sequence,
      updated_at
    ) VALUES (
      NEW.workspace_id,
      v_order_type,
      v_year,
      1,
      timezone('utc', now())
    )
    ON CONFLICT (workspace_id, order_type, order_year)
    DO UPDATE SET
      last_sequence = counters.last_sequence + 1,
      updated_at = EXCLUDED.updated_at
    RETURNING last_sequence INTO v_sequence;

    NEW.order_number := format('%s-%s-%s', v_prefix, v_year, LPAD(v_sequence::text, 5, '0'));
    RETURN NEW;
  END IF;

  -- Non-standard external references (for example, marketplace references)
  -- are retained, but still cannot be duplicated within their order type and
  -- workspace. The advisory lock makes this safe without rewriting historic
  -- duplicate numbers that predate the atomic counter.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      format('crm.%s_orders:%s:%s', v_order_type, NEW.workspace_id, v_requested_number),
      0
    )
  );

  IF v_order_type = 'sales' THEN
    IF EXISTS (
      SELECT 1
      FROM crm.sales_orders AS existing
      WHERE existing.workspace_id = NEW.workspace_id
        AND existing.order_number = v_requested_number
        AND COALESCE(existing.is_deleted, false) = false
    ) THEN
      RAISE EXCEPTION 'Sales order number % already exists in this workspace', v_requested_number
        USING ERRCODE = 'unique_violation';
    END IF;
  ELSIF EXISTS (
    SELECT 1
    FROM crm.purchase_orders AS existing
    WHERE existing.workspace_id = NEW.workspace_id
      AND existing.order_number = v_requested_number
      AND COALESCE(existing.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Purchase order number % already exists in this workspace', v_requested_number
      USING ERRCODE = 'unique_violation';
  END IF;

  NEW.order_number := v_requested_number;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION crm.assign_order_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.assign_order_number() FROM anon, authenticated;
