-- Plain order loans are simple loans, but their details page still expects one
-- loan_installments row, matching manually-created simple loans.

CREATE OR REPLACE FUNCTION public.create_order_financing_loan(
  p_workspace_id uuid,
  p_order_type text,
  p_order_id uuid,
  p_order_number text,
  p_partner_id uuid,
  p_partner_name text,
  p_payment_method text,
  p_principal numeric,
  p_currency text,
  p_exchange_rates jsonb,
  p_installment_count integer,
  p_installment_frequency text,
  p_first_due_date date,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, pg_temp
AS $function$
DECLARE
  v_existing uuid;
  v_loan_id uuid := gen_random_uuid();
  v_partner crm.business_partners%ROWTYPE;
  v_direction text;
  v_limit numeric;
  v_usage numeric := 0;
  v_converted numeric;
  v_category text;
  v_count integer;
  v_base numeric;
  v_planned numeric;
  v_due date;
  v_index integer;
  v_plan text;
BEGIN
  IF p_order_type NOT IN ('sales', 'purchase') THEN RAISE EXCEPTION 'invalid_order_type'; END IF;
  IF p_payment_method NOT IN ('loan', 'installments') THEN RAISE EXCEPTION 'invalid_financing_method'; END IF;
  IF p_principal <= 0 THEN RAISE EXCEPTION 'invalid_financed_balance'; END IF;

  SELECT plan::text INTO v_plan FROM public.workspaces WHERE id = p_workspace_id;
  IF NOT public.workspace_module_allowed(
    p_workspace_id,
    v_plan,
    CASE WHEN p_payment_method = 'loan' THEN 'loans' ELSE 'installments' END
  ) THEN
    RAISE EXCEPTION 'financing_module_not_available';
  END IF;

  SELECT id INTO v_existing
  FROM public.loans
  WHERE order_type = p_order_type AND order_id = p_order_id AND is_deleted = false
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT * INTO v_partner
  FROM crm.business_partners
  WHERE id = p_partner_id AND workspace_id = p_workspace_id AND is_deleted = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'business_partner_not_found'; END IF;

  v_direction := CASE WHEN p_order_type = 'sales' THEN 'lent' ELSE 'borrowed' END;
  v_limit := CASE WHEN v_direction = 'lent' THEN v_partner.receivable_credit_limit ELSE v_partner.payable_credit_limit END;

  IF v_limit IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.loans l
      WHERE l.workspace_id = p_workspace_id
        AND l.linked_party_id = p_partner_id
        AND l.direction = v_direction
        AND l.status <> 'completed'
        AND l.balance_amount > 0
        AND l.is_deleted = false
        AND public.convert_financed_amount(l.balance_amount, l.settlement_currency, v_partner.default_currency, l.exchange_rate_snapshot) IS NULL
    ) THEN
      RAISE EXCEPTION 'missing_credit_limit_exchange_rate';
    END IF;

    SELECT COALESCE(sum(public.convert_financed_amount(
      l.balance_amount, l.settlement_currency, v_partner.default_currency, l.exchange_rate_snapshot
    )), 0)
    INTO v_usage
    FROM public.loans l
    WHERE l.workspace_id = p_workspace_id
      AND l.linked_party_id = p_partner_id
      AND l.direction = v_direction
      AND l.status <> 'completed'
      AND l.balance_amount > 0
      AND l.is_deleted = false;

    v_converted := public.convert_financed_amount(p_principal, p_currency, v_partner.default_currency, p_exchange_rates);
    IF v_converted IS NULL THEN RAISE EXCEPTION 'missing_credit_limit_exchange_rate'; END IF;
    IF v_usage + v_converted > v_limit THEN RAISE EXCEPTION 'credit_limit_exceeded'; END IF;
  END IF;

  v_category := CASE WHEN p_payment_method = 'loan' THEN 'simple' ELSE 'standard' END;
  v_count := CASE
    WHEN p_payment_method = 'installments' THEN GREATEST(COALESCE(p_installment_count, 0), 1)
    ELSE 1
  END;
  IF p_payment_method = 'installments' AND (p_first_due_date IS NULL OR p_installment_frequency IS NULL) THEN
    RAISE EXCEPTION 'installment_schedule_required';
  END IF;

  INSERT INTO public.loans (
    id, workspace_id, sale_id, order_id, order_type, loan_no, source, loan_category,
    direction, linked_party_type, linked_party_id, linked_party_name,
    borrower_name, borrower_phone, borrower_address, borrower_national_id,
    principal_amount, total_paid_amount, balance_amount, settlement_currency,
    exchange_rate_snapshot, installment_count, installment_frequency,
    first_due_date, next_due_date, status, notes, created_by, version, is_deleted
  ) VALUES (
    v_loan_id, p_workspace_id, NULL, p_order_id, p_order_type,
    (CASE WHEN v_category = 'simple' THEN 'SL-' ELSE 'LN-' END)
      || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_loan_id::text, '-', ''), 1, 6)),
    'order', v_category, v_direction, 'business_partner', p_partner_id, p_partner_name,
    p_partner_name, '', '', '', p_principal, 0, p_principal, lower(p_currency),
    p_exchange_rates, v_count, COALESCE(p_installment_frequency, 'monthly'),
    p_first_due_date, p_first_due_date,
    CASE WHEN p_first_due_date IS NOT NULL AND p_first_due_date < CURRENT_DATE THEN 'overdue' ELSE 'active' END,
    'Financing for ' || p_order_type || ' order ' || p_order_number,
    p_created_by, 1, false
  );

  v_base := CASE WHEN lower(p_currency) = 'iqd' THEN round(p_principal / v_count) ELSE round(p_principal / v_count, 2) END;
  FOR v_index IN 1..v_count LOOP
    v_planned := CASE
      WHEN v_index = v_count THEN p_principal - (v_base * (v_count - 1))
      ELSE v_base
    END;
    v_due := CASE COALESCE(p_installment_frequency, 'monthly')
      WHEN 'weekly' THEN p_first_due_date + ((v_index - 1) * 7)
      WHEN 'biweekly' THEN p_first_due_date + ((v_index - 1) * 14)
      ELSE (p_first_due_date + make_interval(months => v_index - 1))::date
    END;
    INSERT INTO public.loan_installments (
      id, loan_id, workspace_id, installment_no, due_date, planned_amount,
      paid_amount, balance_amount, status, paid_at, version, is_deleted
    ) VALUES (
      gen_random_uuid(), v_loan_id, p_workspace_id, v_index, v_due, v_planned,
      0, v_planned, CASE WHEN v_due IS NOT NULL AND v_due < CURRENT_DATE THEN 'overdue' ELSE 'unpaid' END,
      NULL, 1, false
    );
  END LOOP;

  RETURN v_loan_id;
END;
$function$;

WITH missing_simple_order_loans AS (
  SELECT
    l.*,
    COALESCE(l.balance_amount, GREATEST(COALESCE(l.principal_amount, 0) - COALESCE(l.total_paid_amount, 0), 0)) AS effective_balance_amount
  FROM public.loans l
  WHERE l.source = 'order'
    AND l.loan_category = 'simple'
    AND l.is_deleted = false
    AND NOT EXISTS (
      SELECT 1
      FROM public.loan_installments li
      WHERE li.loan_id = l.id
        AND li.is_deleted = false
    )
), inserted AS (
  INSERT INTO public.loan_installments (
    id, loan_id, workspace_id, installment_no, due_date, planned_amount,
    paid_amount, balance_amount, status, paid_at, created_at, updated_at,
    version, is_deleted
  )
  SELECT
    gen_random_uuid(), l.id, l.workspace_id, 1, l.first_due_date,
    COALESCE(l.principal_amount, 0),
    COALESCE(l.total_paid_amount, 0),
    l.effective_balance_amount,
    CASE
      WHEN l.effective_balance_amount <= 0 THEN 'paid'
      WHEN COALESCE(l.total_paid_amount, 0) > 0 THEN 'partial'
      WHEN l.first_due_date IS NOT NULL AND l.first_due_date < CURRENT_DATE THEN 'overdue'
      ELSE 'unpaid'
    END,
    CASE
      WHEN l.effective_balance_amount <= 0 AND COALESCE(l.total_paid_amount, 0) > 0 THEN COALESCE(l.updated_at, l.created_at, now())
      ELSE NULL
    END,
    COALESCE(l.created_at, now()), now(), 1, false
  FROM missing_simple_order_loans l
  RETURNING loan_id
)
UPDATE public.loans l
SET installment_count = 1,
    next_due_date = CASE WHEN COALESCE(l.balance_amount, GREATEST(COALESCE(l.principal_amount, 0) - COALESCE(l.total_paid_amount, 0), 0)) > 0 THEN l.first_due_date ELSE NULL END,
    status = CASE
      WHEN COALESCE(l.balance_amount, GREATEST(COALESCE(l.principal_amount, 0) - COALESCE(l.total_paid_amount, 0), 0)) <= 0 THEN 'completed'
      WHEN l.first_due_date IS NOT NULL AND l.first_due_date < CURRENT_DATE THEN 'overdue'
      ELSE 'active'
    END,
    updated_at = now(),
    version = COALESCE(l.version, 0) + 1
FROM inserted
WHERE l.id = inserted.loan_id;

REVOKE ALL ON FUNCTION public.create_order_financing_loan(uuid, text, uuid, text, uuid, text, text, numeric, text, jsonb, integer, text, date, uuid) FROM PUBLIC;
