CREATE TABLE public.workspace_usage (
  workspace_id uuid NOT NULL,
  storage_units bigint NOT NULL DEFAULT 0,
  data_transfer_bytes bigint NOT NULL DEFAULT 0,
  purchased_credit_bytes bigint NOT NULL DEFAULT 0,
  transfer_period_start date NOT NULL DEFAULT date_trunc('month'::text, timezone('utc'::text, now()))::date,
  storage_updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  transfer_updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT workspace_usage_storage_units_check CHECK (storage_units >= 0),
  CONSTRAINT workspace_usage_data_transfer_bytes_check CHECK (data_transfer_bytes >= 0),
  CONSTRAINT workspace_usage_purchased_credit_bytes_check CHECK (purchased_credit_bytes >= 0),
  PRIMARY KEY (workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES public.workspace_usage_limits(workspace_id) ON DELETE CASCADE
);

