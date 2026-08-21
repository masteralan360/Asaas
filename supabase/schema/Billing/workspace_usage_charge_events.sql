CREATE TABLE billing.workspace_usage_charge_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  transfer_period_start date NOT NULL,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  charged_usage_bytes bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT workspace_usage_charge_events_pkey PRIMARY KEY (id),
  CONSTRAINT workspace_usage_charge_events_charged_usage_bytes_check
    CHECK (charged_usage_bytes > 0),
  CONSTRAINT workspace_usage_charge_events_workspace_request_key
    UNIQUE (workspace_id, request_id),
  CONSTRAINT workspace_usage_charge_events_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

CREATE INDEX workspace_usage_charge_events_workspace_period_idx
  ON billing.workspace_usage_charge_events (workspace_id, transfer_period_start, created_at DESC);
