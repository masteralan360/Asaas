-- Fix: Allow user deletion without deleting associated business data
-- This script decouples products, customers, orders, and invoices from the user who created them.
-- Instead of deleting the data when a user is deleted, it sets the user reference to NULL.

-- 1. PRODUCTS
ALTER TABLE public.products ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_user_id_fkey;

ALTER TABLE public.products
ADD CONSTRAINT products_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE SET NULL;

-- 2. CUSTOMERS
ALTER TABLE public.customers ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_user_id_fkey;

ALTER TABLE public.customers
ADD CONSTRAINT customers_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE SET NULL;

-- 3. ORDERS
ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;

ALTER TABLE public.orders
ADD CONSTRAINT orders_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE SET NULL;

-- 4. INVOICES
ALTER TABLE public.invoices ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_user_id_fkey;

ALTER TABLE public.invoices
ADD CONSTRAINT invoices_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE SET NULL;
