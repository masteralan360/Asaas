-- Keep the Storage RLS helper out of the exposed delivery API schema.  It is
-- only callable while evaluating a Storage policy, never through REST RPC.
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.can_access_delivery_voice_reason_object(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  path_parts text[];
  object_workspace_id uuid;
  object_shipment_id uuid;
BEGIN
  IF p_object_name IS NULL OR p_object_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(returned|postponed)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.flac$' THEN
    RETURN false;
  END IF;

  path_parts := string_to_array(p_object_name, '/');
  object_workspace_id := path_parts[1]::uuid;
  object_shipment_id := path_parts[2]::uuid;

  RETURN EXISTS (
    SELECT 1
    FROM delivery.delivery_shipments AS shipment
    WHERE shipment.id = object_shipment_id
      AND shipment.workspace_id = object_workspace_id
      AND NOT shipment.is_deleted
      AND shipment.workspace_id = public.current_workspace_id()
      AND delivery.module_allowed(shipment.workspace_id)
      AND (
        public.current_user_role() = 'admin'
        OR (
          public.current_user_role() = 'staff'
          AND EXISTS (
            SELECT 1
            FROM crm.agents AS agent
            WHERE agent.id = shipment.assigned_agent_id
              AND agent.workspace_id = shipment.workspace_id
              AND agent.agent_type = 'courier'
              AND agent.linked_user_id = (SELECT auth.uid())
              AND COALESCE(agent.is_deleted, false) = false
          )
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.can_access_delivery_voice_reason_object(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_access_delivery_voice_reason_object(text) TO authenticated;

DROP POLICY IF EXISTS delivery_voice_reason_read ON storage.objects;
CREATE POLICY delivery_voice_reason_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'voice'
    AND app_private.can_access_delivery_voice_reason_object(name)
  );

DROP POLICY IF EXISTS delivery_voice_reason_upload ON storage.objects;
CREATE POLICY delivery_voice_reason_upload
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'voice'
    AND lower(storage.extension(name)) = 'flac'
    AND app_private.can_access_delivery_voice_reason_object(name)
  );

DROP POLICY IF EXISTS delivery_voice_reason_delete ON storage.objects;
CREATE POLICY delivery_voice_reason_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'voice'
    AND app_private.can_access_delivery_voice_reason_object(name)
  );

-- Older installations created this helper in the exposed delivery schema.
-- Fresh installations already use app_private, so clean up only when the
-- legacy function actually exists.
DO $$
BEGIN
  IF to_regprocedure('delivery.can_access_voice_reason_object(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION delivery.can_access_voice_reason_object(text) FROM PUBLIC, authenticated';
    EXECUTE 'DROP FUNCTION delivery.can_access_voice_reason_object(text)';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS delivery_shipment_events_actor_agent_id_idx
  ON delivery.delivery_shipment_events (actor_agent_id)
  WHERE actor_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS delivery_shipment_events_actor_user_id_idx
  ON delivery.delivery_shipment_events (actor_user_id)
  WHERE actor_user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
