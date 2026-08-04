-- Order numbers are workspace-wide identifiers. They must be assigned by the
-- database, because an RLS-restricted client cannot see every order required
-- to calculate the next value safely.
CREATE TABLE IF NOT EXISTS crm.order_number_counters (
  workspace_id uuid NOT NULL,
  order_type text NOT NULL CHECK (order_type IN ('sales', 'purchase')),
  order_year integer NOT NULL CHECK (order_year BETWEEN 2000 AND 9999),
  last_sequence bigint NOT NULL CHECK (last_sequence > 0),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (workspace_id, order_type, order_year)
);

ALTER TABLE crm.order_number_counters ENABLE ROW LEVEL SECURITY;

-- This is an internal counter. Applications receive numbers through the
-- insert trigger below and must never read or mutate counter rows directly.
REVOKE ALL ON TABLE crm.order_number_counters FROM PUBLIC;
REVOKE ALL ON TABLE crm.order_number_counters FROM anon, authenticated;

-- Start each counter at the greatest existing automatic number. Historical
-- duplicates are deliberately preserved; this migration prevents new ones
-- without rewriting identifiers that may already appear on documents.
WITH existing_numbers AS (
  SELECT
    sales_order.workspace_id,
    'sales'::text AS order_type,
    (matches.parts)[1]::integer AS order_year,
    (matches.parts)[2]::bigint AS sequence_value
  FROM crm.sales_orders AS sales_order
  CROSS JOIN LATERAL regexp_match(
    sales_order.order_number,
    '^SO-([0-9]{4})-([0-9]+)$'
  ) AS matches(parts)

  UNION ALL

  SELECT
    purchase_order.workspace_id,
    'purchase'::text AS order_type,
    (matches.parts)[1]::integer AS order_year,
    (matches.parts)[2]::bigint AS sequence_value
  FROM crm.purchase_orders AS purchase_order
  CROSS JOIN LATERAL regexp_match(
    purchase_order.order_number,
    '^PO-([0-9]{4})-([0-9]+)$'
  ) AS matches(parts)
), maximums AS (
  SELECT
    workspace_id,
    order_type,
    order_year,
    MAX(sequence_value) AS last_sequence
  FROM existing_numbers
  GROUP BY workspace_id, order_type, order_year
)
INSERT INTO crm.order_number_counters AS counters (
  workspace_id,
  order_type,
  order_year,
  last_sequence,
  updated_at
)
SELECT
  workspace_id,
  order_type,
  order_year,
  last_sequence,
  timezone('utc', now())
FROM maximums
ON CONFLICT (workspace_id, order_type, order_year)
DO UPDATE SET
  last_sequence = GREATEST(counters.last_sequence, EXCLUDED.last_sequence),
  updated_at = EXCLUDED.updated_at;

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

  -- An upsert first runs this insert trigger, even if it subsequently updates
  -- an existing ID. Preserve that row's number instead of allocating another.
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
  -- duplicate numbers that predate this migration.
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
