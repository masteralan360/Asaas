-- Review notes remain part of the audit trail when supplied, but an admin may
-- approve, override, or reject a COD change request without entering one.
ALTER TABLE delivery.delivery_shipment_cod_adjustment_requests
  DROP CONSTRAINT IF EXISTS delivery_cod_adjustment_decision_check;

ALTER TABLE delivery.delivery_shipment_cod_adjustment_requests
  ADD CONSTRAINT delivery_cod_adjustment_decision_check CHECK (
    (status = 'pending' AND reviewed_cod_amount IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (
      status = 'approved'
      AND reviewed_cod_amount IS NOT NULL
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
    OR (
      status = 'rejected'
      AND reviewed_cod_amount IS NULL
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  );

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
      NEW.status IN ('pending', 'approved')
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
    OR shipment.cod_amount IS DISTINCT FROM NEW.original_cod_amount
  ) THEN
    RAISE EXCEPTION 'This COD change request can no longer be approved' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
