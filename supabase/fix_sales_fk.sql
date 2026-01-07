-- Fix: Allow user deletion by handling foreign key constraint on sales table
-- This script modifies the sales table to allow the cashier_id to be set to NULL when a user is deleted.

-- 1. Alter the column to allow NULLs
ALTER TABLE public.sales ALTER COLUMN cashier_id DROP NOT NULL;

-- 2. Drop the existing foreign key constraint
-- Note: The name 'sales_cashier_id_fkey' is the standard naming convention Supabase uses.
-- If the name is different, you might need to check your constraints:
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.sales'::regclass;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_cashier_id_fkey;

-- 3. Add the new foreign key constraint with ON DELETE SET NULL
ALTER TABLE public.sales
ADD CONSTRAINT sales_cashier_id_fkey
FOREIGN KEY (cashier_id)
REFERENCES auth.users(id)
ON DELETE SET NULL;
