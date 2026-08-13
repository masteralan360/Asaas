-- A public-storefront inquiry PDF belongs to the immutable marketplace order
-- that created it.  Keep the R2 object reference instead of a temporary URL,
-- because signed download URLs expire and must be generated when needed.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS inquiry_pdf_storage_id text NULL,
  ADD COLUMN IF NOT EXISTS inquiry_pdf_document_number text NULL,
  ADD COLUMN IF NOT EXISTS inquiry_pdf_uploaded_at timestamp with time zone NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_orders_inquiry_pdf_storage_id_format'
  ) THEN
    ALTER TABLE public.marketplace_orders
      ADD CONSTRAINT marketplace_orders_inquiry_pdf_storage_id_format
      CHECK (
        inquiry_pdf_storage_id IS NULL
        OR inquiry_pdf_storage_id ~ '^[A-Za-z0-9_-]{24,64}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_orders_inquiry_pdf_document_number_format'
  ) THEN
    ALTER TABLE public.marketplace_orders
      ADD CONSTRAINT marketplace_orders_inquiry_pdf_document_number_format
      CHECK (
        inquiry_pdf_document_number IS NULL
        OR inquiry_pdf_document_number ~ '^MKT-[0-9]{5,}$'
      );
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_orders_inquiry_pdf_storage
  ON public.marketplace_orders (inquiry_pdf_storage_id)
  WHERE inquiry_pdf_storage_id IS NOT NULL;
