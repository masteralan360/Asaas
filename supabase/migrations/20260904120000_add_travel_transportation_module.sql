-- Travel & Transportation is deliberately override-only: no subscription plan
-- grants it by default. Platform administrators grant `travel_transportation`
-- through workspace_access_overrides when a workspace is entitled to use it.

CREATE SCHEMA IF NOT EXISTS travel_transportation;

CREATE OR REPLACE FUNCTION travel_transportation.module_allowed(p_workspace_id uuid)
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
      AND public.workspace_module_allowed(p_workspace_id, workspace.plan::text, 'travel_transportation')
  );
$function$;

CREATE TABLE IF NOT EXISTS travel_transportation.travel_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  booking_number text NOT NULL,
  currency text NOT NULL,
  travel_date timestamptz NULL,
  passenger_total numeric NOT NULL DEFAULT 0 CHECK (passenger_total >= 0),
  booking_total numeric NOT NULL DEFAULT 0 CHECK (booking_total >= 0),
  adjusted_booking_total numeric NOT NULL DEFAULT 0,
  booking_adjustments jsonb NULL,
  profit_amount numeric NOT NULL DEFAULT 0 CHECK (profit_amount >= 0),
  paid_profit_amount numeric NOT NULL DEFAULT 0 CHECK (paid_profit_amount >= 0),
  outstanding_profit_amount numeric NOT NULL DEFAULT 0 CHECK (outstanding_profit_amount >= 0),
  payment_method text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'booked', 'partially_paid', 'completed', 'cancelled')),
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT travel_bookings_workspace_number_unique UNIQUE (workspace_id, booking_number)
);

CREATE TABLE IF NOT EXISTS travel_transportation.travel_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES travel_transportation.travel_bookings(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) > 0),
  transportation_type text NOT NULL CHECK (transportation_type IN ('flight', 'bus')),
  price numeric NOT NULL CHECK (price > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false
);

-- Keep each table protected from the moment it is created. These explicit
-- statements also allow the Supabase SQL editor to verify the RLS setup
-- instead of relying on the policy loop below.
ALTER TABLE travel_transportation.travel_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_transportation.travel_passengers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS travel_bookings_workspace_status_idx
  ON travel_transportation.travel_bookings (workspace_id, status, created_at DESC)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS travel_bookings_workspace_travel_date_idx
  ON travel_transportation.travel_bookings (workspace_id, travel_date DESC)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS travel_passengers_booking_idx
  ON travel_transportation.travel_passengers (booking_id, transportation_type)
  WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION travel_transportation.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION travel_transportation.assert_booking_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, travel_transportation
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT NEW.is_deleted AND NOT OLD.is_deleted AND NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('booked', 'completed'))
      OR (OLD.status = 'booked' AND NEW.status IN ('partially_paid', 'completed', 'cancelled'))
      OR (OLD.status = 'partially_paid' AND NEW.status IN ('booked', 'partially_paid', 'completed'))
      OR (OLD.status = 'completed' AND NEW.status IN ('booked', 'partially_paid'))
    ) THEN
      RAISE EXCEPTION 'Invalid Travel & Transportation booking status transition'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION travel_transportation.assert_passenger_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, travel_transportation
AS $function$
BEGIN
  IF NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM travel_transportation.travel_bookings AS booking
    WHERE booking.id = NEW.booking_id
      AND booking.workspace_id = NEW.workspace_id
      AND booking.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Passenger booking must belong to the same active workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS touch_travel_bookings_updated_at ON travel_transportation.travel_bookings;
CREATE TRIGGER touch_travel_bookings_updated_at
  BEFORE UPDATE ON travel_transportation.travel_bookings
  FOR EACH ROW EXECUTE FUNCTION travel_transportation.touch_updated_at();

DROP TRIGGER IF EXISTS touch_travel_passengers_updated_at ON travel_transportation.travel_passengers;
CREATE TRIGGER touch_travel_passengers_updated_at
  BEFORE UPDATE ON travel_transportation.travel_passengers
  FOR EACH ROW EXECUTE FUNCTION travel_transportation.touch_updated_at();

DROP TRIGGER IF EXISTS travel_booking_integrity ON travel_transportation.travel_bookings;
CREATE TRIGGER travel_booking_integrity
  BEFORE INSERT OR UPDATE ON travel_transportation.travel_bookings
  FOR EACH ROW EXECUTE FUNCTION travel_transportation.assert_booking_integrity();

DROP TRIGGER IF EXISTS travel_passenger_integrity ON travel_transportation.travel_passengers;
CREATE TRIGGER travel_passenger_integrity
  BEFORE INSERT OR UPDATE ON travel_transportation.travel_passengers
  FOR EACH ROW EXECUTE FUNCTION travel_transportation.assert_passenger_integrity();

DO $do$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['travel_bookings', 'travel_passengers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS travel_read ON travel_transportation.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS travel_insert ON travel_transportation.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS travel_update ON travel_transportation.%I', table_name);
    EXECUTE format(
      'CREATE POLICY travel_read ON travel_transportation.%I FOR SELECT TO authenticated USING (workspace_id = public.current_workspace_id() AND travel_transportation.module_allowed(workspace_id))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY travel_insert ON travel_transportation.%I FOR INSERT TO authenticated WITH CHECK (workspace_id = public.current_workspace_id() AND travel_transportation.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff''))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY travel_update ON travel_transportation.%I FOR UPDATE TO authenticated USING (workspace_id = public.current_workspace_id() AND travel_transportation.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff'')) WITH CHECK (workspace_id = public.current_workspace_id() AND travel_transportation.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff''))',
      table_name
    );
  END LOOP;
END;
$do$;

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON travel_transportation.travel_bookings;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON travel_transportation.travel_bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('travel_transportation');

DROP TRIGGER IF EXISTS enforce_workspace_module_plan_access ON travel_transportation.travel_passengers;
CREATE TRIGGER enforce_workspace_module_plan_access
  BEFORE INSERT OR UPDATE ON travel_transportation.travel_passengers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_module_plan_access('travel_transportation');

CREATE OR REPLACE FUNCTION public.enforce_travel_transportation_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF (
      (TG_OP <> 'INSERT' AND OLD.type = 'module' AND lower(OLD.key) = 'travel_transportation')
      OR (TG_OP <> 'DELETE' AND NEW.type = 'module' AND lower(NEW.key) = 'travel_transportation')
    )
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Travel & Transportation access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_travel_transportation_override_admin_console ON public.workspace_access_overrides;
CREATE TRIGGER enforce_travel_transportation_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_travel_transportation_override_admin_console();

GRANT USAGE ON SCHEMA travel_transportation TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA travel_transportation TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION travel_transportation.module_allowed(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_workspace_module_plan_access() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_travel_transportation_override_admin_console() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
