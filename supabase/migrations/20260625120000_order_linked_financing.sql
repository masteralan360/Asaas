-- Replace order-owned credit obligations with canonical loan records.
ALTER TABLE crm.business_partners
  ADD COLUMN IF NOT EXISTS receivable_credit_limit numeric NULL,
  ADD COLUMN IF NOT EXISTS payable_credit_limit numeric NULL;

UPDATE crm.business_partners
SET
  receivable_credit_limit = CASE
    WHEN role IN ('customer', 'both') THEN NULLIF(COALESCE(credit_limit, 0), 0)
    ELSE NULL
  END,
  payable_credit_limit = CASE
    WHEN role IN ('supplier', 'both') THEN NULLIF(COALESCE(credit_limit, 0), 0)
    ELSE NULL
  END
WHERE receivable_credit_limit IS NULL
  AND payable_credit_limit IS NULL;

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS order_id uuid NULL,
  ADD COLUMN IF NOT EXISTS order_type text NULL,
  ALTER COLUMN first_due_date DROP NOT NULL;

ALTER TABLE public.loans
  DROP CONSTRAINT IF EXISTS loans_source_check,
  ADD CONSTRAINT loans_source_check
    CHECK (source IN ('pos', 'manual', 'order')),
  DROP CONSTRAINT IF EXISTS loans_order_type_check,
  ADD CONSTRAINT loans_order_type_check
    CHECK (order_type IS NULL OR order_type IN ('sales', 'purchase')),
  DROP CONSTRAINT IF EXISTS loans_source_link_check,
  ADD CONSTRAINT loans_source_link_check CHECK (
    (source = 'order' AND order_id IS NOT NULL AND order_type IS NOT NULL AND sale_id IS NULL)
    OR (source <> 'order' AND order_id IS NULL AND order_type IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_loans_active_order
  ON public.loans (order_type, order_id)
  WHERE order_id IS NOT NULL AND is_deleted = false;

ALTER TABLE crm.sales_orders
  ADD COLUMN IF NOT EXISTS initial_payment_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linked_loan_id uuid NULL;

ALTER TABLE crm.purchase_orders
  ADD COLUMN IF NOT EXISTS initial_payment_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linked_loan_id uuid NULL;

UPDATE crm.sales_orders
SET
  initial_payment_amount = CASE
    WHEN payment_method = 'credit' THEN GREATEST(COALESCE(paid_amount, 0), 0)
    ELSE COALESCE(initial_payment_amount, 0)
  END,
  payment_method = CASE
    WHEN payment_method = 'credit' AND is_installment_based THEN 'installments'
    WHEN payment_method = 'credit' THEN 'loan'
    ELSE payment_method
  END
WHERE payment_method = 'credit';

UPDATE crm.purchase_orders
SET
  initial_payment_amount = CASE
    WHEN payment_method = 'credit' THEN GREATEST(COALESCE(paid_amount, 0), 0)
    ELSE COALESCE(initial_payment_amount, 0)
  END,
  payment_method = CASE
    WHEN payment_method = 'credit' AND is_installment_based THEN 'installments'
    WHEN payment_method = 'credit' THEN 'loan'
    ELSE payment_method
  END
WHERE payment_method = 'credit';

ALTER TABLE crm.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_payment_method_check,
  ADD CONSTRAINT sales_orders_payment_method_check CHECK (
    payment_method IS NULL OR payment_method IN (
      'cash', 'fib', 'qicard', 'zaincash', 'fastpay', 'bank_transfer', 'loan', 'installments'
    )
  );

ALTER TABLE crm.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_payment_method_check,
  ADD CONSTRAINT purchase_orders_payment_method_check CHECK (
    payment_method IS NULL OR payment_method IN (
      'cash', 'fib', 'qicard', 'zaincash', 'fastpay', 'bank_transfer', 'loan', 'installments'
    )
  );

WITH candidates AS (
  SELECT
    so.*,
    gen_random_uuid() AS loan_id
  FROM crm.sales_orders so
  WHERE so.status IN ('pending', 'completed')
    AND so.payment_method IN ('loan', 'installments')
    AND COALESCE(so.balance_amount, 0) > 0
    AND so.linked_loan_id IS NULL
), inserted AS (
  INSERT INTO public.loans (
    id, workspace_id, sale_id, order_id, order_type, loan_no, source, loan_category,
    direction, linked_party_type, linked_party_id, linked_party_name,
    borrower_name, borrower_phone, borrower_address, borrower_national_id,
    principal_amount, total_paid_amount, balance_amount, settlement_currency,
    exchange_rate_snapshot, installment_count, installment_frequency,
    first_due_date, next_due_date, status, notes, created_by, created_at, updated_at,
    version, is_deleted
  )
  SELECT
    c.loan_id, c.workspace_id, NULL, c.id, 'sales',
    (CASE WHEN c.payment_method = 'loan' THEN 'SL-' ELSE 'LN-' END)
      || to_char(COALESCE(c.updated_at, now()), 'YYYYMMDD') || '-'
      || upper(substr(replace(c.loan_id::text, '-', ''), 1, 6)),
    'order', CASE WHEN c.payment_method = 'loan' THEN 'simple' ELSE 'standard' END,
    'lent', 'business_partner', COALESCE(
      c.business_partner_id,
      (SELECT customer.business_partner_id FROM crm.customers customer WHERE customer.id = c.customer_id),
      c.customer_id
    ),
    COALESCE(c.customer_name, 'Customer'), COALESCE(c.customer_name, 'Customer'),
    '', '', '', c.balance_amount, 0, c.balance_amount, c.currency,
    c.exchange_rates,
    CASE WHEN c.payment_method = 'installments' THEN GREATEST(c.installment_count, 1)
         WHEN c.first_due_date IS NOT NULL THEN 1 ELSE 0 END,
    COALESCE(c.installment_frequency, 'monthly'), c.first_due_date, c.first_due_date,
    CASE WHEN c.first_due_date < CURRENT_DATE THEN 'overdue' ELSE 'active' END,
    'Migrated from sales order ' || c.order_number, c.created_by,
    COALESCE(c.created_at, now()), COALESCE(c.updated_at, now()), 1, false
  FROM candidates c
  RETURNING id, order_id
)
UPDATE crm.sales_orders so
SET linked_loan_id = inserted.id
FROM inserted
WHERE so.id = inserted.order_id;

WITH candidates AS (
  SELECT
    po.*,
    gen_random_uuid() AS loan_id
  FROM crm.purchase_orders po
  WHERE po.status IN ('ordered', 'received', 'completed')
    AND po.payment_method IN ('loan', 'installments')
    AND COALESCE(po.balance_amount, 0) > 0
    AND po.linked_loan_id IS NULL
), inserted AS (
  INSERT INTO public.loans (
    id, workspace_id, sale_id, order_id, order_type, loan_no, source, loan_category,
    direction, linked_party_type, linked_party_id, linked_party_name,
    borrower_name, borrower_phone, borrower_address, borrower_national_id,
    principal_amount, total_paid_amount, balance_amount, settlement_currency,
    exchange_rate_snapshot, installment_count, installment_frequency,
    first_due_date, next_due_date, status, notes, created_by, created_at, updated_at,
    version, is_deleted
  )
  SELECT
    c.loan_id, c.workspace_id, NULL, c.id, 'purchase',
    (CASE WHEN c.payment_method = 'loan' THEN 'SL-' ELSE 'LN-' END)
      || to_char(COALESCE(c.updated_at, now()), 'YYYYMMDD') || '-'
      || upper(substr(replace(c.loan_id::text, '-', ''), 1, 6)),
    'order', CASE WHEN c.payment_method = 'loan' THEN 'simple' ELSE 'standard' END,
    'borrowed', 'business_partner', COALESCE(
      c.business_partner_id,
      (SELECT supplier.business_partner_id FROM crm.suppliers supplier WHERE supplier.id = c.supplier_id),
      c.supplier_id
    ),
    COALESCE(c.supplier_name, 'Supplier'), COALESCE(c.supplier_name, 'Supplier'),
    '', '', '', c.balance_amount, 0, c.balance_amount, c.currency,
    c.exchange_rates,
    CASE WHEN c.payment_method = 'installments' THEN GREATEST(c.installment_count, 1)
         WHEN c.first_due_date IS NOT NULL THEN 1 ELSE 0 END,
    COALESCE(c.installment_frequency, 'monthly'), c.first_due_date, c.first_due_date,
    CASE WHEN c.first_due_date < CURRENT_DATE THEN 'overdue' ELSE 'active' END,
    'Migrated from purchase order ' || c.order_number, c.created_by,
    COALESCE(c.created_at, now()), COALESCE(c.updated_at, now()), 1, false
  FROM candidates c
  RETURNING id, order_id
)
UPDATE crm.purchase_orders po
SET linked_loan_id = inserted.id
FROM inserted
WHERE po.id = inserted.order_id;

INSERT INTO public.loan_installments (
  id, loan_id, workspace_id, installment_no, due_date, planned_amount,
  paid_amount, balance_amount, status, paid_at, created_at, updated_at, version, is_deleted
)
SELECT
  gen_random_uuid(), l.id, oi.workspace_id,
  row_number() OVER (PARTITION BY l.id ORDER BY oi.installment_no),
  oi.due_date, oi.balance_amount, 0, oi.balance_amount,
  CASE WHEN oi.due_date < CURRENT_DATE THEN 'overdue' ELSE 'unpaid' END,
  NULL, oi.created_at, oi.updated_at, 1, false
FROM crm.order_installments oi
JOIN public.loans l
  ON l.order_id = oi.order_id
 AND l.order_type = oi.order_type
 AND l.source = 'order'
WHERE l.loan_category = 'standard'
  AND oi.is_deleted = false
  AND oi.balance_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.loan_installments li WHERE li.loan_id = l.id AND li.is_deleted = false
  );

INSERT INTO public.loan_installments (
  id, loan_id, workspace_id, installment_no, due_date, planned_amount,
  paid_amount, balance_amount, status, paid_at, created_at, updated_at, version, is_deleted
)
SELECT
  gen_random_uuid(), l.id, l.workspace_id, 1, l.first_due_date,
  l.balance_amount, 0, l.balance_amount,
  CASE WHEN l.first_due_date < CURRENT_DATE THEN 'overdue' ELSE 'unpaid' END,
  NULL, l.created_at, l.updated_at, 1, false
FROM public.loans l
WHERE l.source = 'order'
  AND l.loan_category = 'simple'
  AND l.first_due_date IS NOT NULL
  AND l.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM public.loan_installments li WHERE li.loan_id = l.id AND li.is_deleted = false
  );

INSERT INTO public.loan_installments (
  id, loan_id, workspace_id, installment_no, due_date, planned_amount,
  paid_amount, balance_amount, status, paid_at, created_at, updated_at, version, is_deleted
)
SELECT
  gen_random_uuid(), l.id, l.workspace_id, series.installment_no,
  CASE l.installment_frequency
    WHEN 'weekly' THEN l.first_due_date + ((series.installment_no - 1) * 7)
    WHEN 'biweekly' THEN l.first_due_date + ((series.installment_no - 1) * 14)
    ELSE (l.first_due_date + make_interval(months => series.installment_no - 1))::date
  END,
  CASE
    WHEN series.installment_no = l.installment_count THEN
      l.principal_amount - (
        CASE WHEN l.settlement_currency = 'iqd'
          THEN round(l.principal_amount / l.installment_count)
          ELSE round(l.principal_amount / l.installment_count, 2)
        END * (l.installment_count - 1)
      )
    WHEN l.settlement_currency = 'iqd' THEN round(l.principal_amount / l.installment_count)
    ELSE round(l.principal_amount / l.installment_count, 2)
  END,
  0,
  CASE
    WHEN series.installment_no = l.installment_count THEN
      l.principal_amount - (
        CASE WHEN l.settlement_currency = 'iqd'
          THEN round(l.principal_amount / l.installment_count)
          ELSE round(l.principal_amount / l.installment_count, 2)
        END * (l.installment_count - 1)
      )
    WHEN l.settlement_currency = 'iqd' THEN round(l.principal_amount / l.installment_count)
    ELSE round(l.principal_amount / l.installment_count, 2)
  END,
  CASE WHEN l.first_due_date < CURRENT_DATE THEN 'overdue' ELSE 'unpaid' END,
  NULL, l.created_at, l.updated_at, 1, false
FROM public.loans l
CROSS JOIN LATERAL generate_series(1, GREATEST(l.installment_count, 1)) AS series(installment_no)
WHERE l.source = 'order'
  AND l.loan_category = 'standard'
  AND l.first_due_date IS NOT NULL
  AND l.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM public.loan_installments li WHERE li.loan_id = l.id AND li.is_deleted = false
  );

UPDATE public.loans l
SET
  installment_count = schedule.installment_count,
  next_due_date = schedule.next_due_date,
  status = CASE
    WHEN l.balance_amount <= 0 THEN 'completed'
    WHEN schedule.next_due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'active'
  END
FROM (
  SELECT
    loan_id,
    count(*)::integer AS installment_count,
    min(due_date) FILTER (WHERE balance_amount > 0) AS next_due_date
  FROM public.loan_installments
  WHERE is_deleted = false
  GROUP BY loan_id
) schedule
WHERE l.id = schedule.loan_id
  AND l.source = 'order';

UPDATE crm.order_installments oi
SET is_deleted = true, updated_at = now(), version = version + 1
WHERE is_deleted = false
  AND EXISTS (
    SELECT 1
    FROM public.loans l
    WHERE l.order_id = oi.order_id
      AND l.order_type = oi.order_type
      AND l.source = 'order'
  );

CREATE OR REPLACE FUNCTION public.convert_financed_amount(
  p_amount numeric,
  p_from text,
  p_to text,
  p_snapshot jsonb
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_usd_iqd numeric;
  v_usd_eur numeric;
  v_eur_iqd numeric;
  v_usd_try numeric;
  v_try_iqd numeric;
BEGIN
  IF lower(p_from) = lower(p_to) THEN RETURN p_amount; END IF;

  SELECT max((entry->>'rate')::numeric / COALESCE(NULLIF((entry->>'priceBasisAmount')::numeric, 0), 100))
  INTO v_usd_iqd
  FROM jsonb_array_elements(COALESCE(p_snapshot, '[]'::jsonb)) entry
  WHERE upper(entry->>'pair') = 'USD/IQD';
  SELECT max((entry->>'rate')::numeric / COALESCE(NULLIF((entry->>'priceBasisAmount')::numeric, 0), 100))
  INTO v_usd_eur
  FROM jsonb_array_elements(COALESCE(p_snapshot, '[]'::jsonb)) entry
  WHERE upper(entry->>'pair') = 'USD/EUR';
  SELECT max((entry->>'rate')::numeric / COALESCE(NULLIF((entry->>'priceBasisAmount')::numeric, 0), 100))
  INTO v_eur_iqd
  FROM jsonb_array_elements(COALESCE(p_snapshot, '[]'::jsonb)) entry
  WHERE upper(entry->>'pair') = 'EUR/IQD';
  SELECT max((entry->>'rate')::numeric / COALESCE(NULLIF((entry->>'priceBasisAmount')::numeric, 0), 100))
  INTO v_usd_try
  FROM jsonb_array_elements(COALESCE(p_snapshot, '[]'::jsonb)) entry
  WHERE upper(entry->>'pair') = 'USD/TRY';
  SELECT max((entry->>'rate')::numeric / COALESCE(NULLIF((entry->>'priceBasisAmount')::numeric, 0), 100))
  INTO v_try_iqd
  FROM jsonb_array_elements(COALESCE(p_snapshot, '[]'::jsonb)) entry
  WHERE upper(entry->>'pair') = 'TRY/IQD';

  IF lower(p_from) = 'usd' AND lower(p_to) = 'iqd' THEN RETURN p_amount * v_usd_iqd;
  ELSIF lower(p_from) = 'iqd' AND lower(p_to) = 'usd' THEN RETURN p_amount / NULLIF(v_usd_iqd, 0);
  ELSIF lower(p_from) = 'usd' AND lower(p_to) = 'eur' THEN RETURN p_amount * v_usd_eur;
  ELSIF lower(p_from) = 'eur' AND lower(p_to) = 'usd' THEN RETURN p_amount / NULLIF(v_usd_eur, 0);
  ELSIF lower(p_from) = 'eur' AND lower(p_to) = 'iqd' THEN RETURN p_amount * v_eur_iqd;
  ELSIF lower(p_from) = 'iqd' AND lower(p_to) = 'eur' THEN RETURN p_amount / NULLIF(v_eur_iqd, 0);
  ELSIF lower(p_from) = 'usd' AND lower(p_to) = 'try' THEN RETURN p_amount * v_usd_try;
  ELSIF lower(p_from) = 'try' AND lower(p_to) = 'usd' THEN RETURN p_amount / NULLIF(v_usd_try, 0);
  ELSIF lower(p_from) = 'try' AND lower(p_to) = 'iqd' THEN RETURN p_amount * v_try_iqd;
  ELSIF lower(p_from) = 'iqd' AND lower(p_to) = 'try' THEN RETURN p_amount / NULLIF(v_try_iqd, 0);
  ELSIF lower(p_from) = 'try' AND lower(p_to) = 'eur' THEN RETURN (p_amount * v_try_iqd) / NULLIF(v_eur_iqd, 0);
  ELSIF lower(p_from) = 'eur' AND lower(p_to) = 'try' THEN RETURN (p_amount * v_eur_iqd) / NULLIF(v_try_iqd, 0);
  END IF;

  RETURN NULL;
END;
$function$;

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
    WHEN p_first_due_date IS NOT NULL THEN 1
    ELSE 0
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
    CASE WHEN p_first_due_date < CURRENT_DATE THEN 'overdue' ELSE 'active' END,
    'Financing for ' || p_order_type || ' order ' || p_order_number,
    p_created_by, 1, false
  );

  IF v_count > 0 THEN
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
        0, v_planned, CASE WHEN v_due < CURRENT_DATE THEN 'overdue' ELSE 'unpaid' END,
        NULL, 1, false
      );
    END LOOP;
  END IF;

  RETURN v_loan_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_financed_order(
  p_order_type text,
  p_order_id uuid,
  p_target_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm, pg_temp
AS $function$
DECLARE
  v_sales crm.sales_orders%ROWTYPE;
  v_purchase crm.purchase_orders%ROWTYPE;
  v_workspace_id uuid := public.current_workspace_id();
  v_loan_id uuid;
BEGIN
  IF v_workspace_id IS NULL THEN RAISE EXCEPTION 'workspace_required'; END IF;

  IF p_order_type = 'sales' THEN
    SELECT * INTO v_sales FROM crm.sales_orders
    WHERE id = p_order_id AND workspace_id = v_workspace_id AND is_deleted = false
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
    IF v_sales.status <> 'draft' OR p_target_status <> 'pending' THEN RAISE EXCEPTION 'invalid_order_transition'; END IF;

    IF v_sales.payment_method IN ('loan', 'installments') THEN
      v_loan_id := public.create_order_financing_loan(
        v_sales.workspace_id, 'sales', v_sales.id, v_sales.order_number,
        COALESCE(v_sales.business_partner_id, v_sales.customer_id), COALESCE(v_sales.customer_name, 'Customer'),
        v_sales.payment_method, v_sales.balance_amount, v_sales.currency, v_sales.exchange_rates,
        v_sales.installment_count, v_sales.installment_frequency, v_sales.first_due_date, v_sales.created_by
      );
    ELSIF NOT COALESCE(v_sales.is_paid, false) THEN
      RAISE EXCEPTION 'non_financed_order_must_be_paid';
    END IF;

    UPDATE crm.sales_orders
    SET status = 'pending', linked_loan_id = v_loan_id, updated_at = now(), version = version + 1
    WHERE id = p_order_id;
  ELSIF p_order_type = 'purchase' THEN
    SELECT * INTO v_purchase FROM crm.purchase_orders
    WHERE id = p_order_id AND workspace_id = v_workspace_id AND is_deleted = false
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
    IF v_purchase.status <> 'draft' OR p_target_status <> 'ordered' THEN RAISE EXCEPTION 'invalid_order_transition'; END IF;

    IF v_purchase.payment_method IN ('loan', 'installments') THEN
      v_loan_id := public.create_order_financing_loan(
        v_purchase.workspace_id, 'purchase', v_purchase.id, v_purchase.order_number,
        COALESCE(v_purchase.business_partner_id, v_purchase.supplier_id), COALESCE(v_purchase.supplier_name, 'Supplier'),
        v_purchase.payment_method, v_purchase.balance_amount, v_purchase.currency, v_purchase.exchange_rates,
        v_purchase.installment_count, v_purchase.installment_frequency, v_purchase.first_due_date, v_purchase.created_by
      );
    ELSIF NOT COALESCE(v_purchase.is_paid, false) THEN
      RAISE EXCEPTION 'non_financed_order_must_be_paid';
    END IF;

    UPDATE crm.purchase_orders
    SET status = 'ordered', linked_loan_id = v_loan_id, updated_at = now(), version = version + 1
    WHERE id = p_order_id;
  ELSE
    RAISE EXCEPTION 'invalid_order_type';
  END IF;

  RETURN jsonb_build_object('order_id', p_order_id, 'order_type', p_order_type, 'status', p_target_status, 'loan_id', v_loan_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_order_financing_loan(uuid, text, uuid, text, uuid, text, text, numeric, text, jsonb, integer, text, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_financed_order(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_financed_order(text, uuid, text) TO authenticated;
