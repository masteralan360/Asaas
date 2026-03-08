ALTER TABLE public.loans
ADD COLUMN IF NOT EXISTS overdue_reminder_snoozed_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS overdue_reminder_snoozed_for_due_date DATE NULL;
