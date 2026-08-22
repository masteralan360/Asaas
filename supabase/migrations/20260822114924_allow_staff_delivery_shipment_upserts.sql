-- PostgREST evaluates the INSERT policy for an upsert before it resolves the
-- conflict. Status updates are synced as upserts, so staff need a narrowly
-- scoped INSERT-policy exception for the shipments already assigned to their
-- linked courier. New shipment creation remains an admin-only action.

CREATE OR REPLACE FUNCTION delivery.can_upsert_assigned_shipment(
  p_shipment_id uuid,
  p_workspace_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM delivery.delivery_shipments AS existing
    INNER JOIN crm.agents AS agent
      ON agent.id = existing.assigned_agent_id
      AND agent.workspace_id = existing.workspace_id
    WHERE existing.id = p_shipment_id
      AND existing.workspace_id = p_workspace_id
      AND agent.agent_type = 'courier'
      AND agent.linked_user_id = (SELECT auth.uid())
      AND COALESCE(agent.is_deleted, false) = false
  );
$$;

REVOKE ALL ON FUNCTION delivery.can_upsert_assigned_shipment(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delivery.can_upsert_assigned_shipment(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS delivery_write ON delivery.delivery_shipments;
CREATE POLICY delivery_write
  ON delivery.delivery_shipments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND (
      public.current_user_role() = 'admin'
      OR (
        public.current_user_role() = 'staff'
        AND delivery.can_upsert_assigned_shipment(id, workspace_id)
      )
    )
  );

NOTIFY pgrst, 'reload schema';
