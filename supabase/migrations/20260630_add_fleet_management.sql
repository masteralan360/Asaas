CREATE SCHEMA IF NOT EXISTS fleet;

GRANT USAGE ON SCHEMA fleet TO authenticated, service_role;

CREATE OR REPLACE FUNCTION fleet.workspace_permission_allowed(
  p_workspace_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    public.workspace_module_allowed(
      p_workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = p_workspace_id),
      'agents'
    )
    AND (
      public.current_user_role() = 'admin'
      OR NOT public.workspace_capability_allowed(
        p_workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = p_workspace_id),
        'workspaceManagementPermissions'
      )
      OR EXISTS (
        SELECT 1
        FROM public.workspace_permissions permission
        WHERE permission.workspace_id = p_workspace_id
          AND permission.user_uuid = auth.uid()
          AND permission.key = p_permission_key
      )
    );
$function$;

CREATE OR REPLACE FUNCTION fleet.is_linked_agent(
  p_workspace_id uuid,
  p_agent_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM crm.agents agent
    WHERE agent.id = p_agent_id
      AND agent.workspace_id = p_workspace_id
      AND agent.linked_user_id = auth.uid()
      AND agent.status = 'active'
      AND COALESCE(agent.is_deleted, false) = false
      AND public.workspace_module_allowed(
        agent.workspace_id,
        (SELECT w.plan::text FROM public.workspaces w WHERE w.id = agent.workspace_id),
        'agents'
      )
  );
$function$;

CREATE TABLE IF NOT EXISTS fleet.fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plate_number text NOT NULL,
  make text NULL,
  model text NOT NULL,
  year integer NULL,
  color text NULL,
  vin text NULL,
  status text NOT NULL DEFAULT 'active',
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT fleet_vehicles_plate_check CHECK (NULLIF(BTRIM(plate_number), '') IS NOT NULL),
  CONSTRAINT fleet_vehicles_model_check CHECK (NULLIF(BTRIM(model), '') IS NOT NULL),
  CONSTRAINT fleet_vehicles_year_check CHECK (year IS NULL OR year BETWEEN 1900 AND 2200),
  CONSTRAINT fleet_vehicles_status_check CHECK (status IN ('active', 'maintenance', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_vehicles_workspace_plate
  ON fleet.fleet_vehicles (workspace_id, LOWER(BTRIM(plate_number)))
  WHERE COALESCE(is_deleted, false) = false;

CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_workspace_status
  ON fleet.fleet_vehicles (workspace_id, status)
  WHERE COALESCE(is_deleted, false) = false;

CREATE TABLE IF NOT EXISTS fleet.fleet_vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES fleet.fleet_vehicles(id) ON DELETE RESTRICT,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  status text NOT NULL DEFAULT 'active',
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT fleet_vehicle_assignments_status_check CHECK (status IN ('active', 'ended')),
  CONSTRAINT fleet_vehicle_assignments_end_check CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_active_assignment_vehicle
  ON fleet.fleet_vehicle_assignments (workspace_id, vehicle_id)
  WHERE status = 'active' AND COALESCE(is_deleted, false) = false;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_active_assignment_agent
  ON fleet.fleet_vehicle_assignments (workspace_id, agent_id)
  WHERE status = 'active' AND COALESCE(is_deleted, false) = false;

CREATE INDEX IF NOT EXISTS idx_fleet_assignments_workspace_agent
  ON fleet.fleet_vehicle_assignments (workspace_id, agent_id, assigned_at DESC);

CREATE OR REPLACE FUNCTION fleet.enforce_assignment_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, fleet
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM fleet.fleet_vehicles vehicle
    WHERE vehicle.id = NEW.vehicle_id
      AND vehicle.workspace_id = NEW.workspace_id
      AND COALESCE(vehicle.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Fleet vehicle must belong to the assignment workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.agents agent
    WHERE agent.id = NEW.agent_id
      AND agent.workspace_id = NEW.workspace_id
      AND COALESCE(agent.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Agent must belong to the assignment workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_assignment_links ON fleet.fleet_vehicle_assignments;
CREATE TRIGGER enforce_assignment_links
  BEFORE INSERT OR UPDATE ON fleet.fleet_vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION fleet.enforce_assignment_links();

DROP TRIGGER IF EXISTS touch_fleet_vehicles_updated_at ON fleet.fleet_vehicles;
CREATE TRIGGER touch_fleet_vehicles_updated_at
  BEFORE UPDATE ON fleet.fleet_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS touch_fleet_assignments_updated_at ON fleet.fleet_vehicle_assignments;
CREATE TRIGGER touch_fleet_assignments_updated_at
  BEFORE UPDATE ON fleet.fleet_vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO fleet.fleet_vehicles (
  id,
  workspace_id,
  plate_number,
  model,
  status,
  notes,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  agent.workspace_id,
  UPPER(BTRIM(agent.plate_number)),
  BTRIM(agent.car_model),
  CASE WHEN agent.status = 'active' THEN 'active' ELSE 'inactive' END,
  'Migrated from the legacy driver profile',
  COALESCE(agent.created_at, now()),
  COALESCE(agent.updated_at, now())
FROM crm.agents agent
WHERE agent.agent_type = 'driver'
  AND COALESCE(agent.is_deleted, false) = false
  AND NULLIF(BTRIM(agent.plate_number), '') IS NOT NULL
  AND NULLIF(BTRIM(agent.car_model), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM fleet.fleet_vehicles vehicle
    WHERE vehicle.workspace_id = agent.workspace_id
      AND LOWER(BTRIM(vehicle.plate_number)) = LOWER(BTRIM(agent.plate_number))
      AND COALESCE(vehicle.is_deleted, false) = false
  );

INSERT INTO fleet.fleet_vehicle_assignments (
  id,
  workspace_id,
  vehicle_id,
  agent_id,
  assigned_at,
  status,
  notes,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  agent.workspace_id,
  vehicle.id,
  agent.id,
  COALESCE(agent.created_at, now()),
  'active',
  'Migrated from the legacy driver profile',
  COALESCE(agent.created_at, now()),
  COALESCE(agent.updated_at, now())
FROM crm.agents agent
JOIN fleet.fleet_vehicles vehicle
  ON vehicle.workspace_id = agent.workspace_id
 AND LOWER(BTRIM(vehicle.plate_number)) = LOWER(BTRIM(agent.plate_number))
 AND COALESCE(vehicle.is_deleted, false) = false
WHERE agent.agent_type = 'driver'
  AND agent.status = 'active'
  AND COALESCE(agent.is_deleted, false) = false
  AND NOT EXISTS (
    SELECT 1
    FROM fleet.fleet_vehicle_assignments assignment
    WHERE assignment.workspace_id = agent.workspace_id
      AND assignment.agent_id = agent.id
      AND assignment.status = 'active'
      AND COALESCE(assignment.is_deleted, false) = false
  )
  AND NOT EXISTS (
    SELECT 1
    FROM fleet.fleet_vehicle_assignments assignment
    WHERE assignment.workspace_id = agent.workspace_id
      AND assignment.vehicle_id = vehicle.id
      AND assignment.status = 'active'
      AND COALESCE(assignment.is_deleted, false) = false
  );

CREATE TABLE IF NOT EXISTS fleet.location_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  last_seen_at timestamptz NULL,
  device_label text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fleet_location_sessions_status_check CHECK (status IN ('active', 'stopped', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_active_location_session
  ON fleet.location_sessions (workspace_id, agent_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_fleet_location_sessions_workspace_started
  ON fleet.location_sessions (workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS fleet.live_locations (
  agent_id uuid PRIMARY KEY REFERENCES crm.agents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES fleet.location_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy double precision NULL,
  heading double precision NULL,
  speed double precision NULL,
  altitude double precision NULL,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  is_sharing boolean NOT NULL DEFAULT true,
  CONSTRAINT fleet_live_locations_latitude_check CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT fleet_live_locations_longitude_check CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS idx_fleet_live_locations_workspace_recorded
  ON fleet.live_locations (workspace_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS fleet.location_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES fleet.location_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy double precision NULL,
  heading double precision NULL,
  speed double precision NULL,
  altitude double precision NULL,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fleet_location_history_latitude_check CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT fleet_location_history_longitude_check CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS idx_fleet_location_history_workspace_recorded
  ON fleet.location_history (workspace_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_fleet_location_history_agent_recorded
  ON fleet.location_history (agent_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION fleet.close_inactive_agent_operations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, fleet
AS $function$
BEGIN
  IF (
    NEW.status <> 'active'
    OR COALESCE(NEW.is_deleted, false) = true
    OR NEW.linked_user_id IS DISTINCT FROM OLD.linked_user_id
  ) THEN
    UPDATE fleet.live_locations
    SET
      is_sharing = false,
      received_at = now()
    WHERE agent_id = NEW.id
      AND is_sharing = true;

    UPDATE fleet.location_sessions
    SET
      status = 'stopped',
      ended_at = COALESCE(ended_at, now()),
      last_seen_at = COALESCE(last_seen_at, now()),
      updated_at = now()
    WHERE agent_id = NEW.id
      AND status = 'active';

    UPDATE fleet.fleet_vehicle_assignments
    SET
      status = 'ended',
      ended_at = COALESCE(ended_at, now()),
      updated_at = now(),
      version = version + 1
    WHERE agent_id = NEW.id
      AND status = 'active'
      AND COALESCE(is_deleted, false) = false;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS close_inactive_agent_operations ON crm.agents;
CREATE TRIGGER close_inactive_agent_operations
  AFTER UPDATE OF status, is_deleted, linked_user_id ON crm.agents
  FOR EACH ROW EXECUTE FUNCTION fleet.close_inactive_agent_operations();

CREATE OR REPLACE FUNCTION fleet.enforce_location_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, fleet
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'live_locations'
    AND pg_trigger_depth() > 1
    AND NEW.is_sharing = false
  THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id <> auth.uid()
    OR NOT fleet.is_linked_agent(NEW.workspace_id, NEW.agent_id)
  THEN
    RAISE EXCEPTION 'Location updates must belong to the authenticated linked agent'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM fleet.location_sessions session
    WHERE session.id = NEW.session_id
      AND session.workspace_id = NEW.workspace_id
      AND session.agent_id = NEW.agent_id
      AND session.user_id = NEW.user_id
      AND session.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Location session is not active'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_live_location_owner ON fleet.live_locations;
CREATE TRIGGER enforce_live_location_owner
  BEFORE INSERT OR UPDATE ON fleet.live_locations
  FOR EACH ROW EXECUTE FUNCTION fleet.enforce_location_owner();

DROP TRIGGER IF EXISTS enforce_location_history_owner ON fleet.location_history;
CREATE TRIGGER enforce_location_history_owner
  BEFORE INSERT OR UPDATE ON fleet.location_history
  FOR EACH ROW EXECUTE FUNCTION fleet.enforce_location_owner();

ALTER TABLE fleet.fleet_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.fleet_vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.location_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.location_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY fleet_vehicles_select
  ON fleet.fleet_vehicles FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.access')
  );

CREATE POLICY fleet_vehicles_insert
  ON fleet.fleet_vehicles FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.manageVehicles')
  );

CREATE POLICY fleet_vehicles_update
  ON fleet.fleet_vehicles FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.manageVehicles')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.manageVehicles')
  );

CREATE POLICY fleet_vehicles_delete
  ON fleet.fleet_vehicles FOR DELETE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.manageVehicles')
  );

CREATE POLICY fleet_assignments_select
  ON fleet.fleet_vehicle_assignments FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.access')
  );

CREATE POLICY fleet_assignments_insert
  ON fleet.fleet_vehicle_assignments FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.manageAssignments')
  );

CREATE POLICY fleet_assignments_update
  ON fleet.fleet_vehicle_assignments FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.manageAssignments')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.manageAssignments')
  );

CREATE POLICY fleet_assignments_delete
  ON fleet.fleet_vehicle_assignments FOR DELETE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND fleet.workspace_permission_allowed(workspace_id, 'fleet.manageAssignments')
  );

CREATE POLICY fleet_sessions_select
  ON fleet.location_sessions FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      user_id = auth.uid()
      OR fleet.workspace_permission_allowed(workspace_id, 'fleet.viewLiveLocations')
    )
  );

CREATE POLICY fleet_sessions_insert
  ON fleet.location_sessions FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND user_id = auth.uid()
    AND fleet.is_linked_agent(workspace_id, agent_id)
  );

CREATE POLICY fleet_sessions_update
  ON fleet.location_sessions FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND user_id = auth.uid()
    AND fleet.is_linked_agent(workspace_id, agent_id)
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND user_id = auth.uid()
    AND fleet.is_linked_agent(workspace_id, agent_id)
  );

CREATE POLICY fleet_live_locations_select
  ON fleet.live_locations FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      user_id = auth.uid()
      OR fleet.workspace_permission_allowed(workspace_id, 'fleet.viewLiveLocations')
    )
  );

CREATE POLICY fleet_live_locations_insert
  ON fleet.live_locations FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND user_id = auth.uid()
    AND fleet.is_linked_agent(workspace_id, agent_id)
  );

CREATE POLICY fleet_live_locations_update
  ON fleet.live_locations FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND user_id = auth.uid()
    AND fleet.is_linked_agent(workspace_id, agent_id)
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND user_id = auth.uid()
    AND fleet.is_linked_agent(workspace_id, agent_id)
  );

CREATE POLICY fleet_location_history_select
  ON fleet.location_history FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      user_id = auth.uid()
      OR fleet.workspace_permission_allowed(workspace_id, 'fleet.viewHistory')
    )
  );

CREATE POLICY fleet_location_history_insert
  ON fleet.location_history FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND user_id = auth.uid()
    AND fleet.is_linked_agent(workspace_id, agent_id)
  );

ALTER TABLE fleet.live_locations REPLICA IDENTITY FULL;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'fleet'
      AND tablename = 'live_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE fleet.live_locations;
  END IF;
END;
$block$;

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fleet_location_broadcast_receive ON realtime.messages;
CREATE POLICY fleet_location_broadcast_receive
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    extension = 'broadcast'
    AND realtime.topic() = 'fleet-live:' || public.current_workspace_id()::text
    AND fleet.workspace_permission_allowed(
      public.current_workspace_id(),
      'fleet.viewLiveLocations'
    )
  );

DROP POLICY IF EXISTS fleet_location_broadcast_send ON realtime.messages;
CREATE POLICY fleet_location_broadcast_send
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    extension = 'broadcast'
    AND realtime.topic() = 'fleet-live:' || public.current_workspace_id()::text
    AND EXISTS (
      SELECT 1
      FROM crm.agents agent
      WHERE agent.workspace_id = public.current_workspace_id()
        AND agent.linked_user_id = auth.uid()
        AND agent.status = 'active'
        AND COALESCE(agent.is_deleted, false) = false
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_workspace_permissions_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
BEGIN
  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL OR NOT public.workspace_capability_allowed(NEW.workspace_id, v_plan, 'workspaceManagementPermissions') THEN
    RAISE EXCEPTION 'Workspace management permissions are not included in the current workspace plan'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.module IN ('currencyExchange', 'currencyExchangeFeeRules')
    AND NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'currency_exchange')
  THEN
    RAISE EXCEPTION 'Currency Exchange Service is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.module IN ('agents', 'fleet')
    AND NOT public.workspace_module_allowed(NEW.workspace_id, v_plan, 'agents')
  THEN
    RAISE EXCEPTION 'Agents module is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fleet TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA fleet TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fleet.workspace_permission_allowed(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fleet.is_linked_agent(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fleet.enforce_assignment_links() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fleet.close_inactive_agent_operations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fleet.enforce_location_owner() TO authenticated, service_role;

ALTER ROLE authenticator SET pgrst.db_schemas =
  'public, graphql_public, crm, budget, real_estate, fx, clinics, fleet';

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
