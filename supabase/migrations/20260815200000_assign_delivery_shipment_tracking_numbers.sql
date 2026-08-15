-- Delivery shipment tracking numbers are derived from the existing shipment
-- rows. This deliberately avoids a separate counter table while still making
-- assignment atomic for concurrent inserts in the same workspace and day.
CREATE OR REPLACE FUNCTION delivery.assign_shipment_tracking_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, delivery
AS $function$
DECLARE
  v_tracking_day text;
  v_next_sequence bigint;
  v_existing_number text;
  v_requested_number text := NULLIF(BTRIM(COALESCE(NEW.tracking_number, '')), '');
BEGIN
  IF NEW.workspace_id IS NULL THEN
    RAISE EXCEPTION 'Delivery shipments require a workspace';
  END IF;

  -- The shipment policies make the same assertion. Keep it here because this
  -- function is privileged in order to derive a workspace-wide sequence.
  IF NEW.workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Shipment workspace does not match the authenticated workspace';
  END IF;

  -- PostgREST upserts execute BEFORE INSERT triggers even when the row resolves
  -- to ON CONFLICT DO UPDATE. Preserve an existing tracking number so edits do
  -- not consume a new daily sequence value.
  SELECT existing.tracking_number
  INTO v_existing_number
  FROM delivery.delivery_shipments AS existing
  WHERE existing.id = NEW.id;

  IF v_existing_number IS NOT NULL THEN
    NEW.tracking_number := v_existing_number;
    RETURN NEW;
  END IF;

  -- Posts follow the Iraqi operating day, including rows that arrive from an
  -- offline device after midnight. The client sends its original created_at.
  v_tracking_day := to_char(
    COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Baghdad',
    'YYYYMMDD'
  );

  -- Blank, temporary, and legacy client-generated values are replaced with
  -- the authoritative server-side tracking number.
  IF v_requested_number IS NULL
    OR v_requested_number ~ '^PST-PENDING-[A-Z0-9-]+$'
    OR v_requested_number ~ '^PST-[0-9]{8}-[A-Z0-9]{6}$'
  THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        format('delivery.shipments:%s:%s', NEW.workspace_id, v_tracking_day),
        0
      )
    );

    SELECT COALESCE(
      MAX(((regexp_match(tracking_number, format('^PST-%s-([0-9]+)$', v_tracking_day)))[1])::bigint),
      0
    ) + 1
    INTO v_next_sequence
    FROM delivery.delivery_shipments
    WHERE workspace_id = NEW.workspace_id
      AND tracking_number ~ format('^PST-%s-[0-9]+$', v_tracking_day);

    NEW.tracking_number := format(
      'PST-%s-%s',
      v_tracking_day,
      LPAD(v_next_sequence::text, 5, '0')
    );
    RETURN NEW;
  END IF;

  -- Preserve an explicit external reference, but prevent it from being reused
  -- inside the workspace. The lock makes that validation concurrency-safe.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      format('delivery.shipments:%s:%s', NEW.workspace_id, v_requested_number),
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM delivery.delivery_shipments AS existing
    WHERE existing.workspace_id = NEW.workspace_id
      AND existing.tracking_number = v_requested_number
  ) THEN
    RAISE EXCEPTION 'Shipment tracking number % already exists in this workspace', v_requested_number
      USING ERRCODE = 'unique_violation';
  END IF;

  NEW.tracking_number := v_requested_number;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION delivery.assign_shipment_tracking_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery.assign_shipment_tracking_number() FROM anon, authenticated;

DROP TRIGGER IF EXISTS assign_delivery_shipment_tracking_number_on_insert ON delivery.delivery_shipments;
CREATE TRIGGER assign_delivery_shipment_tracking_number_on_insert
BEFORE INSERT ON delivery.delivery_shipments
FOR EACH ROW
EXECUTE FUNCTION delivery.assign_shipment_tracking_number();

NOTIFY pgrst, 'reload schema';
