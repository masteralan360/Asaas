-- Activities are sold through the POS virtual storage. POS users must be able
-- to read the catalog and create the transaction without gaining access to the
-- standalone Activities management screen.

BEGIN;

DROP POLICY IF EXISTS activity_catalog_select ON activities.activity_catalog;
CREATE POLICY activity_catalog_select ON activities.activity_catalog FOR SELECT TO authenticated
USING (
  workspace_id = public.current_workspace_id()
  AND (
    activities.permission_allowed(workspace_id, 'activities.access')
    OR activities.permission_allowed(workspace_id, 'pos.access')
  )
);

-- POS needs Activity records in the local cache to keep its Activity sales
-- synchronized and allocate ACT references. The standalone history UI remains
-- gated by the Activities permissions in the application.
DROP POLICY IF EXISTS activity_transactions_select ON activities.activity_transactions;
CREATE POLICY activity_transactions_select ON activities.activity_transactions FOR SELECT TO authenticated
USING (
  workspace_id = public.current_workspace_id()
  AND (
    activities.permission_allowed(workspace_id, 'activities.viewHistory')
    OR activities.permission_allowed(workspace_id, 'pos.access')
  )
);

DROP POLICY IF EXISTS activity_transaction_lines_select ON activities.activity_transaction_lines;
CREATE POLICY activity_transaction_lines_select ON activities.activity_transaction_lines FOR SELECT TO authenticated
USING (
  workspace_id = public.current_workspace_id()
  AND (
    activities.permission_allowed(workspace_id, 'activities.viewHistory')
    OR activities.permission_allowed(workspace_id, 'pos.access')
  )
);

DROP POLICY IF EXISTS activity_transactions_insert ON activities.activity_transactions;
CREATE POLICY activity_transactions_insert ON activities.activity_transactions FOR INSERT TO authenticated
WITH CHECK (
  workspace_id = public.current_workspace_id()
  AND (
    activities.permission_allowed(workspace_id, 'activities.createTransaction')
    OR activities.permission_allowed(workspace_id, 'pos.access')
  )
);

DROP POLICY IF EXISTS activity_transaction_lines_insert ON activities.activity_transaction_lines;
CREATE POLICY activity_transaction_lines_insert ON activities.activity_transaction_lines FOR INSERT TO authenticated
WITH CHECK (
  workspace_id = public.current_workspace_id()
  AND (
    activities.permission_allowed(workspace_id, 'activities.createTransaction')
    OR activities.permission_allowed(workspace_id, 'pos.access')
  )
);

COMMIT;
