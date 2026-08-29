-- Automatic Sales Agent Commission Settlement
--
-- Once a completed sales order becomes fully paid, its eligible commission is
-- settled as an append-only payout. This runs from the server-side commission
-- ledger so cloud and hybrid workspaces remain Supabase-authoritative. The
-- payment transaction is deliberately ledger-only: no payment account is
-- guessed or debited by a background process.

ALTER TABLE crm.agent_commission_entries
  ADD COLUMN IF NOT EXISTS settlement_source text NOT NULL DEFAULT 'manual';

ALTER TABLE crm.agent_commission_entries
  DROP CONSTRAINT IF EXISTS agent_commission_entries_settlement_source_check;

ALTER TABLE crm.agent_commission_entries
  ADD CONSTRAINT agent_commission_entries_settlement_source_check
  CHECK (settlement_source IN ('manual', 'automatic'));

CREATE OR REPLACE FUNCTION private.settle_paid_sales_agent_commission_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order crm.sales_orders%ROWTYPE;
  v_assignment crm.sales_order_agent_assignments%ROWTYPE;
  v_assignment_due numeric := 0;
  v_agent_due numeric := 0;
  v_payout crm.agent_commission_entries%ROWTYPE;
  v_counterparty_name text;
BEGIN
  -- Only reconciliation entries can make commission newly payable. Payouts,
  -- approvals, estimates, and manual adjustments must never cascade here.
  IF (NEW.kind NOT IN ('accrual', 'reversal')
      AND NOT (NEW.kind = 'adjustment' AND NEW.related_entry_id IS NOT NULL))
    OR NEW.assignment_id IS NULL
    OR NEW.order_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_order
  FROM crm.sales_orders AS sales_order
  WHERE sales_order.id = NEW.order_id
    AND sales_order.workspace_id = NEW.workspace_id
    AND COALESCE(sales_order.is_deleted, false) = false;

  IF NOT FOUND
    OR v_order.status <> 'completed'
    OR NOT (COALESCE(v_order.is_paid, false) OR v_order.payment_status = 'paid')
  THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_assignment
  FROM crm.sales_order_agent_assignments AS assignment
  WHERE assignment.id = NEW.assignment_id
    AND assignment.workspace_id = NEW.workspace_id
    AND assignment.order_id = v_order.id
    AND assignment.agent_id = NEW.agent_id
    AND assignment.is_deleted = false
    AND assignment.unassigned_at IS NULL;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- The reconciliation routine already takes this lock. Keeping it here also
  -- makes independently inserted server reconciliation rows idempotent.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commission-assignment:' || NEW.workspace_id::text || ':' || NEW.assignment_id::text || ':' || lower(NEW.currency::text),
      0
    )
  );

  SELECT COALESCE(sum(entry.amount), 0)
  INTO v_assignment_due
  FROM crm.agent_commission_entries AS entry
  WHERE entry.workspace_id = NEW.workspace_id
    AND entry.assignment_id = NEW.assignment_id
    AND entry.currency = NEW.currency
    AND entry.is_deleted = false
    AND entry.kind NOT IN ('estimate', 'approval');

  SELECT COALESCE(sum(entry.amount), 0)
  INTO v_agent_due
  FROM crm.agent_commission_entries AS entry
  WHERE entry.workspace_id = NEW.workspace_id
    AND entry.agent_id = NEW.agent_id
    AND entry.currency = NEW.currency
    AND entry.is_deleted = false
    AND entry.kind NOT IN ('estimate', 'approval');

  IF v_assignment_due <= 0.000001 OR v_agent_due <= 0.000001 THEN
    RETURN NEW;
  END IF;

  INSERT INTO crm.agent_commission_entries (
    id, workspace_id, order_id, assignment_id, agent_id,
    membership_id, plan_id, order_return_id, related_entry_id,
    kind, status, currency, calculation_basis, include_tax,
    include_delivery_charge, basis_amount, revenue_amount, cost_amount,
    tax_amount, delivery_charge_amount, rate_percent, amount, occurred_at,
    payout_reference, settlement_source, notes, created_by, created_at,
    updated_at, sync_status, version, is_deleted
  ) VALUES (
    gen_random_uuid(), NEW.workspace_id, v_order.id, NEW.assignment_id, NEW.agent_id,
    NULL, NULL, NULL, NULL,
    'payout', 'paid', NEW.currency, NEW.calculation_basis, false,
    false, 0, 0, 0, 0, 0, 0, -round(LEAST(v_assignment_due, v_agent_due), 6),
    COALESCE(v_order.paid_at, NEW.occurred_at, now()),
    v_order.order_number, 'automatic',
    'Automatically settled after the sales order was paid in full.',
    NEW.created_by, now(), now(), 'synced', 1, false
  )
  RETURNING * INTO v_payout;

  SELECT partner.name
  INTO v_counterparty_name
  FROM crm.agents AS agent
  JOIN crm.business_partners AS partner ON partner.id = agent.business_partner_id
  WHERE agent.id = NEW.agent_id
    AND agent.workspace_id = NEW.workspace_id
    AND COALESCE(agent.is_deleted, false) = false
    AND COALESCE(partner.is_deleted, false) = false;

  INSERT INTO public.payment_transactions (
    id, workspace_id, source_module, source_type, source_record_id,
    source_subrecord_id, direction, amount, currency, payment_method, paid_at,
    counterparty_name, reference_label, note, created_by, metadata,
    created_at, updated_at, version, is_deleted
  ) VALUES (
    gen_random_uuid(), NEW.workspace_id, 'orders', 'agent_commission_payout', NEW.agent_id,
    v_payout.id, 'outgoing', abs(v_payout.amount), v_payout.currency, 'unknown',
    v_payout.occurred_at, v_counterparty_name, v_order.order_number,
    'Automatic agent commission settlement after order payment.', NEW.created_by,
    pg_catalog.jsonb_build_object(
      'agentCommissionEntryId', v_payout.id,
      'agentId', NEW.agent_id,
      'orderId', v_order.id,
      'automaticSettlement', true
    ),
    now(), now(), 1, false
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS settle_paid_sales_agent_commission_after_entry
  ON crm.agent_commission_entries;
CREATE TRIGGER settle_paid_sales_agent_commission_after_entry
  AFTER INSERT ON crm.agent_commission_entries
  FOR EACH ROW
  EXECUTE FUNCTION private.settle_paid_sales_agent_commission_entry();

-- A payout is now generated only by the database trigger above. Existing
-- historical payout rows stay readable; approvals and manual adjustments are
-- retained as non-cash ledger controls.
DROP POLICY IF EXISTS agent_commission_entries_insert ON crm.agent_commission_entries;
CREATE POLICY agent_commission_entries_insert ON crm.agent_commission_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = agent_commission_entries.workspace_id),
      'sales_agent_commissions'
    )
    AND (
      (kind = 'estimate'
        AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.assignOrders'))
      OR (kind = 'approval'
        AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay'))
      OR (kind = 'adjustment'
        AND related_entry_id IS NULL
        AND private.sales_agent_commissions_has_permission(workspace_id, 'salesAgentCommissions.pay'))
    )
  );

REVOKE ALL ON FUNCTION private.settle_paid_sales_agent_commission_entry() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
