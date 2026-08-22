-- When `postService.view_own` is granted, a non-admin sees only shipments
-- assigned to their linked courier. The courier link is authoritative in
-- crm.agents; a workspace user can have only one non-deleted link there.

DROP POLICY IF EXISTS delivery_read ON delivery.delivery_shipments;
CREATE POLICY delivery_read
  ON delivery.delivery_shipments
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('postService.view_own'))
      OR EXISTS (
        SELECT 1
        FROM crm.agents AS agent
        WHERE agent.id = delivery_shipments.assigned_agent_id
          AND agent.workspace_id = delivery_shipments.workspace_id
          AND agent.agent_type = 'courier'
          AND agent.linked_user_id = (SELECT auth.uid())
          AND COALESCE(agent.is_deleted, false) = false
      )
    )
  );

DROP POLICY IF EXISTS delivery_read ON delivery.delivery_shipment_events;
CREATE POLICY delivery_read
  ON delivery.delivery_shipment_events
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND EXISTS (
      SELECT 1
      FROM delivery.delivery_shipments AS shipment
      WHERE shipment.id = delivery_shipment_events.shipment_id
        AND shipment.workspace_id = delivery_shipment_events.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('postService.view_own'))
          OR EXISTS (
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

DROP POLICY IF EXISTS delivery_read ON delivery.delivery_runs;
CREATE POLICY delivery_read
  ON delivery.delivery_runs
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('postService.view_own'))
      OR EXISTS (
        SELECT 1
        FROM delivery.delivery_run_items AS item
        INNER JOIN delivery.delivery_shipments AS shipment
          ON shipment.id = item.shipment_id
          AND shipment.workspace_id = item.workspace_id
        INNER JOIN crm.agents AS agent
          ON agent.id = shipment.assigned_agent_id
          AND agent.workspace_id = shipment.workspace_id
        WHERE item.run_id = delivery_runs.id
          AND item.workspace_id = delivery_runs.workspace_id
          AND agent.agent_type = 'courier'
          AND agent.linked_user_id = (SELECT auth.uid())
          AND COALESCE(agent.is_deleted, false) = false
      )
    )
  );

DROP POLICY IF EXISTS delivery_read ON delivery.delivery_run_items;
CREATE POLICY delivery_read
  ON delivery.delivery_run_items
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND EXISTS (
      SELECT 1
      FROM delivery.delivery_shipments AS shipment
      WHERE shipment.id = delivery_run_items.shipment_id
        AND shipment.workspace_id = delivery_run_items.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('postService.view_own'))
          OR EXISTS (
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

DROP POLICY IF EXISTS delivery_read ON delivery.delivery_settlements;
CREATE POLICY delivery_read
  ON delivery.delivery_settlements
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('postService.view_own'))
      OR EXISTS (
        SELECT 1
        FROM delivery.delivery_shipments AS shipment
        INNER JOIN crm.agents AS agent
          ON agent.id = shipment.assigned_agent_id
          AND agent.workspace_id = shipment.workspace_id
        WHERE shipment.id = delivery_settlements.shipment_id
          AND shipment.workspace_id = delivery_settlements.workspace_id
          AND agent.agent_type = 'courier'
          AND agent.linked_user_id = (SELECT auth.uid())
          AND COALESCE(agent.is_deleted, false) = false
      )
    )
  );

DROP POLICY IF EXISTS delivery_read ON delivery.delivery_ledger_entries;
CREATE POLICY delivery_read
  ON delivery.delivery_ledger_entries
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('postService.view_own'))
      OR EXISTS (
        SELECT 1
        FROM delivery.delivery_shipments AS shipment
        INNER JOIN crm.agents AS agent
          ON agent.id = shipment.assigned_agent_id
          AND agent.workspace_id = shipment.workspace_id
        WHERE shipment.id = delivery_ledger_entries.shipment_id
          AND shipment.workspace_id = delivery_ledger_entries.workspace_id
          AND agent.agent_type = 'courier'
          AND agent.linked_user_id = (SELECT auth.uid())
          AND COALESCE(agent.is_deleted, false) = false
      )
    )
  );

-- New merchants and posts are administrative setup actions. Operational
-- staff may still work with the courier-assigned posts they are permitted to
-- view, under the existing update policies.
DROP POLICY IF EXISTS delivery_write ON delivery.delivery_merchant_profiles;
CREATE POLICY delivery_write
  ON delivery.delivery_merchant_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS delivery_write ON delivery.delivery_shipments;
CREATE POLICY delivery_write
  ON delivery.delivery_shipments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND public.current_user_role() = 'admin'
  );

NOTIFY pgrst, 'reload schema';
