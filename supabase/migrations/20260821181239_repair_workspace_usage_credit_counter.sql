-- Repair deployments where the unified usage migration was applied without
-- the earlier workspace-billing prerequisite. The unified RPCs expose the
-- effective allowance, so this current-cycle credit field must exist even
-- when no workspace has ever purchased additional credit.

ALTER TABLE public.workspace_usage
  ADD COLUMN IF NOT EXISTS purchased_credit_bytes bigint NOT NULL DEFAULT 0;

ALTER TABLE public.workspace_usage
  DROP CONSTRAINT IF EXISTS workspace_usage_purchased_credit_bytes_check;

ALTER TABLE public.workspace_usage
  ADD CONSTRAINT workspace_usage_purchased_credit_bytes_check
  CHECK (purchased_credit_bytes >= 0);

COMMENT ON COLUMN public.workspace_usage.purchased_credit_bytes IS
  'Approved one-time charged-usage credit for the current usage cycle, in decimal bytes.';

NOTIFY pgrst, 'reload schema';
