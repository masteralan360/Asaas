-- Electronically prepaid posts may require a correction to the amount paid
-- out to the recipient. This review record keeps the payout funding method
-- intact and lets the normal delivery flow create payment and ledger rows.

CREATE TABLE IF NOT EXISTS delivery.delivery_shipment_recipient_payout_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES delivery.delivery_shipments(id) ON DELETE RESTRICT,
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requester_agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  currency text NOT NULL DEFAULT 'iqd',
  original_recipient_payout_amount numeric NOT NULL CHECK (original_recipient_payout_amount >= 0),
  requested_recipient_payout_amount numeric NOT NULL CHECK (requested_recipient_payout_amount >= 0),
  reason text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_recipient_payout_amount numeric NULL CHECK (reviewed_recipient_payout_amount IS NULL OR reviewed_recipient_payout_amount >= 0),
  review_note text NULL,
  reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_recipient_payout_adjustment_decision_check CHECK (
    (status = 'pending' AND reviewed_recipient_payout_amount IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (
      status = 'approved'
      AND reviewed_recipient_payout_amount IS NOT NULL
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
    OR (
      status = 'rejected'
      AND reviewed_recipient_payout_amount IS NULL
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  ),
  CONSTRAINT delivery_recipient_payout_adjustment_not_same_amount CHECK (
    requested_recipient_payout_amount <> original_recipient_payout_amount
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_recipient_payout_adjustment_one_pending_per_shipment
  ON delivery.delivery_shipment_recipient_payout_adjustment_requests (workspace_id, shipment_id)
  WHERE status = 'pending' AND is_deleted = false;

CREATE INDEX IF NOT EXISTS delivery_recipient_payout_adjustment_workspace_status
  ON delivery.delivery_shipment_recipient_payout_adjustment_requests (workspace_id, status, updated_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS delivery_recipient_payout_adjustment_requester
  ON delivery.delivery_shipment_recipient_payout_adjustment_requests (workspace_id, requester_user_id, updated_at DESC)
  WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION delivery.assert_recipient_payout_adjustment_request_links()
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
    RAISE EXCEPTION 'Recipient payout change request must reference a shipment in the same workspace' USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'Recipient payout change request must be made by the assigned courier' USING ERRCODE = '23514';
  END IF;

  IF NEW.currency IS DISTINCT FROM shipment.currency
    OR (
      NEW.status = 'pending'
      AND NEW.original_recipient_payout_amount IS DISTINCT FROM COALESCE(shipment.recipient_payout_amount, 0)
    ) THEN
    RAISE EXCEPTION 'Recipient payout change request must use the shipment currency and current recipient payout amount' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'pending' AND (
    shipment.customer_payment_status <> 'prepaid_electronically'
    OR shipment.status NOT IN ('assigned', 'postponed')
    OR shipment.assigned_agent_id IS DISTINCT FROM NEW.requester_agent_id
  ) THEN
    RAISE EXCEPTION 'Recipient payout changes can only be requested for an assigned or postponed electronically prepaid post' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'approved' AND (
    shipment.customer_payment_status <> 'prepaid_electronically'
    OR shipment.status NOT IN ('assigned', 'postponed')
    OR (
      COALESCE(shipment.recipient_payout_amount, 0) IS DISTINCT FROM NEW.original_recipient_payout_amount
      AND COALESCE(shipment.recipient_payout_amount, 0) IS DISTINCT FROM NEW.reviewed_recipient_payout_amount
    )
  ) THEN
    RAISE EXCEPTION 'This recipient payout change request can no longer be approved' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_recipient_payout_adjustment_request_links
  ON delivery.delivery_shipment_recipient_payout_adjustment_requests;
CREATE TRIGGER delivery_recipient_payout_adjustment_request_links
  BEFORE INSERT OR UPDATE ON delivery.delivery_shipment_recipient_payout_adjustment_requests
  FOR EACH ROW EXECUTE FUNCTION delivery.assert_recipient_payout_adjustment_request_links();

CREATE OR REPLACE FUNCTION delivery.guard_delivery_shipment_recipient_payout_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Direct Dashboard/SQL and service-role work remains an administrator-level
  -- override, matching the existing delivery COD guard.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW.recipient_payout_amount IS DISTINCT FROM OLD.recipient_payout_amount
      OR NEW.recipient_payout_funding IS DISTINCT FROM OLD.recipient_payout_funding
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.customer_payment_status IS DISTINCT FROM OLD.customer_payment_status
    )
    AND EXISTS (
      SELECT 1
      FROM delivery.delivery_shipment_recipient_payout_adjustment_requests AS request
      WHERE request.shipment_id = NEW.id
        AND request.workspace_id = NEW.workspace_id
        AND request.status = 'pending'
        AND NOT request.is_deleted
    ) THEN
    RAISE EXCEPTION 'Review the pending recipient payout change before changing the post payout details' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'delivered' AND EXISTS (
    SELECT 1
    FROM delivery.delivery_shipment_recipient_payout_adjustment_requests AS request
    WHERE request.shipment_id = NEW.id
      AND request.workspace_id = NEW.workspace_id
      AND request.status = 'pending'
      AND NOT request.is_deleted
  ) THEN
    RAISE EXCEPTION 'Review the pending recipient payout change before marking the post delivered' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_guard_recipient_payout_change ON delivery.delivery_shipments;
CREATE TRIGGER delivery_guard_recipient_payout_change
  BEFORE INSERT OR UPDATE ON delivery.delivery_shipments
  FOR EACH ROW EXECUTE FUNCTION delivery.guard_delivery_shipment_recipient_payout_change();

DROP TRIGGER IF EXISTS touch_delivery_recipient_payout_adjustment_requests_updated_at
  ON delivery.delivery_shipment_recipient_payout_adjustment_requests;
CREATE TRIGGER touch_delivery_recipient_payout_adjustment_requests_updated_at
  BEFORE UPDATE ON delivery.delivery_shipment_recipient_payout_adjustment_requests
  FOR EACH ROW EXECUTE FUNCTION delivery.touch_updated_at();

ALTER TABLE delivery.delivery_shipment_recipient_payout_adjustment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_recipient_payout_adjustment_read ON delivery.delivery_shipment_recipient_payout_adjustment_requests;
CREATE POLICY delivery_recipient_payout_adjustment_read
  ON delivery.delivery_shipment_recipient_payout_adjustment_requests
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND (
      public.current_user_role() = 'admin'
      OR requester_user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS delivery_recipient_payout_adjustment_create ON delivery.delivery_shipment_recipient_payout_adjustment_requests;
CREATE POLICY delivery_recipient_payout_adjustment_create
  ON delivery.delivery_shipment_recipient_payout_adjustment_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND (
      public.current_user_role() = 'admin'
      OR (
        public.current_user_role() = 'staff'
        AND requester_user_id = (SELECT auth.uid())
        AND status = 'pending'
        AND EXISTS (
          SELECT 1
          FROM delivery.delivery_shipments AS shipment
          INNER JOIN crm.agents AS agent
            ON agent.id = shipment.assigned_agent_id
            AND agent.workspace_id = shipment.workspace_id
          WHERE shipment.id = delivery_shipment_recipient_payout_adjustment_requests.shipment_id
            AND shipment.workspace_id = delivery_shipment_recipient_payout_adjustment_requests.workspace_id
            AND shipment.status IN ('assigned', 'postponed')
            AND shipment.customer_payment_status = 'prepaid_electronically'
            AND agent.id = delivery_shipment_recipient_payout_adjustment_requests.requester_agent_id
            AND agent.agent_type = 'courier'
            AND agent.linked_user_id = (SELECT auth.uid())
            AND COALESCE(agent.is_deleted, false) = false
        )
      )
    )
  );

DROP POLICY IF EXISTS delivery_recipient_payout_adjustment_update ON delivery.delivery_shipment_recipient_payout_adjustment_requests;
CREATE POLICY delivery_recipient_payout_adjustment_update
  ON delivery.delivery_shipment_recipient_payout_adjustment_requests
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND public.current_user_role() = 'admin'
    AND (reviewed_by IS NULL OR reviewed_by = (SELECT auth.uid()))
  );

GRANT SELECT, INSERT, UPDATE ON delivery.delivery_shipment_recipient_payout_adjustment_requests TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delivery.assert_recipient_payout_adjustment_request_links() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delivery.guard_delivery_shipment_recipient_payout_change() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
