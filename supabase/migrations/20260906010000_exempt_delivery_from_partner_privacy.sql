-- Delivery/Post Service is an operational workflow. Its own module and
-- courier-assignment policies control access; business-partner privacy must
-- not block a post or any record derived from it.

DO $do$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'delivery_merchant_profiles',
    'delivery_shipments',
    'delivery_runs',
    'delivery_run_items',
    'delivery_shipment_events',
    'delivery_shipment_cod_adjustment_requests',
    'delivery_settlements',
    'delivery_ledger_entries'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON delivery.%I',
      'enforce_visible_partner_link_on_' || table_name,
      table_name
    );
    -- These three policies were introduced only by the partner-privacy
    -- migration. The COD-request table keeps its dedicated policies below.
    EXECUTE format('DROP POLICY IF EXISTS delivery_read ON delivery.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS delivery_write ON delivery.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS delivery_update ON delivery.%I', table_name);
  END LOOP;
END;
$do$;

-- Restore the standard Post Service policies for the delivery tables that use
-- the shared policy names. The COD-adjustment-request table retains its
-- dedicated delivery_cod_adjustment_* policies.
DO $do$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'delivery_merchant_profiles',
    'delivery_shipments',
    'delivery_runs',
    'delivery_run_items',
    'delivery_shipment_events',
    'delivery_settlements',
    'delivery_ledger_entries'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY delivery_read ON delivery.%I FOR SELECT TO authenticated USING (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY delivery_write ON delivery.%I FOR INSERT TO authenticated WITH CHECK (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff''))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY delivery_update ON delivery.%I FOR UPDATE TO authenticated USING (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff'')) WITH CHECK (workspace_id = public.current_workspace_id() AND delivery.module_allowed(workspace_id) AND public.current_user_role() IN (''admin'', ''staff''))',
      table_name
    );
  END LOOP;
END;
$do$;

-- Preserve the Post Service "view own" restriction for linked couriers. It
-- is intentionally independent from business-partner visibility.
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

-- Merchant and new-post creation remain administrative. A linked courier can
-- still upsert a post already assigned to them, as before the privacy change.
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
    AND (
      public.current_user_role() = 'admin'
      OR (
        public.current_user_role() = 'staff'
        AND delivery.can_upsert_assigned_shipment(id, workspace_id)
      )
    )
  );

DROP FUNCTION IF EXISTS delivery.enforce_visible_partner_link();
DROP FUNCTION IF EXISTS delivery.can_access_partner_linked_record(uuid, text, jsonb);

NOTIFY pgrst, 'reload schema';
