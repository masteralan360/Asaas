-- Make plan an enum so Supabase Dashboard shows a dropdown with valid values.
-- Also remove plan-change validation so users can freely switch plans.
-- Existing functions that accept text for p_plan are called with ::text where needed.

-- Drop policies that reference the plan column before altering its type
DROP POLICY IF EXISTS workspace_permissions_select ON public.workspace_permissions;
DROP POLICY IF EXISTS workspace_permissions_insert ON public.workspace_permissions;
DROP POLICY IF EXISTS workspace_permissions_update ON public.workspace_permissions;
DROP POLICY IF EXISTS workspace_permissions_delete ON public.workspace_permissions;

-- Drop CHECK constraint on plan (will be enforced by enum type itself).
-- Must be done before ALTER TYPE to avoid workspace_plan_type = text operator error.
ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_plan_check;

CREATE TYPE public.workspace_plan_type AS ENUM ('basic', 'business', 'enterprise');

-- Implicit cast from enum to text so existing functions and trigger variables
-- (declared as text) continue to work without modification.
CREATE CAST (public.workspace_plan_type AS text) WITH INOUT AS IMPLICIT;

ALTER TABLE public.workspaces
  ALTER COLUMN plan DROP DEFAULT,
  ALTER COLUMN plan TYPE public.workspace_plan_type
  USING plan::public.workspace_plan_type,
  ALTER COLUMN plan SET DEFAULT 'basic'::public.workspace_plan_type;

-- Overload normalize_workspace_plan to accept the enum (pass-through, already valid)
CREATE OR REPLACE FUNCTION public.normalize_workspace_plan(p_plan public.workspace_plan_type)
RETURNS public.workspace_plan_type
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_plan;
$function$;

GRANT EXECUTE ON FUNCTION public.normalize_workspace_plan(public.workspace_plan_type) TO authenticated, service_role;

-- Update apply_workspace_plan_access:
--   - Remove normalize call (column is already the correct type)
--   - Remove plan-change validation block (users can freely change plan in Dashboard)
--   - Cast NEW.plan::text where passing to functions that still accept text
CREATE OR REPLACE FUNCTION public.apply_workspace_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.instant_pos := COALESCE(NEW.instant_pos, true);
  NEW.members := true;

  NEW.real_estate := false;

  IF NOT public.workspace_plan_allows_currency(NEW.plan::text, NEW.default_currency::text) THEN
    NEW.default_currency := 'usd';
  END IF;

  NEW.eur_conversion_enabled := public.workspace_plan_has_capability(NEW.plan::text, 'multiCurrency');
  NEW.try_conversion_enabled := public.workspace_plan_has_capability(NEW.plan::text, 'multiCurrency');
  NEW.allow_whatsapp := public.workspace_plan_has_capability(NEW.plan::text, 'whatsappIntegration');
  NEW.kds_enabled := public.workspace_plan_has_capability(NEW.plan::text, 'kds')
    AND COALESCE(NEW.instant_pos, true)
    AND COALESCE(NEW.kds_enabled, true);
  NEW.upload_limit_mb := CASE public.normalize_workspace_plan(NEW.plan::text)
    WHEN 'enterprise' THEN 1024
    WHEN 'business' THEN 100
    ELSE NULL
  END;

  IF NOT public.workspace_plan_has_capability(NEW.plan::text, 'marketplaceStorefronts') THEN
    NEW.visibility := 'private';
    NEW.store_slug := NULL;
    NEW.store_description := NULL;
  END IF;

  IF NOT public.workspace_plan_has_capability(NEW.plan::text, 'a4PdfInvoices') THEN
    NEW.print_quality := 'low';
  END IF;

  RETURN NEW;
END;
$function$;

-- Update normalize_marketplace_workspace_settings: remove references to dropped
-- "ecommerce" column (now derived from plan at runtime).
CREATE OR REPLACE FUNCTION public.normalize_marketplace_workspace_settings()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.visibility := COALESCE(NULLIF(lower(trim(COALESCE(NEW.visibility, 'private'))), ''), 'private');
  NEW.store_slug := NULLIF(lower(trim(COALESCE(NEW.store_slug, ''))), '');
  NEW.store_description := NULLIF(trim(COALESCE(NEW.store_description, '')), '');

  IF NEW.visibility NOT IN ('private', 'public') THEN
    RAISE EXCEPTION 'Workspace visibility must be private or public';
  END IF;

  IF NEW.visibility = 'public' AND NEW.deleted_at IS NULL THEN
    IF COALESCE(NEW.data_mode, 'cloud') = 'local' THEN
      RAISE EXCEPTION 'Local workspaces cannot be published to the marketplace';
    END IF;

    IF NEW.store_slug IS NULL THEN
      RAISE EXCEPTION 'A store slug is required before a workspace can be published';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Recreate policies that depend on the plan column (now enum with implicit text cast)
CREATE POLICY workspace_permissions_select
  ON public.workspace_permissions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_plan_has_capability(
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND (
      user_uuid = auth.uid()
      OR public.current_user_role() = 'admin'
    )
  );

CREATE POLICY workspace_permissions_insert
  ON public.workspace_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND module = split_part(key, '.', 1)
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = workspace_permissions.user_uuid
        AND p.workspace_id = workspace_permissions.workspace_id
        AND p.role <> 'admin'
    )
  );

CREATE POLICY workspace_permissions_update
  ON public.workspace_permissions
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND module = split_part(key, '.', 1)
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = workspace_permissions.user_uuid
        AND p.workspace_id = workspace_permissions.workspace_id
        AND p.role <> 'admin'
    )
  );

CREATE POLICY workspace_permissions_delete
  ON public.workspace_permissions
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_plan_has_capability(
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
  );
