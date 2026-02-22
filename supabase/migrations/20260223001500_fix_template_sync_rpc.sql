-- Migration to fix get_workspace_features RPC to include template settings and other missing columns

DROP FUNCTION IF EXISTS public.get_workspace_features();

CREATE OR REPLACE FUNCTION public.get_workspace_features()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_workspace_id UUID;
    v_result JSONB;
BEGIN
    -- Get user's workspace
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

    -- Get ALL workspace features and settings
    SELECT jsonb_build_object(
        'workspace_id', id,
        'workspace_name', name,
        'allow_pos', COALESCE(allow_pos, false),
        'allow_customers', COALESCE(allow_customers, false),
        'allow_suppliers', COALESCE(allow_suppliers, false),
        'allow_orders', COALESCE(allow_orders, false),
        'allow_invoices', COALESCE(allow_invoices, false),
        'is_configured', COALESCE(is_configured, false),
        'default_currency', COALESCE(default_currency, 'usd'),
        'iqd_display_preference', COALESCE(iqd_display_preference, 'IQD'),
        'eur_conversion_enabled', COALESCE(eur_conversion_enabled, false),
        'try_conversion_enabled', COALESCE(try_conversion_enabled, false),
        'locked_workspace', COALESCE(locked_workspace, false),
        'logo_url', logo_url,
        'max_discount_percent', COALESCE(max_discount_percent, 100),
        'allow_whatsapp', COALESCE(allow_whatsapp, false),
        'print_lang', COALESCE(print_lang, 'auto'),
        'print_qr', COALESCE(print_qr, false),
        'receipt_template', COALESCE(receipt_template, 'primary'),
        'a4_template', COALESCE(a4_template, 'primary'),
        'subscription_expires_at', subscription_expires_at
    ) INTO v_result
    FROM public.workspaces
    WHERE id = v_workspace_id;

    RETURN v_result;
END;
$$;
