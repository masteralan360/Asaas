CREATE TABLE billing.payment_transaction_status_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  billing_workspace_id uuid NOT NULL,
  from_status text NULL,
  to_status text NOT NULL,
  changed_by uuid NULL,
  changed_by_label text NULL,
  changed_via text NULL,
  change_note text NULL,
  provider_payment_id text NULL,
  old_record jsonb NULL,
  new_record jsonb NOT NULL,
  changed_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT payment_transaction_status_audit_from_status_check
    CHECK (from_status IS NULL OR from_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])),
  CONSTRAINT payment_transaction_status_audit_to_status_check
    CHECK (to_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text]))
);

CREATE INDEX payment_transaction_status_audit_transaction_idx
  ON billing.payment_transaction_status_audit (transaction_id, changed_at DESC);

CREATE INDEX payment_transaction_status_audit_workspace_idx
  ON billing.payment_transaction_status_audit (billing_workspace_id, changed_at DESC);

