-- Consolidated Workspace Settings & RPC Fix
-- Redefines the RPCs to include all workspace configuration fields

-- 1. Update get_workspace_features RPC
-- This is used by the frontend on every refresh/initialization
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
        'allow_whatsapp', COALESCE(allow_whatsapp, false)
    ) INTO v_result
    FROM public.workspaces
    WHERE id = v_workspace_id;

    RETURN v_result;
END;
$$;

-- 2. Update admin_get_all_workspaces
-- Ensures Super-Admins can see all these settings in the admin dashboard
DROP FUNCTION IF EXISTS public.get_all_workspaces(text);

CREATE OR REPLACE FUNCTION public.get_all_workspaces(provided_key TEXT)
RETURNS TABLE (
    id UUID,
    name TEXT,
    code TEXT,
    created_at TIMESTAMPTZ,
    allow_pos BOOLEAN,
    allow_customers BOOLEAN,
    allow_orders BOOLEAN,
    allow_invoices BOOLEAN,
    is_configured BOOLEAN,
    deleted_at TIMESTAMPTZ,
    logo_url TEXT,
    allow_whatsapp BOOLEAN,
    locked_workspace BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.verify_admin_passkey(provided_key) THEN
        RAISE EXCEPTION 'Unauthorized: Invalid admin passkey';
    END IF;

    RETURN QUERY
    SELECT 
        w.id,
        w.name,
        w.code,
        w.created_at,
        COALESCE(w.allow_pos, false),
        COALESCE(w.allow_customers, false),
        COALESCE(w.allow_orders, false),
        COALESCE(w.allow_invoices, false),
        COALESCE(w.is_configured, false),
        w.deleted_at,
        w.logo_url,
        COALESCE(w.allow_whatsapp, false),
        COALESCE(w.locked_workspace, false)
    FROM public.workspaces w
    ORDER BY w.created_at DESC;
END;
$$;
