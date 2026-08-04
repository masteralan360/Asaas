-- Product exchanges replace the returned line with a product priced under the
-- same Price Book when the returned sale item was priced from one. The remote
-- validation must therefore accept the Price Book item price, not only the
-- base product price.

CREATE OR REPLACE FUNCTION public.process_sale_product_exchange(
  p_exchange_id uuid,
  p_return_id uuid,
  p_sale_id uuid,
  p_return_sale_item_id uuid,
  p_return_quantity numeric,
  p_replacement_product_id uuid,
  p_replacement_storage_id uuid,
  p_replacement_quantity numeric,
  p_replacement_unit_amount numeric,
  p_settlement_method text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_return_reason text DEFAULT 'Product exchange'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_return_item public.sale_items%ROWTYPE;
  v_replacement_product public.products%ROWTYPE;
  v_replacement_inventory public.inventory%ROWTYPE;
  v_batch public.stock_batches%ROWTYPE;
  v_loan public.loans%ROWTYPE;
  v_installment public.loan_installments%ROWTYPE;
  v_user_role text;
  v_return_result jsonb;
  v_return_amount numeric := 0;
  v_replacement_amount numeric := 0;
  v_difference numeric := 0;
  v_replacement_remaining numeric := 0;
  v_allocated_quantity numeric := 0;
  v_batch_allocations jsonb := '[]'::jsonb;
  v_cash_settlement numeric := 0;
  v_settlement_direction text := NULL;
  v_settlement_transaction_id uuid := NULL;
  v_loan_credit numeric := 0;
  v_credit_remaining numeric := 0;
  v_next_balance numeric := 0;
  v_next_status text := 'active';
  v_next_due_date date := NULL;
  v_payment_id uuid := NULL;
  v_reason text;
  v_expected_replacement_unit_amount numeric := 0;
BEGIN
  IF p_exchange_id IS NULL OR p_return_id IS NULL OR p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Exchange, return, and sale IDs are required';
  END IF;
  IF p_return_quantity IS NULL OR p_return_quantity <= 0
     OR p_replacement_quantity IS NULL OR p_replacement_quantity <= 0 THEN
    RAISE EXCEPTION 'Exchange quantities must be greater than zero';
  END IF;
  IF p_replacement_unit_amount IS NULL OR p_replacement_unit_amount < 0 THEN
    RAISE EXCEPTION 'Replacement unit amount must be zero or greater';
  END IF;

  IF EXISTS (SELECT 1 FROM public.sale_product_exchanges WHERE id = p_exchange_id) THEN
    RETURN jsonb_build_object('success', true, 'exchange_id', p_exchange_id, 'idempotent_replay', true);
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF lower(BTRIM(COALESCE(v_sale.origin, ''))) <> 'pos' THEN
    RAISE EXCEPTION 'Product exchange is available only for POS sales';
  END IF;

  SELECT role INTO v_user_role
  FROM public.profiles
  WHERE id = auth.uid() AND workspace_id = v_sale.workspace_id;
  IF v_user_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized: Only admins and staff can exchange sale products';
  END IF;

  SELECT * INTO v_return_item
  FROM public.sale_items
  WHERE id = p_return_sale_item_id AND sale_id = p_sale_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original sale item not found'; END IF;

  SELECT * INTO v_replacement_product
  FROM public.products
  WHERE id = p_replacement_product_id
    AND workspace_id = v_sale.workspace_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Replacement product not found'; END IF;
  IF lower(COALESCE(v_replacement_product.currency, '')) <> lower(v_sale.settlement_currency) THEN
    RAISE EXCEPTION 'Replacement product currency must match the sale settlement currency';
  END IF;
  v_expected_replacement_unit_amount := COALESCE(v_replacement_product.price, 0);
  IF v_return_item.price_book_id IS NOT NULL THEN
    SELECT pb_item.price
    INTO v_expected_replacement_unit_amount
    FROM public.price_book_items AS pb_item
    JOIN public.price_books AS pb ON pb.id = pb_item.price_book_id
    WHERE pb_item.price_book_id = v_return_item.price_book_id
      AND pb_item.product_id = p_replacement_product_id
      AND pb_item.is_deleted = false
      AND pb.is_deleted = false
      AND lower(pb_item.currency) = lower(v_sale.settlement_currency);
  END IF;
  IF abs(v_expected_replacement_unit_amount - p_replacement_unit_amount) > 0.000001 THEN
    RAISE EXCEPTION 'Replacement unit amount must match the current product price';
  END IF;

  SELECT * INTO v_replacement_inventory
  FROM public.inventory
  WHERE workspace_id = v_sale.workspace_id
    AND product_id = p_replacement_product_id
    AND storage_id = p_replacement_storage_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_replacement_inventory.quantity, 0) < p_replacement_quantity THEN
    RAISE EXCEPTION 'Insufficient inventory in the selected replacement storage';
  END IF;

  -- Allocate replacement batches exactly like POS checkout (FIFO by expiry).
  v_replacement_remaining := p_replacement_quantity;
  FOR v_batch IN
    SELECT * FROM public.stock_batches
    WHERE workspace_id = v_sale.workspace_id
      AND product_id = p_replacement_product_id
      AND storage_id = p_replacement_storage_id
      AND COALESCE(is_deleted, false) = false
    ORDER BY expiry_date ASC NULLS LAST, manufacturing_date ASC NULLS LAST, created_at ASC, batch_number ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_replacement_remaining <= 0;
    v_allocated_quantity := LEAST(v_replacement_remaining, COALESCE(v_batch.quantity, 0));
    IF v_allocated_quantity <= 0 THEN CONTINUE; END IF;
    UPDATE public.stock_batches
    SET quantity = quantity - v_allocated_quantity,
        is_deleted = quantity - v_allocated_quantity <= 0,
        updated_at = now(), version = COALESCE(version, 0) + 1
    WHERE id = v_batch.id;
    v_batch_allocations := v_batch_allocations || jsonb_build_array(jsonb_build_object(
      'batch_id', v_batch.id, 'batch_number', v_batch.batch_number,
      'quantity', v_allocated_quantity, 'price', v_batch.price,
      'cost_price', v_batch.cost_price, 'currency', lower(v_batch.currency),
      'expiry_date', v_batch.expiry_date, 'manufacturing_date', v_batch.manufacturing_date
    ));
    v_replacement_remaining := v_replacement_remaining - v_allocated_quantity;
  END LOOP;

  -- The standard return routine updates sale quantities, inventory and return
  -- ledger entries.  Its full-return loan trigger is skipped only for this
  -- transaction and the return is then labelled as an exchange.
  PERFORM set_config('atlas.product_exchange', 'true', true);
  v_reason := COALESCE(NULLIF(BTRIM(p_return_reason), ''), 'Product exchange');
  v_return_result := public.process_sale_return(
    p_return_id,
    p_sale_id,
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'sale_item_id', p_return_sale_item_id, 'quantity', p_return_quantity)),
    v_reason,
    'product_exchange'
  );
  v_return_amount := COALESCE((v_return_result->>'return_value')::numeric, 0);
  UPDATE public.sale_returns
  SET source = 'exchange', refund_method = NULL, updated_at = timezone('utc', now())
  WHERE id = p_return_id;

  UPDATE public.inventory
  SET quantity = quantity - p_replacement_quantity,
      updated_at = now(), version = COALESCE(version, 0) + 1,
      is_deleted = quantity - p_replacement_quantity <= 0
  WHERE id = v_replacement_inventory.id;
  PERFORM public.refresh_product_inventory_snapshot(p_replacement_product_id);

  v_replacement_amount := p_replacement_quantity * p_replacement_unit_amount;
  v_difference := v_replacement_amount - v_return_amount;

  -- Loan sales retain the same loan.  A cheaper replacement pays down the
  -- balance; a more expensive one increases that loan's principal and balance.
  IF v_sale.payment_method = 'loan' THEN
    SELECT * INTO v_loan
    FROM public.loans
    WHERE workspace_id = v_sale.workspace_id
      AND sale_id = p_sale_id AND source = 'pos'
      AND COALESCE(is_deleted, false) = false
    FOR UPDATE;

    IF FOUND THEN
      IF v_difference < 0 THEN
        v_loan_credit := LEAST(-v_difference, COALESCE(v_loan.balance_amount, 0));
        v_credit_remaining := v_loan_credit;
        FOR v_installment IN
          SELECT * FROM public.loan_installments
          WHERE loan_id = v_loan.id AND COALESCE(is_deleted, false) = false
          ORDER BY installment_no FOR UPDATE
        LOOP
          EXIT WHEN v_credit_remaining <= 0;
          v_allocated_quantity := LEAST(v_credit_remaining, COALESCE(v_installment.balance_amount, 0));
          IF v_allocated_quantity <= 0 THEN CONTINUE; END IF;
          UPDATE public.loan_installments
          SET paid_amount = paid_amount + v_allocated_quantity,
              balance_amount = balance_amount - v_allocated_quantity,
              status = CASE WHEN balance_amount - v_allocated_quantity <= 0 THEN 'paid' ELSE 'partial' END,
              paid_at = CASE WHEN balance_amount - v_allocated_quantity <= 0 THEN now() ELSE paid_at END,
              updated_at = now(), version = COALESCE(version, 0) + 1
          WHERE id = v_installment.id;
          v_credit_remaining := v_credit_remaining - v_allocated_quantity;
        END LOOP;
        v_cash_settlement := -v_difference - v_loan_credit;
      ELSIF v_difference > 0 THEN
        -- Add the extra value to the next unpaid installment, or revive the
        -- final installment if the loan had been completed.
        SELECT * INTO v_installment FROM public.loan_installments
        WHERE loan_id = v_loan.id AND COALESCE(is_deleted, false) = false AND balance_amount > 0
        ORDER BY installment_no LIMIT 1 FOR UPDATE;
        IF NOT FOUND THEN
          SELECT * INTO v_installment FROM public.loan_installments
          WHERE loan_id = v_loan.id AND COALESCE(is_deleted, false) = false
          ORDER BY installment_no DESC LIMIT 1 FOR UPDATE;
        END IF;
        IF FOUND THEN
          UPDATE public.loan_installments
          SET planned_amount = planned_amount + v_difference,
              balance_amount = balance_amount + v_difference,
              status = CASE WHEN due_date < CURRENT_DATE THEN 'overdue' WHEN paid_amount > 0 THEN 'partial' ELSE 'unpaid' END,
              paid_at = NULL, updated_at = now(), version = COALESCE(version, 0) + 1
          WHERE id = v_installment.id;
        END IF;
      END IF;

      v_next_balance := GREATEST(0, COALESCE(v_loan.balance_amount, 0) + v_difference);
      SELECT due_date INTO v_next_due_date
      FROM public.loan_installments
      WHERE loan_id = v_loan.id
        AND COALESCE(is_deleted, false) = false
        AND balance_amount > 0
      ORDER BY installment_no
      LIMIT 1;
      v_next_status := CASE
        WHEN v_next_balance <= 0 THEN 'completed'
        WHEN v_next_due_date IS NOT NULL AND v_next_due_date < CURRENT_DATE THEN 'overdue'
        ELSE 'active'
      END;
      UPDATE public.loans
      SET principal_amount = principal_amount + GREATEST(v_difference, 0),
          total_paid_amount = total_paid_amount + v_loan_credit,
          balance_amount = v_next_balance,
          next_due_date = v_next_due_date,
          status = v_next_status,
          updated_at = now(), version = COALESCE(version, 0) + 1
      WHERE id = v_loan.id;

      IF v_loan_credit > 0 THEN
        v_payment_id := gen_random_uuid();
        INSERT INTO public.loan_payments (id, loan_id, workspace_id, amount, payment_method, paid_at, note, created_by, created_at, updated_at, version, is_deleted)
        VALUES (v_payment_id, v_loan.id, v_sale.workspace_id, v_loan_credit, 'loan_adjustment', now(), 'Product exchange credit ' || p_exchange_id::text, auth.uid(), now(), now(), 1, false);
        INSERT INTO public.payment_transactions (id, workspace_id, source_module, source_type, source_record_id, source_subrecord_id, direction, amount, currency, payment_method, paid_at, counterparty_name, reference_label, note, created_by, metadata, created_at, updated_at, version, is_deleted)
        VALUES (gen_random_uuid(), v_sale.workspace_id, 'loans', CASE WHEN COALESCE(v_loan.loan_category, 'standard') = 'simple' THEN 'simple_loan' ELSE 'loan_installment' END, v_loan.id, v_payment_id, CASE WHEN COALESCE(v_loan.direction, 'lent') = 'borrowed' THEN 'outgoing' ELSE 'incoming' END, v_loan_credit, v_loan.settlement_currency, 'loan_adjustment', now(), v_loan.borrower_name, v_loan.loan_no, 'Product exchange credit', auth.uid(), jsonb_build_object('saleId', p_sale_id, 'saleProductExchangeId', p_exchange_id, 'loanPaymentId', v_payment_id), now(), now(), 1, false);
      END IF;
    ELSE
      v_cash_settlement := abs(v_difference);
    END IF;
  ELSE
    v_cash_settlement := abs(v_difference);
  END IF;

  IF v_cash_settlement > 0 THEN
    IF NULLIF(BTRIM(p_settlement_method), '') IS NULL THEN
      RAISE EXCEPTION 'A settlement method is required for the cash difference';
    END IF;
    v_settlement_direction := CASE WHEN v_difference > 0 THEN 'incoming' ELSE 'outgoing' END;
    v_settlement_transaction_id := gen_random_uuid();
    INSERT INTO public.payment_transactions (id, workspace_id, source_module, source_type, source_record_id, direction, amount, currency, payment_method, paid_at, reference_label, note, created_by, metadata, created_at, updated_at, version, is_deleted)
    VALUES (v_settlement_transaction_id, v_sale.workspace_id, 'sales', 'sale_exchange', p_exchange_id, v_settlement_direction, v_cash_settlement, v_sale.settlement_currency, p_settlement_method, now(), p_exchange_id::text, 'Product exchange settlement', auth.uid(), jsonb_build_object('saleId', p_sale_id, 'saleProductExchangeId', p_exchange_id), now(), now(), 1, false);
  END IF;

  INSERT INTO public.sale_product_exchanges (
    id, workspace_id, sale_id, return_id, return_sale_item_id, return_product_id,
    return_quantity, return_unit_amount, return_amount, return_storage_id,
    replacement_product_id, replacement_storage_id, replacement_quantity,
    replacement_unit_amount, replacement_amount, replacement_batch_allocations,
    settlement_currency, difference_amount, cash_settlement_amount,
    settlement_direction, settlement_method, settlement_transaction_id, loan_id,
    loan_credit_amount, reason, notes, exchanged_by, exchanged_at, status,
    created_at, updated_at, version, is_deleted
  ) VALUES (
    p_exchange_id, v_sale.workspace_id, p_sale_id, p_return_id, p_return_sale_item_id, v_return_item.product_id,
    p_return_quantity, COALESCE(v_return_item.converted_unit_price, v_return_item.unit_price, 0), v_return_amount,
    (SELECT restored_storage_id FROM public.sale_return_items WHERE return_id = p_return_id AND sale_item_id = p_return_sale_item_id),
    p_replacement_product_id, p_replacement_storage_id, p_replacement_quantity,
    p_replacement_unit_amount, v_replacement_amount,
    CASE WHEN jsonb_array_length(v_batch_allocations) > 0 THEN v_batch_allocations ELSE NULL END,
    v_sale.settlement_currency, v_difference, v_cash_settlement,
    v_settlement_direction, NULLIF(BTRIM(p_settlement_method), ''), v_settlement_transaction_id,
    CASE WHEN v_loan.id IS NULL THEN NULL ELSE v_loan.id END,
    v_loan_credit, v_reason, NULLIF(BTRIM(p_note), ''), auth.uid(), now(), 'posted',
    now(), timezone('utc', now()), 1, false
  );

  RETURN jsonb_build_object(
    'success', true, 'exchange_id', p_exchange_id, 'return_id', p_return_id,
    'return_amount', v_return_amount, 'replacement_amount', v_replacement_amount,
    'difference_amount', v_difference, 'cash_settlement_amount', v_cash_settlement,
    'loan_credit_amount', v_loan_credit, 'idempotent_replay', false
  );
END;
$function$;


