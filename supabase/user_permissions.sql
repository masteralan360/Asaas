-- Add feature flags to public.profiles
-- Default to TRUE so existing users don't lose access unless explicitly disabled
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allow_pos BOOLEAN DEFAULT TRUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allow_customers BOOLEAN DEFAULT TRUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allow_orders BOOLEAN DEFAULT TRUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allow_invoices BOOLEAN DEFAULT TRUE;

-- Function to update user permissions (Admin only)
-- Uses existing verify_admin_passkey for security
CREATE OR REPLACE FUNCTION public.update_user_permissions(
    provided_key TEXT,
    target_user_id UUID,
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

    UPDATE public.profiles
    SET 
        allow_pos = new_allow_pos,
        allow_customers = new_allow_customers,
        allow_orders = new_allow_orders,
        allow_invoices = new_allow_invoices
    WHERE id = target_user_id;
END;
$$;

-- Update get_all_users to include these new columns
DROP FUNCTION IF EXISTS public.get_all_users(text);

CREATE OR REPLACE FUNCTION public.get_all_users(provided_key TEXT)
RETURNS TABLE (
    id UUID,
    name TEXT,
    role TEXT,
    workspace_id UUID,
    workspace_name TEXT,
    created_at TIMESTAMPTZ,
    email TEXT,
    allow_pos BOOLEAN,
    allow_customers BOOLEAN,
    allow_orders BOOLEAN,
    allow_invoices BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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
        u.email::TEXT,
        COALESCE(p.allow_pos, true) as allow_pos,
        COALESCE(p.allow_customers, true) as allow_customers,
        COALESCE(p.allow_orders, true) as allow_orders,
        COALESCE(p.allow_invoices, true) as allow_invoices
    FROM auth.users u
    LEFT JOIN public.profiles p ON u.id = p.id
    LEFT JOIN public.workspaces w ON p.workspace_id = w.id
    ORDER BY u.created_at DESC;
END;
$$;
