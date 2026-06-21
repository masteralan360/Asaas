CREATE TABLE public.loans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  sale_id uuid NULL,
  order_id uuid NULL,
  order_type text NULL,
  loan_no text NOT NULL,
  source text NOT NULL,
  loan_category text NOT NULL DEFAULT 'standard'::text,
  direction text NOT NULL DEFAULT 'lent'::text,
  linked_party_type text NULL,
  linked_party_id uuid NULL,
  linked_party_name text NULL,
  borrower_name text NOT NULL,
  borrower_phone text NOT NULL,
  borrower_address text NOT NULL,
  borrower_national_id text NOT NULL,
  principal_amount numeric NOT NULL,
  total_paid_amount numeric NOT NULL DEFAULT 0,
  balance_amount numeric NOT NULL,
  settlement_currency text NOT NULL,
  exchange_rate_snapshot jsonb NULL,
  installment_count integer NOT NULL,
  installment_frequency text NOT NULL,
  first_due_date date NULL,
  next_due_date date NULL,
  status text NOT NULL,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  overdue_reminder_snoozed_at timestamp with time zone NULL,
  overdue_reminder_snoozed_for_due_date date NULL,
  CONSTRAINT loans_category_check CHECK (
    loan_category IN ('standard', 'simple')
  ),
  CONSTRAINT loans_direction_check CHECK (
    direction IN ('lent', 'borrowed')
  ),
  CONSTRAINT loans_source_check CHECK (
    source IN ('pos', 'manual', 'order')
  ),
  CONSTRAINT loans_order_type_check CHECK (
    order_type IS NULL OR order_type IN ('sales', 'purchase')
  ),
  CONSTRAINT loans_source_link_check CHECK (
    (source = 'order' AND order_id IS NOT NULL AND order_type IS NOT NULL AND sale_id IS NULL)
    OR (source <> 'order' AND order_id IS NULL AND order_type IS NULL)
  ),
  CONSTRAINT loans_linked_party_type_check CHECK (
    linked_party_type IS NULL
    OR linked_party_type = 'business_partner'::text
  ),
  CONSTRAINT loans_linked_party_presence_check CHECK (
    (
      linked_party_type IS NULL
      AND linked_party_id IS NULL
      AND linked_party_name IS NULL
    )
    OR (
      linked_party_type IS NOT NULL
      AND linked_party_id IS NOT NULL
      AND linked_party_name IS NOT NULL
    )
  ),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_loans_workspace_linked_party
  ON public.loans (workspace_id, linked_party_type, linked_party_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_loans_workspace_category_direction
  ON public.loans (workspace_id, loan_category, direction)
  WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_loans_active_order
  ON public.loans (order_type, order_id)
  WHERE order_id IS NOT NULL AND is_deleted = false;
