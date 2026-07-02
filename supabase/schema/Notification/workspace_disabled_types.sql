CREATE TABLE notifications.workspace_disabled_types (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  disabled_by uuid NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  disabled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, notification_type),
  CONSTRAINT notifications_workspace_disabled_types_type_check CHECK (
    notification_type IN (
      'marketplace_order_pending',
      'order_approval_request',
      'order_approval_approved',
      'loan_installment_overdue',
      'expense_item_overdue',
      'payroll_overdue',
      'inventory_low_stock'
    )
  )
);

CREATE INDEX idx_notifications_workspace_disabled_types_workspace
  ON notifications.workspace_disabled_types (workspace_id);

DROP TRIGGER IF EXISTS set_notifications_workspace_disabled_types_updated_at
  ON notifications.workspace_disabled_types;

CREATE TRIGGER set_notifications_workspace_disabled_types_updated_at
BEFORE UPDATE ON notifications.workspace_disabled_types
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE notifications.workspace_disabled_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_workspace_disabled_types_select
  ON notifications.workspace_disabled_types;
CREATE POLICY notifications_workspace_disabled_types_select
  ON notifications.workspace_disabled_types
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS notifications_workspace_disabled_types_insert
  ON notifications.workspace_disabled_types;
CREATE POLICY notifications_workspace_disabled_types_insert
  ON notifications.workspace_disabled_types
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND (disabled_by IS NULL OR disabled_by = auth.uid())
  );

DROP POLICY IF EXISTS notifications_workspace_disabled_types_update
  ON notifications.workspace_disabled_types;
CREATE POLICY notifications_workspace_disabled_types_update
  ON notifications.workspace_disabled_types
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS notifications_workspace_disabled_types_delete
  ON notifications.workspace_disabled_types;
CREATE POLICY notifications_workspace_disabled_types_delete
  ON notifications.workspace_disabled_types
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

REVOKE ALL ON TABLE notifications.workspace_disabled_types FROM anon;
REVOKE ALL ON TABLE notifications.workspace_disabled_types FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE notifications.workspace_disabled_types TO authenticated;
GRANT ALL ON TABLE notifications.workspace_disabled_types TO service_role;
