-- Inventory transactions are an append-only cloud ledger for manual stock
-- adjustments only. Mirrored sales, returns, purchases, transfers, and
-- initial-stock activity remain device-local.
DROP POLICY IF EXISTS "inventory_transactions_insert" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_insert"
  ON public.inventory_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND transaction_type = 'stock_adjustment'
  );

DROP POLICY IF EXISTS "inventory_transactions_update" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_update"
  ON public.inventory_transactions
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND transaction_type = 'stock_adjustment'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND transaction_type = 'stock_adjustment'
  );
