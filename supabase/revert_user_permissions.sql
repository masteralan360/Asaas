-- Revert changes to public.profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS allow_pos;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS allow_customers;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS allow_orders;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS allow_invoices;

-- Drop the update function
-- Note: We must specify argument types to ensure we drop the correct function signature if overloaded, 
-- though here it's unique enough. 
DROP FUNCTION IF EXISTS public.update_user_permissions(TEXT, UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);

-- Revert get_all_users to previous version (removing the permission columns)
DROP FUNCTION IF EXISTS public.get_all_users(text);

CREATE OR REPLACE FUNCTION public.get_all_users(provided_key TEXT)
RETURNS TABLE (
    id UUID,
    name TEXT,
    role TEXT,
    workspace_id UUID,
    workspace_name TEXT,
    created_at TIMESTAMPTZ,
    email TEXT
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
        u.email::TEXT
    FROM auth.users u
    LEFT JOIN public.profiles p ON u.id = p.id
    LEFT JOIN public.workspaces w ON p.workspace_id = w.id
    ORDER BY u.created_at DESC;
END;
$$;
