-- The delivery tables use different row shapes. Keep the field references in
-- table-specific branches so Postgres never tries to resolve a merchant-only
-- field (business_partner_id) against a shipment row.
CREATE OR REPLACE FUNCTION delivery.assert_workspace_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, fleet, delivery
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'delivery_merchant_profiles' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM crm.business_partners AS partner
      WHERE partner.id = NEW.business_partner_id
        AND partner.workspace_id = NEW.workspace_id
        AND COALESCE(partner.is_deleted, false) = false
    ) THEN
      RAISE EXCEPTION 'Merchant must belong to the same workspace' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'delivery_shipments' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM delivery.delivery_merchant_profiles AS profile
      WHERE profile.id = NEW.merchant_profile_id
        AND profile.workspace_id = NEW.workspace_id
        AND COALESCE(profile.is_deleted, false) = false
    ) OR NOT EXISTS (
      SELECT 1
      FROM crm.business_partners AS partner
      WHERE partner.id = NEW.merchant_business_partner_id
        AND partner.workspace_id = NEW.workspace_id
        AND COALESCE(partner.is_deleted, false) = false
    ) OR (
      NEW.assigned_agent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM crm.agents AS agent
        WHERE agent.id = NEW.assigned_agent_id
          AND agent.workspace_id = NEW.workspace_id
          AND COALESCE(agent.is_deleted, false) = false
      )
    ) THEN
      RAISE EXCEPTION 'Shipment links must belong to the same workspace' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'delivery_runs' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM crm.agents AS agent
      WHERE agent.id = NEW.agent_id
        AND agent.workspace_id = NEW.workspace_id
        AND COALESCE(agent.is_deleted, false) = false
    ) OR (
      NEW.vehicle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM fleet.fleet_vehicles AS vehicle
        WHERE vehicle.id = NEW.vehicle_id
          AND vehicle.workspace_id = NEW.workspace_id
          AND COALESCE(vehicle.is_deleted, false) = false
      )
    ) THEN
      RAISE EXCEPTION 'Run links must belong to the same workspace' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
