-- Tracking numbers have a workspace-wide unique constraint, so a soft-deleted
-- shipment must still reserve its number. Replace the first version of the
-- function with a lookup that considers the complete shipment history.
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

  IF NEW.workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Shipment workspace does not match the authenticated workspace';
  END IF;

  SELECT existing.tracking_number
  INTO v_existing_number
  FROM delivery.delivery_shipments AS existing
  WHERE existing.id = NEW.id;

  IF v_existing_number IS NOT NULL THEN
    NEW.tracking_number := v_existing_number;
    RETURN NEW;
  END IF;

  v_tracking_day := to_char(
    COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Baghdad',
    'YYYYMMDD'
  );

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

NOTIFY pgrst, 'reload schema';
