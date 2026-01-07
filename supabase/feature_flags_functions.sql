-- Feature Flags System for Workspaces
-- This file contains schema updates and RPCs for workspace feature flags

-- 1. Add feature flag columns to workspaces table
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS allow_pos BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS allow_customers BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS allow_orders BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS allow_invoices BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS is_configured BOOLEAN NOT NULL DEFAULT false;

-- 2. RPC Function: Configure Workspace (Admin Only)
-- Sets feature flags and marks workspace as configured
CREATE OR REPLACE FUNCTION public.configure_workspace(
    p_allow_pos BOOLEAN DEFAULT false,
    p_allow_customers BOOLEAN DEFAULT false,
    p_allow_orders BOOLEAN DEFAULT false,
    p_allow_invoices BOOLEAN DEFAULT false
)
RETURNS JSONB
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

-- 3. RPC Function: Get Workspace Features
-- Returns the feature flags for the current user's workspace
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

    -- Get workspace features
    SELECT jsonb_build_object(
        'workspace_id', id,
        'workspace_name', name,
        'allow_pos', allow_pos,
        'allow_customers', allow_customers,
        'allow_orders', allow_orders,
        'allow_invoices', allow_invoices,
        'is_configured', is_configured
    ) INTO v_result
    FROM public.workspaces
    WHERE id = v_workspace_id;

    RETURN COALESCE(v_result, jsonb_build_object(
        'allow_pos', false,
        'allow_customers', false,
        'allow_orders', false,
        'allow_invoices', false,
        'is_configured', false
    ));
END;
$$;

-- 4. Helper function to check if a feature is enabled for current user's workspace
CREATE OR REPLACE FUNCTION public.check_feature_enabled(p_feature TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_workspace_id UUID;
    v_enabled BOOLEAN := false;
BEGIN
    SELECT workspace_id INTO v_workspace_id
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_workspace_id IS NULL THEN
        RETURN false;
    END IF;

    EXECUTE format(
        'SELECT %I FROM public.workspaces WHERE id = $1',
        p_feature
    ) INTO v_enabled USING v_workspace_id;

    RETURN COALESCE(v_enabled, false);
END;
$$;
