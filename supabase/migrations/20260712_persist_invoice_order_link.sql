ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS order_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_order_id
  ON public.invoices (order_id)
  WHERE order_id IS NOT NULL AND is_deleted = false;
