-- Voice reasons are immutable delivery-event evidence.  The browser captures
-- PCM and encodes a real FLAC client-side before writing the object below; the
-- event persists only the private Storage object path and its duration.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voice', 'voice', false, 104857600, ARRAY['audio/flac']::text[])
ON CONFLICT (id) DO NOTHING;

ALTER TABLE delivery.delivery_shipment_events
  ADD COLUMN IF NOT EXISTS voice_reason_path text NULL,
  ADD COLUMN IF NOT EXISTS voice_reason_duration_ms integer NULL;

CREATE OR REPLACE FUNCTION delivery.is_delivery_voice_reason_path(
  p_path text,
  p_workspace_id uuid,
  p_shipment_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT
    p_path ~* (
      '^' || p_workspace_id::text || '/' || p_shipment_id::text ||
      '/(' || p_status || ')/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.flac$'
    );
$$;

CREATE OR REPLACE FUNCTION delivery.assert_voice_reason_storage_object()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.voice_reason_path IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = 'voice'
      AND object.name = NEW.voice_reason_path
      AND object.metadata ->> 'mimetype' = 'audio/flac'
  ) THEN
    RAISE EXCEPTION 'Voice reason recording was not uploaded' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_voice_reason_storage_object ON delivery.delivery_shipment_events;
CREATE TRIGGER delivery_voice_reason_storage_object
  BEFORE INSERT OR UPDATE OF voice_reason_path, voice_reason_duration_ms
  ON delivery.delivery_shipment_events
  FOR EACH ROW
  EXECUTE FUNCTION delivery.assert_voice_reason_storage_object();

ALTER TABLE delivery.delivery_shipment_events
  DROP CONSTRAINT IF EXISTS delivery_shipment_event_reason_check,
  DROP CONSTRAINT IF EXISTS delivery_shipment_event_reason_source_check,
  DROP CONSTRAINT IF EXISTS delivery_shipment_event_voice_reason_duration_check,
  DROP CONSTRAINT IF EXISTS delivery_shipment_event_voice_reason_path_check;

ALTER TABLE delivery.delivery_shipment_events
  ADD CONSTRAINT delivery_shipment_event_reason_source_check
    CHECK (
      status NOT IN ('postponed', 'returned', 'cancelled')
      OR (
        status = 'cancelled'
        AND char_length(btrim(coalesce(note, ''))) > 0
      )
      OR (
        status IN ('postponed', 'returned')
        AND (
          char_length(btrim(coalesce(note, ''))) > 0
          OR voice_reason_path IS NOT NULL
        )
      )
    ),
  ADD CONSTRAINT delivery_shipment_event_voice_reason_duration_check
    CHECK (
      (voice_reason_path IS NULL AND voice_reason_duration_ms IS NULL)
      OR (
        voice_reason_path IS NOT NULL
        AND voice_reason_duration_ms BETWEEN 1 AND 1800000
      )
    ),
  ADD CONSTRAINT delivery_shipment_event_voice_reason_path_check
    CHECK (
      voice_reason_path IS NULL
      OR delivery.is_delivery_voice_reason_path(
        voice_reason_path,
        workspace_id,
        shipment_id,
        status
      )
    );

-- A path is not merely client input: it must be a current user's own
-- assigned shipment (or an administrator's workspace shipment).  This same
-- check governs upload, signed-url reads, and delete/re-record cleanup.
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

REVOKE ALL ON FUNCTION delivery.assert_voice_reason_storage_object() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
