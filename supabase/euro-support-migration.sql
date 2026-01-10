-- Mix-Currency POS Extension: EUR Support

-- 1. Update Workspaces table
ALTER TABLE public.workspaces 
ADD COLUMN IF NOT EXISTS eur_conversion_enabled BOOLEAN DEFAULT FALSE;

-- 2. Update Sales table to support multiple snapshots via JSONB
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS exchange_rates JSONB DEFAULT '[]'::jsonb;

-- 3. Update get_workspace_features RPC to include the new field
DROP FUNCTION IF EXISTS public.get_workspace_features();
CREATE OR REPLACE FUNCTION public.get_workspace_features()
RETURNS TABLE (
    allow_pos BOOLEAN,
    allow_customers BOOLEAN,
    allow_orders BOOLEAN,
    allow_invoices BOOLEAN,
    is_configured BOOLEAN,
    default_currency TEXT,
    iqd_display_preference TEXT,
    workspace_name TEXT,
    eur_conversion_enabled BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        w.allow_pos,
        w.allow_customers,
        w.allow_orders,
        w.allow_invoices,
        w.is_configured,
        w.default_currency,
        w.iqd_display_preference,
        w.name as workspace_name,
        w.eur_conversion_enabled
    FROM public.workspaces w
    JOIN public.profiles p ON p.workspace_id = w.id
    WHERE p.id = auth.uid();
END;
$$;

-- 4. Update complete_sale RPC to handle exchange_rates payload
DROP FUNCTION IF EXISTS public.complete_sale(JSONB);
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
    v_eur_enabled BOOLEAN;
BEGIN
    -- Get current user's workspace
    SELECT workspace_id INTO p_workspace_id 
    FROM public.profiles 
    WHERE id = auth.uid();

    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'User does not belong to a workspace';
    END IF;

    -- Check if POS feature and EUR (if needed) are enabled
    SELECT allow_pos, eur_conversion_enabled INTO v_allow_pos, v_eur_enabled
    FROM public.workspaces
    WHERE id = p_workspace_id;

    IF NOT COALESCE(v_allow_pos, false) THEN
        RAISE EXCEPTION 'POS feature is not enabled for this workspace';
    END IF;

    -- Validate EUR products if disabled (backend safety)
    IF NOT COALESCE(v_eur_enabled, false) THEN
        FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
        LOOP
            IF (item->>'original_currency') = 'eur' THEN
                RAISE EXCEPTION 'EUR products are not enabled for this workspace';
            END IF;
        END LOOP;
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
        exchange_rates,
        origin
    )
    VALUES (
        COALESCE((payload->>'id')::UUID, gen_random_uuid()),
        p_workspace_id, 
        auth.uid(), 
        total_sale_amount, 
        COALESCE(payload->>'settlement_currency', 'usd'),
        COALESCE(payload->>'exchange_source', 'mixed'), -- For multi-source/eur sales
        COALESCE((payload->>'exchange_rate')::NUMERIC, 0), -- Backward compatibility for IQD/USD only
        COALESCE((payload->>'exchange_rate_timestamp')::TIMESTAMPTZ, NOW()),
        COALESCE(payload->'exchange_rates', '[]'::jsonb), -- New multi-snapshot field
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
