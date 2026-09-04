-- Car Rental Service is a stand-alone, platform-admin-granted module. It is
-- intentionally separate from fleet: fleet tracks internal assignments while
-- rental tracks customer availability, contracts, and vehicle condition.

CREATE SCHEMA IF NOT EXISTS car_rental;

CREATE OR REPLACE FUNCTION public.workspace_plan_has_module(p_plan text, p_module text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_module, ''))
    WHEN 'pos' THEN true
    WHEN 'instant_pos' THEN false
    WHEN 'kds' THEN false
    WHEN 'sales_history' THEN true
    WHEN 'products' THEN true
    WHEN 'services' THEN false
    WHEN 'storages' THEN true
    WHEN 'inventory_transfer' THEN true
    WHEN 'inventory_transactions' THEN true
    WHEN 'stock_adjustments' THEN true
    WHEN 'ledger' THEN true
    WHEN 'payments' THEN true
    WHEN 'direct_transactions' THEN true
    WHEN 'members' THEN true
    WHEN 'business_partners' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'agents' THEN false
    WHEN 'sales_agent_commissions' THEN false
    WHEN 'post_service' THEN false
    WHEN 'car_rental' THEN false
    WHEN 'customers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'suppliers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'orders' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'ecommerce' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'real_estate' THEN false
    WHEN 'activities' THEN false
    WHEN 'currency_exchange' THEN false
    WHEN 'clinical_appointments' THEN false
    WHEN 'loans' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'installments' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'discounts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'revenue_analytics' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'team_performance' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'invoice_history' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'accounting' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'hr' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'expenses' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'payroll' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsapp' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'manual_entry' THEN false
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION car_rental.module_allowed(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces AS workspace
    WHERE workspace.id = p_workspace_id
      AND workspace.deleted_at IS NULL
      AND public.workspace_module_allowed(p_workspace_id, workspace.plan::text, 'car_rental')
  );
$function$;

CREATE TABLE IF NOT EXISTS car_rental.rental_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plate_number text NOT NULL CHECK (char_length(btrim(plate_number)) > 0),
  make text NULL,
  model text NOT NULL CHECK (char_length(btrim(model)) > 0),
  year integer NULL CHECK (year IS NULL OR year BETWEEN 1900 AND 2200),
  color text NULL,
  vin text NULL,
  category text NULL,
  daily_rate numeric NOT NULL CHECK (daily_rate > 0),
  currency text NOT NULL DEFAULT 'iqd',
  current_odometer numeric NULL CHECK (current_odometer IS NULL OR current_odometer >= 0),
  current_fuel_level text NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'maintenance', 'inactive')),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT rental_vehicle_workspace_plate_unique UNIQUE (workspace_id, plate_number)
);

CREATE TABLE IF NOT EXISTS car_rental.rental_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  request_no text NOT NULL,
  customer_name text NOT NULL CHECK (char_length(btrim(customer_name)) > 0),
  customer_phone text NOT NULL CHECK (char_length(btrim(customer_phone)) > 0),
  business_partner_id uuid NULL REFERENCES crm.business_partners(id) ON DELETE SET NULL,
  preferred_vehicle_id uuid NULL REFERENCES car_rental.rental_vehicles(id) ON DELETE SET NULL,
  requested_start_at timestamptz NOT NULL,
  requested_end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'offered', 'converted', 'rejected', 'cancelled', 'expired')),
  notes text NULL,
  converted_contract_id uuid NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT rental_request_workspace_no_unique UNIQUE (workspace_id, request_no),
  CONSTRAINT rental_request_period_check CHECK (requested_end_at > requested_start_at)
);

CREATE TABLE IF NOT EXISTS car_rental.rental_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contract_no text NOT NULL,
  request_id uuid NULL REFERENCES car_rental.rental_requests(id) ON DELETE SET NULL,
  vehicle_id uuid NOT NULL REFERENCES car_rental.rental_vehicles(id) ON DELETE RESTRICT,
  customer_name text NOT NULL CHECK (char_length(btrim(customer_name)) > 0),
  customer_phone text NOT NULL CHECK (char_length(btrim(customer_phone)) > 0),
  business_partner_id uuid NULL REFERENCES crm.business_partners(id) ON DELETE SET NULL,
  driver_license_no text NULL,
  planned_pickup_at timestamptz NOT NULL,
  planned_return_at timestamptz NOT NULL,
  actual_pickup_at timestamptz NULL,
  actual_return_at timestamptz NULL,
  daily_rate numeric NOT NULL CHECK (daily_rate > 0),
  rental_days integer NOT NULL CHECK (rental_days > 0),
  discount_amount numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  rental_amount numeric NOT NULL CHECK (rental_amount >= 0),
  return_adjustment_amount numeric NOT NULL DEFAULT 0 CHECK (return_adjustment_amount >= 0),
  final_amount numeric NOT NULL CHECK (final_amount >= 0),
  deposit_amount numeric NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  currency text NOT NULL DEFAULT 'iqd',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reserved', 'active', 'returned', 'closed', 'cancelled')),
  handover_odometer numeric NULL CHECK (handover_odometer IS NULL OR handover_odometer >= 0),
  handover_fuel_level text NULL,
  handover_condition text NULL,
  return_odometer numeric NULL CHECK (return_odometer IS NULL OR return_odometer >= 0),
  return_fuel_level text NULL,
  return_condition text NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT rental_contract_workspace_no_unique UNIQUE (workspace_id, contract_no),
  CONSTRAINT rental_contract_period_check CHECK (planned_return_at > planned_pickup_at),
  CONSTRAINT rental_contract_return_after_pickup_check CHECK (actual_return_at IS NULL OR actual_pickup_at IS NULL OR actual_return_at >= actual_pickup_at),
  CONSTRAINT rental_contract_financial_check CHECK (discount_amount <= daily_rate * rental_days AND abs(rental_amount - (daily_rate * rental_days - discount_amount)) < 0.0001 AND abs(final_amount - (rental_amount + return_adjustment_amount)) < 0.0001)
);

ALTER TABLE car_rental.rental_requests
  DROP CONSTRAINT IF EXISTS rental_request_converted_contract_id_fkey;
ALTER TABLE car_rental.rental_requests
  ADD CONSTRAINT rental_request_converted_contract_id_fkey
  FOREIGN KEY (converted_contract_id) REFERENCES car_rental.rental_contracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rental_vehicles_workspace_status_idx
  ON car_rental.rental_vehicles (workspace_id, status, plate_number) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS rental_requests_workspace_status_idx
  ON car_rental.rental_requests (workspace_id, status, created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS rental_contracts_workspace_status_idx
  ON car_rental.rental_contracts (workspace_id, status, planned_pickup_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS rental_contracts_vehicle_period_idx
  ON car_rental.rental_contracts (workspace_id, vehicle_id, planned_pickup_at, planned_return_at) WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION car_rental.assert_contract_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, rental
AS $function$
DECLARE
  v_previous_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_rental.rental_vehicles AS vehicle
    WHERE vehicle.id = NEW.vehicle_id
      AND vehicle.workspace_id = NEW.workspace_id
      AND vehicle.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Rental vehicle must belong to the same workspace' USING ERRCODE = '23514';
  END IF;

  IF NEW.request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM car_rental.rental_requests AS rental_request
    WHERE rental_request.id = NEW.request_id
      AND rental_request.workspace_id = NEW.workspace_id
      AND rental_request.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Rental request must belong to the same workspace' USING ERRCODE = '23514';
  END IF;

  IF NEW.business_partner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.business_partners AS partner
    WHERE partner.id = NEW.business_partner_id
      AND partner.workspace_id = NEW.workspace_id
      AND partner.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Business partner must belong to the same workspace' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NOT NEW.is_deleted AND NOT OLD.is_deleted THEN
    v_previous_status := OLD.status;
    IF NEW.status <> v_previous_status
      AND NOT (
        (v_previous_status = 'draft' AND NEW.status IN ('reserved', 'cancelled'))
        OR (v_previous_status = 'reserved' AND NEW.status IN ('active', 'cancelled'))
        OR (v_previous_status = 'active' AND NEW.status = 'returned')
        OR (v_previous_status = 'returned' AND NEW.status = 'closed')
      )
    THEN
      RAISE EXCEPTION 'Invalid rental contract status transition' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IN ('reserved', 'active', 'returned', 'closed') AND NOT NEW.is_deleted THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.workspace_id::text || ':' || NEW.vehicle_id::text));

    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status = 'draft') THEN
      IF NOT EXISTS (
        SELECT 1 FROM car_rental.rental_vehicles AS vehicle
        WHERE vehicle.id = NEW.vehicle_id
          AND vehicle.workspace_id = NEW.workspace_id
          AND vehicle.status = 'available'
          AND vehicle.is_deleted = false
      ) THEN
        RAISE EXCEPTION 'Rental vehicle is unavailable' USING ERRCODE = '23514';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM car_rental.rental_contracts AS contract
      WHERE contract.workspace_id = NEW.workspace_id
        AND contract.vehicle_id = NEW.vehicle_id
        AND contract.id <> NEW.id
        AND contract.is_deleted = false
        AND contract.status IN ('reserved', 'active', 'returned', 'closed')
        AND tstzrange(contract.planned_pickup_at, contract.planned_return_at, '[)')
          && tstzrange(NEW.planned_pickup_at, NEW.planned_return_at, '[)')
    ) THEN
      RAISE EXCEPTION 'Rental vehicle already has a contract in the selected period' USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION car_rental.assert_request_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, rental
AS $function$
BEGIN
  IF NEW.business_partner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.business_partners AS partner
    WHERE partner.id = NEW.business_partner_id
      AND partner.workspace_id = NEW.workspace_id
      AND partner.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Business partner must belong to the same workspace' USING ERRCODE = '23514';
  END IF;

  IF NEW.preferred_vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM car_rental.rental_vehicles AS vehicle
    WHERE vehicle.id = NEW.preferred_vehicle_id
      AND vehicle.workspace_id = NEW.workspace_id
      AND vehicle.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Preferred vehicle must belong to the same workspace' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION car_rental.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rental_contract_integrity ON car_rental.rental_contracts;
CREATE TRIGGER rental_contract_integrity
  BEFORE INSERT OR UPDATE ON car_rental.rental_contracts
  FOR EACH ROW EXECUTE FUNCTION car_rental.assert_contract_integrity();

DROP TRIGGER IF EXISTS rental_request_integrity ON car_rental.rental_requests;
CREATE TRIGGER rental_request_integrity
  BEFORE INSERT OR UPDATE ON car_rental.rental_requests
  FOR EACH ROW EXECUTE FUNCTION car_rental.assert_request_integrity();

DO $do$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['rental_vehicles', 'rental_requests', 'rental_contracts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS touch_%s_updated_at ON car_rental.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER touch_%s_updated_at BEFORE UPDATE ON car_rental.%I FOR EACH ROW EXECUTE FUNCTION car_rental.touch_updated_at()', table_name, table_name);
  END LOOP;
END;
$do$;

DO $do$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['rental_vehicles', 'rental_requests', 'rental_contracts'] LOOP
    EXECUTE format('ALTER TABLE car_rental.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS rental_read ON car_rental.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS rental_write ON car_rental.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS rental_update ON car_rental.%I', table_name);
    EXECUTE format('CREATE POLICY rental_read ON car_rental.%I FOR SELECT TO authenticated USING (workspace_id = public.current_workspace_id() AND car_rental.module_allowed(workspace_id))', table_name);
    EXECUTE format('CREATE POLICY rental_write ON car_rental.%I FOR INSERT TO authenticated WITH CHECK (workspace_id = public.current_workspace_id() AND car_rental.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff''))', table_name);
    EXECUTE format('CREATE POLICY rental_update ON car_rental.%I FOR UPDATE TO authenticated USING (workspace_id = public.current_workspace_id() AND car_rental.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff'')) WITH CHECK (workspace_id = public.current_workspace_id() AND car_rental.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff''))', table_name);
  END LOOP;
END;
$do$;

CREATE OR REPLACE FUNCTION public.enforce_car_rental_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF (
      (TG_OP <> 'INSERT' AND OLD.type = 'module' AND lower(OLD.key) = 'car_rental')
      OR (TG_OP <> 'DELETE' AND NEW.type = 'module' AND lower(NEW.key) = 'car_rental')
    )
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Car Rental Service access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_car_rental_override_admin_console ON public.workspace_access_overrides;
CREATE TRIGGER enforce_car_rental_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_car_rental_override_admin_console();

GRANT USAGE ON SCHEMA car_rental TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA car_rental TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION car_rental.module_allowed(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_car_rental_override_admin_console() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
