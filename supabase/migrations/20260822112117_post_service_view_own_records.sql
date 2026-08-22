-- `postService.view_own` is opt-in. Without it, the existing workspace-wide
-- delivery visibility remains unchanged. When granted, a non-admin may only
-- read shipments they created and the delivery records derived from them.

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
      OR created_by = (SELECT auth.uid())
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
          OR shipment.created_by = (SELECT auth.uid())
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
      -- A newly created manifest is synced before its items, so its creator
      -- must be able to receive the run row during that initial write.
      OR created_by = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1
        FROM delivery.delivery_run_items AS item
        INNER JOIN delivery.delivery_shipments AS shipment
          ON shipment.id = item.shipment_id
          AND shipment.workspace_id = item.workspace_id
        WHERE item.run_id = delivery_runs.id
          AND item.workspace_id = delivery_runs.workspace_id
          AND shipment.created_by = (SELECT auth.uid())
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
          OR shipment.created_by = (SELECT auth.uid())
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
        WHERE shipment.id = delivery_settlements.shipment_id
          AND shipment.workspace_id = delivery_settlements.workspace_id
          AND shipment.created_by = (SELECT auth.uid())
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
        WHERE shipment.id = delivery_ledger_entries.shipment_id
          AND shipment.workspace_id = delivery_ledger_entries.workspace_id
          AND shipment.created_by = (SELECT auth.uid())
      )
    )
  );

-- Merchant profiles remain shared reference data, needed by the post form.

CREATE INDEX IF NOT EXISTS idx_delivery_shipments_workspace_creator_created
  ON delivery.delivery_shipments (workspace_id, created_by, created_at DESC)
  WHERE is_deleted = false;

NOTIFY pgrst, 'reload schema';
