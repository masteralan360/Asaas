CREATE TABLE billing.workspace_payment_configurations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  subscription_amount numeric(20, 3) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD'::text,
  is_payment_enabled boolean NOT NULL DEFAULT false,
  usage_enabled boolean NOT NULL DEFAULT false,
  gb_per_payment numeric(14, 6) NOT NULL DEFAULT 0,
  renewal_due_at timestamp with time zone NULL,
  usage_start_date date NULL,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_by_label text NULL,
  updated_by_label text NULL,
  created_via text NULL,
  updated_via text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT workspace_payment_configurations_amount_check CHECK (subscription_amount >= 0),
  CONSTRAINT workspace_payment_configurations_currency_check CHECK (currency = 'IQD'::text),
  CONSTRAINT workspace_payment_configurations_gb_check CHECK (gb_per_payment >= 0),
  CONSTRAINT workspace_payment_configurations_enabled_amount_check
    CHECK (NOT is_payment_enabled OR subscription_amount > 0),
  CONSTRAINT workspace_payment_configurations_usage_values_check
    CHECK (NOT usage_enabled OR (gb_per_payment > 0 AND renewal_due_at IS NOT NULL)),
  PRIMARY KEY (id),
  UNIQUE (workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

