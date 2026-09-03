-- A staff user linked to a field agent earns qualifying product commission for
-- sales they create, even when no manual or sales-account beneficiary was
-- selected. The derived assignment is product-only: it must not grant the
-- agent's normal whole-order commission plan on unrelated lines.

ALTER TABLE crm.sales_order_agent_assignments
  DROP CONSTRAINT IF EXISTS sales_order_agent_assignments_source_check,
  ADD CONSTRAINT sales_order_agent_assignments_source_check
    CHECK (assignment_source IN ('manual', 'sales_account', 'order_creator_product'));

COMMENT ON COLUMN crm.sales_order_agent_assignments.assignment_source IS
  'manual is user-selected, sales_account follows the selected agent account, and order_creator_product is a product-only attribution derived from the linked staff user who created the sale.';

-- Creator-derived assignments must stay product-only on every reconciliation,
-- not only on the first pass when the assignment is inserted after the core
-- routine has run. Extend the established core query without copying its
-- calculation implementation into another migration.
DO $block$
DECLARE
  v_definition text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef(
    'public.reconcile_sales_agent_commission_core(uuid, uuid)'::regprocedure
  )
  INTO v_definition;
  -- Function bodies retain the line endings used by the migration that created
  -- them. Normalize CRLF before matching so this migration behaves identically
  -- whether the source migration was applied from Windows or Unix.
  v_definition := replace(v_definition, chr(13), '');
  v_original := v_definition;

  IF position('order_creator_product' IN v_definition) = 0 THEN
    v_definition := replace(
      v_definition,
      E'      AND assignment.is_deleted = false\n    ORDER BY assignment.agent_id, assignment.id',
      E'      AND assignment.is_deleted = false\n      AND COALESCE(assignment.assignment_source, ''manual'') <> ''order_creator_product''\n    ORDER BY assignment.agent_id, assignment.id'
    );
    IF v_definition = v_original THEN
      RAISE EXCEPTION 'Could not exclude product-only creator assignments from core commission reconciliation';
    END IF;
    EXECUTE v_definition;
  END IF;
END;
$block$;

-- The order-level switch controls optional manual and sales-account payouts.
-- Creator product commission is automatic, including POS customer checkout
-- where that optional switch can remain false. Narrow the exception to this
-- derived assignment source when the common settlement helper scans an order.
DO $block$
DECLARE
  v_definition text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef(
    'private.settle_paid_sales_agent_commissions_for_order(uuid, uuid, uuid)'::regprocedure
  )
  INTO v_definition;
  -- See the core reconciler rewrite above: stored PL/pgSQL source may contain
  -- CRLF even though this migration's replacement strings use LF.
  v_definition := replace(v_definition, chr(13), '');
  v_original := v_definition;

  IF position('assignment.assignment_source = ''order_creator_product''' IN v_definition) = 0 THEN
    v_definition := replace(
      v_definition,
      E'    OR COALESCE(v_order.commission_enabled, true) = false\n    OR v_order.status <> ''completed''',
      E'    OR v_order.status <> ''completed'''
    );
    v_definition := replace(
      v_definition,
      E'      AND assignment.unassigned_at IS NULL\n    ORDER BY assignment.id',
      E'      AND assignment.unassigned_at IS NULL\n      AND (\n        COALESCE(v_order.commission_enabled, true)\n        OR assignment.assignment_source = ''order_creator_product''\n      )\n    ORDER BY assignment.id'
    );

    IF v_definition = v_original
      OR position('OR COALESCE(v_order.commission_enabled, true) = false' IN v_definition) > 0
      OR position('assignment.assignment_source = ''order_creator_product''' IN v_definition) = 0
    THEN
      RAISE EXCEPTION 'Could not extend commission settlement for product-only creator assignments';
    END IF;
    EXECUTE v_definition;
  ELSIF position('OR COALESCE(v_order.commission_enabled, true) = false' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Commission settlement has an inconsistent product-only creator assignment patch';
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION private.ensure_order_creator_product_commission_assignment(
  p_order_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order crm.sales_orders%ROWTYPE;
  v_agent crm.agents%ROWTYPE;
  v_event_at timestamptz;
  v_previous_assignment_id uuid;
  v_previous_unassigned_at timestamptz;
  v_inserted integer := 0;
BEGIN
  SELECT *
  INTO v_order
  FROM crm.sales_orders AS sales_order
  WHERE sales_order.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_order.created_by IS NULL
    OR v_order.status <> 'completed'
    OR NOT (COALESCE(v_order.is_paid, false) OR v_order.payment_status = 'paid')
    OR COALESCE(v_order.return_status, 'none') = 'full'
    OR COALESCE(v_order.is_deleted, false)
  THEN
    RETURN 0;
  END IF;

  SELECT agent.*
  INTO v_agent
  FROM crm.agents AS agent
  WHERE agent.workspace_id = v_order.workspace_id
    AND agent.linked_user_id = v_order.created_by
    AND agent.agent_type = 'field_agent'
    AND agent.status = 'active'
    AND COALESCE(agent.is_deleted, false) = false
  ORDER BY agent.id
  LIMIT 1;

  IF NOT FOUND OR EXISTS (
    SELECT 1
    FROM crm.sales_order_agent_assignments AS assignment
    WHERE assignment.workspace_id = v_order.workspace_id
      AND assignment.order_id = v_order.id
      AND assignment.agent_id = v_agent.id
      AND assignment.unassigned_at IS NULL
      AND assignment.is_deleted = false
  ) THEN
    RETURN 0;
  END IF;

  v_event_at := GREATEST(
    COALESCE(v_order.actual_delivery_date, '-infinity'::timestamptz),
    COALESCE(v_order.paid_at, '-infinity'::timestamptz),
    COALESCE(v_order.updated_at, v_order.created_at, now())
  );

  SELECT assignment.id, assignment.unassigned_at
  INTO v_previous_assignment_id, v_previous_unassigned_at
  FROM crm.sales_order_agent_assignments AS assignment
  WHERE assignment.workspace_id = v_order.workspace_id
    AND assignment.order_id = v_order.id
    AND assignment.agent_id = v_agent.id
    AND assignment.is_deleted = false
  ORDER BY assignment.assigned_at DESC, assignment.id
  LIMIT 1;
  IF FOUND THEN
    v_event_at := GREATEST(v_event_at, COALESCE(v_previous_unassigned_at, v_event_at));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_order.items) = 'array' THEN v_order.items ELSE '[]'::jsonb END
    ) AS item(value)
    JOIN LATERAL (
      SELECT rule.*
      FROM crm.product_commission_rules AS rule
      WHERE rule.workspace_id = v_order.workspace_id
        AND rule.product_id = NULLIF(COALESCE(item.value->>'product_id', item.value->>'productId'), '')::uuid
        AND rule.is_deleted = false
        AND rule.is_active = true
        AND rule.effective_from <= v_event_at
        AND (rule.effective_to IS NULL OR v_event_at < rule.effective_to)
      ORDER BY rule.effective_from DESC, rule.id
      LIMIT 1
    ) AS active_rule ON true
    WHERE GREATEST(
      COALESCE(NULLIF(item.value->>'quantity', '')::numeric, 0)
        - GREATEST(COALESCE(
            NULLIF(item.value->>'returned_quantity', '')::numeric,
            NULLIF(item.value->>'returnedQuantity', '')::numeric,
            0
          ), 0),
      0
    ) > 0
      AND (
        active_rule.recipient_scope = 'all_assigned'
        OR EXISTS (
          SELECT 1
          FROM crm.product_commission_rule_agents AS recipient
          WHERE recipient.workspace_id = v_order.workspace_id
            AND recipient.rule_id = active_rule.id
            AND recipient.agent_id = v_agent.id
            AND recipient.is_deleted = false
        )
      )
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO crm.sales_order_agent_assignments (
    id,
    workspace_id,
    order_id,
    agent_id,
    assignment_source,
    assigned_at,
    assigned_by,
    reassignment_reason,
    previous_assignment_id,
    created_at,
    updated_at,
    sync_status,
    version,
    is_deleted
  ) VALUES (
    gen_random_uuid(),
    v_order.workspace_id,
    v_order.id,
    v_agent.id,
    'order_creator_product',
    v_event_at,
    v_order.created_by,
    'Automatically attributed from the staff user who created the sale',
    v_previous_assignment_id,
    now(),
    now(),
    'synced',
    1,
    false
  )
  ON CONFLICT (workspace_id, order_id, agent_id)
    WHERE unassigned_at IS NULL AND is_deleted = false
    DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

-- Linked agents need the applicable rule snapshots to preview their automatic
-- commission before the order exists. This is an ownership entitlement, not a
-- commission-administration permission. Keep the catalog narrow: all-assigned
-- rules apply to them, while selected-assigned rules are visible only when
-- their own agent is a configured recipient.
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

-- Keep the original ordering for existing assignments, then add the product-
-- only creator assignment before product-line reconciliation. This prevents
-- the normal core from applying a whole-order plan to a derived recipient.
CREATE OR REPLACE FUNCTION public.reconcile_sales_agent_commission(
  p_order_id uuid,
  p_order_return_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_changed integer := 0;
  v_workspace_id uuid;
BEGIN
  PERFORM set_config('atlas.defer_commission_settlement', 'on', true);
  v_changed := public.reconcile_sales_agent_commission_core(p_order_id, p_order_return_id);
  v_changed := v_changed + private.ensure_order_creator_product_commission_assignment(p_order_id);
  v_changed := v_changed + private.reconcile_product_sales_agent_commission(p_order_id, p_order_return_id);
  PERFORM set_config('atlas.defer_commission_settlement', 'off', true);

  SELECT workspace_id
  INTO v_workspace_id
  FROM crm.sales_orders
  WHERE id = p_order_id
    AND COALESCE(is_deleted, false) = false;
  IF v_workspace_id IS NOT NULL THEN
    PERFORM private.settle_paid_sales_agent_commissions_for_order(
      v_workspace_id,
      p_order_id,
      (SELECT auth.uid())
    );
  END IF;
  RETURN v_changed;
END;
$function$;

REVOKE ALL ON FUNCTION private.ensure_order_creator_product_commission_assignment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_sales_agent_commission_core(uuid, uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_sales_agent_commission(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
