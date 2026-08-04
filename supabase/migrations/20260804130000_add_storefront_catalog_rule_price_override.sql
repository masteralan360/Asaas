-- Per-rule price override: when enabled on a price-book rule, the storefront
-- sells that book's products at the price book prices instead of the product
-- prices. Only one rule per storefront may override prices.

ALTER TABLE public.workspace_storefront_catalog_rules
  ADD COLUMN IF NOT EXISTS override_prices boolean NOT NULL DEFAULT false;

ALTER TABLE public.workspace_storefront_catalog_rules
  DROP CONSTRAINT IF EXISTS storefront_catalog_rules_override_requires_price_book;

ALTER TABLE public.workspace_storefront_catalog_rules
  ADD CONSTRAINT storefront_catalog_rules_override_requires_price_book
  CHECK (override_prices = false OR price_book_id IS NOT NULL);

DROP INDEX IF EXISTS uq_storefront_catalog_rules_override;
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_catalog_rules_override
  ON public.workspace_storefront_catalog_rules (
    workspace_id,
    COALESCE(storefront_id, '00000000-0000-0000-0000-000000000000')
  )
  WHERE override_prices = true;