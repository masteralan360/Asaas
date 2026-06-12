ALTER TYPE public.workspace_data_mode
  ADD VALUE IF NOT EXISTS 'demo';

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_data_mode_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_data_mode_check
  CHECK ((data_mode::text) = ANY (
    ARRAY['cloud'::text, 'local'::text, 'hybrid'::text, 'demo'::text]
  ));

CREATE OR REPLACE FUNCTION public.prevent_demo_business_data_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  target_workspace_id uuid;
  target_data_mode text;
  request_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF request_role IS DISTINCT FROM 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  target_workspace_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.workspace_id
    ELSE NEW.workspace_id
  END;

  IF target_workspace_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT data_mode
  INTO target_data_mode
  FROM public.workspaces
  WHERE id = target_workspace_id;

  IF target_data_mode = 'demo' THEN
    RAISE EXCEPTION 'Demo business data is local-only';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_demo_workspace_client_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  request_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF request_role = 'authenticated'
    AND COALESCE(OLD.data_mode, 'cloud') = 'demo' THEN
    RAISE EXCEPTION 'Demo workspace settings are local-only';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_demo_workspace_client_updates_on_workspaces
  ON public.workspaces;

CREATE TRIGGER prevent_demo_workspace_client_updates_on_workspaces
BEFORE UPDATE ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.prevent_demo_workspace_client_updates();

CREATE OR REPLACE FUNCTION public.prevent_demo_profile_client_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  target_workspace_id uuid;
  target_data_mode text;
  request_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF request_role <> 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  target_workspace_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.workspace_id
    ELSE NEW.workspace_id
  END;

  SELECT data_mode
  INTO target_data_mode
  FROM public.workspaces
  WHERE id = target_workspace_id;

  IF target_data_mode = 'demo' THEN
    RAISE EXCEPTION 'Demo profile settings are local-only';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_demo_profile_client_updates_on_profiles
  ON public.profiles;

CREATE TRIGGER prevent_demo_profile_client_updates_on_profiles
BEFORE UPDATE OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_demo_profile_client_updates();

DO $block$
DECLARE
  target_table record;
  trigger_name text;
BEGIN
  FOR target_table IN
    SELECT columns.table_name
    FROM information_schema.columns AS columns
    INNER JOIN information_schema.tables AS tables
      ON tables.table_schema = columns.table_schema
      AND tables.table_name = columns.table_name
    WHERE columns.table_schema = 'public'
      AND tables.table_type = 'BASE TABLE'
      AND columns.column_name = 'workspace_id'
      AND columns.table_name NOT IN (
        'workspaces',
        'workspace_access_overrides',
        'profiles'
      )
  LOOP
    trigger_name := 'prevent_demo_writes_' || target_table.table_name;
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      trigger_name,
      target_table.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.prevent_demo_business_data_writes()',
      trigger_name,
      target_table.table_name
    );
  END LOOP;
END;
$block$;
