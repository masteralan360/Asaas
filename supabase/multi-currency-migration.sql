-- Multi-Currency Support Migration
-- Run this in your Supabase SQL Editor

-- 1. Update workspaces table
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL DEFAULT 'usd';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS iqd_display_preference TEXT NOT NULL DEFAULT 'IQD';

-- 2. Update products table
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';

-- 3. Update sales table
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';

-- 4. Update orders table (if applicable)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';

-- 5. Update invoices table (if applicable)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';

-- 6. Update get_workspace_features RPC
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
            'allow_orders', false,
            'allow_invoices', false,
            'is_configured', false,
            'default_currency', 'usd',
            'iqd_display_preference', 'IQD'
        );
    END IF;

    SELECT jsonb_build_object(
        'workspace_id', id,
        'workspace_name', name,
        'allow_pos', allow_pos,
        'allow_customers', allow_customers,
        'allow_orders', allow_orders,
        'allow_invoices', allow_invoices,
        'is_configured', is_configured,
        'default_currency', default_currency,
        'iqd_display_preference', iqd_display_preference
    ) INTO v_result
    FROM public.workspaces
    WHERE id = v_workspace_id;

    RETURN COALESCE(v_result, jsonb_build_object(
        'allow_pos', false,
        'allow_customers', false,
        'allow_orders', false,
        'allow_invoices', false,
        'is_configured', false,
        'default_currency', 'usd',
        'iqd_display_preference', 'IQD'
    ));
END;
$$;

-- 7. Update complete_sale RPC
CREATE OR REPLACE FUNCTION public.complete_sale(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_sale_id UUID;
    item JSONB;
    p_workspace_id UUID;
    total_sale_amount NUMERIC := 0;
    v_allow_pos BOOLEAN;
    v_currency TEXT;
BEGIN
    SELECT workspace_id INTO p_workspace_id 
    FROM public.profiles 
    WHERE id = auth.uid();

    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'User does not belong to a workspace';
    END IF;

    SELECT allow_pos INTO v_allow_pos
    FROM public.workspaces
    WHERE id = p_workspace_id;

    IF NOT COALESCE(v_allow_pos, false) THEN
        RAISE EXCEPTION 'POS feature is not enabled for this workspace';
    END IF;

    total_sale_amount := (payload->>'total_amount')::NUMERIC;
    v_currency := COALESCE(payload->>'currency', 'usd');

    INSERT INTO public.sales (workspace_id, cashier_id, total_amount, currency, origin)
    VALUES (p_workspace_id, auth.uid(), total_sale_amount, v_currency, COALESCE(payload->>'origin', 'pos'))
    RETURNING id INTO new_sale_id;

    FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
    LOOP
        INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total_price)
        VALUES (
            new_sale_id,
            (item->>'product_id')::UUID,
            (item->>'quantity')::INTEGER,
            (item->>'price')::NUMERIC,
            (item->>'total')::NUMERIC
        );

        UPDATE public.products
        SET quantity = quantity - (item->>'quantity')::INTEGER
        WHERE id = (item->>'product_id')::UUID
          AND workspace_id = p_workspace_id;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'sale_id', new_sale_id);
END;
$$;
