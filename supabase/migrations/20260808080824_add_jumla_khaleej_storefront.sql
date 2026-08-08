-- A first-class configuration for the standalone Jumla Khaleej storefront.
-- The public site is allowed to render only this configured workspace. Retail
-- visitors see native products (not assigned to any price book); wholesale
-- visitors see products in the configured wholesale price book at its prices.

CREATE TABLE IF NOT EXISTS public.website_storefront_configs (
  site_key text PRIMARY KEY,
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  wholesale_price_book_id uuid NOT NULL REFERENCES public.price_books(id) ON DELETE RESTRICT,
  primary_domain text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT website_storefront_configs_site_key_check
    CHECK (site_key ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  CONSTRAINT website_storefront_configs_primary_domain_check
    CHECK (primary_domain ~ '^[a-z0-9.-]+$')
);

CREATE OR REPLACE FUNCTION public.normalize_website_storefront_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.site_key := lower(trim(NEW.site_key));
  NEW.primary_domain := lower(trim(NEW.primary_domain));

  IF NEW.site_key !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' THEN
    RAISE EXCEPTION 'Website storefront site key is invalid';
  END IF;

  IF NEW.primary_domain !~ '^[a-z0-9.-]+$' THEN
    RAISE EXCEPTION 'Website storefront domain is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.price_books AS price_book
    WHERE price_book.id = NEW.wholesale_price_book_id
      AND price_book.workspace_id = NEW.workspace_id
      AND COALESCE(price_book.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'Wholesale price book must belong to the same workspace';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_website_storefront_config_on_write ON public.website_storefront_configs;
CREATE TRIGGER normalize_website_storefront_config_on_write
BEFORE INSERT OR UPDATE ON public.website_storefront_configs
FOR EACH ROW
EXECUTE FUNCTION public.normalize_website_storefront_config();

DROP TRIGGER IF EXISTS update_website_storefront_configs_updated_at ON public.website_storefront_configs;
CREATE TRIGGER update_website_storefront_configs_updated_at
BEFORE UPDATE ON public.website_storefront_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.website_storefront_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS website_storefront_configs_select ON public.website_storefront_configs;
CREATE POLICY website_storefront_configs_select
  ON public.website_storefront_configs
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

DROP POLICY IF EXISTS website_storefront_configs_update ON public.website_storefront_configs;
CREATE POLICY website_storefront_configs_update
  ON public.website_storefront_configs
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

-- Seed only if the specified workspace and price book already exist. This
-- keeps a fresh development database migratable before production data is
-- imported, while production gets the binding automatically.
INSERT INTO public.website_storefront_configs (
  site_key,
  workspace_id,
  wholesale_price_book_id,
  primary_domain,
  is_enabled
)
SELECT
  'jumla-khaleej',
  workspace.id,
  price_book.id,
  'khaleejbeauty.vercel.app',
  true
FROM public.workspaces AS workspace
JOIN public.price_books AS price_book
  ON price_book.workspace_id = workspace.id
  AND price_book.id = '0c8124bf-fc1b-4594-9d87-0d8147fbfd15'::uuid
  AND COALESCE(price_book.is_deleted, false) = false
WHERE workspace.id = 'ec5305ba-e804-4e3e-a600-6d9692108b86'::uuid
  AND workspace.deleted_at IS NULL
ON CONFLICT (site_key) DO NOTHING;

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS website_storefront_key text NULL,
  ADD COLUMN IF NOT EXISTS storefront_mode text NULL
    CHECK (storefront_mode IS NULL OR storefront_mode IN ('retail', 'wholesale')),
  ADD COLUMN IF NOT EXISTS price_book_id uuid NULL REFERENCES public.price_books(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_domain text NULL,
  ADD COLUMN IF NOT EXISTS checkout_request_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_workspace_storefront_mode_created
  ON public.marketplace_orders (workspace_id, storefront_mode, created_at DESC)
  WHERE storefront_mode IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_orders_workspace_checkout_request
  ON public.marketplace_orders (workspace_id, checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_marketplace_order_price_book_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.price_book_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.price_books AS price_book
       WHERE price_book.id = NEW.price_book_id
         AND price_book.workspace_id = NEW.workspace_id
     )
  THEN
    RAISE EXCEPTION 'Marketplace order price book must belong to the same workspace';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_marketplace_order_price_book_workspace_on_write ON public.marketplace_orders;
CREATE TRIGGER enforce_marketplace_order_price_book_workspace_on_write
BEFORE INSERT OR UPDATE ON public.marketplace_orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_marketplace_order_price_book_workspace();
