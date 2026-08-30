-- A cashier may own only one formally active occurrence in a workspace. The
-- partial unique index is concurrency-safe, unlike a client-side pre-check,
-- and becomes available again as soon as the occurrence is completed or
-- soft-deleted.
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_cashier_occurrence_active_unique
  ON payment_accounts.cashier_shift_occurrences (workspace_id, cashier_user_id)
  WHERE status = 'active' AND NOT is_deleted;

NOTIFY pgrst, 'reload schema';
