-- An order may credit multiple field agents. Keep a single active historical
-- assignment per agent, rather than a single active assignment for the order.
DROP INDEX IF EXISTS crm.sales_order_agent_assignments_one_active_idx;

-- Safe when the new index was created manually before this migration was recorded.
CREATE UNIQUE INDEX IF NOT EXISTS sales_order_agent_assignments_one_active_agent_idx
  ON crm.sales_order_agent_assignments (workspace_id, order_id, agent_id)
  WHERE unassigned_at IS NULL AND is_deleted = false;

NOTIFY pgrst, 'reload schema';
