-- Negotiated Price Feature Migration
-- Run this in your Supabase SQL Editor to enable negotiated pricing.

-- 1. Add negotiated_price column to sale_items
ALTER TABLE public.sale_items
ADD COLUMN IF NOT EXISTS negotiated_price NUMERIC DEFAULT NULL;

-- 2. Update complete_sale RPC to accept and store negotiated_price
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
    v_try_enabled BOOLEAN;
    v_product RECORD;
    v_cost_price NUMERIC;
    v_converted_cost_price NUMERIC;
    v_settlement_currency TEXT;
    v_original_currency TEXT;
    v_rate_data JSONB;
BEGIN
    -- Get current user's workspace
    SELECT workspace_id INTO p_workspace_id 
    FROM public.profiles 
    WHERE id = auth.uid();

    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'User does not belong to a workspace';
    END IF;

    -- Check if POS feature and EUR/TRY (if needed) are enabled
    SELECT 
        allow_pos, 
        eur_conversion_enabled,
        try_conversion_enabled
    INTO 
        v_allow_pos, 
        v_eur_enabled,
        v_try_enabled
    FROM public.workspaces
    WHERE id = p_workspace_id;

    IF NOT COALESCE(v_allow_pos, false) THEN
        RAISE EXCEPTION 'POS feature is not enabled for this workspace';
    END IF;

    -- Validate EUR/TRY products if disabled (backend safety)
    IF NOT COALESCE(v_eur_enabled, false) OR NOT COALESCE(v_try_enabled, false) THEN
        FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
        LOOP
            IF NOT COALESCE(v_eur_enabled, false) AND (item->>'original_currency') = 'eur' THEN
                RAISE EXCEPTION 'EUR products are not enabled for this workspace';
            END IF;
            IF NOT COALESCE(v_try_enabled, false) AND (item->>'original_currency') = 'try' THEN
                RAISE EXCEPTION 'TRY products are not enabled for this workspace';
            END IF;
        END LOOP;
    END IF;

    total_sale_amount := (payload->>'total_amount')::NUMERIC;
    v_settlement_currency := COALESCE(payload->>'settlement_currency', 'usd');

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
        v_settlement_currency,
        COALESCE(payload->>'exchange_source', 'mixed'),
        COALESCE((payload->>'exchange_rate')::NUMERIC, 0),
        COALESCE((payload->>'exchange_rate_timestamp')::TIMESTAMPTZ, NOW()),
        COALESCE(payload->'exchange_rates', '[]'::jsonb),
        COALESCE(payload->>'origin', 'pos')
    )
    RETURNING id INTO new_sale_id;

    -- Process Items
    FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
    LOOP
        -- Fetch product cost from DB
        SELECT cost_price, currency INTO v_product
        FROM public.products
        WHERE id = (item->>'product_id')::UUID AND workspace_id = p_workspace_id;

        v_cost_price := COALESCE(v_product.cost_price, 0);
        v_original_currency := COALESCE(item->>'original_currency', v_product.currency, 'usd');
        v_converted_cost_price := v_cost_price; -- Default: no conversion

        -- Convert cost if currencies differ
        IF v_original_currency <> v_settlement_currency THEN
            -- Try to find direct rate: ORIGINAL/SETTLEMENT
            SELECT er INTO v_rate_data FROM jsonb_array_elements(payload->'exchange_rates') er
            WHERE (er->>'pair') = (UPPER(v_original_currency) || '/' || UPPER(v_settlement_currency));
            
            IF v_rate_data IS NOT NULL THEN
                v_converted_cost_price := v_cost_price * ((v_rate_data->>'rate')::NUMERIC / 100);
            ELSE
                -- Try inverse: SETTLEMENT/ORIGINAL
                SELECT er INTO v_rate_data FROM jsonb_array_elements(payload->'exchange_rates') er
                WHERE (er->>'pair') = (UPPER(v_settlement_currency) || '/' || UPPER(v_original_currency));
                
                IF v_rate_data IS NOT NULL THEN
                    v_converted_cost_price := v_cost_price / ((v_rate_data->>'rate')::NUMERIC / 100);
                ELSE
                    -- Fallback: Try chaining through IQD if available
                    DECLARE
                        v_orig_iqd_rate NUMERIC := NULL;
                        v_settle_iqd_rate NUMERIC := NULL;
                    BEGIN
                        SELECT (er->>'rate')::NUMERIC INTO v_orig_iqd_rate FROM jsonb_array_elements(payload->'exchange_rates') er
                        WHERE (er->>'pair') = (UPPER(v_original_currency) || '/IQD');
                        
                        SELECT (er->>'rate')::NUMERIC INTO v_settle_iqd_rate FROM jsonb_array_elements(payload->'exchange_rates') er
                        WHERE (er->>'pair') = (UPPER(v_settlement_currency) || '/IQD');
                        
                        IF v_orig_iqd_rate IS NOT NULL AND v_settle_iqd_rate IS NOT NULL THEN
                            v_converted_cost_price := (v_cost_price * (v_orig_iqd_rate / 100)) / (v_settle_iqd_rate / 100);
                        END IF;
                    END;
                END IF;
            END IF;
        END IF;

        -- Insert Sale Item with cost tracking and negotiated price
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
            v_cost_price,
            v_converted_cost_price,
            v_original_currency,
            COALESCE((item->>'original_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE((item->>'converted_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            v_settlement_currency,
            (item->>'negotiated_price')::NUMERIC
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
