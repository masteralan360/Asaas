-- Automatic sales-agent commission payouts use the account that received the
-- order payment. If the order has no active, account-backed payment, keep the
-- established ledger-only fallback rather than guessing an account.

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
  v_payment_account_id uuid;
  v_payment_account_name_snapshot text;
  v_payment_method text := 'unknown';
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

  -- Use the latest order payment which both reached an active account and has
  -- not been fully reversed. This covers initial, progressive, and loan
  -- payments without debiting an account selected for an unpaid loan.
  SELECT payment.account_id,
         COALESCE(payment.account_name_snapshot, account.name),
         payment.payment_method
  INTO v_payment_account_id, v_payment_account_name_snapshot, v_payment_method
  FROM public.payment_transactions AS payment
  JOIN payment_accounts.accounts AS account
    ON account.id = payment.account_id
    AND account.workspace_id = payment.workspace_id
    AND account.is_active = true
    AND account.is_deleted = false
  WHERE payment.workspace_id = NEW.workspace_id
    AND payment.source_type = 'sales_order'
    AND payment.source_record_id = v_order.id
    AND payment.direction = 'incoming'
    AND payment.account_id IS NOT NULL
    AND payment.reversal_of_transaction_id IS NULL
    AND payment.is_deleted = false
    AND payment.amount > COALESCE((
      SELECT sum(abs(reversal.amount))
      FROM public.payment_transactions AS reversal
      WHERE reversal.workspace_id = payment.workspace_id
        AND reversal.reversal_of_transaction_id = payment.id
        AND reversal.is_deleted = false
    ), 0) + 0.000001
  ORDER BY payment.paid_at DESC, payment.created_at DESC, payment.id DESC
  LIMIT 1;

  INSERT INTO public.payment_transactions (
    id, workspace_id, source_module, source_type, source_record_id,
    source_subrecord_id, direction, amount, currency, payment_method, paid_at,
    account_id, account_name_snapshot, counterparty_name, reference_label, note,
    created_by, metadata, created_at, updated_at, version, is_deleted
  ) VALUES (
    gen_random_uuid(), NEW.workspace_id, 'orders', 'agent_commission_payout', NEW.agent_id,
    v_payout.id, 'outgoing', abs(v_payout.amount), v_payout.currency,
    COALESCE(v_payment_method, 'unknown'), v_payout.occurred_at,
    v_payment_account_id, v_payment_account_name_snapshot, v_counterparty_name,
    v_order.order_number, 'Automatic agent commission settlement after order payment.', NEW.created_by,
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

REVOKE ALL ON FUNCTION private.settle_paid_sales_agent_commission_entry() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
