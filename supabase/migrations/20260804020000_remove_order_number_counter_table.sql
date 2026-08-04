-- The order_number_counters table is unnecessary. The trigger below is
-- SECURITY DEFINER (the function owner is the table owner, and RLS does not
-- apply to the owner), so it can read every order in the workspace even when
-- the calling client is restricted by the view-own policy. Serializing
-- concurrent inserts with a transaction-level advisory lock - exactly like the
-- pre-existing marketplace sales-order trigger - is enough to make
-- workspace-wide numbers atomic, so the next value can be derived from the
-- orders themselves instead of a dedicated counter table.
DROP TRIGGER IF EXISTS assign_sales_order_number_on_insert ON crm.sales_orders;
DROP TRIGGER IF EXISTS assign_purchase_order_number_on_insert ON crm.purchase_orders;

DROP FUNCTION IF EXISTS crm.assign_order_number();

DROP TABLE IF EXISTS crm.order_number_counters;

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
  v_next_sequence bigint;
  v_existing_number text;
  v_requested_number text := NULLIF(BTRIM(COALESCE(NEW.order_number, '')), '');
BEGIN
  IF NEW.workspace_id IS NULL THEN
    RAISE EXCEPTION 'Orders require a workspace';
  END IF;

  -- The table policy performs the same authorization check. Keep it here as
  -- well because this function intentionally has privileged order access.
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

  -- PostgREST upserts execute BEFORE INSERT triggers even when the row resolves
  -- to ON CONFLICT DO UPDATE. Preserve the already-assigned number in that path
  -- so ordinary edits cannot consume or replace a workspace sequence value.
  IF v_existing_number IS NOT NULL THEN
    NEW.order_number := v_existing_number;
    RETURN NEW;
  END IF;

  v_year := EXTRACT(YEAR FROM COALESCE(NEW.created_at, timezone('utc', now())))::integer;

  -- A blank value, a previous client-generated number, or an offline
  -- placeholder is always replaced with the next workspace-wide number. The
  -- advisory lock serializes concurrent inserts for the same workspace, type
  -- and year, so two transactions cannot compute the same MAX + 1.
  IF v_requested_number IS NULL
    OR v_requested_number ~ format('^%s-[0-9]{4}-[0-9]+$', v_prefix)
    OR v_requested_number ~ format('^%s-PENDING-[A-Z0-9-]+$', v_prefix)
  THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        format('crm.%s_orders:%s:%s', v_order_type, NEW.workspace_id, v_year),
        0
      )
    );

    IF v_order_type = 'sales' THEN
      SELECT COALESCE(
        MAX(((regexp_match(order_number, format('^SO-%s-([0-9]+)$', v_year)))[1])::bigint),
        0
      ) + 1
      INTO v_next_sequence
      FROM crm.sales_orders
      WHERE workspace_id = NEW.workspace_id
        AND COALESCE(is_deleted, false) = false
        AND order_number ~ format('^SO-%s-[0-9]+$', v_year);
    ELSE
      SELECT COALESCE(
        MAX(((regexp_match(order_number, format('^PO-%s-([0-9]+)$', v_year)))[1])::bigint),
        0
      ) + 1
      INTO v_next_sequence
      FROM crm.purchase_orders
      WHERE workspace_id = NEW.workspace_id
        AND COALESCE(is_deleted, false) = false
        AND order_number ~ format('^PO-%s-[0-9]+$', v_year);
    END IF;

    NEW.order_number := format('%s-%s-%s', v_prefix, v_year, LPAD(v_next_sequence::text, 5, '0'));
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

DROP TRIGGER IF EXISTS assign_sales_order_number_on_insert ON crm.sales_orders;
CREATE TRIGGER assign_sales_order_number_on_insert
BEFORE INSERT ON crm.sales_orders
FOR EACH ROW
EXECUTE FUNCTION crm.assign_order_number();

DROP TRIGGER IF EXISTS assign_purchase_order_number_on_insert ON crm.purchase_orders;
CREATE TRIGGER assign_purchase_order_number_on_insert
BEFORE INSERT ON crm.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION crm.assign_order_number();
