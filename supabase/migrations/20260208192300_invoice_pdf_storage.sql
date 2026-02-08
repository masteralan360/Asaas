-- Migration: invoice_pdf_storage
-- Description: Update invoices table for PDF storage (add R2 paths, drop legacy JSONB)

-- 1. Add new columns for PDF storage and simplified totals
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS total_amount NUMERIC,
ADD COLUMN IF NOT EXISTS settlement_currency TEXT,
ADD COLUMN IF NOT EXISTS r2_path_a4 TEXT,
ADD COLUMN IF NOT EXISTS r2_path_receipt TEXT,
ADD COLUMN IF NOT EXISTS print_format TEXT;

-- 2. Drop legacy JSONB columns (as per user instruction that old data is verified/deleted)
ALTER TABLE invoices 
DROP COLUMN IF EXISTS items,
DROP COLUMN IF EXISTS subtotal,
DROP COLUMN IF EXISTS discount,
DROP COLUMN IF EXISTS currency,
DROP COLUMN IF EXISTS print_metadata;

-- 3. Add index for R2 paths to speed up lookups if needed (optional but good practice)
CREATE INDEX IF NOT EXISTS idx_invoices_r2_path_a4 ON invoices(r2_path_a4);
CREATE INDEX IF NOT EXISTS idx_invoices_r2_path_receipt ON invoices(r2_path_receipt);
