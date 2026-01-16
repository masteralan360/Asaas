-- Create Sales Tables and Functions

-- 1. Create 'sales' table
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID REFERENCES public.workspaces(id) NOT NULL,
    cashier_id UUID REFERENCES auth.users(id) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    origin TEXT DEFAULT 'pos', -- 'pos', 'manual', etc.
    payment_method TEXT DEFAULT 'cash'
);

-- 2. Create 'sale_items' table
CREATE TABLE IF NOT EXISTS public.sale_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sale_id UUID REFERENCES public.sales(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    total_price NUMERIC(10, 2) NOT NULL
);

-- 3. RLS Policies
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

-- Sales: Viewable by workspace members, Insertable by authenticated users (via RPC mainly, but allow policy)
DROP POLICY IF EXISTS "Sales viewable by workspace members" ON public.sales;
CREATE POLICY "Sales viewable by workspace members"
ON public.sales FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Sales insertable by workspace members" ON public.sales;
CREATE POLICY "Sales insertable by workspace members"
ON public.sales FOR INSERT
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
    )
);

-- Delete/Update restricted to admins? Logic handled in app, policy can allow workspace admins.
DROP POLICY IF EXISTS "Sales modifiable by workspace admins" ON public.sales;
CREATE POLICY "Sales modifiable by workspace admins"
ON public.sales FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    )
);

-- Sale Items: Viewable by workspace members (via join usually, but direct access needed for sales details)
DROP POLICY IF EXISTS "Sale Items accessible by workspace members" ON public.sale_items;
CREATE POLICY "Sale Items accessible by workspace members"
ON public.sale_items FOR SELECT
USING (
    sale_id IN (
        SELECT id FROM public.sales WHERE workspace_id IN (
            SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
        )
    )
);

-- 4. RPC Function: Complete Sale (Atomic Transaction)
CREATE OR REPLACE FUNCTION public.complete_sale(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- To bypass RLS and ensure integrity of inventory updates
AS $$
DECLARE
    new_sale_id UUID;
    item JSONB;
    p_workspace_id UUID;
    total_sale_amount NUMERIC := 0;
    v_allow_pos BOOLEAN;
BEGIN
    -- Extract workspace_id from the first item or assume user has one. 
    -- Better: Get current user's workspace.
    SELECT workspace_id INTO p_workspace_id 
    FROM public.profiles 
    WHERE id = auth.uid();

    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'User does not belong to a workspace';
    END IF;

    -- Check if POS feature is enabled for this workspace
    SELECT allow_pos INTO v_allow_pos
    FROM public.workspaces
    WHERE id = p_workspace_id;

    IF NOT COALESCE(v_allow_pos, false) THEN
        RAISE EXCEPTION 'POS feature is not enabled for this workspace';
    END IF;

    -- Calculate total (or trust payload? Trusting payload for now, but usually backend recalculates)
    -- We will insert what frontend sends but verification of total usually happens here.
    -- For simplicity/MVP, we extract `totalAmount` from payload or sum items.
    
    total_sale_amount := (payload->>'total_amount')::NUMERIC;

    -- Insert Sale Record
    INSERT INTO public.sales (
        id,
        workspace_id, 
        cashier_id, 
        total_amount, 
        settlement_currency,
        exchange_source,
        exchange_rate,
        exchange_rate_timestamp,
        exchange_rates,
        origin,
        payment_method
    )
    VALUES (
        COALESCE((payload->>'id')::UUID, gen_random_uuid()),
        p_workspace_id, 
        auth.uid(), 
        total_sale_amount, 
        COALESCE(payload->>'settlement_currency', 'usd'),
        COALESCE(payload->>'exchange_source', 'xeiqd'),
        COALESCE((payload->>'exchange_rate')::NUMERIC, 0),
        COALESCE((payload->>'exchange_rate_timestamp')::TIMESTAMPTZ, NOW()),
        COALESCE((payload->'exchange_rates'), '[]'::jsonb),
        COALESCE(payload->>'origin', 'pos'),
        COALESCE(payload->>'payment_method', 'cash')
    )
    RETURNING id INTO new_sale_id;

    -- Process Items
    FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
    LOOP
        -- Insert Sale Item
        INSERT INTO public.sale_items (
            sale_id, 
            product_id, 
            quantity, 
            unit_price, 
            total_price,
            cost_price,
            converted_cost_price,
            original_currency,
            original_unit_price,
            converted_unit_price,
            settlement_currency,
            negotiated_price
        )
        VALUES (
            new_sale_id,
            (item->>'product_id')::UUID,
            (item->>'quantity')::INTEGER,
            (item->>'unit_price')::NUMERIC,
            (item->>'total_price')::NUMERIC,
            COALESCE((item->>'cost_price')::NUMERIC, 0),
            COALESCE((item->>'converted_cost_price')::NUMERIC, 0),
            COALESCE(item->>'original_currency', 'usd'),
            COALESCE((item->>'original_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE((item->>'converted_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE(item->>'settlement_currency', 'usd'),
            (item->>'negotiated_price')::NUMERIC
        );

        -- Update Inventory
        UPDATE public.products
        SET quantity = quantity - (item->>'quantity')::INTEGER
        WHERE id = (item->>'product_id')::UUID
          AND workspace_id = p_workspace_id; -- Safety check
          
        -- Optional: Check for negative stock if enforced?
    END LOOP;

    RETURN jsonb_build_object('success', true, 'sale_id', new_sale_id);
END;
$$;

-- 5. RPC Function: Delete Sale (Restore Inventory and Delete)
CREATE OR REPLACE FUNCTION public.delete_sale(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- To bypass RLS and grant permission to update inventory
AS $$
DECLARE
    item RECORD;
    p_workspace_id UUID;
    v_user_role TEXT;
    v_allow_pos BOOLEAN;
BEGIN
    -- Verify Sale Existence and Get Workspace
    SELECT workspace_id INTO p_workspace_id FROM public.sales WHERE id = p_sale_id;
    
    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'Sale not found';
    END IF;

    -- Check if POS feature is enabled for this workspace
    SELECT allow_pos INTO v_allow_pos
    FROM public.workspaces
    WHERE id = p_workspace_id;

    IF NOT COALESCE(v_allow_pos, false) THEN
        RAISE EXCEPTION 'POS feature is not enabled for this workspace';
    END IF;

    -- Check Permissions: User must be Admin in the same workspace
    SELECT role INTO v_user_role
    FROM public.profiles 
    WHERE id = auth.uid() 
    AND workspace_id = p_workspace_id;

    IF v_user_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can delete sales';
    END IF;

    -- Delete Sale (Cascade will handle items) - NO inventory restoration
    DELETE FROM public.sales WHERE id = p_sale_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
