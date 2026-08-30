-- Couriers and operational staff still update statuses for their assigned
-- posts. Commercial amendments and a replacement manifest, however, are an
-- administrator-only correction flow.
CREATE OR REPLACE FUNCTION delivery.restrict_non_admin_shipment_amendments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.current_user_role() = 'admin' THEN
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
    -- Keep the pre-existing staff dispatch workflow for unassigned or
    -- postponed posts, but never let staff replace an active assignment.
    IF OLD.status NOT IN ('received', 'postponed') OR NEW.status <> 'assigned' THEN
      RAISE EXCEPTION 'Only an administrator can edit and redispatch a post'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restrict_non_admin_shipment_amendments ON delivery.delivery_shipments;
CREATE TRIGGER restrict_non_admin_shipment_amendments
  BEFORE UPDATE ON delivery.delivery_shipments
  FOR EACH ROW
  EXECUTE FUNCTION delivery.restrict_non_admin_shipment_amendments();
