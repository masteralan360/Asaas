-- Commission settlement hardening (runs after the initial settlement migrations)
--
-- This migration deliberately does not change historic money movements. It
-- makes future automatic settlements use only money that actually reached an
-- active payment account, caps them by the current account balance, and leaves
-- any unfunded amount outstanding for review instead of creating a fictional
-- payout. It also prevents clients from fabricating automatic commission
-- payment transactions.

ALTER TABLE crm.sales_orders
  ADD COLUMN IF NOT EXISTS commission_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS sales_orders_commission_enabled_idx
  ON crm.sales_orders (workspace_id, sales_account_agent_id)
  WHERE commission_enabled = true
    AND sales_account_agent_id IS NOT NULL
    AND is_deleted = false;

CREATE OR REPLACE FUNCTION private.validate_automatic_agent_commission_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry crm.agent_commission_entries%ROWTYPE;
  v_order_number text;
BEGIN
  IF NEW.source_type <> 'agent_commission_payout' THEN
    RETURN NEW;
  END IF;

  SELECT entry.*
  INTO v_entry
  FROM crm.agent_commission_entries AS entry
  JOIN crm.sales_orders AS sales_order
    ON sales_order.id = entry.order_id
   AND sales_order.workspace_id = entry.workspace_id
   AND sales_order.is_deleted = false
  WHERE entry.id = NEW.source_subrecord_id
    AND entry.workspace_id = NEW.workspace_id
    AND entry.is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automatic commission payment must match its generated commission payout'
      USING ERRCODE = '23514';
  END IF;

  SELECT sales_order.order_number
  INTO v_order_number
  FROM crm.sales_orders AS sales_order
  WHERE sales_order.id = v_entry.order_id
    AND sales_order.workspace_id = v_entry.workspace_id
    AND sales_order.is_deleted = false;

  IF v_entry.kind <> 'payout'
    OR v_entry.status <> 'paid'
    OR v_entry.settlement_source <> 'automatic'
    OR v_entry.amount >= 0
    OR NEW.source_module <> 'orders'
    OR NEW.source_record_id <> v_entry.agent_id
    OR NEW.direction <> 'outgoing'
    OR NEW.currency <> v_entry.currency
    OR abs(NEW.amount) <> abs(v_entry.amount)
  THEN
    RAISE EXCEPTION 'Automatic commission payment must match its generated commission payout'
      USING ERRCODE = '23514';
  END IF;

  -- The SO number and metadata must be derived from the immutable payout
  -- relationship, never supplied by a client.
  NEW.reference_label := v_order_number;
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'agentCommissionEntryId', v_entry.id,
      'agentId', v_entry.agent_id,
      'orderId', v_entry.order_id,
      'automaticSettlement', true
    );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_automatic_agent_commission_payment
  ON public.payment_transactions;
CREATE TRIGGER validate_automatic_agent_commission_payment
  BEFORE INSERT ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_automatic_agent_commission_payment();

-- Automatic payout rows are created only by the SECURITY DEFINER settlement
-- trigger below. Users can still read them, but cannot insert, alter, or soft
-- delete them through the generic payment API.
DROP POLICY IF EXISTS payment_transactions_insert ON public.payment_transactions;
CREATE POLICY payment_transactions_insert
  ON public.payment_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND source_type <> 'agent_commission_payout'
  );

DROP POLICY IF EXISTS payment_transactions_update ON public.payment_transactions;
CREATE POLICY payment_transactions_update
  ON public.payment_transactions
  FOR UPDATE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND source_type <> 'agent_commission_payout'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND source_type <> 'agent_commission_payout'
  );

DROP POLICY IF EXISTS payment_transactions_delete ON public.payment_transactions;
CREATE POLICY payment_transactions_delete
  ON public.payment_transactions
  FOR DELETE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND source_type <> 'agent_commission_payout'
  );

CREATE INDEX IF NOT EXISTS payment_transactions_commission_payout_lookup_idx
  ON public.payment_transactions (workspace_id, account_id, currency, source_subrecord_id)
  WHERE source_type = 'agent_commission_payout'
    AND is_deleted = false;

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
  v_remaining numeric := 0;
  v_payout crm.agent_commission_entries%ROWTYPE;
  v_counterparty_name text;
  v_funding record;
  v_current_balance numeric := 0;
  v_already_allocated numeric := 0;
  v_available numeric := 0;
  v_settlement_amount numeric := 0;
  v_has_account_backed_receipt boolean := false;
BEGIN
  -- Only immutable reconciliation events can make an order commission payable.
  -- Manual adjustments remain explicit obligations; they are never silently
  -- paid from a different order's cash receipt.
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
    OR COALESCE(v_order.commission_enabled, true) = false
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

  v_remaining := round(LEAST(v_assignment_due, v_agent_due), 6);
  IF v_remaining <= 0.000001 THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.payment_transactions AS payment
    WHERE payment.workspace_id = NEW.workspace_id
      AND payment.source_type = 'sales_order'
      AND payment.source_record_id = v_order.id
      AND payment.direction = 'incoming'
      AND payment.account_id IS NOT NULL
      AND payment.reversal_of_transaction_id IS NULL
      AND payment.is_deleted = false
      AND lower(payment.currency) = lower(NEW.currency)
      AND payment.amount > COALESCE((
        SELECT sum(abs(reversal.amount))
        FROM public.payment_transactions AS reversal
        WHERE reversal.workspace_id = payment.workspace_id
          AND reversal.reversal_of_transaction_id = payment.id
          AND reversal.is_deleted = false
      ), 0) + 0.000001
  ) INTO v_has_account_backed_receipt;

  SELECT partner.name
  INTO v_counterparty_name
  FROM crm.agents AS agent
  JOIN crm.business_partners AS partner ON partner.id = agent.business_partner_id
  WHERE agent.id = NEW.agent_id
    AND agent.workspace_id = NEW.workspace_id
    AND COALESCE(agent.is_deleted, false) = false
    AND COALESCE(partner.is_deleted, false) = false;

  FOR v_funding IN
    WITH receipt_totals AS (
      SELECT payment.account_id,
             sum(payment.amount - COALESCE((
               SELECT sum(abs(reversal.amount))
               FROM public.payment_transactions AS reversal
               WHERE reversal.workspace_id = payment.workspace_id
                 AND reversal.reversal_of_transaction_id = payment.id
                 AND reversal.is_deleted = false
             ), 0)) AS receipt_amount
      FROM public.payment_transactions AS payment
      WHERE payment.workspace_id = NEW.workspace_id
        AND payment.source_type = 'sales_order'
        AND payment.source_record_id = v_order.id
        AND payment.direction = 'incoming'
        AND payment.account_id IS NOT NULL
        AND payment.reversal_of_transaction_id IS NULL
        AND payment.is_deleted = false
        AND lower(payment.currency) = lower(NEW.currency)
      GROUP BY payment.account_id
    )
    SELECT receipts.account_id,
           receipts.receipt_amount,
           account.name AS account_name,
           latest_payment.payment_method,
           COALESCE(latest_payment.account_name_snapshot, account.name) AS account_name_snapshot,
           false AS ledger_only
    FROM receipt_totals AS receipts
    JOIN payment_accounts.accounts AS account
      ON account.id = receipts.account_id
     AND account.workspace_id = NEW.workspace_id
     AND account.is_active = true
     AND account.is_deleted = false
    JOIN LATERAL (
      SELECT payment_method, account_name_snapshot
      FROM public.payment_transactions
      WHERE workspace_id = NEW.workspace_id
        AND source_type = 'sales_order'
        AND source_record_id = v_order.id
        AND account_id = receipts.account_id
        AND direction = 'incoming'
        AND reversal_of_transaction_id IS NULL
        AND is_deleted = false
      ORDER BY paid_at DESC, created_at DESC, id DESC
      LIMIT 1
    ) AS latest_payment ON true
    WHERE receipts.receipt_amount > 0.000001

    UNION ALL

    SELECT NULL::uuid,
           NULL::numeric,
           NULL::text,
           'unknown'::text,
           NULL::text,
           true
    WHERE NOT v_has_account_backed_receipt

    ORDER BY account_id NULLS LAST
  LOOP
    EXIT WHEN v_remaining <= 0.000001;

    IF v_funding.ledger_only THEN
      v_available := v_remaining;
    ELSE
      -- Lock account balances in a stable account-id order before deciding the
      -- amount. The payment-account trigger performs the same final
      -- non-negative enforcement when the outgoing payment is inserted.
      SELECT balance.balance_amount
      INTO v_current_balance
      FROM payment_accounts.account_balances AS balance
      WHERE balance.workspace_id = NEW.workspace_id
        AND balance.account_id = v_funding.account_id
        AND lower(balance.currency) = lower(NEW.currency)
        AND balance.is_deleted = false
      FOR UPDATE;

      v_current_balance := COALESCE(v_current_balance, 0);
      SELECT COALESCE(sum(abs(payment.amount)), 0)
      INTO v_already_allocated
      FROM public.payment_transactions AS payment
      JOIN crm.agent_commission_entries AS payout
        ON payout.id = payment.source_subrecord_id
       AND payout.workspace_id = payment.workspace_id
       AND payout.order_id = v_order.id
       AND payout.kind = 'payout'
       AND payout.is_deleted = false
      WHERE payment.workspace_id = NEW.workspace_id
        AND payment.source_type = 'agent_commission_payout'
        AND payment.account_id = v_funding.account_id
        AND lower(payment.currency) = lower(NEW.currency)
        AND payment.is_deleted = false;

      v_available := greatest(
        0,
        least(v_funding.receipt_amount - v_already_allocated, v_current_balance)
      );
    END IF;

    v_settlement_amount := round(least(v_remaining, v_available), 6);
    CONTINUE WHEN v_settlement_amount <= 0.000001;

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
      false, 0, 0, 0, 0, 0, 0, -v_settlement_amount,
      COALESCE(v_order.paid_at, NEW.occurred_at, now()),
      v_order.order_number, 'automatic',
      'Automatically settled after the sales order was paid in full.',
      NEW.created_by, now(), now(), 'synced', 1, false
    )
    RETURNING * INTO v_payout;

    INSERT INTO public.payment_transactions (
      id, workspace_id, source_module, source_type, source_record_id,
      source_subrecord_id, direction, amount, currency, payment_method, paid_at,
      account_id, account_name_snapshot, counterparty_name, reference_label, note,
      created_by, metadata, created_at, updated_at, version, is_deleted
    ) VALUES (
      gen_random_uuid(), NEW.workspace_id, 'orders', 'agent_commission_payout', NEW.agent_id,
      v_payout.id, 'outgoing', abs(v_payout.amount), v_payout.currency,
      COALESCE(v_funding.payment_method, 'unknown'), v_payout.occurred_at,
      v_funding.account_id, v_funding.account_name_snapshot, v_counterparty_name,
      v_order.order_number, 'Automatic agent commission settlement after order payment.', NEW.created_by,
      jsonb_build_object(
        'agentCommissionEntryId', v_payout.id,
        'agentId', NEW.agent_id,
        'orderId', v_order.id,
        'automaticSettlement', true
      ),
      now(), now(), 1, false
    );

    v_remaining := round(v_remaining - v_settlement_amount, 6);
  END LOOP;

  RETURN NEW;
END;
$function$;

-- A commission can be earned while a completed order is still unpaid (for
-- example, a loan or installment order). Reconciliation later sees no new
-- accrual to insert, so settlement must also be callable directly after the
-- order payment state has changed. Keep the account-funded algorithm in one
-- helper and reuse it from both paths.
CREATE OR REPLACE FUNCTION private.settle_paid_sales_agent_commissions_for_order(
  p_workspace_id uuid,
  p_order_id uuid,
  p_created_by uuid DEFAULT NULL
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
  v_assignment_due numeric := 0;
  v_agent_due numeric := 0;
  v_remaining numeric := 0;
  v_payout crm.agent_commission_entries%ROWTYPE;
  v_counterparty_name text;
  v_funding record;
  v_current_balance numeric := 0;
  v_already_allocated numeric := 0;
  v_available numeric := 0;
  v_settlement_amount numeric := 0;
  v_has_account_backed_receipt boolean := false;
  v_settlements integer := 0;
BEGIN
  SELECT *
  INTO v_order
  FROM crm.sales_orders AS sales_order
  WHERE sales_order.id = p_order_id
    AND sales_order.workspace_id = p_workspace_id
    AND COALESCE(sales_order.is_deleted, false) = false;

  IF NOT FOUND
    OR COALESCE(v_order.commission_enabled, true) = false
    OR v_order.status <> 'completed'
    OR NOT (COALESCE(v_order.is_paid, false) OR v_order.payment_status = 'paid')
  THEN
    RETURN 0;
  END IF;

  FOR v_assignment IN
    SELECT assignment.*
    FROM crm.sales_order_agent_assignments AS assignment
    WHERE assignment.workspace_id = p_workspace_id
      AND assignment.order_id = v_order.id
      AND assignment.is_deleted = false
      AND assignment.unassigned_at IS NULL
    ORDER BY assignment.id
  LOOP
    SELECT *
    INTO v_accrual
    FROM crm.agent_commission_entries AS entry
    WHERE entry.workspace_id = p_workspace_id
      AND entry.order_id = v_order.id
      AND entry.assignment_id = v_assignment.id
      AND entry.agent_id = v_assignment.agent_id
      AND entry.kind = 'accrual'
      AND entry.is_deleted = false
    ORDER BY entry.occurred_at, entry.created_at, entry.id
    LIMIT 1;
    CONTINUE WHEN NOT FOUND;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'commission-assignment:' || p_workspace_id::text || ':' || v_assignment.id::text || ':' || lower(v_accrual.currency::text),
        0
      )
    );

    SELECT COALESCE(sum(entry.amount), 0)
    INTO v_assignment_due
    FROM crm.agent_commission_entries AS entry
    WHERE entry.workspace_id = p_workspace_id
      AND entry.assignment_id = v_assignment.id
      AND entry.currency = v_accrual.currency
      AND entry.is_deleted = false
      AND entry.kind NOT IN ('estimate', 'approval');

    SELECT COALESCE(sum(entry.amount), 0)
    INTO v_agent_due
    FROM crm.agent_commission_entries AS entry
    WHERE entry.workspace_id = p_workspace_id
      AND entry.agent_id = v_assignment.agent_id
      AND entry.currency = v_accrual.currency
      AND entry.is_deleted = false
      AND entry.kind NOT IN ('estimate', 'approval');

    v_remaining := round(least(v_assignment_due, v_agent_due), 6);
    CONTINUE WHEN v_remaining <= 0.000001;

    SELECT EXISTS (
      SELECT 1
      FROM public.payment_transactions AS payment
      WHERE payment.workspace_id = p_workspace_id
        AND payment.source_type = 'sales_order'
        AND payment.source_record_id = v_order.id
        AND payment.direction = 'incoming'
        AND payment.account_id IS NOT NULL
        AND payment.reversal_of_transaction_id IS NULL
        AND payment.is_deleted = false
        AND lower(payment.currency) = lower(v_accrual.currency)
        AND payment.amount > COALESCE((
          SELECT sum(abs(reversal.amount))
          FROM public.payment_transactions AS reversal
          WHERE reversal.workspace_id = payment.workspace_id
            AND reversal.reversal_of_transaction_id = payment.id
            AND reversal.is_deleted = false
        ), 0) + 0.000001
    ) INTO v_has_account_backed_receipt;

    SELECT partner.name
    INTO v_counterparty_name
    FROM crm.agents AS agent
    JOIN crm.business_partners AS partner ON partner.id = agent.business_partner_id
    WHERE agent.id = v_assignment.agent_id
      AND agent.workspace_id = p_workspace_id
      AND COALESCE(agent.is_deleted, false) = false
      AND COALESCE(partner.is_deleted, false) = false;

    FOR v_funding IN
      WITH receipt_totals AS (
        SELECT payment.account_id,
               sum(payment.amount - COALESCE((
                 SELECT sum(abs(reversal.amount))
                 FROM public.payment_transactions AS reversal
                 WHERE reversal.workspace_id = payment.workspace_id
                   AND reversal.reversal_of_transaction_id = payment.id
                   AND reversal.is_deleted = false
               ), 0)) AS receipt_amount
        FROM public.payment_transactions AS payment
        WHERE payment.workspace_id = p_workspace_id
          AND payment.source_type = 'sales_order'
          AND payment.source_record_id = v_order.id
          AND payment.direction = 'incoming'
          AND payment.account_id IS NOT NULL
          AND payment.reversal_of_transaction_id IS NULL
          AND payment.is_deleted = false
          AND lower(payment.currency) = lower(v_accrual.currency)
        GROUP BY payment.account_id
      )
      SELECT receipts.account_id,
             receipts.receipt_amount,
             latest_payment.payment_method,
             COALESCE(latest_payment.account_name_snapshot, account.name) AS account_name_snapshot,
             false AS ledger_only
      FROM receipt_totals AS receipts
      JOIN payment_accounts.accounts AS account
        ON account.id = receipts.account_id
       AND account.workspace_id = p_workspace_id
       AND account.is_active = true
       AND account.is_deleted = false
      JOIN LATERAL (
        SELECT payment_method, account_name_snapshot
        FROM public.payment_transactions
        WHERE workspace_id = p_workspace_id
          AND source_type = 'sales_order'
          AND source_record_id = v_order.id
          AND account_id = receipts.account_id
          AND direction = 'incoming'
          AND reversal_of_transaction_id IS NULL
          AND is_deleted = false
        ORDER BY paid_at DESC, created_at DESC, id DESC
        LIMIT 1
      ) AS latest_payment ON true
      WHERE receipts.receipt_amount > 0.000001

      UNION ALL

      SELECT NULL::uuid,
             NULL::numeric,
             'unknown'::text,
             NULL::text,
             true
      WHERE NOT v_has_account_backed_receipt

      ORDER BY account_id NULLS LAST
    LOOP
      EXIT WHEN v_remaining <= 0.000001;

      IF v_funding.ledger_only THEN
        v_available := v_remaining;
      ELSE
        SELECT balance.balance_amount
        INTO v_current_balance
        FROM payment_accounts.account_balances AS balance
        WHERE balance.workspace_id = p_workspace_id
          AND balance.account_id = v_funding.account_id
          AND lower(balance.currency) = lower(v_accrual.currency)
          AND balance.is_deleted = false
        FOR UPDATE;

        v_current_balance := COALESCE(v_current_balance, 0);
        SELECT COALESCE(sum(abs(payment.amount)), 0)
        INTO v_already_allocated
        FROM public.payment_transactions AS payment
        JOIN crm.agent_commission_entries AS payout
          ON payout.id = payment.source_subrecord_id
         AND payout.workspace_id = payment.workspace_id
         AND payout.order_id = v_order.id
         AND payout.kind = 'payout'
         AND payout.is_deleted = false
        WHERE payment.workspace_id = p_workspace_id
          AND payment.source_type = 'agent_commission_payout'
          AND payment.account_id = v_funding.account_id
          AND lower(payment.currency) = lower(v_accrual.currency)
          AND payment.is_deleted = false;

        v_available := greatest(
          0,
          least(v_funding.receipt_amount - v_already_allocated, v_current_balance)
        );
      END IF;

      v_settlement_amount := round(least(v_remaining, v_available), 6);
      CONTINUE WHEN v_settlement_amount <= 0.000001;

      INSERT INTO crm.agent_commission_entries (
        id, workspace_id, order_id, assignment_id, agent_id,
        membership_id, plan_id, order_return_id, related_entry_id,
        kind, status, currency, calculation_basis, include_tax,
        include_delivery_charge, basis_amount, revenue_amount, cost_amount,
        tax_amount, delivery_charge_amount, rate_percent, amount, occurred_at,
        payout_reference, settlement_source, notes, created_by, created_at,
        updated_at, sync_status, version, is_deleted
      ) VALUES (
        gen_random_uuid(), p_workspace_id, v_order.id, v_assignment.id, v_assignment.agent_id,
        NULL, NULL, NULL, NULL,
        'payout', 'paid', v_accrual.currency, v_accrual.calculation_basis, false,
        false, 0, 0, 0, 0, 0, 0, -v_settlement_amount,
        COALESCE(v_order.paid_at, v_accrual.occurred_at, now()),
        v_order.order_number, 'automatic',
        'Automatically settled after the sales order was paid in full.',
        COALESCE(p_created_by, v_accrual.created_by), now(), now(), 'synced', 1, false
      )
      RETURNING * INTO v_payout;

      INSERT INTO public.payment_transactions (
        id, workspace_id, source_module, source_type, source_record_id,
        source_subrecord_id, direction, amount, currency, payment_method, paid_at,
        account_id, account_name_snapshot, counterparty_name, reference_label, note,
        created_by, metadata, created_at, updated_at, version, is_deleted
      ) VALUES (
        gen_random_uuid(), p_workspace_id, 'orders', 'agent_commission_payout', v_assignment.agent_id,
        v_payout.id, 'outgoing', abs(v_payout.amount), v_payout.currency,
        COALESCE(v_funding.payment_method, 'unknown'), v_payout.occurred_at,
        v_funding.account_id, v_funding.account_name_snapshot, v_counterparty_name,
        v_order.order_number, 'Automatic agent commission settlement after order payment.',
        COALESCE(p_created_by, v_accrual.created_by),
        jsonb_build_object(
          'agentCommissionEntryId', v_payout.id,
          'agentId', v_assignment.agent_id,
          'orderId', v_order.id,
          'automaticSettlement', true
        ),
        now(), now(), 1, false
      );

      v_remaining := round(v_remaining - v_settlement_amount, 6);
      v_settlements := v_settlements + 1;
    END LOOP;
  END LOOP;

  RETURN v_settlements;
END;
$function$;

CREATE OR REPLACE FUNCTION private.settle_paid_sales_agent_commission_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (NEW.kind IN ('accrual', 'reversal')
      OR (NEW.kind = 'adjustment' AND NEW.related_entry_id IS NOT NULL))
    AND NEW.assignment_id IS NOT NULL
    AND NEW.order_id IS NOT NULL
  THEN
    PERFORM private.settle_paid_sales_agent_commissions_for_order(
      NEW.workspace_id,
      NEW.order_id,
      NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Reconciliation used to settle only when it inserted a new accrual. Preserve
-- its established calculation implementation, then settle outstanding earned
-- amounts after every successful reconciliation (including payment completion
-- for loan and installment orders).
DO $block$
BEGIN
  IF to_regprocedure('public.reconcile_sales_agent_commission_core(uuid,uuid)') IS NULL THEN
    EXECUTE 'ALTER FUNCTION public.reconcile_sales_agent_commission(uuid, uuid) RENAME TO reconcile_sales_agent_commission_core';
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
  v_changed integer;
  v_workspace_id uuid;
BEGIN
  v_changed := public.reconcile_sales_agent_commission_core(p_order_id, p_order_return_id);

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

REVOKE ALL ON FUNCTION public.reconcile_sales_agent_commission_core(uuid, uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_sales_agent_commission(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.validate_automatic_agent_commission_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.settle_paid_sales_agent_commission_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.settle_paid_sales_agent_commissions_for_order(uuid, uuid, uuid) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
