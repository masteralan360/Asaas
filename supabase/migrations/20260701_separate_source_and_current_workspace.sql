ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_workspace uuid NULL;

UPDATE public.profiles
SET current_workspace = workspace_id
WHERE current_workspace IS NULL
  AND workspace_id IS NOT NULL;

-- Recover the source workspace for users who were actively switched into a
-- branch before current_workspace existed. The metadata is used only for this
-- one-time migration and only when it matches a real branch relationship.
UPDATE public.profiles AS profile
SET workspace_id = branch.source_workspace_id
FROM auth.users AS auth_user
JOIN public.workspace_branches AS branch
  ON auth_user.raw_user_meta_data->>'branch_source_workspace_id' = branch.source_workspace_id::text
 AND auth_user.raw_user_meta_data->>'branch_workspace_id' = branch.branch_workspace_id::text
WHERE auth_user.id = profile.id
  AND auth_user.raw_user_meta_data->>'branch_entry_mode' = 'switch'
  AND profile.current_workspace = branch.branch_workspace_id
  AND profile.workspace_id = branch.branch_workspace_id;

CREATE INDEX IF NOT EXISTS idx_profiles_current_workspace
  ON public.profiles (current_workspace);

CREATE OR REPLACE FUNCTION public.source_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT workspace_id
  FROM public.profiles
  WHERE id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.source_workspace_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.source_workspace_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT current_workspace
  FROM public.profiles
  WHERE id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.current_workspace_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO authenticated, service_role;

-- Update existing RPC definitions that historically treated profiles.workspace_id
-- as the caller's active workspace. Using pg_get_functiondef keeps every deployed
-- overload intact while changing only the obsolete profile-column references.
DO $migration$
DECLARE
  routine record;
  definition text;
  updated_definition text;
BEGIN
  FOR routine IN
    SELECT procedure.oid, procedure.proname
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'complete_sale',
        'get_net_revenue',
        'get_sales_summary',
        'get_team_performance',
        'get_top_products',
        'upsert_device_token',
        'check_return_permissions',
        'return_whole_sale',
        'acknowledge_p2p_sync'
      )
  LOOP
    definition := pg_get_functiondef(routine.oid);
    updated_definition := definition;

    IF routine.proname IN (
      'complete_sale',
      'get_net_revenue',
      'get_sales_summary',
      'get_team_performance',
      'get_top_products'
    ) THEN
      updated_definition := replace(
        updated_definition,
        'SELECT workspace_id INTO p_workspace_id',
        'SELECT current_workspace INTO p_workspace_id'
      );
    END IF;

    IF routine.proname = 'upsert_device_token' THEN
      updated_definition := replace(
        updated_definition,
        'SELECT p.workspace_id',
        'SELECT p.current_workspace'
      );
    END IF;

    IF routine.proname = 'check_return_permissions' THEN
      updated_definition := replace(
        updated_definition,
        'pr.workspace_id = s.workspace_id',
        'pr.current_workspace = s.workspace_id'
      );
    END IF;

    IF routine.proname = 'return_whole_sale' THEN
      updated_definition := replace(
        updated_definition,
        'p.workspace_id = s.workspace_id',
        'p.current_workspace = s.workspace_id'
      );
    END IF;

    IF routine.proname = 'acknowledge_p2p_sync' THEN
      updated_definition := replace(
        updated_definition,
        'p.workspace_id = v_workspace_id',
        'p.current_workspace = v_workspace_id'
      );
    END IF;

    IF updated_definition IS DISTINCT FROM definition THEN
      EXECUTE updated_definition;
    END IF;
  END LOOP;
END;
$migration$;

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND workspace_id IS NOT DISTINCT FROM public.source_workspace_id()
    AND current_workspace IS NOT DISTINCT FROM public.current_workspace_id()
    AND role IS NOT DISTINCT FROM public.current_user_role()
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  raw_ws_id text;
  valid_ws_id uuid;
BEGIN
  raw_ws_id := NEW.raw_user_meta_data->>'workspace_id';

  IF raw_ws_id IS NOT NULL AND raw_ws_id <> '' THEN
    BEGIN
      valid_ws_id := raw_ws_id::uuid;
    EXCEPTION WHEN OTHERS THEN
      valid_ws_id := NULL;
    END;
  ELSE
    valid_ws_id := NULL;
  END IF;

  INSERT INTO public.profiles (id, name, role, workspace_id, current_workspace)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'role',
    valid_ws_id,
    valid_ws_id
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_member_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
  v_member_count integer;
BEGIN
  IF NEW.workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN
    RETURN NEW;
  END IF;

  SELECT plan::text INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_member_count
  FROM public.profiles
  WHERE workspace_id = NEW.workspace_id
    AND id IS DISTINCT FROM NEW.id;

  IF v_member_count >= public.workspace_max_members(NEW.workspace_id, v_plan) THEN
    RAISE EXCEPTION 'Workspace member limit reached for current plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_demos()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_workspace record;
  v_user_ids uuid[];
  v_user_id uuid;
  v_cleaned int := 0;
BEGIN
  FOR v_workspace IN
    SELECT id FROM public.workspaces
    WHERE code LIKE 'demo.%'
      AND subscription_expires_at < now()
      AND deleted_at IS NULL
  LOOP
    SELECT array_agg(id) INTO v_user_ids
    FROM public.profiles
    WHERE workspace_id = v_workspace.id;

    PERFORM public.delete_demo_cascade(v_workspace.id);

    IF v_user_ids IS NOT NULL THEN
      FOREACH v_user_id IN ARRAY v_user_ids LOOP
        DELETE FROM auth.users WHERE id = v_user_id;
      END LOOP;
    END IF;

    v_cleaned := v_cleaned + 1;
  END LOOP;

  RETURN v_cleaned;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_expired_demos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_demos() TO service_role;
