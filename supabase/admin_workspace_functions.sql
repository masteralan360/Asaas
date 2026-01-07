-- Admin Workspace Functions
-- Functions for Super Admins to manage workspaces and their feature flags

-- 1. Get All Workspaces (Admin Only)
-- Drops the function first to allow return type changes
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
    deleted_at TIMESTAMPTZ
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
        w.deleted_at
    FROM public.workspaces w
    ORDER BY w.created_at DESC;
END;
$$;


-- 2. Update Workspace Features (Admin Only)
CREATE OR REPLACE FUNCTION public.admin_update_workspace_features(
    provided_key TEXT,
    target_workspace_id UUID,
    new_allow_pos BOOLEAN,
    new_allow_customers BOOLEAN,
    new_allow_orders BOOLEAN,
    new_allow_invoices BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.verify_admin_passkey(provided_key) THEN
        RAISE EXCEPTION 'Unauthorized: Invalid admin passkey';
    END IF;

    UPDATE public.workspaces
    SET 
        allow_pos = new_allow_pos,
        allow_customers = new_allow_customers,
        allow_orders = new_allow_orders,
        allow_invoices = new_allow_invoices,
        is_configured = true -- Ensure it's marked configured if admin touches it
    WHERE id = target_workspace_id;
END;
$$;
