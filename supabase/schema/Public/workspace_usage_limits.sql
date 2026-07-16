CREATE TABLE public.workspace_usage_limits (
  workspace_id uuid NOT NULL,
  storage_unit_limit bigint NULL,
  monthly_data_transfer_limit_bytes bigint NULL,
  notes text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT workspace_usage_limits_storage_unit_limit_check
    CHECK (storage_unit_limit IS NULL OR storage_unit_limit >= 0),
  CONSTRAINT workspace_usage_limits_transfer_limit_check
    CHECK (monthly_data_transfer_limit_bytes IS NULL OR monthly_data_transfer_limit_bytes >= 0),
  CONSTRAINT workspace_usage_limits_has_limit_check
    CHECK (storage_unit_limit IS NOT NULL OR monthly_data_transfer_limit_bytes IS NOT NULL),
  PRIMARY KEY (workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

