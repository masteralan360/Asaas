-- Automatic product commission is an ownership entitlement for an active
-- field agent linked to the signed-in staff user. Reading the applicable rule
-- snapshot must not depend on commission-management or reporting permissions.
-- Other agents' selected-recipient rows remain hidden.

DROP POLICY IF EXISTS product_commission_rule_agents_select ON crm.product_commission_rule_agents;
CREATE POLICY product_commission_rule_agents_select
  ON crm.product_commission_rule_agents
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = workspace_id),
      'sales_agent_commissions'
    )
    AND (
      private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewAll')
      OR EXISTS (
        SELECT 1
        FROM crm.agents AS agent
        WHERE agent.id = product_commission_rule_agents.agent_id
          AND agent.workspace_id = product_commission_rule_agents.workspace_id
          AND agent.linked_user_id = (SELECT auth.uid())
          AND agent.agent_type = 'field_agent'
          AND agent.status = 'active'
          AND COALESCE(agent.is_deleted, false) = false
      )
    )
  );

DROP POLICY IF EXISTS product_commission_rules_select ON crm.product_commission_rules;
CREATE POLICY product_commission_rules_select
  ON crm.product_commission_rules
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = workspace_id),
      'sales_agent_commissions'
    )
    AND (
      private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
      OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewAll')
      OR EXISTS (
        SELECT 1
        FROM crm.agents AS agent
        WHERE agent.workspace_id = product_commission_rules.workspace_id
          AND agent.linked_user_id = (SELECT auth.uid())
          AND agent.agent_type = 'field_agent'
          AND agent.status = 'active'
          AND COALESCE(agent.is_deleted, false) = false
          AND (
            product_commission_rules.recipient_scope = 'all_assigned'
            OR EXISTS (
              SELECT 1
              FROM crm.product_commission_rule_agents AS recipient
              WHERE recipient.workspace_id = product_commission_rules.workspace_id
                AND recipient.rule_id = product_commission_rules.id
                AND recipient.agent_id = agent.id
                AND recipient.is_deleted = false
            )
          )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
