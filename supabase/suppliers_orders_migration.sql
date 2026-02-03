-- Migration for Suppliers, Customers, and Orders
-- Created: 2026-02-03

-- 1. Suppliers Table
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    country TEXT,
    default_currency TEXT NOT NULL DEFAULT 'usd' CHECK (default_currency IN ('usd', 'eur', 'iqd', 'try')),
    notes TEXT,
    total_purchases NUMERIC DEFAULT 0,
    total_spent NUMERIC DEFAULT 0,
    
    -- Sync fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    sync_status TEXT DEFAULT 'synced',
    version BIGINT DEFAULT 1,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- Enable RLS for Suppliers
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace suppliers" ON public.suppliers
    FOR SELECT USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert their workspace suppliers" ON public.suppliers
    FOR INSERT WITH CHECK (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their workspace suppliers" ON public.suppliers
    FOR UPDATE USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete their workspace suppliers" ON public.suppliers
    FOR DELETE USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));


-- 2. Customers Table (Enhancements)
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    country TEXT,
    notes TEXT,
    
    -- New fields
    default_currency TEXT NOT NULL DEFAULT 'usd' CHECK (default_currency IN ('usd', 'eur', 'iqd', 'try')),
    total_orders NUMERIC DEFAULT 0,
    total_spent NUMERIC DEFAULT 0,
    outstanding_balance NUMERIC DEFAULT 0,

    -- Sync fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    sync_status TEXT DEFAULT 'synced',
    version BIGINT DEFAULT 1,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- Add columns if they don't exist (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'default_currency') THEN
        ALTER TABLE public.customers ADD COLUMN default_currency TEXT NOT NULL DEFAULT 'usd' CHECK (default_currency IN ('usd', 'eur', 'iqd', 'try'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'outstanding_balance') THEN
        ALTER TABLE public.customers ADD COLUMN outstanding_balance NUMERIC DEFAULT 0;
    END IF;
END $$;

-- Enable RLS for Customers (if not already enabled)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Ensure Policies exist (using unique names or IF NOT EXISTS logic via DO block)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customers' AND policyname = 'Users can view their workspace customers') THEN
        CREATE POLICY "Users can view their workspace customers" ON public.customers FOR SELECT USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customers' AND policyname = 'Users can insert their workspace customers') THEN
        CREATE POLICY "Users can insert their workspace customers" ON public.customers FOR INSERT WITH CHECK (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customers' AND policyname = 'Users can update their workspace customers') THEN
        CREATE POLICY "Users can update their workspace customers" ON public.customers FOR UPDATE USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customers' AND policyname = 'Users can delete their workspace customers') THEN
        CREATE POLICY "Users can delete their workspace customers" ON public.customers FOR DELETE USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));
    END IF;
END $$;


-- 3. Purchase Orders Table
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
    order_number TEXT NOT NULL,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
    supplier_name TEXT,
    subtotal NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    total NUMERIC DEFAULT 0,
    currency TEXT NOT NULL CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
    
    exchange_rate NUMERIC,
    exchange_rate_source TEXT,
    exchange_rate_timestamp TIMESTAMPTZ,
    exchange_rates JSONB,
    
    status TEXT NOT NULL,
    expected_delivery_date TIMESTAMPTZ,
    actual_delivery_date TIMESTAMPTZ,
    
    is_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMPTZ,
    payment_method TEXT,
    notes TEXT,

    items JSONB DEFAULT '[]'::jsonb, -- Storing items as JSON array

    -- Sync fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    sync_status TEXT DEFAULT 'synced',
    version BIGINT DEFAULT 1,
    is_deleted BOOLEAN DEFAULT FALSE
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace purchase_orders" ON public.purchase_orders
    FOR SELECT USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert their workspace purchase_orders" ON public.purchase_orders
    FOR INSERT WITH CHECK (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their workspace purchase_orders" ON public.purchase_orders
    FOR UPDATE USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete their workspace purchase_orders" ON public.purchase_orders
    FOR DELETE USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));


-- 4. Sales Orders Table
CREATE TABLE IF NOT EXISTS public.sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
    order_number TEXT NOT NULL,
    customer_id UUID NOT NULL REFERENCES public.customers(id),
    customer_name TEXT,
    subtotal NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    tax NUMERIC DEFAULT 0,
    total NUMERIC DEFAULT 0,
    currency TEXT NOT NULL CHECK (currency IN ('usd', 'eur', 'iqd', 'try')),
    
    exchange_rate NUMERIC,
    exchange_rate_source TEXT,
    exchange_rate_timestamp TIMESTAMPTZ,
    exchange_rates JSONB,
    
    status TEXT NOT NULL,
    expected_delivery_date TIMESTAMPTZ,
    actual_delivery_date TIMESTAMPTZ,
    
    is_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMPTZ,
    payment_method TEXT,
    
    reserved_at TIMESTAMPTZ,
    shipping_address TEXT,
    notes TEXT,

    items JSONB DEFAULT '[]'::jsonb,

    -- Sync fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    sync_status TEXT DEFAULT 'synced',
    version BIGINT DEFAULT 1,
    is_deleted BOOLEAN DEFAULT FALSE
);

ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace sales_orders" ON public.sales_orders
    FOR SELECT USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert their workspace sales_orders" ON public.sales_orders
    FOR INSERT WITH CHECK (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their workspace sales_orders" ON public.sales_orders
    FOR UPDATE USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete their workspace sales_orders" ON public.sales_orders
    FOR DELETE USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));


-- 5. Workspace Features Update (Suppliers & others)
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS allow_suppliers BOOLEAN NOT NULL DEFAULT true;

-- Update configure_workspace
CREATE OR REPLACE FUNCTION public.configure_workspace(
    p_allow_pos BOOLEAN DEFAULT false,
    p_allow_customers BOOLEAN DEFAULT false,
    p_allow_suppliers BOOLEAN DEFAULT false, -- New
    p_allow_orders BOOLEAN DEFAULT false,
    p_allow_invoices BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_workspace_id UUID;
    v_user_role TEXT;
BEGIN
    SELECT workspace_id, role INTO v_workspace_id, v_user_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_workspace_id IS NULL THEN
        RAISE EXCEPTION 'User does not belong to a workspace';
    END IF;

    IF v_user_role != 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can configure workspace features';
    END IF;

    UPDATE public.workspaces
    SET 
        allow_pos = p_allow_pos,
        allow_customers = p_allow_customers,
        allow_suppliers = p_allow_suppliers,
        allow_orders = p_allow_orders,
        allow_invoices = p_allow_invoices,
        is_configured = true
    WHERE id = v_workspace_id;

    RETURN jsonb_build_object(
        'success', true,
        'allow_pos', p_allow_pos,
        'allow_customers', p_allow_customers,
        'allow_suppliers', p_allow_suppliers,
        'allow_orders', p_allow_orders,
        'allow_invoices', p_allow_invoices
    );
END;
$$;

-- Update get_workspace_features (COMPREHENSIVE)
CREATE OR REPLACE FUNCTION public.get_workspace_features()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_workspace_id UUID;
    v_result JSONB;
BEGIN
    SELECT workspace_id INTO v_workspace_id
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_workspace_id IS NULL THEN
        RETURN jsonb_build_object(
            'error', 'User does not belong to a workspace',
            'allow_pos', false,
            'allow_customers', false,
            'allow_suppliers', false,
            'allow_orders', false,
            'allow_invoices', false,
            'is_configured', false
        );
    END IF;

    -- Return ALL settings fields used by frontend
    SELECT jsonb_build_object(
        'workspace_id', id,
        'workspace_name', name,
        'allow_pos', allow_pos,
        'allow_customers', allow_customers,
        'allow_suppliers', allow_suppliers,
        'allow_orders', allow_orders,
        'allow_invoices', allow_invoices,
        'is_configured', is_configured,
        'default_currency', default_currency,
        'iqd_display_preference', iqd_display_preference,
        'eur_conversion_enabled', eur_conversion_enabled,
        'try_conversion_enabled', try_conversion_enabled,
        'locked_workspace', locked_workspace,
        'max_discount_percent', max_discount_percent,
        'allow_whatsapp', allow_whatsapp,
        'logo_url', logo_url
    ) INTO v_result
    FROM public.workspaces
    WHERE id = v_workspace_id;

    RETURN COALESCE(v_result, jsonb_build_object(
        'allow_pos', false,
        'allow_customers', false,
        'allow_suppliers', false,
        'allow_orders', false,
        'allow_invoices', false,
        'is_configured', false
    ));
END;
$$;
