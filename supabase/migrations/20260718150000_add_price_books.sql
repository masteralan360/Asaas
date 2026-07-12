CREATE OR REPLACE FUNCTION public.workspace_plan_has_capability(p_plan text, p_capability text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_capability, ''))
    WHEN 'receiptprinting' THEN true
    WHEN 'a4pdfinvoices' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'pdfinvoicegeneration' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'barcodescanner' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'thermalprinter' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'multipleworkspacecontacts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'marketplaceinquiries' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'marketplacestorefronts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'loaninstallmentinvoices' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'multicurrency' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'excelexportsales' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'excelexportledger' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'excelexportrevenue' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'workspacestorageuploads' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'workspacepdfuploads' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'workspaceimageuploads' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'workspaceaudiouploads' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'workspacemanagementpermissions' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsappintegration' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsappsharing' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'stockbatches' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'orderfreebonus' THEN false
    WHEN 'pricebooks' THEN false
    WHEN 'kds' THEN true
    ELSE false
  END;
$function$;

CREATE TABLE IF NOT EXISTS public.price_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  sync_status text NOT NULL DEFAULT 'synced'::text,
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT price_books_name_not_blank CHECK (char_length(btrim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS public.price_book_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  price_book_id uuid NOT NULL REFERENCES public.price_books(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cost_price numeric NOT NULL,
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

ALTER TABLE crm.business_partners
  ADD COLUMN IF NOT EXISTS price_book_id uuid NULL;

ALTER TABLE crm.business_partners
  DROP CONSTRAINT IF EXISTS business_partners_price_book_id_fkey;

ALTER TABLE crm.business_partners
  ADD CONSTRAINT business_partners_price_book_id_fkey
  FOREIGN KEY (price_book_id) REFERENCES public.price_books(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_price_books_workspace
  ON public.price_books (workspace_id);

CREATE INDEX IF NOT EXISTS idx_price_books_workspace_updated
  ON public.price_books (workspace_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_books_workspace_active_name_unique
  ON public.price_books (workspace_id, lower(btrim(name)))
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_price_book_items_workspace
  ON public.price_book_items (workspace_id);

CREATE INDEX IF NOT EXISTS idx_price_book_items_workspace_book
  ON public.price_book_items (workspace_id, price_book_id);

CREATE INDEX IF NOT EXISTS idx_price_book_items_product
  ON public.price_book_items (product_id);

CREATE INDEX IF NOT EXISTS idx_crm_business_partners_price_book
  ON crm.business_partners (price_book_id);

DROP TRIGGER IF EXISTS update_price_books_updated_at ON public.price_books;
CREATE TRIGGER update_price_books_updated_at
BEFORE UPDATE ON public.price_books
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

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

CREATE OR REPLACE FUNCTION public.enforce_crm_business_partner_price_book()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE
  v_plan text;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.price_book_id IS NOT DISTINCT FROM OLD.price_book_id
    AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.price_book_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT workspace.plan::text
  INTO v_plan
  FROM public.workspaces AS workspace
  WHERE workspace.id = NEW.workspace_id
    AND workspace.deleted_at IS NULL;

  IF v_plan IS NULL
    OR NOT public.workspace_capability_allowed(NEW.workspace_id, v_plan, 'priceBooks')
  THEN
    RAISE EXCEPTION 'Price Books capability is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.price_books AS price_book
    WHERE price_book.id = NEW.price_book_id
      AND price_book.workspace_id = NEW.workspace_id
      AND price_book.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Business partner price book must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_crm_business_partner_price_book ON crm.business_partners;
CREATE TRIGGER enforce_crm_business_partner_price_book
  BEFORE INSERT OR UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crm_business_partner_price_book();

CREATE OR REPLACE FUNCTION public.enforce_price_books_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF (
      (
        TG_OP <> 'INSERT'
        AND OLD.type = 'capability'
        AND lower(OLD.key) = 'pricebooks'
      )
      OR (
        TG_OP <> 'DELETE'
        AND NEW.type = 'capability'
        AND lower(NEW.key) = 'pricebooks'
      )
    )
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Price Books capability access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_price_books_override_admin_console ON public.workspace_access_overrides;
CREATE TRIGGER enforce_price_books_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_price_books_override_admin_console();

ALTER TABLE public.price_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_book_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_books_select ON public.price_books;
CREATE POLICY price_books_select
  ON public.price_books
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_books.workspace_id),
      'priceBooks'
    )
  );

DROP POLICY IF EXISTS price_books_insert ON public.price_books;
CREATE POLICY price_books_insert
  ON public.price_books
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_books.workspace_id),
      'priceBooks'
    )
  );

DROP POLICY IF EXISTS price_books_update ON public.price_books;
CREATE POLICY price_books_update
  ON public.price_books
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_books.workspace_id),
      'priceBooks'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_books.workspace_id),
      'priceBooks'
    )
  );

DROP POLICY IF EXISTS price_books_delete ON public.price_books;
CREATE POLICY price_books_delete
  ON public.price_books
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND public.workspace_capability_allowed(
      workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = price_books.workspace_id),
      'priceBooks'
    )
  );

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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_books TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_book_items TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.workspace_plan_has_capability(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_price_book_item_workspace_links() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_crm_business_partner_price_book() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_price_books_override_admin_console() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
