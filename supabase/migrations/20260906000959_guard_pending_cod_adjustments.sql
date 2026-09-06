-- A pending COD request snapshots the commercial terms that an administrator
-- will review. Keep those terms stable until the request is reviewed, while
-- allowing an older request to be finalized when its approved amount was
-- already applied before this guard existed.
CREATE OR REPLACE FUNCTION delivery.assert_cod_adjustment_request_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  shipment delivery.delivery_shipments%ROWTYPE;
BEGIN
  SELECT * INTO shipment
  FROM delivery.delivery_shipments
  WHERE id = NEW.shipment_id
    AND workspace_id = NEW.workspace_id
    AND NOT is_deleted;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COD change request must reference a shipment in the same workspace' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.agents AS agent
    WHERE agent.id = NEW.requester_agent_id
      AND agent.workspace_id = NEW.workspace_id
      AND agent.agent_type = 'courier'
      AND agent.linked_user_id = NEW.requester_user_id
      AND COALESCE(agent.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'COD change request must be made by the assigned courier' USING ERRCODE = '23514';
  END IF;

  IF NEW.currency IS DISTINCT FROM shipment.currency
    OR (
      NEW.status = 'pending'
      AND NEW.original_cod_amount IS DISTINCT FROM shipment.cod_amount
    ) THEN
    RAISE EXCEPTION 'COD change request must use the shipment currency and current COD amount' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'pending' AND (
    shipment.customer_payment_status <> 'cash_on_delivery'
    OR shipment.status NOT IN ('assigned', 'postponed')
    OR shipment.assigned_agent_id IS DISTINCT FROM NEW.requester_agent_id
  ) THEN
    RAISE EXCEPTION 'COD changes can only be requested for an assigned or postponed cash-on-delivery post' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'approved' AND (
    shipment.customer_payment_status <> 'cash_on_delivery'
    OR shipment.status NOT IN ('assigned', 'postponed')
    OR (
      shipment.cod_amount IS DISTINCT FROM NEW.original_cod_amount
      AND shipment.cod_amount IS DISTINCT FROM NEW.reviewed_cod_amount
    )
  ) THEN
    RAISE EXCEPTION 'This COD change request can no longer be approved' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION delivery.guard_delivery_shipment_cod_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND auth.uid() IS NOT NULL
    AND public.current_user_role() IS DISTINCT FROM 'admin'
    AND (
      NEW.cod_amount IS DISTINCT FROM OLD.cod_amount
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.customer_payment_status IS DISTINCT FROM OLD.customer_payment_status
    ) THEN
    RAISE EXCEPTION 'Only an administrator can approve a COD change' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW.cod_amount IS DISTINCT FROM OLD.cod_amount
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.customer_payment_status IS DISTINCT FROM OLD.customer_payment_status
    )
    AND EXISTS (
      SELECT 1
      FROM delivery.delivery_shipment_cod_adjustment_requests AS request
      WHERE request.shipment_id = NEW.id
        AND request.workspace_id = NEW.workspace_id
        AND request.status = 'pending'
        AND NOT request.is_deleted
    ) THEN
    RAISE EXCEPTION 'Review the pending COD change before changing the post COD details' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'delivered' AND EXISTS (
    SELECT 1
    FROM delivery.delivery_shipment_cod_adjustment_requests AS request
    WHERE request.shipment_id = NEW.id
      AND request.workspace_id = NEW.workspace_id
      AND request.status = 'pending'
      AND NOT request.is_deleted
  ) THEN
    RAISE EXCEPTION 'Review the pending COD change before marking the post delivered' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
