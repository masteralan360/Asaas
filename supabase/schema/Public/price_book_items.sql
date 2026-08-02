CREATE TABLE public.price_book_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  price_book_id uuid NOT NULL REFERENCES public.price_books(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cost_price numeric NULL,
  price numeric NOT NULL,
  currency text NOT NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  sync_status text NOT NULL DEFAULT 'synced'::text,
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT price_book_items_book_product_unique UNIQUE (price_book_id, product_id),
  CONSTRAINT price_book_items_cost_price_nonnegative CHECK (cost_price >= 0),
  CONSTRAINT price_book_items_price_nonnegative CHECK (price >= 0),
  CONSTRAINT price_book_items_currency_check CHECK (currency IN ('usd', 'eur', 'iqd', 'try'))
);

CREATE INDEX IF NOT EXISTS idx_price_book_items_workspace
  ON public.price_book_items (workspace_id);

CREATE INDEX IF NOT EXISTS idx_price_book_items_workspace_book
  ON public.price_book_items (workspace_id, price_book_id);

CREATE INDEX IF NOT EXISTS idx_price_book_items_product
  ON public.price_book_items (product_id);

DROP TRIGGER IF EXISTS update_price_book_items_updated_at ON public.price_book_items;
CREATE TRIGGER update_price_book_items_updated_at
BEFORE UPDATE ON public.price_book_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enforce_price_book_item_workspace_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.price_books AS price_book
    WHERE price_book.id = NEW.price_book_id
      AND price_book.workspace_id = NEW.workspace_id
      AND price_book.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Price book item must reference a price book in the same workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.id = NEW.product_id
      AND product.workspace_id = NEW.workspace_id
      AND product.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Price book item must reference a product in the same workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_price_book_item_workspace_links ON public.price_book_items;
CREATE TRIGGER enforce_price_book_item_workspace_links
  BEFORE INSERT OR UPDATE ON public.price_book_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_price_book_item_workspace_links();

ALTER TABLE public.price_book_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_book_items_select ON public.price_book_items;
CREATE POLICY price_book_items_select
  ON public.price_book_items
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_book_items.workspace_id),
      'priceBooks'
    )
  );

DROP POLICY IF EXISTS price_book_items_insert ON public.price_book_items;
CREATE POLICY price_book_items_insert
  ON public.price_book_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_book_items.workspace_id),
      'priceBooks'
    )
  );

DROP POLICY IF EXISTS price_book_items_update ON public.price_book_items;
CREATE POLICY price_book_items_update
  ON public.price_book_items
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_book_items.workspace_id),
      'priceBooks'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_book_items.workspace_id),
      'priceBooks'
    )
  );

DROP POLICY IF EXISTS price_book_items_delete ON public.price_book_items;
CREATE POLICY price_book_items_delete
  ON public.price_book_items
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_book_items.workspace_id),
      'priceBooks'
    )
  );
