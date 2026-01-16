-- Functions in public schema

CREATE OR REPLACE FUNCTION public.get_all_users(provided_key text)
RETURNS TABLE(id uuid, name text, role text, workspace_id uuid, workspace_name text, created_at timestamptz, email text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.verify_admin_passkey(provided_key) THEN
        RAISE EXCEPTION 'Unauthorized: Invalid admin passkey';
    END IF;

    RETURN QUERY
    SELECT 
        u.id, 
        p.name, 
        p.role, 
        p.workspace_id,
        w.name as workspace_name,
        u.created_at,
        u.email::TEXT
    FROM auth.users u
    LEFT JOIN public.profiles p ON u.id = p.id
    LEFT JOIN public.workspaces w ON p.workspace_id = w.id
    ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_workspace(p_allow_pos boolean, p_allow_customers boolean, p_allow_orders boolean, p_allow_invoices boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_workspace_id UUID;
    v_user_role TEXT;
BEGIN
    -- Get user's workspace and role
    SELECT workspace_id, role INTO v_workspace_id, v_user_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_workspace_id IS NULL THEN
        RAISE EXCEPTION 'User does not belong to a workspace';
    END IF;

    IF v_user_role != 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can configure workspace features';
    END IF;

    -- Update workspace with feature flags
    UPDATE public.workspaces
    SET 
        allow_pos = p_allow_pos,
        allow_customers = p_allow_customers,
        allow_orders = p_allow_orders,
        allow_invoices = p_allow_invoices,
        is_configured = true
    WHERE id = v_workspace_id;

    RETURN jsonb_build_object(
        'success', true,
        'allow_pos', p_allow_pos,
        'allow_customers', p_allow_customers,
        'allow_orders', p_allow_orders,
        'allow_invoices', p_allow_invoices
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.profiles (id, name, role, workspace_id)
    VALUES (
        new.id,
        new.raw_user_meta_data->>'name',
        new.raw_user_meta_data->>'role',
        (new.raw_user_meta_data->>'workspace_id')::uuid
    );
    RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_admin_passkey(provided_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    valid_key TEXT;
BEGIN
    SELECT key_value INTO valid_key 
    FROM public.app_permissions 
    WHERE key_name = 'super_admin_passkey';
    
    RETURN provided_key = valid_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user_account(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_role TEXT;
    v_workspace_id UUID;
BEGIN
    -- Get user role and workspace
    SELECT role, workspace_id INTO v_role, v_workspace_id
    FROM public.profiles
    WHERE id = target_user_id;

    -- If user is admin and has a workspace, soft delete it
    IF v_role = 'admin' AND v_workspace_id IS NOT NULL THEN
        UPDATE public.workspaces
        SET deleted_at = NOW()
        WHERE id = v_workspace_id;
    END IF;

    -- Delete from public.profiles
    DELETE FROM public.profiles WHERE id = target_user_id;
    
    -- Delete from auth.users
    DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_workspace_code() RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    new_code TEXT;
    is_unique BOOLEAN DEFAULT FALSE;
BEGIN
    WHILE NOT is_unique LOOP
        new_code := '';
        FOR i IN 1..4 LOOP
            new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
        END LOOP;
        new_code := new_code || '-';
        FOR i IN 1..4 LOOP
            new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
        END LOOP;
        
        SELECT NOT EXISTS (SELECT 1 FROM public.workspaces WHERE code = new_code) INTO is_unique;
    END LOOP;
    RETURN new_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.create_workspace(w_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_id UUID;
    new_code TEXT;
BEGIN
    INSERT INTO public.workspaces (name)
    VALUES (w_name)
    RETURNING id, code INTO new_id, new_code;
    
    RETURN jsonb_build_object('id', new_id, 'code', new_code);
END;
$$;

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
    eur_conversion_enabled BOOLEAN,
    try_conversion_enabled BOOLEAN
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
        w.eur_conversion_enabled,
        w.try_conversion_enabled
    FROM public.workspaces w
    JOIN public.profiles p ON p.workspace_id = w.id
    WHERE p.id = auth.uid();
END;
$$;

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
    SELECT workspace_id INTO p_workspace_id FROM public.profiles WHERE id = auth.uid();
    IF p_workspace_id IS NULL THEN RAISE EXCEPTION 'User does not belong to a workspace'; END IF;

    SELECT allow_pos, eur_conversion_enabled, try_conversion_enabled
    INTO v_allow_pos, v_eur_enabled, v_try_enabled
    FROM public.workspaces WHERE id = p_workspace_id;

    IF NOT COALESCE(v_allow_pos, false) THEN RAISE EXCEPTION 'POS feature is not enabled'; END IF;

    IF NOT COALESCE(v_eur_enabled, false) OR NOT COALESCE(v_try_enabled, false) THEN
        FOR item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
            IF NOT COALESCE(v_eur_enabled, false) AND (item->>'original_currency') = 'eur' THEN RAISE EXCEPTION 'EUR products disabled'; END IF;
            IF NOT COALESCE(v_try_enabled, false) AND (item->>'original_currency') = 'try' THEN RAISE EXCEPTION 'TRY products disabled'; END IF;
        END LOOP;
    END IF;

    total_sale_amount := (payload->>'total_amount')::NUMERIC;
    v_settlement_currency := COALESCE(payload->>'settlement_currency', 'usd');

    INSERT INTO public.sales (
        id, workspace_id, cashier_id, total_amount, settlement_currency,
        exchange_source, exchange_rate, exchange_rate_timestamp, exchange_rates,
        origin, payment_method
    )
    VALUES (
        COALESCE((payload->>'id')::UUID, gen_random_uuid()),
        p_workspace_id, auth.uid(), total_sale_amount, v_settlement_currency,
        COALESCE(payload->>'exchange_source', 'mixed'),
        COALESCE((payload->>'exchange_rate')::NUMERIC, 0),
        COALESCE((payload->>'exchange_rate_timestamp')::TIMESTAMPTZ, NOW()),
        COALESCE(payload->'exchange_rates', '[]'::jsonb),
        COALESCE(payload->>'origin', 'pos'),
        COALESCE(payload->>'payment_method', 'cash')
    )
    RETURNING id INTO new_sale_id;

    FOR item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
        SELECT cost_price, currency INTO v_product FROM public.products
        WHERE id = (item->>'product_id')::UUID AND workspace_id = p_workspace_id;

        v_cost_price := COALESCE(v_product.cost_price, 0);
        v_original_currency := COALESCE(item->>'original_currency', v_product.currency, 'usd');
        v_converted_cost_price := v_cost_price;

        IF v_original_currency <> v_settlement_currency THEN
            SELECT er INTO v_rate_data FROM jsonb_array_elements(payload->'exchange_rates') er
            WHERE (er->>'pair') = (UPPER(v_original_currency) || '/' || UPPER(v_settlement_currency));
            
            IF v_rate_data IS NOT NULL THEN
                v_converted_cost_price := v_cost_price * ((v_rate_data->>'rate')::NUMERIC / 100);
            ELSE
                SELECT er INTO v_rate_data FROM jsonb_array_elements(payload->'exchange_rates') er
                WHERE (er->>'pair') = (UPPER(v_settlement_currency) || '/' || UPPER(v_original_currency));
                
                IF v_rate_data IS NOT NULL THEN
                    v_converted_cost_price := v_cost_price / ((v_rate_data->>'rate')::NUMERIC / 100);
                ELSE
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

        INSERT INTO public.sale_items (
            sale_id, product_id, quantity, unit_price, total_price,
            cost_price, converted_cost_price, original_currency,
            original_unit_price, converted_unit_price, settlement_currency,
            negotiated_price
        )
        VALUES (
            new_sale_id, (item->>'product_id')::UUID, (item->>'quantity')::INTEGER,
            (item->>'unit_price')::NUMERIC, (item->>'total_price')::NUMERIC,
            v_cost_price, v_converted_cost_price, v_original_currency,
            COALESCE((item->>'original_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE((item->>'converted_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            v_settlement_currency, (item->>'negotiated_price')::NUMERIC
        );

        UPDATE public.products SET quantity = quantity - (item->>'quantity')::INTEGER
        WHERE id = (item->>'product_id')::UUID AND workspace_id = p_workspace_id;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'sale_id', new_sale_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_sale(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    p_workspace_id UUID;
    v_user_role TEXT;
BEGIN
    SELECT workspace_id INTO p_workspace_id FROM public.sales WHERE id = p_sale_id;
    IF p_workspace_id IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;

    SELECT role INTO v_user_role FROM public.profiles WHERE id = auth.uid() AND workspace_id = p_workspace_id;
    IF v_user_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    DELETE FROM public.sales WHERE id = p_sale_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.return_whole_sale(p_sale_id UUID, p_return_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    sale_record RECORD;
    item_record RECORD;
    p_workspace_id UUID;
    v_user_role TEXT;
BEGIN
    SELECT * INTO sale_record FROM public.sales WHERE id = p_sale_id;
    IF sale_record IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
    IF sale_record.is_returned = TRUE THEN RAISE EXCEPTION 'Already returned'; END IF;

    p_workspace_id := sale_record.workspace_id;
    SELECT role INTO v_user_role FROM public.profiles WHERE id = auth.uid() AND workspace_id = p_workspace_id;
    IF v_user_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    UPDATE public.sales SET is_returned = TRUE, return_reason = p_return_reason, returned_at = NOW(), returned_by = auth.uid()
    WHERE id = p_sale_id;

    UPDATE public.sale_items SET is_returned = TRUE, return_reason = 'Whole sale returned: ' || p_return_reason, returned_at = NOW(), returned_by = auth.uid()
    WHERE sale_id = p_sale_id;

    FOR item_record IN SELECT * FROM public.sale_items WHERE sale_id = p_sale_id LOOP
        UPDATE public.products SET quantity = quantity + item_record.quantity
        WHERE id = item_record.product_id AND workspace_id = p_workspace_id;
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.return_sale_items(p_sale_item_ids UUID[], p_return_quantities INTEGER[], p_return_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item_record RECORD;
    p_workspace_id UUID;
    v_user_role TEXT;
    v_index INTEGER;
BEGIN
    IF array_length(p_sale_item_ids, 1) != array_length(p_return_quantities, 1) THEN RAISE EXCEPTION 'Mismatched arrays'; END IF;

    SELECT s.workspace_id INTO p_workspace_id FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id WHERE si.id = p_sale_item_ids[1];
    SELECT role INTO v_user_role FROM public.profiles WHERE id = auth.uid() AND workspace_id = p_workspace_id;
    IF v_user_role NOT IN ('admin', 'staff') THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    FOR v_index IN 1..array_length(p_sale_item_ids, 1) LOOP
        SELECT si.*, s.id as sale_id INTO item_record FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id WHERE si.id = p_sale_item_ids[v_index];
        IF item_record IS NULL OR item_record.is_returned = TRUE THEN CONTINUE; END IF;

        IF p_return_quantities[v_index] = item_record.quantity THEN
            UPDATE public.sale_items SET is_returned = TRUE, return_reason = p_return_reason, returned_at = NOW(), returned_by = auth.uid(), returned_quantity = item_record.quantity
            WHERE id = item_record.id;
            UPDATE public.products SET quantity = quantity + item_record.quantity WHERE id = item_record.product_id AND workspace_id = p_workspace_id;
        ELSE
            UPDATE public.sale_items SET 
                quantity = quantity - p_return_quantities[v_index],
                total_price = total_price - (p_return_quantities[v_index] * (item_record.total_price / item_record.quantity)),
                returned_quantity = returned_quantity + p_return_quantities[v_index],
                return_reason = p_return_reason,
                returned_at = NOW(),
                returned_by = auth.uid()
            WHERE id = item_record.id;
            
            UPDATE public.sales SET total_amount = total_amount - (p_return_quantities[v_index] * COALESCE(item_record.converted_unit_price, item_record.unit_price))
            WHERE id = item_record.sale_id;
            
            UPDATE public.products SET quantity = quantity + p_return_quantities[v_index] WHERE id = item_record.product_id AND workspace_id = p_workspace_id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;
