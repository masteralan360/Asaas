-- Member Management Functions
-- This file contains RPC functions for workspace member management

-- 1. Function to kick a member from the workspace
-- Only admins can kick members, and admins cannot kick other admins
-- The user's role is preserved, only workspace_id is removed

DROP FUNCTION IF EXISTS public.kick_member(uuid);

CREATE OR REPLACE FUNCTION public.kick_member(target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    caller_role TEXT;
    caller_workspace_id UUID;
    target_role TEXT;
    target_workspace_id UUID;
BEGIN
    -- Get caller's info from JWT
    caller_role := auth.jwt() -> 'user_metadata' ->> 'role';
    caller_workspace_id := (auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid;
    
    -- Check if caller is an admin
    IF caller_role != 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can kick members';
    END IF;
    
    -- Get target user's info from profiles
    SELECT role, workspace_id INTO target_role, target_workspace_id
    FROM public.profiles
    WHERE id = target_user_id;
    
    IF target_role IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;
    
    -- Check if target is in the same workspace
    IF target_workspace_id != caller_workspace_id THEN
        RAISE EXCEPTION 'Cannot kick members from other workspaces';
    END IF;
    
    -- Prevent kicking other admins
    IF target_role = 'admin' THEN
        RAISE EXCEPTION 'Cannot kick other admins';
    END IF;
    
    -- Prevent kicking yourself
    IF target_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot kick yourself';
    END IF;
    
    -- Remove workspace_id from profiles table
    UPDATE public.profiles 
    SET workspace_id = NULL
    WHERE id = target_user_id;
    
    -- Update auth.users metadata to remove workspace info
    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data 
        - 'workspace_id' 
        - 'workspace_code' 
        - 'workspace_name'
    WHERE id = target_user_id;
    
    RETURN jsonb_build_object('success', true, 'message', 'Member kicked successfully');
END;
$$;

-- 2. Function to join a workspace (for kicked users)
-- Updates user's workspace_id in both profiles and auth.users metadata

DROP FUNCTION IF EXISTS public.join_workspace(text);

CREATE OR REPLACE FUNCTION public.join_workspace(workspace_code_input TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    target_workspace_id UUID;
    target_workspace_name TEXT;
    current_user_id UUID;
    current_user_role TEXT;
BEGIN
    current_user_id := auth.uid();
    
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    
    -- Get user's current role
    SELECT role INTO current_user_role
    FROM public.profiles
    WHERE id = current_user_id;
    
    -- Find workspace by code
    SELECT id, name INTO target_workspace_id, target_workspace_name
    FROM public.workspaces
    WHERE code = UPPER(workspace_code_input);
    
    IF target_workspace_id IS NULL THEN
        RAISE EXCEPTION 'Invalid workspace code';
    END IF;
    
    -- Update profiles table
    UPDATE public.profiles
    SET workspace_id = target_workspace_id
    WHERE id = current_user_id;
    
    -- Update auth.users metadata
    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object(
        'workspace_id', target_workspace_id,
        'workspace_code', UPPER(workspace_code_input),
        'workspace_name', target_workspace_name
    )
    WHERE id = current_user_id;
    
    RETURN jsonb_build_object(
        'success', true, 
        'workspace_id', target_workspace_id,
        'workspace_code', UPPER(workspace_code_input),
        'workspace_name', target_workspace_name
    );
END;
$$;

-- 3. Policy to allow admins to view all profiles in their workspace (already exists)
-- 4. Add policy to allow users to update their own profile's workspace_id

DROP POLICY IF EXISTS "Users can update own workspace" ON public.profiles;

CREATE POLICY "Users can update own workspace" ON public.profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
