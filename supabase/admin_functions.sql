-- 1. Insert the Super Admin passkey into app_permissions
INSERT INTO public.app_permissions (key_name, key_value)
VALUES ('super_admin_passkey', 'F7mQ4ZKx9h8aB5YtC6RDP4VJH')
ON CONFLICT (key_name) DO UPDATE SET key_value = EXCLUDED.key_value;

-- 2. Secure function to verify the admin passkey from the frontend
CREATE OR REPLACE FUNCTION public.verify_admin_passkey(provided_key TEXT)
RETURNS BOOLEAN
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

-- 3. Function to delete a user account
-- We use SECURITY DEFINER so it has bypass-RLS permissions to delete from auth.users
CREATE OR REPLACE FUNCTION public.delete_user_account(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Delete from auth.users (this will cascade to public.profiles if the FK is set correctly)
    -- However, we delete from profiles first just in case
    DELETE FROM public.profiles WHERE id = target_user_id;
    DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

-- 4. Function to get all users including emails
-- We use SECURITY DEFINER to bypass RLS on profiles and access auth.users

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
