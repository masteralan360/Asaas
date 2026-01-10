-- Mixed-Currency Support Migration

-- 1. Update Sales table
ALTER TABLE public.sales 
ADD COLUMN IF NOT EXISTS settlement_currency TEXT NOT NULL DEFAULT 'usd',
ADD COLUMN IF NOT EXISTS exchange_source TEXT NOT NULL DEFAULT 'xeiqd',
ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC NOT NULL DEFAULT 145395,
ADD COLUMN IF NOT EXISTS exchange_rate_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Update Sale Items table
ALTER TABLE public.sale_items
ADD COLUMN IF NOT EXISTS original_currency TEXT NOT NULL DEFAULT 'usd',
ADD COLUMN IF NOT EXISTS original_unit_price NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS converted_unit_price NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS settlement_currency TEXT NOT NULL DEFAULT 'usd';

-- 3. Update complete_sale RPC function
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
BEGIN
    -- Get current user's workspace
    SELECT workspace_id INTO p_workspace_id 
    FROM public.profiles 
    WHERE id = auth.uid();

    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'User does not belong to a workspace';
    END IF;

    -- Check if POS feature is enabled
    SELECT allow_pos INTO v_allow_pos
    FROM public.workspaces
    WHERE id = p_workspace_id;

    IF NOT COALESCE(v_allow_pos, false) THEN
        RAISE EXCEPTION 'POS feature is not enabled for this workspace';
    END IF;

    total_sale_amount := (payload->>'total_amount')::NUMERIC;

    -- Insert Sale Record with snapshot metadata
    INSERT INTO public.sales (
        id,
        workspace_id, 
        cashier_id, 
        total_amount, 
        settlement_currency,
        exchange_source,
        exchange_rate,
        exchange_rate_timestamp,
        origin
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
        COALESCE(payload->>'origin', 'pos')
    )
    RETURNING id INTO new_sale_id;

    -- Process Items
    FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
    LOOP
        -- Insert Sale Item with mixed-currency metadata
        INSERT INTO public.sale_items (
            sale_id, 
            product_id, 
            quantity, 
            unit_price, 
            total_price,
            original_currency,
            original_unit_price,
            converted_unit_price,
            settlement_currency
        )
        VALUES (
            new_sale_id,
            (item->>'product_id')::UUID,
            (item->>'quantity')::INTEGER,
            (item->>'unit_price')::NUMERIC,
            (item->>'total_price')::NUMERIC,
            COALESCE(item->>'original_currency', 'usd'),
            COALESCE((item->>'original_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE((item->>'converted_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE(item->>'settlement_currency', 'usd')
        );

        -- Update Inventory
        UPDATE public.products
        SET quantity = quantity - (item->>'quantity')::INTEGER
        WHERE id = (item->>'product_id')::UUID
          AND workspace_id = p_workspace_id;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'sale_id', new_sale_id);
END;
$$;
