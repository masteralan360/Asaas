-- HR & Budget Tables Migration
-- Run this to enable backend synchronization for Asaas ERP

-- 1. Employees table
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    gender TEXT CHECK (gender IN ('male', 'female', 'other')),
    role TEXT NOT NULL, -- Internal labeling roles
    location TEXT,
    joining_date DATE NOT NULL DEFAULT CURRENT_DATE,
    salary NUMERIC(15, 2) NOT NULL DEFAULT 0,
    salary_currency TEXT NOT NULL DEFAULT 'usd',
    
    -- Sync Metadata
    version INTEGER NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Expenses table
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    description TEXT,
    type TEXT CHECK (type IN ('recurring', 'one-time')),
    category TEXT CHECK (category IN ('rent', 'electricity', 'payroll', 'utility', 'marketing', 'general', 'other')),
    amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT CHECK (status IN ('pending', 'paid', 'snoozed')),
    due_date TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    snooze_until TIMESTAMPTZ,
    snooze_count INTEGER NOT NULL DEFAULT 0,
    employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    
    -- Sync Metadata
    version INTEGER NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_employees_workspace_id ON public.employees(workspace_id);
CREATE INDEX IF NOT EXISTS idx_expenses_workspace_id ON public.expenses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_expenses_due_date ON public.expenses(due_date);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- 5. Policies (Workspace isolation)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employees' AND policyname = 'Workspaces members can view employees') THEN
        CREATE POLICY "Workspaces members can view employees" ON public.employees
            FOR ALL USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expenses' AND policyname = 'Workspaces members can view expenses') THEN
        CREATE POLICY "Workspaces members can view expenses" ON public.expenses
            FOR ALL USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
                )
            );
    END IF;
END $$;

-- 6. Trigger for updated_at
-- This function usually already exists in Asaas (defined in schema.sql)
-- CREATE OR REPLACE FUNCTION update_updated_at_column() ...

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_employees_updated_at') THEN
        CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON public.employees
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_expenses_updated_at') THEN
        CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON public.expenses
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
