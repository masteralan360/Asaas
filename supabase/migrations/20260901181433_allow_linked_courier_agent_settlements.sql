-- Courier-level remittances, fee payouts, and reimbursements intentionally
-- have no shipment_id. A linked courier must still be able to read their own
-- rows so the staff balance and handover status use the same data as admin.

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
        FROM crm.agents AS agent
        WHERE agent.id = delivery_settlements.agent_id
          AND agent.workspace_id = delivery_settlements.workspace_id
          AND agent.agent_type = 'courier'
          AND agent.linked_user_id = (SELECT auth.uid())
          AND COALESCE(agent.is_deleted, false) = false
      )
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
        FROM crm.agents AS agent
        WHERE agent.id = delivery_ledger_entries.agent_id
          AND agent.workspace_id = delivery_ledger_entries.workspace_id
          AND agent.agent_type = 'courier'
          AND agent.linked_user_id = (SELECT auth.uid())
          AND COALESCE(agent.is_deleted, false) = false
      )
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

NOTIFY pgrst, 'reload schema';
