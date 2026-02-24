-- Loans Module Tables

CREATE TABLE IF NOT EXISTS public.loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sale_id UUID NULL REFERENCES public.sales(id) ON DELETE SET NULL,
    loan_no TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('pos', 'manual')),
    borrower_name TEXT NOT NULL,
    borrower_phone TEXT NOT NULL,
    borrower_address TEXT NOT NULL,
    borrower_national_id TEXT NOT NULL,
    principal_amount NUMERIC NOT NULL,
    total_paid_amount NUMERIC NOT NULL DEFAULT 0,
    balance_amount NUMERIC NOT NULL,
    settlement_currency TEXT NOT NULL,
    installment_count INTEGER NOT NULL,
    installment_frequency TEXT NOT NULL CHECK (installment_frequency IN ('weekly', 'biweekly', 'monthly')),
    first_due_date DATE NOT NULL,
    next_due_date DATE NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'overdue', 'completed')),
    notes TEXT NULL,
    created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS public.loan_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    installment_no INTEGER NOT NULL,
    due_date DATE NOT NULL,
    planned_amount NUMERIC NOT NULL,
    paid_amount NUMERIC NOT NULL DEFAULT 0,
    balance_amount NUMERIC NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue')),
    paid_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS public.loan_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'fib', 'qicard', 'zaincash', 'fastpay', 'loan_adjustment')),
    paid_at TIMESTAMPTZ NOT NULL,
    note TEXT NULL,
    created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loans_workspace_loan_no_unique
ON public.loans(workspace_id, loan_no);

CREATE INDEX IF NOT EXISTS idx_loans_workspace_status_due
ON public.loans(workspace_id, status, next_due_date);

CREATE INDEX IF NOT EXISTS idx_loan_installments_workspace_loan_due_status
ON public.loan_installments(workspace_id, loan_id, due_date, status);

CREATE INDEX IF NOT EXISTS idx_loan_installments_loan_no_unique
ON public.loan_installments(loan_id, installment_no);

CREATE INDEX IF NOT EXISTS idx_loan_payments_workspace_loan_paid_at
ON public.loan_payments(workspace_id, loan_id, paid_at DESC);

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Loans are viewable by workspace members" ON public.loans;
CREATE POLICY "Loans are viewable by workspace members"
ON public.loans FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Loans insertable by workspace admin or staff" ON public.loans;
CREATE POLICY "Loans insertable by workspace admin or staff"
ON public.loans FOR INSERT
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
);

DROP POLICY IF EXISTS "Loans updateable by workspace admin or staff" ON public.loans;
CREATE POLICY "Loans updateable by workspace admin or staff"
ON public.loans FOR UPDATE
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
)
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
);

DROP POLICY IF EXISTS "Loans deletable by workspace admin or staff" ON public.loans;
CREATE POLICY "Loans deletable by workspace admin or staff"
ON public.loans FOR DELETE
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
);

DROP POLICY IF EXISTS "Loan installments are viewable by workspace members" ON public.loan_installments;
CREATE POLICY "Loan installments are viewable by workspace members"
ON public.loan_installments FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Loan installments insertable by workspace admin or staff" ON public.loan_installments;
CREATE POLICY "Loan installments insertable by workspace admin or staff"
ON public.loan_installments FOR INSERT
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
);

DROP POLICY IF EXISTS "Loan installments updateable by workspace admin or staff" ON public.loan_installments;
CREATE POLICY "Loan installments updateable by workspace admin or staff"
ON public.loan_installments FOR UPDATE
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
)
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
);

DROP POLICY IF EXISTS "Loan installments deletable by workspace admin or staff" ON public.loan_installments;
CREATE POLICY "Loan installments deletable by workspace admin or staff"
ON public.loan_installments FOR DELETE
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
);

DROP POLICY IF EXISTS "Loan payments are viewable by workspace members" ON public.loan_payments;
CREATE POLICY "Loan payments are viewable by workspace members"
ON public.loan_payments FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Loan payments insertable by workspace admin or staff" ON public.loan_payments;
CREATE POLICY "Loan payments insertable by workspace admin or staff"
ON public.loan_payments FOR INSERT
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
);

DROP POLICY IF EXISTS "Loan payments updateable by workspace admin or staff" ON public.loan_payments;
CREATE POLICY "Loan payments updateable by workspace admin or staff"
ON public.loan_payments FOR UPDATE
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
)
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
);

DROP POLICY IF EXISTS "Loan payments deletable by workspace admin or staff" ON public.loan_payments;
CREATE POLICY "Loan payments deletable by workspace admin or staff"
ON public.loan_payments FOR DELETE
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
);
