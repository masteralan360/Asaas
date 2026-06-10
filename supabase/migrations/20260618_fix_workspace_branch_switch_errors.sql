-- Fix 1: Remove print_quality references from apply_workspace_plan_access
-- print_quality column was dropped in 20260617_remove_print_quality.sql

CREATE OR REPLACE FUNCTION public.apply_workspace_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_member_count integer;
  v_branch_count integer;
  v_contact_count integer;
  v_max_contacts integer;
BEGIN
  NEW.plan := public.normalize_workspace_plan(NEW.plan);

  IF TG_OP = 'UPDATE' AND NEW.plan::text IS DISTINCT FROM OLD.plan::text THEN
    SELECT count(*) INTO v_member_count
    FROM public.profiles
    WHERE workspace_id = NEW.id;

    IF v_member_count > public.workspace_max_members(NEW.id, NEW.plan) THEN
      RAISE EXCEPTION 'Workspace member count exceeds the % plan limit', NEW.plan
        USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_branch_count
    FROM public.workspace_branches
    WHERE source_workspace_id = NEW.id;

    IF v_branch_count > public.workspace_max_branches(NEW.id, NEW.plan) THEN
      RAISE EXCEPTION 'Workspace branch count exceeds the % plan limit', NEW.plan
        USING ERRCODE = '42501';
    END IF;

    v_max_contacts := public.workspace_max_contacts(NEW.id, NEW.plan);
    IF v_max_contacts IS NOT NULL THEN
      SELECT count(*) INTO v_contact_count
      FROM public.workspace_contacts
      WHERE workspace_id = NEW.id;

      IF v_contact_count > v_max_contacts THEN
        RAISE EXCEPTION 'Workspace contact count exceeds the % plan limit', NEW.plan
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  NEW.instant_pos := COALESCE(NEW.instant_pos, true);

  IF TG_OP = 'INSERT' OR NEW.plan::text IS DISTINCT FROM OLD.plan::text THEN
    NEW.travel_agency := public.workspace_module_allowed(NEW.id, NEW.plan::text, 'travel_agency');
    NEW.real_estate := public.workspace_module_allowed(NEW.id, NEW.plan::text, 'real_estate');
    NEW.allow_whatsapp := public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'whatsappIntegration');
    NEW.upload_limit_mb := CASE
      WHEN public.workspace_has_override(NEW.id, 'limit', 'maxUploadSizeMb')
        THEN public.workspace_get_override_value(NEW.id, 'limit', 'maxUploadSizeMb')::integer
      ELSE CASE public.normalize_workspace_plan(NEW.plan::text)
        WHEN 'enterprise' THEN 1024
        WHEN 'business' THEN 100
        ELSE NULL
      END
    END;
  END IF;

  IF NOT public.workspace_currency_allowed(NEW.id, NEW.plan::text, NEW.default_currency::text) THEN
    NEW.default_currency := 'iqd';
  END IF;

  NEW.kds_enabled := public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'kds')
    AND COALESCE(NEW.instant_pos, true)
    AND COALESCE(NEW.kds_enabled, true);

  IF NOT public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'marketplaceStorefronts') THEN
    NEW.visibility := 'private';
    NEW.store_slug := NULL;
    NEW.store_description := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- Fix 2: Allow branch switches without enforcing workspace member limits
-- This lets users freely switch between a source workspace and its branches
-- regardless of how many members are in the target workspace

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

  -- Allow branch switches without checking member limits
  IF TG_OP = 'UPDATE' AND OLD.workspace_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.workspace_branches
      WHERE (source_workspace_id = OLD.workspace_id AND branch_workspace_id = NEW.workspace_id)
         OR (source_workspace_id = NEW.workspace_id AND branch_workspace_id = OLD.workspace_id)
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT plan INTO v_plan
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
