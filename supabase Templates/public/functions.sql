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
