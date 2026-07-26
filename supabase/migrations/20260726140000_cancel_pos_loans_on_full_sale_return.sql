-- A full return voids the financing created for a POS loan sale.  Any real
-- repayments and non-cash loan adjustments are reversed in the payment ledger.
-- The trigger runs inside process_sale_return's transaction so
-- the return and its financial effects cannot be committed separately.

ALTER TABLE public.loans
  DROP CONSTRAINT IF EXISTS loans_status_check;

ALTER TABLE public.loans
  ADD CONSTRAINT loans_status_check
  CHECK (status IN ('active', 'overdue', 'completed', 'cancelled'));

ALTER TABLE public.loan_installments
  DROP CONSTRAINT IF EXISTS loan_installments_status_check;

ALTER TABLE public.loan_installments
  ADD CONSTRAINT loan_installments_status_check
  CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue', 'cancelled'));

CREATE OR REPLACE FUNCTION public.cancel_pos_loan_after_full_sale_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_loan public.loans%ROWTYPE;
  v_payment public.loan_payments%ROWTYPE;
  v_source_transaction public.payment_transactions%ROWTYPE;
  v_return_id uuid;
  v_source_type text;
  v_reason text;
BEGIN
  IF OLD.return_status = 'full'
     OR NEW.return_status IS DISTINCT FROM 'full'
     OR NEW.payment_method IS DISTINCT FROM 'loan' THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_loan
  FROM public.loans
  WHERE sale_id = NEW.id
    AND workspace_id = NEW.workspace_id
    AND source = 'pos'
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_reason := COALESCE(NULLIF(BTRIM(NEW.return_reason), ''), 'Return');

  SELECT id
  INTO v_return_id
  FROM public.sale_returns
  WHERE sale_id = NEW.id
    AND workspace_id = NEW.workspace_id
    AND status = 'posted'
  ORDER BY returned_at DESC, id DESC
  LIMIT 1;

  UPDATE public.loans
  SET
    total_paid_amount = 0,
    balance_amount = 0,
    next_due_date = NULL,
    status = 'cancelled',
    notes = concat_ws(E'\n', NULLIF(BTRIM(notes), ''), 'Cancelled: linked sale was fully returned (' || v_reason || ').'),
    overdue_reminder_snoozed_at = NULL,
    overdue_reminder_snoozed_for_due_date = NULL,
    updated_at = timezone('utc', now()),
    version = COALESCE(version, 0) + 1
  WHERE id = v_loan.id;

  UPDATE public.loan_installments
  SET
    paid_amount = 0,
    balance_amount = 0,
    status = 'cancelled',
    paid_at = NULL,
    updated_at = timezone('utc', now()),
    version = COALESCE(version, 0) + 1
  WHERE loan_id = v_loan.id
    AND COALESCE(is_deleted, false) = false;

  FOR v_payment IN
    SELECT *
    FROM public.loan_payments
    WHERE loan_id = v_loan.id
      AND COALESCE(is_deleted, false) = false
      AND amount > 0
    ORDER BY paid_at, created_at, id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.payment_transactions existing_refund
      WHERE existing_refund.workspace_id = NEW.workspace_id
        AND COALESCE(existing_refund.is_deleted, false) = false
        AND existing_refund.metadata ->> 'loanPaymentId' = v_payment.id::text
        AND COALESCE((existing_refund.metadata ->> 'fullSaleReturn')::boolean, false)
    ) THEN
      CONTINUE;
    END IF;

    SELECT *
    INTO v_source_transaction
    FROM public.payment_transactions payment_transaction
    WHERE payment_transaction.workspace_id = NEW.workspace_id
      AND COALESCE(payment_transaction.is_deleted, false) = false
      AND payment_transaction.reversal_of_transaction_id IS NULL
      AND (
        payment_transaction.metadata ->> 'loanPaymentId' = v_payment.id::text
        OR (
          payment_transaction.source_subrecord_id = v_payment.id
          AND payment_transaction.source_type IN ('loan_payment', 'simple_loan')
        )
      )
    ORDER BY payment_transaction.paid_at DESC, payment_transaction.created_at DESC, payment_transaction.id DESC
    LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.payment_transactions (
        id, workspace_id, source_module, source_type, source_record_id,
        source_subrecord_id, direction, amount, currency, payment_method,
        paid_at, counterparty_name, reference_label, note, created_by,
        reversal_of_transaction_id, metadata, created_at, updated_at, version, is_deleted
      ) VALUES (
        gen_random_uuid(), NEW.workspace_id, v_source_transaction.source_module,
        v_source_transaction.source_type, v_source_transaction.source_record_id,
        v_source_transaction.source_subrecord_id, v_source_transaction.direction,
        -ABS(v_payment.amount), v_source_transaction.currency,
        v_source_transaction.payment_method, now(), v_source_transaction.counterparty_name,
        v_source_transaction.reference_label,
        'Full sale return: ' || v_reason, NEW.returned_by,
        v_source_transaction.id,
        COALESCE(v_source_transaction.metadata, '{}'::jsonb) || jsonb_build_object(
          'saleId', NEW.id,
          'saleReturnId', v_return_id,
          'loanPaymentId', v_payment.id,
          'fullSaleReturn', true,
          'returnReason', v_reason
        ),
        now(), timezone('utc', now()), 1, false
      );
    ELSE
      v_source_type := CASE
        WHEN COALESCE(v_loan.loan_category, 'standard') = 'simple' THEN 'simple_loan'
        WHEN COALESCE(v_loan.installment_count, 1) > 1 THEN 'loan_installment'
        ELSE 'loan_payment'
      END;

      INSERT INTO public.payment_transactions (
        id, workspace_id, source_module, source_type, source_record_id,
        source_subrecord_id, direction, amount, currency, payment_method,
        paid_at, counterparty_name, reference_label, note, created_by,
        reversal_of_transaction_id, metadata, created_at, updated_at, version, is_deleted
      ) VALUES (
        gen_random_uuid(), NEW.workspace_id, 'loans', v_source_type, v_loan.id,
        v_payment.id,
        CASE WHEN COALESCE(v_loan.direction, 'lent') = 'borrowed' THEN 'outgoing' ELSE 'incoming' END,
        -ABS(v_payment.amount), v_loan.settlement_currency, v_payment.payment_method,
        now(), v_loan.borrower_name, v_loan.loan_no,
        'Full sale return: ' || v_reason, NEW.returned_by,
        NULL,
        jsonb_build_object(
          'saleId', NEW.id,
          'saleReturnId', v_return_id,
          'loanId', v_loan.id,
          'loanPaymentId', v_payment.id,
          'fullSaleReturn', true,
          'returnReason', v_reason,
          'refundWithoutOriginalTransaction', true
        ),
        now(), timezone('utc', now()), 1, false
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS cancel_pos_loan_after_full_sale_return ON public.sales;

CREATE TRIGGER cancel_pos_loan_after_full_sale_return
AFTER UPDATE OF return_status ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.cancel_pos_loan_after_full_sale_return();
