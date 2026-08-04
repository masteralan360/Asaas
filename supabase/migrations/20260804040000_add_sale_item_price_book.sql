-- POS sales may be priced from a selected Price Book. Each sale item keeps a
-- snapshot of the Price Book that priced it so later exchanges can re-price
-- the replacement product under the same book. NULL means the line was priced
-- from the base product price.

BEGIN;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS price_book_id uuid NULL REFERENCES public.price_books(id);

CREATE INDEX IF NOT EXISTS idx_sale_items_price_book
  ON public.sale_items (price_book_id);

COMMIT;
