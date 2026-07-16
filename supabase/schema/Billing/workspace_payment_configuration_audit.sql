CREATE TABLE billing.workspace_payment_configuration_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  configuration_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  action text NOT NULL CHECK (action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])),
  old_record jsonb NULL,
  new_record jsonb NULL,
  changed_by uuid NULL,
  changed_by_label text NULL,
  changed_via text NULL,
  changed_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX workspace_payment_configuration_audit_workspace_idx
  ON billing.workspace_payment_configuration_audit (workspace_id, changed_at DESC);

