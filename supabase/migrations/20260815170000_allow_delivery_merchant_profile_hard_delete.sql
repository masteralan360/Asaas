-- Merchant profile deletion intentionally applies only to unused profiles.
-- Shipment and ledger foreign keys remain RESTRICT to preserve delivery history.

GRANT DELETE ON TABLE delivery.delivery_merchant_profiles TO authenticated, service_role;

DROP POLICY IF EXISTS delivery_delete ON delivery.delivery_merchant_profiles;
CREATE POLICY delivery_delete ON delivery.delivery_merchant_profiles
  FOR DELETE TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND public.current_user_role() IN ('admin', 'staff')
  );

NOTIFY pgrst, 'reload schema';
