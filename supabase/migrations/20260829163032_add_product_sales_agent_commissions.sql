-- Product Sales Agent Commissions
--
-- Product commission configuration intentionally lives outside crm.products:
-- a sellable product can have effective-dated terms, selected recipients and
-- an immutable order-line history. The existing aggregate commission ledger
-- remains the payable balance; agent_product_commission_entries explains it.

CREATE TABLE IF NOT EXISTS crm.product_commission_rules (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  commission_type text NOT NULL,
  rate_percent numeric(9, 6) NOT NULL DEFAULT 0,
  fixed_amount numeric(18, 6) NULL,
  fixed_currency text NULL,
  recipient_scope text NOT NULL DEFAULT 'all_assigned',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT product_commission_rules_type_check CHECK (commission_type IN ('fixed_amount', 'percentage')),
  CONSTRAINT product_commission_rules_recipient_scope_check CHECK (recipient_scope IN ('all_assigned', 'selected_assigned')),
  CONSTRAINT product_commission_rules_currency_check CHECK (fixed_currency IS NULL OR fixed_currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT product_commission_rules_terms_check CHECK (
    (commission_type = 'percentage' AND rate_percent > 0 AND rate_percent <= 100 AND fixed_amount IS NULL AND fixed_currency IS NULL)
    OR (commission_type = 'fixed_amount' AND rate_percent = 0 AND fixed_amount > 0 AND fixed_currency IS NOT NULL)
  ),
  CONSTRAINT product_commission_rules_effective_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS product_commission_rules_workspace_product_idx
  ON crm.product_commission_rules (workspace_id, product_id, effective_from DESC)
  WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.product_commission_rule_agents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES crm.product_commission_rules(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT product_commission_rule_agents_unique UNIQUE (rule_id, agent_id)
);

CREATE INDEX IF NOT EXISTS product_commission_rule_agents_workspace_rule_idx
  ON crm.product_commission_rule_agents (workspace_id, rule_id)
  WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.agent_product_commission_entries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES crm.sales_orders(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL REFERENCES crm.sales_order_agent_assignments(id) ON DELETE RESTRICT,
  agent_id uuid NOT NULL REFERENCES crm.agents(id) ON DELETE RESTRICT,
  order_item_id text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  product_sku_snapshot text NULL,
  unit_snapshot text NULL,
  rule_id uuid NULL REFERENCES crm.product_commission_rules(id) ON DELETE SET NULL,
  order_return_id uuid NULL REFERENCES public.order_returns(id) ON DELETE RESTRICT,
  related_entry_id uuid NULL REFERENCES crm.agent_product_commission_entries(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  status text NOT NULL,
  currency text NOT NULL,
  commission_type text NOT NULL,
  rate_percent numeric(9, 6) NOT NULL DEFAULT 0,
  fixed_source_amount numeric(18, 6) NULL,
  fixed_source_currency text NULL,
  fixed_conversion_rate numeric(24, 12) NULL,
  fixed_exchange_rate_source text NULL,
  fixed_exchange_rate_timestamp timestamptz NULL,
  fixed_exchange_rates jsonb NULL,
  quantity numeric(18, 6) NOT NULL,
  basis_amount_per_unit numeric(18, 6) NOT NULL,
  commission_per_unit numeric(18, 6) NOT NULL,
  amount numeric(18, 6) NOT NULL,
  occurred_at timestamptz NOT NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT agent_product_commission_entries_kind_check CHECK (kind IN ('accrual', 'reversal', 'adjustment')),
  CONSTRAINT agent_product_commission_entries_status_check CHECK (status IN ('earned', 'reversed')),
  CONSTRAINT agent_product_commission_entries_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT agent_product_commission_entries_type_check CHECK (commission_type IN ('fixed_amount', 'percentage')),
  CONSTRAINT agent_product_commission_entries_fixed_currency_check CHECK (fixed_source_currency IS NULL OR fixed_source_currency IN ('usd', 'eur', 'iqd', 'try')),
  CONSTRAINT agent_product_commission_entries_shape_check CHECK (
    (commission_type = 'percentage' AND rate_percent > 0 AND fixed_source_amount IS NULL AND fixed_source_currency IS NULL)
    OR (commission_type = 'fixed_amount' AND rate_percent = 0 AND fixed_source_amount > 0 AND fixed_source_currency IS NOT NULL)
  ),
  CONSTRAINT agent_product_commission_entries_quantity_check CHECK (quantity <> 0),
  CONSTRAINT agent_product_commission_entries_amount_check CHECK (abs(amount - round(quantity * commission_per_unit, 6)) <= 0.000001)
);

CREATE INDEX IF NOT EXISTS agent_product_commission_entries_order_assignment_idx
  ON crm.agent_product_commission_entries (workspace_id, order_id, assignment_id, order_item_id, occurred_at)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS agent_product_commission_entries_agent_idx
  ON crm.agent_product_commission_entries (workspace_id, agent_id, occurred_at DESC)
  WHERE is_deleted = false;

ALTER TABLE crm.agent_commission_entries
  ADD COLUMN IF NOT EXISTS plan_commission_amount numeric(18, 6) NULL,
  ADD COLUMN IF NOT EXISTS product_commission_amount numeric(18, 6) NULL;

-- Enforce the workspace graph for configuration and line snapshots. These are
-- server-side invariants; client-side filtering is intentionally not trusted.
CREATE OR REPLACE FUNCTION private.enforce_product_commission_rule_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND (SELECT auth.uid()) IS NOT NULL THEN
    NEW.created_by := (SELECT auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products AS product
    WHERE product.id = NEW.product_id
      AND product.workspace_id = NEW.workspace_id
      AND COALESCE(product.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Product commission product must belong to the same workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_product_commission_rule_agent_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM crm.product_commission_rules AS rule
    WHERE rule.id = NEW.rule_id AND rule.workspace_id = NEW.workspace_id
  ) OR NOT EXISTS (
    SELECT 1 FROM crm.agents AS agent
    WHERE agent.id = NEW.agent_id
      AND agent.workspace_id = NEW.workspace_id
      AND agent.agent_type = 'field_agent'
      AND COALESCE(agent.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Product commission recipient must be a field agent in the same workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_agent_product_commission_entry_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Product commission snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM crm.sales_orders AS sales_order
    WHERE sales_order.id = NEW.order_id AND sales_order.workspace_id = NEW.workspace_id
  ) OR NOT EXISTS (
    SELECT 1 FROM crm.sales_order_agent_assignments AS assignment
    WHERE assignment.id = NEW.assignment_id
      AND assignment.workspace_id = NEW.workspace_id
      AND assignment.order_id = NEW.order_id
      AND assignment.agent_id = NEW.agent_id
  ) THEN
    RAISE EXCEPTION 'Product commission entry must match its order assignment and workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_product_commission_rule_row ON crm.product_commission_rules;
CREATE TRIGGER enforce_product_commission_rule_row BEFORE INSERT OR UPDATE ON crm.product_commission_rules
  FOR EACH ROW EXECUTE FUNCTION private.enforce_product_commission_rule_row();
DROP TRIGGER IF EXISTS enforce_product_commission_rule_agent_row ON crm.product_commission_rule_agents;
CREATE TRIGGER enforce_product_commission_rule_agent_row BEFORE INSERT OR UPDATE ON crm.product_commission_rule_agents
  FOR EACH ROW EXECUTE FUNCTION private.enforce_product_commission_rule_agent_row();
DROP TRIGGER IF EXISTS enforce_agent_product_commission_entry_row ON crm.agent_product_commission_entries;
CREATE TRIGGER enforce_agent_product_commission_entry_row BEFORE INSERT OR UPDATE ON crm.agent_product_commission_entries
  FOR EACH ROW EXECUTE FUNCTION private.enforce_agent_product_commission_entry_row();

ALTER TABLE crm.product_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.product_commission_rule_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.agent_product_commission_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE crm.product_commission_rules FROM anon;
REVOKE ALL ON TABLE crm.product_commission_rule_agents FROM anon;
REVOKE ALL ON TABLE crm.agent_product_commission_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.product_commission_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.product_commission_rule_agents TO authenticated;
GRANT SELECT ON crm.agent_product_commission_entries TO authenticated;
GRANT ALL ON TABLE crm.product_commission_rules TO service_role;
GRANT ALL ON TABLE crm.product_commission_rule_agents TO service_role;
GRANT ALL ON TABLE crm.agent_product_commission_entries TO service_role;

DROP POLICY IF EXISTS product_commission_rules_select ON crm.product_commission_rules;
CREATE POLICY product_commission_rules_select ON crm.product_commission_rules FOR SELECT TO authenticated USING (
  workspace_id = public.current_workspace_id()
  AND public.workspace_module_allowed(workspace_id, (SELECT plan::text FROM public.workspaces WHERE id = workspace_id), 'sales_agent_commissions')
  AND (
    private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
    OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
    OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewAll')
  )
);
DROP POLICY IF EXISTS product_commission_rules_manage ON crm.product_commission_rules;
CREATE POLICY product_commission_rules_manage ON crm.product_commission_rules FOR ALL TO authenticated USING (
  workspace_id = public.current_workspace_id()
  AND public.workspace_module_allowed(workspace_id, (SELECT plan::text FROM public.workspaces WHERE id = workspace_id), 'sales_agent_commissions')
  AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
) WITH CHECK (
  workspace_id = public.current_workspace_id()
  AND public.workspace_module_allowed(workspace_id, (SELECT plan::text FROM public.workspaces WHERE id = workspace_id), 'sales_agent_commissions')
  AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
);

DROP POLICY IF EXISTS product_commission_rule_agents_select ON crm.product_commission_rule_agents;
CREATE POLICY product_commission_rule_agents_select ON crm.product_commission_rule_agents FOR SELECT TO authenticated USING (
  workspace_id = public.current_workspace_id()
  AND public.workspace_module_allowed(workspace_id, (SELECT plan::text FROM public.workspaces WHERE id = workspace_id), 'sales_agent_commissions')
  AND (
    private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
    OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
    OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewAll')
  )
);
DROP POLICY IF EXISTS product_commission_rule_agents_manage ON crm.product_commission_rule_agents;
CREATE POLICY product_commission_rule_agents_manage ON crm.product_commission_rule_agents FOR ALL TO authenticated USING (
  workspace_id = public.current_workspace_id()
  AND public.workspace_module_allowed(workspace_id, (SELECT plan::text FROM public.workspaces WHERE id = workspace_id), 'sales_agent_commissions')
  AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
) WITH CHECK (
  workspace_id = public.current_workspace_id()
  AND public.workspace_module_allowed(workspace_id, (SELECT plan::text FROM public.workspaces WHERE id = workspace_id), 'sales_agent_commissions')
  AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
);

DROP POLICY IF EXISTS agent_product_commission_entries_select ON crm.agent_product_commission_entries;
CREATE POLICY agent_product_commission_entries_select ON crm.agent_product_commission_entries FOR SELECT TO authenticated USING (
  workspace_id = public.current_workspace_id()
  AND public.workspace_module_allowed(workspace_id, (SELECT plan::text FROM public.workspaces WHERE id = workspace_id), 'sales_agent_commissions')
  AND (
    private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewAll')
    OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.managePlans')
    OR private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders')
    OR (private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.viewOwn')
      AND private.sales_agent_commissions_order_is_own(workspace_id, order_id))
  )
);

-- Avoid payouts while the reconciliation wrapper builds both the normal-plan
-- and product-line portions of the same payable commission.
CREATE OR REPLACE FUNCTION private.settle_paid_sales_agent_commission_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF current_setting('atlas.defer_commission_settlement', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF (NEW.kind IN ('accrual', 'reversal') OR (NEW.kind = 'adjustment' AND NEW.related_entry_id IS NOT NULL))
    AND NEW.assignment_id IS NOT NULL AND NEW.order_id IS NOT NULL
  THEN
    PERFORM private.settle_paid_sales_agent_commissions_for_order(NEW.workspace_id, NEW.order_id, NEW.created_by);
  END IF;
  RETURN NEW;
END;
$function$;

-- The product function writes immutable line snapshots and one aggregate
-- adjustment per assignment. Percentage normal-plan commission is removed for
-- the same product line; fixed plans are apportioned by the line's net revenue.
CREATE OR REPLACE FUNCTION private.reconcile_product_sales_agent_commission(
  p_order_id uuid,
  p_order_return_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order crm.sales_orders%ROWTYPE;
  v_assignment crm.sales_order_agent_assignments%ROWTYPE;
  v_accrual crm.agent_commission_entries%ROWTYPE;
  v_rule crm.product_commission_rules%ROWTYPE;
  v_line jsonb;
  v_item_id text;
  v_product_id uuid;
  v_quantity numeric;
  v_returned numeric;
  v_net_quantity numeric;
  v_unit_price numeric;
  v_line_gross numeric;
  v_total_gross numeric;
  v_adjustment_net numeric;
  v_basis_per_unit numeric;
  v_per_unit numeric;
  v_fixed_converted numeric;
  v_product_total numeric := 0;
  v_product_basis numeric := 0;
  v_product_plan_share numeric := 0;
  v_normal_recognized numeric := 0;
  v_current_product_component numeric := 0;
  v_current_plan_component numeric := 0;
  v_product_delta numeric := 0;
  v_plan_delta numeric := 0;
  v_delta numeric;
  v_event_at timestamptz;
  v_eligible boolean;
  v_rule_agent_selected boolean;
  v_actor uuid := (SELECT auth.uid());
  v_changed integer := 0;
  v_source crm.agent_product_commission_entries%ROWTYPE;
  v_current_quantity numeric;
  v_target_quantity numeric;
  v_has_accrual boolean := false;
BEGIN
  -- The aggregate entry trigger remains authoritative for ordinary entries.
  -- Product-derived aggregate rows are admitted only while this server-side
  -- reconciler is running; clients have no INSERT grant on the snapshot table.
  PERFORM set_config('atlas.reconciling_product_commission', 'on', true);
  SELECT * INTO v_order FROM crm.sales_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF (SELECT auth.uid()) IS NULL
    OR public.current_workspace_id() IS DISTINCT FROM v_order.workspace_id
    OR NOT EXISTS (
      SELECT 1 FROM public.workspaces AS workspace
      WHERE workspace.id = v_order.workspace_id
        AND workspace.deleted_at IS NULL
        AND public.workspace_module_allowed(workspace.id, workspace.plan::text, 'sales_agent_commissions')
    )
  THEN
    RAISE EXCEPTION 'Sales order is not available for product commission reconciliation'
      USING ERRCODE = '42501';
  END IF;
  v_eligible := v_order.status = 'completed'
    AND (COALESCE(v_order.is_paid, false) OR v_order.payment_status = 'paid')
    AND COALESCE(v_order.return_status, 'none') <> 'full'
    AND COALESCE(v_order.is_deleted, false) = false;

  SELECT COALESCE(sum(
    CASE WHEN adjustment.value->>'type' = 'addition' THEN 1 ELSE -1 END
    * COALESCE(NULLIF(adjustment.value->>'converted_amount', '')::numeric, NULLIF(adjustment.value->>'convertedAmount', '')::numeric, 0)
  ), 0)
  INTO v_adjustment_net
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_order.order_adjustments) = 'array' THEN v_order.order_adjustments ELSE '[]'::jsonb END) AS adjustment(value);

  SELECT COALESCE(sum(
    GREATEST(COALESCE(NULLIF(value->>'quantity', '')::numeric, 0)
      - LEAST(
        GREATEST(COALESCE(NULLIF(value->>'quantity', '')::numeric, 0)
          + COALESCE(NULLIF(value->>'free_bonus_quantity', '')::numeric, NULLIF(value->>'freeBonusQuantity', '')::numeric, 0), 0),
        GREATEST(COALESCE(NULLIF(value->>'returned_quantity', '')::numeric, NULLIF(value->>'returnedQuantity', '')::numeric, 0), 0)
      ), 0)
    * GREATEST(COALESCE(NULLIF(value->>'converted_unit_price', '')::numeric, NULLIF(value->>'convertedUnitPrice', '')::numeric, 0), 0)
  ), 0)
  INTO v_total_gross
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_order.items) = 'array' THEN v_order.items ELSE '[]'::jsonb END) AS item(value);

  FOR v_assignment IN
    SELECT * FROM crm.sales_order_agent_assignments
    WHERE workspace_id = v_order.workspace_id AND order_id = v_order.id AND is_deleted = false
    ORDER BY id
  LOOP
    SELECT * INTO v_accrual FROM crm.agent_commission_entries
    WHERE workspace_id = v_order.workspace_id AND assignment_id = v_assignment.id AND kind = 'accrual' AND is_deleted = false
    ORDER BY occurred_at, created_at, id LIMIT 1;
    v_has_accrual := FOUND;
    v_event_at := GREATEST(v_assignment.assigned_at, COALESCE(v_order.actual_delivery_date, v_order.paid_at, v_order.updated_at));
    v_product_total := 0;
    v_product_basis := 0;
    v_product_plan_share := 0;

    FOR v_line IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_order.items) = 'array' THEN v_order.items ELSE '[]'::jsonb END)
    LOOP
      v_item_id := COALESCE(NULLIF(v_line->>'id', ''), NULLIF(v_line->>'line_id', ''), NULLIF(v_line->>'lineId', ''));
      IF v_item_id IS NULL THEN CONTINUE; END IF;
      BEGIN v_product_id := COALESCE(NULLIF(v_line->>'product_id', '')::uuid, NULLIF(v_line->>'productId', '')::uuid); EXCEPTION WHEN invalid_text_representation THEN CONTINUE; END;
      v_quantity := GREATEST(COALESCE(NULLIF(v_line->>'quantity', '')::numeric, 0), 0);
      v_returned := GREATEST(COALESCE(NULLIF(v_line->>'returned_quantity', '')::numeric, NULLIF(v_line->>'returnedQuantity', '')::numeric, 0), 0);
      v_net_quantity := GREATEST(v_quantity - v_returned, 0);
      v_unit_price := GREATEST(COALESCE(NULLIF(v_line->>'converted_unit_price', '')::numeric, NULLIF(v_line->>'convertedUnitPrice', '')::numeric, 0), 0);
      v_line_gross := v_net_quantity * v_unit_price;

      SELECT * INTO v_source FROM crm.agent_product_commission_entries
      WHERE workspace_id = v_order.workspace_id AND assignment_id = v_assignment.id AND order_id = v_order.id
        AND order_item_id = v_item_id AND kind = 'accrual' AND is_deleted = false
      ORDER BY occurred_at, created_at, id LIMIT 1;

      IF FOUND THEN
        SELECT COALESCE(sum(quantity), 0) INTO v_current_quantity
        FROM crm.agent_product_commission_entries
        WHERE workspace_id = v_order.workspace_id AND assignment_id = v_assignment.id AND order_id = v_order.id
          AND order_item_id = v_item_id AND is_deleted = false;
        v_target_quantity := CASE WHEN v_eligible AND v_assignment.unassigned_at IS NULL THEN v_net_quantity ELSE 0 END;
        IF abs(v_target_quantity - v_current_quantity) > 0.000001 THEN
          INSERT INTO crm.agent_product_commission_entries (
            id, workspace_id, order_id, assignment_id, agent_id, order_item_id, product_id,
            product_name_snapshot, product_sku_snapshot, unit_snapshot, rule_id, order_return_id,
            related_entry_id, kind, status, currency, commission_type, rate_percent,
            fixed_source_amount, fixed_source_currency, fixed_conversion_rate, fixed_exchange_rate_source,
            fixed_exchange_rate_timestamp, fixed_exchange_rates, quantity, basis_amount_per_unit,
            commission_per_unit, amount, occurred_at, notes, created_by, created_at, updated_at, sync_status, version, is_deleted
          ) VALUES (
            gen_random_uuid(), v_order.workspace_id, v_order.id, v_assignment.id, v_assignment.agent_id, v_source.order_item_id, v_source.product_id,
            v_source.product_name_snapshot, v_source.product_sku_snapshot, v_source.unit_snapshot, v_source.rule_id,
            CASE WHEN v_target_quantity < v_current_quantity THEN p_order_return_id ELSE NULL END,
            v_source.id, CASE WHEN v_target_quantity < v_current_quantity THEN 'reversal' ELSE 'adjustment' END,
            CASE WHEN v_target_quantity < v_current_quantity THEN 'reversed' ELSE 'earned' END,
            v_source.currency, v_source.commission_type, v_source.rate_percent,
            v_source.fixed_source_amount, v_source.fixed_source_currency, v_source.fixed_conversion_rate, v_source.fixed_exchange_rate_source,
            v_source.fixed_exchange_rate_timestamp, v_source.fixed_exchange_rates, v_target_quantity - v_current_quantity,
            v_source.basis_amount_per_unit, v_source.commission_per_unit,
            round((v_target_quantity - v_current_quantity) * v_source.commission_per_unit, 6), now(),
            'Product commission reconciled to committed sales order state', v_actor, now(), now(), 'synced', 1, false
          );
          v_changed := v_changed + 1;
        END IF;
        CONTINUE;
      END IF;

      CONTINUE WHEN NOT v_eligible OR v_assignment.unassigned_at IS NOT NULL OR v_net_quantity <= 0;
      SELECT * INTO v_rule FROM crm.product_commission_rules
      WHERE workspace_id = v_order.workspace_id AND product_id = v_product_id AND is_deleted = false AND is_active = true
        AND effective_from <= v_event_at AND (effective_to IS NULL OR v_event_at < effective_to)
      ORDER BY effective_from DESC LIMIT 1;
      CONTINUE WHEN NOT FOUND;
      SELECT EXISTS(SELECT 1 FROM crm.product_commission_rule_agents WHERE rule_id = v_rule.id AND agent_id = v_assignment.agent_id AND is_deleted = false)
      INTO v_rule_agent_selected;
      CONTINUE WHEN v_rule.recipient_scope = 'selected_assigned' AND NOT v_rule_agent_selected;

      v_basis_per_unit := round(GREATEST((v_line_gross
        - GREATEST(COALESCE(v_order.discount, 0), 0) * CASE WHEN v_total_gross > 0 THEN v_line_gross / v_total_gross ELSE 0 END
        + v_adjustment_net * CASE WHEN v_total_gross > 0 THEN v_line_gross / v_total_gross ELSE 0 END) / v_net_quantity, 0), 6);
      IF v_rule.commission_type = 'percentage' THEN
        v_per_unit := round(v_basis_per_unit * v_rule.rate_percent / 100, 6);
      ELSE
        v_fixed_converted := private.convert_sales_agent_commission_amount(v_rule.fixed_amount, v_rule.fixed_currency, v_order.currency, v_order.exchange_rates);
        IF v_fixed_converted IS NULL THEN
          RAISE EXCEPTION 'Exchange rate unavailable for the product commission currency on this sales order' USING ERRCODE = '23514';
        END IF;
        v_per_unit := round(v_fixed_converted, 6);
      END IF;
      INSERT INTO crm.agent_product_commission_entries (
        id, workspace_id, order_id, assignment_id, agent_id, order_item_id, product_id,
        product_name_snapshot, product_sku_snapshot, unit_snapshot, rule_id, order_return_id,
        related_entry_id, kind, status, currency, commission_type, rate_percent,
        fixed_source_amount, fixed_source_currency, fixed_conversion_rate, fixed_exchange_rate_source,
        fixed_exchange_rate_timestamp, fixed_exchange_rates, quantity, basis_amount_per_unit,
        commission_per_unit, amount, occurred_at, notes, created_by, created_at, updated_at, sync_status, version, is_deleted
      ) VALUES (
        gen_random_uuid(), v_order.workspace_id, v_order.id, v_assignment.id, v_assignment.agent_id, v_item_id, v_product_id,
        COALESCE(v_line->>'product_name', v_line->>'productName', 'Product'), COALESCE(v_line->>'product_sku', v_line->>'productSku'), COALESCE(v_line->>'unit'), v_rule.id,
        NULL, NULL, 'accrual', 'earned', v_order.currency, v_rule.commission_type,
        CASE WHEN v_rule.commission_type = 'percentage' THEN v_rule.rate_percent ELSE 0 END,
        CASE WHEN v_rule.commission_type = 'fixed_amount' THEN v_rule.fixed_amount ELSE NULL END,
        CASE WHEN v_rule.commission_type = 'fixed_amount' THEN v_rule.fixed_currency ELSE NULL END,
        CASE WHEN v_rule.commission_type = 'fixed_amount' AND v_rule.fixed_amount > 0 THEN v_fixed_converted / v_rule.fixed_amount ELSE NULL END,
        CASE WHEN v_rule.commission_type = 'fixed_amount' THEN 'order_snapshot' ELSE NULL END,
        CASE WHEN v_rule.commission_type = 'fixed_amount' THEN v_event_at ELSE NULL END,
        CASE WHEN v_rule.commission_type = 'fixed_amount' THEN v_order.exchange_rates ELSE NULL END,
        v_net_quantity, v_basis_per_unit, v_per_unit, round(v_net_quantity * v_per_unit, 6), v_event_at,
        'Product commission accrued from committed sales order state', v_actor, now(), now(), 'synced', 1, false
      );
      v_changed := v_changed + 1;
    END LOOP;

    SELECT
      COALESCE(sum(entry.amount), 0),
      COALESCE(sum(entry.quantity * entry.basis_amount_per_unit), 0)
    INTO v_product_total, v_product_basis
    FROM crm.agent_product_commission_entries AS entry
    WHERE entry.workspace_id = v_order.workspace_id
      AND entry.assignment_id = v_assignment.id
      AND entry.order_id = v_order.id
      AND entry.is_deleted = false;

    -- An agent can be product-commission-only. The normal reconciler has no
    -- plan/manual terms to accrue in that case, so create the one payable
    -- aggregate entry here. The immutable line rows above remain the detail.
    IF NOT v_has_accrual THEN
      IF abs(v_product_total) <= 0.000001 THEN
        CONTINUE;
      END IF;
      INSERT INTO crm.agent_commission_entries (
        id, workspace_id, order_id, assignment_id, agent_id, membership_id, plan_id, order_return_id, related_entry_id,
        kind, status, currency, calculation_basis, include_tax, include_delivery_charge,
        basis_amount, revenue_amount, cost_amount, tax_amount, delivery_charge_amount, rate_percent,
        plan_commission_amount, product_commission_amount, amount, occurred_at, payout_reference, settlement_source,
        notes, created_by, created_at, updated_at, sync_status, version, is_deleted
      ) VALUES (
        gen_random_uuid(), v_order.workspace_id, v_order.id, v_assignment.id, v_assignment.agent_id,
        NULL, NULL, NULL, NULL, 'accrual', 'earned', lower(v_order.currency::text), 'net_revenue', false, false,
        v_product_basis, v_product_basis, 0, 0, 0, 0,
        0, v_product_total, v_product_total, v_event_at, NULL, 'automatic',
        'Product commission accrued from committed sales order state', v_actor, now(), now(), 'synced', 1, false
      );
      v_changed := v_changed + 1;
      CONTINUE;
    END IF;

    -- The normal reconciler has already produced the whole-order target. A
    -- product rule replaces only its line's normal-plan share. This mirrors
    -- the client calculation: plan terms are apportioned by merchandise value
    -- and manual terms by the order total.
    SELECT COALESCE(sum(entry.amount), 0)
    INTO v_normal_recognized
    FROM crm.agent_commission_entries AS entry
    WHERE entry.workspace_id = v_order.workspace_id
      AND entry.assignment_id = v_assignment.id
      AND entry.order_id = v_order.id
      AND entry.currency = v_accrual.currency
      AND entry.kind IN ('accrual', 'reversal', 'adjustment')
      AND (entry.kind <> 'adjustment' OR entry.related_entry_id IS NOT NULL)
      AND entry.product_commission_amount IS NULL
      AND entry.is_deleted = false;
    v_product_plan_share := CASE
      WHEN v_accrual.membership_id IS NULL AND v_accrual.plan_id IS NULL
        THEN CASE WHEN GREATEST(COALESCE(v_order.total, 0), 0) > 0
          THEN round(v_normal_recognized * LEAST(v_product_basis / GREATEST(v_order.total, 0), 1), 6)
          ELSE 0 END
      ELSE CASE WHEN GREATEST(v_total_gross - GREATEST(COALESCE(v_order.discount, 0), 0) + v_adjustment_net, 0) > 0
        THEN round(v_normal_recognized * LEAST(
          v_product_basis / GREATEST(v_total_gross - GREATEST(COALESCE(v_order.discount, 0), 0) + v_adjustment_net, 0),
          1
        ), 6)
        ELSE 0 END
    END;

    SELECT
      COALESCE(sum(entry.product_commission_amount), 0),
      COALESCE(sum(entry.plan_commission_amount), 0)
    INTO v_current_product_component, v_current_plan_component
    FROM crm.agent_commission_entries AS entry
    WHERE entry.workspace_id = v_order.workspace_id
      AND entry.assignment_id = v_assignment.id
      AND entry.order_id = v_order.id
      AND entry.product_commission_amount IS NOT NULL
      AND entry.is_deleted = false;
    v_product_delta := round(v_product_total - v_current_product_component, 6);
    v_plan_delta := round(-v_product_plan_share - v_current_plan_component, 6);
    v_delta := round(v_product_delta + v_plan_delta, 6);
    IF abs(v_delta) > 0.000001 THEN
      INSERT INTO crm.agent_commission_entries (
        id, workspace_id, order_id, assignment_id, agent_id, membership_id, plan_id, order_return_id, related_entry_id,
        kind, status, currency, calculation_basis, include_tax, include_delivery_charge,
        basis_amount, revenue_amount, cost_amount, tax_amount, delivery_charge_amount, rate_percent,
        plan_commission_amount, product_commission_amount, amount, occurred_at, payout_reference, settlement_source,
        notes, created_by, created_at, updated_at, sync_status, version, is_deleted
      ) VALUES (
        gen_random_uuid(), v_order.workspace_id, v_order.id, v_assignment.id, v_assignment.agent_id,
        v_accrual.membership_id, v_accrual.plan_id, CASE WHEN v_delta < 0 THEN p_order_return_id ELSE NULL END, v_accrual.id,
        'adjustment', CASE WHEN v_delta < 0 THEN 'reversed' ELSE 'earned' END, v_accrual.currency, v_accrual.calculation_basis, v_accrual.include_tax, v_accrual.include_delivery_charge,
        v_accrual.basis_amount, v_accrual.revenue_amount, v_accrual.cost_amount, v_accrual.tax_amount, v_accrual.delivery_charge_amount, v_accrual.rate_percent,
        v_plan_delta, v_product_delta, v_delta, now(), NULL, 'automatic',
        'Product commission reconciled from immutable order-line snapshots', v_actor, now(), now(), 'synced', 1, false
      );
      v_changed := v_changed + 1;
    END IF;
  END LOOP;
  RETURN v_changed;
END;
$function$;

-- Product aggregate rows are derived by the SECURITY DEFINER reconciler. The
-- legacy aggregate validator expects every accrued amount to come from one
-- order-wide plan, so admit only rows created while that reconciler holds its
-- transaction-local guard. Direct Data API clients cannot insert ledger rows.
DO $block$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef('private.enforce_agent_commission_entry_row()'::regprocedure) INTO v_definition;
  IF position('atlas.reconciling_product_commission' IN v_definition) = 0 THEN
    v_definition := replace(
      v_definition,
      '  IF NEW.kind = ''adjustment''',
      E'  IF NEW.product_commission_amount IS NOT NULL\n     AND current_setting(''atlas.reconciling_product_commission'', true) = ''on''\n  THEN\n    RETURN NEW;\n  END IF;\n\n  IF NEW.kind = ''adjustment'''
    );
    IF position('atlas.reconciling_product_commission' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Could not extend the sales-agent commission validator for product commission entries';
    END IF;
    EXECUTE v_definition;
  END IF;
END;
$block$;

-- Reconcile normal terms and product terms as one atomic operation, then
-- settle the final outstanding amount exactly once from the order payment
-- account. The existing `_core` routine is the raw order-wide reconciler;
-- do not wrap the former public settlement wrapper or it would settle before
-- the product replacement adjustment is present.
DO $block$
BEGIN
  IF to_regprocedure('public.reconcile_sales_agent_commission_core(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Sales-agent commission core reconciliation is required before product commissions can be enabled';
  END IF;
END;
$block$;

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
  v_changed := v_changed + private.reconcile_product_sales_agent_commission(p_order_id, p_order_return_id);
  PERFORM set_config('atlas.defer_commission_settlement', 'off', true);
  SELECT workspace_id INTO v_workspace_id FROM crm.sales_orders WHERE id = p_order_id AND COALESCE(is_deleted, false) = false;
  IF v_workspace_id IS NOT NULL THEN
    PERFORM private.settle_paid_sales_agent_commissions_for_order(v_workspace_id, p_order_id, (SELECT auth.uid()));
  END IF;
  RETURN v_changed;
END;
$function$;

REVOKE ALL ON FUNCTION private.enforce_product_commission_rule_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_product_commission_rule_agent_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_agent_product_commission_entry_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reconcile_product_sales_agent_commission(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_sales_agent_commission_core(uuid, uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_sales_agent_commission(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
