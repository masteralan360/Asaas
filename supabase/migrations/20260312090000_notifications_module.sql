-- Notifications module: overdue detection + dispatch pipeline

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schema
CREATE SCHEMA IF NOT EXISTS notifications;

GRANT USAGE ON SCHEMA notifications TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA notifications TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA notifications GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- Settings (key/value)
CREATE TABLE IF NOT EXISTS notifications.settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO notifications.settings (key, value)
VALUES ('cron_secret', NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO notifications.settings (key, value)
VALUES ('functions_base_url', NULL)
ON CONFLICT (key) DO NOTHING;

-- Events (pending/sent/failed)
CREATE TABLE IF NOT EXISTS notifications.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    due_date DATE NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_events_dedupe
    ON notifications.events(user_id, entity_type, entity_id, due_date);

CREATE INDEX IF NOT EXISTS idx_notifications_events_status_created
    ON notifications.events(status, created_at);

-- Device tokens
CREATE TABLE IF NOT EXISTS notifications.device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    platform TEXT NOT NULL DEFAULT 'android',
    device_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_device_tokens
    ON notifications.device_tokens(user_id, platform, device_token);

-- Employee columns for payday/dividends
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS salary_payday INTEGER DEFAULT 30,
    ADD COLUMN IF NOT EXISTS dividend_payday INTEGER DEFAULT 30,
    ADD COLUMN IF NOT EXISTS has_dividends BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dividend_type TEXT CHECK (dividend_type IN ('fixed', 'percentage')),
    ADD COLUMN IF NOT EXISTS dividend_amount NUMERIC,
    ADD COLUMN IF NOT EXISTS dividend_currency TEXT DEFAULT 'usd';

-- RLS
ALTER TABLE notifications.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.device_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'notifications'
          AND tablename = 'device_tokens'
          AND policyname = 'Users can manage their device tokens'
    ) THEN
        CREATE POLICY "Users can manage their device tokens" ON notifications.device_tokens
            FOR ALL USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());
    END IF;
END $$;

-- updated_at triggers
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_notifications_settings_updated_at' AND tgrelid = 'notifications.settings'::regclass) THEN
        CREATE TRIGGER update_notifications_settings_updated_at BEFORE UPDATE ON notifications.settings
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_notifications_events_updated_at' AND tgrelid = 'notifications.events'::regclass) THEN
        CREATE TRIGGER update_notifications_events_updated_at BEFORE UPDATE ON notifications.events
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_notifications_device_tokens_updated_at' AND tgrelid = 'notifications.device_tokens'::regclass) THEN
        CREATE TRIGGER update_notifications_device_tokens_updated_at BEFORE UPDATE ON notifications.device_tokens
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Helper: compute due date from MonthKey + payday
CREATE OR REPLACE FUNCTION notifications.compute_due_date(month_key TEXT, payday INTEGER)
RETURNS DATE
LANGUAGE plpgsql
AS $$
DECLARE
    year_part INTEGER;
    month_part INTEGER;
    day_part INTEGER;
    days_in_month INTEGER;
BEGIN
    year_part := NULLIF(split_part(month_key, '-', 1), '')::INTEGER;
    month_part := NULLIF(split_part(month_key, '-', 2), '')::INTEGER;

    IF year_part IS NULL OR month_part IS NULL OR month_part < 1 OR month_part > 12 THEN
        RETURN NULL;
    END IF;

    days_in_month := EXTRACT(DAY FROM (date_trunc('month', make_date(year_part, month_part, 1)) + INTERVAL '1 month - 1 day'));
    day_part := LEAST(GREATEST(COALESCE(payday, 30), 1), days_in_month);

    RETURN make_date(year_part, month_part, day_part);
END;
$$;

-- Overdue detection
CREATE OR REPLACE FUNCTION notifications.detect_overdue_events()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = notifications, public, budget, auth, extensions
AS $$
BEGIN
    -- Budget: expense items
    INSERT INTO notifications.events (workspace_id, user_id, entity_type, entity_id, due_date, payload)
    SELECT
        e.workspace_id,
        p.id AS user_id,
        'budget_expense' AS entity_type,
        e.id::TEXT AS entity_id,
        e.due_date,
        jsonb_build_object(
            'entity_type', 'budget_expense',
            'title', COALESCE(s.name, 'Expense'),
            'amount', e.amount,
            'currency', e.currency,
            'due_date', e.due_date,
            'expense_id', e.id,
            'series_id', e.series_id,
            'month', e.month
        )
    FROM budget.expense_items e
    LEFT JOIN budget.expense_series s ON s.id = e.series_id
    INNER JOIN public.profiles p ON p.workspace_id = e.workspace_id AND p.role = 'admin'
    WHERE e.is_deleted = FALSE
      AND e.due_date < CURRENT_DATE
      AND e.status <> 'paid'
      AND (
        e.status <> 'snoozed'
        OR (e.snoozed_indefinite = FALSE AND e.snoozed_until IS NOT NULL AND e.snoozed_until <= NOW())
      )
    ON CONFLICT DO NOTHING;

    -- Budget: payroll statuses
    INSERT INTO notifications.events (workspace_id, user_id, entity_type, entity_id, due_date, payload)
    SELECT
        ps.workspace_id,
        p.id AS user_id,
        'budget_payroll' AS entity_type,
        ps.id::TEXT AS entity_id,
        due_date,
        jsonb_build_object(
            'entity_type', 'budget_payroll',
            'title', COALESCE(emp.name, 'Payroll'),
            'amount', emp.salary,
            'currency', emp.salary_currency,
            'due_date', due_date,
            'month', ps.month,
            'employee_id', emp.id,
            'status_id', ps.id
        )
    FROM budget.payroll_statuses ps
    INNER JOIN public.employees emp ON emp.id = ps.employee_id
    INNER JOIN public.profiles p ON p.workspace_id = ps.workspace_id AND p.role = 'admin'
    CROSS JOIN LATERAL notifications.compute_due_date(ps.month, emp.salary_payday) AS due_date
    WHERE ps.is_deleted = FALSE
      AND due_date IS NOT NULL
      AND due_date < CURRENT_DATE
      AND ps.status <> 'paid'
      AND (
        ps.status <> 'snoozed'
        OR (ps.snoozed_indefinite = FALSE AND ps.snoozed_until IS NOT NULL AND ps.snoozed_until <= NOW())
      )
    ON CONFLICT DO NOTHING;

    -- Budget: dividend statuses
    INSERT INTO notifications.events (workspace_id, user_id, entity_type, entity_id, due_date, payload)
    SELECT
        ds.workspace_id,
        p.id AS user_id,
        'budget_dividend' AS entity_type,
        ds.id::TEXT AS entity_id,
        due_date,
        jsonb_build_object(
            'entity_type', 'budget_dividend',
            'title', COALESCE(emp.name, 'Dividend'),
            'dividend_type', emp.dividend_type,
            'amount', CASE WHEN emp.dividend_type = 'fixed' THEN emp.dividend_amount ELSE NULL END,
            'dividend_percent', CASE WHEN emp.dividend_type = 'percentage' THEN emp.dividend_amount ELSE NULL END,
            'currency', emp.dividend_currency,
            'due_date', due_date,
            'month', ds.month,
            'employee_id', emp.id,
            'status_id', ds.id
        )
    FROM budget.dividend_statuses ds
    INNER JOIN public.employees emp ON emp.id = ds.employee_id
    INNER JOIN public.profiles p ON p.workspace_id = ds.workspace_id AND p.role = 'admin'
    CROSS JOIN LATERAL notifications.compute_due_date(ds.month, emp.dividend_payday) AS due_date
    WHERE ds.is_deleted = FALSE
      AND emp.has_dividends = TRUE
      AND due_date IS NOT NULL
      AND due_date < CURRENT_DATE
      AND ds.status <> 'paid'
      AND (
        ds.status <> 'snoozed'
        OR (ds.snoozed_indefinite = FALSE AND ds.snoozed_until IS NOT NULL AND ds.snoozed_until <= NOW())
      )
    ON CONFLICT DO NOTHING;

    -- Loans: aggregated overdue installments
    WITH overdue AS (
        SELECT
            li.loan_id,
            l.workspace_id,
            MIN(li.due_date) AS oldest_due_date,
            SUM(li.balance_amount) AS overdue_amount,
            COUNT(*) AS overdue_installment_count
        FROM public.loan_installments li
        INNER JOIN public.loans l ON l.id = li.loan_id
        WHERE li.is_deleted = FALSE
          AND l.is_deleted = FALSE
          AND li.balance_amount > 0
          AND li.due_date < CURRENT_DATE
        GROUP BY li.loan_id, l.workspace_id
    )
    INSERT INTO notifications.events (workspace_id, user_id, entity_type, entity_id, due_date, payload)
    SELECT
        o.workspace_id,
        p.id AS user_id,
        'loan_overdue' AS entity_type,
        l.id::TEXT AS entity_id,
        o.oldest_due_date,
        jsonb_build_object(
            'entity_type', 'loan_overdue',
            'title', l.loan_no,
            'loan_id', l.id,
            'loan_no', l.loan_no,
            'borrower_name', l.borrower_name,
            'due_date', o.oldest_due_date,
            'overdue_amount', o.overdue_amount,
            'overdue_installment_count', o.overdue_installment_count,
            'balance_amount', l.balance_amount,
            'currency', l.settlement_currency
        )
    FROM overdue o
    INNER JOIN public.loans l ON l.id = o.loan_id
    INNER JOIN public.profiles p ON p.workspace_id = o.workspace_id AND p.role = 'admin'
    WHERE l.is_deleted = FALSE
      AND (l.overdue_reminder_snoozed_for_due_date IS NULL OR l.overdue_reminder_snoozed_for_due_date <> o.oldest_due_date)
    ON CONFLICT DO NOTHING;
END;
$$;

-- Cron job wrapper: detect then dispatch via pg_net
CREATE OR REPLACE FUNCTION notifications.cron_overdue_job()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = notifications, public, budget, auth, extensions
AS $$
DECLARE
    cron_secret TEXT;
    functions_base_url TEXT;
BEGIN
    PERFORM notifications.detect_overdue_events();

    SELECT value INTO cron_secret FROM notifications.settings WHERE key = 'cron_secret';
    SELECT value INTO functions_base_url FROM notifications.settings WHERE key = 'functions_base_url';

    IF cron_secret IS NULL OR functions_base_url IS NULL THEN
        RAISE NOTICE 'notifications.cron_overdue_job: missing cron_secret or functions_base_url in notifications.settings';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := functions_base_url || '/dispatch-notifications',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Cron-Secret', cron_secret
        ),
        body := '{}'::jsonb
    );
END;
$$;

-- Schedule hourly cron job (if not already scheduled)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'overdue_notifications_hourly'
    ) THEN
        PERFORM cron.schedule(
            'overdue_notifications_hourly',
            '0 * * * *',
            $schedule$SELECT notifications.cron_overdue_job();$schedule$
        );
    END IF;
END $$;
