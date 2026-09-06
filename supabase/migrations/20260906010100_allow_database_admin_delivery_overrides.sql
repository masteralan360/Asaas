-- Atlas staff and couriers must continue to follow the delivery workflow.
-- Supabase Dashboard and server-side database administration have no Atlas
-- auth user, however, and must be able to correct a post directly.

CREATE OR REPLACE FUNCTION delivery.restrict_non_admin_shipment_amendments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Direct Dashboard/SQL and service-role work has no application user. It is
  -- already privileged database administration, so do not treat it as staff.
  IF auth.uid() IS NULL OR public.current_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.merchant_profile_id IS DISTINCT FROM OLD.merchant_profile_id
    OR NEW.merchant_business_partner_id IS DISTINCT FROM OLD.merchant_business_partner_id
    OR NEW.recipient_phone IS DISTINCT FROM OLD.recipient_phone
    OR NEW.recipient_address IS DISTINCT FROM OLD.recipient_address
    OR NEW.recipient_latitude IS DISTINCT FROM OLD.recipient_latitude
    OR NEW.recipient_longitude IS DISTINCT FROM OLD.recipient_longitude
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.cod_amount IS DISTINCT FROM OLD.cod_amount
    OR NEW.customer_payment_status IS DISTINCT FROM OLD.customer_payment_status
    OR NEW.recipient_payout_amount IS DISTINCT FROM OLD.recipient_payout_amount
    OR NEW.recipient_payout_funding IS DISTINCT FROM OLD.recipient_payout_funding
    OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
    OR NEW.fee_payer IS DISTINCT FROM OLD.fee_payer
    OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
    OR NEW.source_sales_order_id IS DISTINCT FROM OLD.source_sales_order_id
  THEN
    RAISE EXCEPTION 'Only an administrator can edit and redispatch a post'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id
    OR NEW.assigned_run_id IS DISTINCT FROM OLD.assigned_run_id
    OR NEW.courier_delivery_fee IS DISTINCT FROM OLD.courier_delivery_fee
  THEN
    IF OLD.status NOT IN ('received', 'postponed') OR NEW.status <> 'assigned' THEN
      RAISE EXCEPTION 'Only an administrator can edit and redispatch a post'
        USING ERRCODE = '42501';
    END IF;
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
  -- Direct Dashboard/SQL and service-role work has no application user. It is
  -- allowed to make an emergency correction even when a COD review is pending.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
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

NOTIFY pgrst, 'reload schema';
