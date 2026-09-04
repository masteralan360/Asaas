ALTER TABLE public.workspace_branches
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_branches_active_source
  ON public.workspace_branches (source_workspace_id, created_at DESC)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN public.workspace_branches.archived_at IS
  'When set, the branch is unavailable but its workspace and all associated data are retained.';

-- Source workspace users may list archived relationships so an administrator can
-- restore them. A user whose current workspace is the branch may only see an
-- active relationship.
DROP POLICY IF EXISTS workspace_branches_select ON public.workspace_branches;
CREATE POLICY workspace_branches_select
  ON public.workspace_branches
  FOR SELECT
  TO authenticated
  USING (
    source_workspace_id = public.current_workspace_id()
    OR (
      archived_at IS NULL
      AND branch_workspace_id = public.current_workspace_id()
    )
  );

-- Branch lifecycle changes are handled by service-role RPCs. Authenticated
-- administrators may still rename active branches, but cannot archive, restore,
-- or physically delete relationships directly.
DROP POLICY IF EXISTS workspace_branches_update ON public.workspace_branches;
CREATE POLICY workspace_branches_update
  ON public.workspace_branches
  FOR UPDATE
  TO authenticated
  USING (
    archived_at IS NULL
    AND public.current_user_role() = 'admin'
    AND (
      source_workspace_id = public.current_workspace_id()
      OR branch_workspace_id = public.current_workspace_id()
    )
  )
  WITH CHECK (
    archived_at IS NULL
    AND archived_by IS NULL
    AND archive_reason IS NULL
    AND public.current_user_role() = 'admin'
    AND (
      source_workspace_id = public.current_workspace_id()
      OR branch_workspace_id = public.current_workspace_id()
    )
  );

DROP POLICY IF EXISTS workspace_branches_delete ON public.workspace_branches;

DROP POLICY IF EXISTS workspaces_select_current ON public.workspaces;
CREATE POLICY workspaces_select_current
  ON public.workspaces
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      id = public.current_workspace_id()
      OR EXISTS (
        SELECT 1
        FROM public.workspace_branches wb
        WHERE wb.archived_at IS NULL
          AND (
            (
              wb.source_workspace_id = public.current_workspace_id()
              AND wb.branch_workspace_id = workspaces.id
            )
            OR (
              wb.branch_workspace_id = public.current_workspace_id()
              AND wb.source_workspace_id = workspaces.id
            )
          )
      )
    )
  );

-- Disable the old destructive path. Keeping this unavailable makes older clients
-- fail safely instead of deleting branch-owned rows.
DROP FUNCTION IF EXISTS public.delete_branch_cascade(uuid, uuid);

CREATE OR REPLACE FUNCTION public.archive_branch(
  p_source_workspace_id uuid,
  p_branch_workspace_id uuid,
  p_archived_by uuid DEFAULT NULL,
  p_archive_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_branch_record public.workspace_branches%ROWTYPE;
  v_affected_profiles integer;
  v_returned_to_source integer;
  v_removed_from_workspace integer;
BEGIN
  PERFORM 1
  FROM public.workspaces
  WHERE id = p_source_workspace_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source workspace not found';
  END IF;

  SELECT *
  INTO v_branch_record
  FROM public.workspace_branches
  WHERE source_workspace_id = p_source_workspace_id
    AND branch_workspace_id = p_branch_workspace_id
    AND archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active branch relationship not found for source % and branch %',
      p_source_workspace_id,
      p_branch_workspace_id;
  END IF;

  SELECT count(*)
  INTO v_affected_profiles
  FROM public.profiles
  WHERE workspace_id = p_branch_workspace_id
    OR current_workspace = p_branch_workspace_id;

  SELECT count(*)
  INTO v_returned_to_source
  FROM public.profiles
  WHERE workspace_id IS DISTINCT FROM p_branch_workspace_id
    AND current_workspace = p_branch_workspace_id;

  SELECT count(*)
  INTO v_removed_from_workspace
  FROM public.profiles
  WHERE workspace_id = p_branch_workspace_id;

  UPDATE public.profiles
  SET current_workspace = p_source_workspace_id
  WHERE workspace_id IS DISTINCT FROM p_branch_workspace_id
    AND current_workspace = p_branch_workspace_id;

  UPDATE public.profiles
  SET workspace_id = NULL,
      current_workspace = NULL
  WHERE workspace_id = p_branch_workspace_id;

  UPDATE public.workspace_branches
  SET archived_at = now(),
      archived_by = p_archived_by,
      archive_reason = NULLIF(btrim(p_archive_reason), '')
  WHERE id = v_branch_record.id;

  UPDATE public.workspaces
  SET deleted_at = COALESCE(deleted_at, now()),
      visibility = 'private',
      store_slug = NULL
  WHERE id = p_branch_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch workspace not found';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'source_workspace_id', p_source_workspace_id,
    'branch_workspace_id', p_branch_workspace_id,
    'moved_users', v_affected_profiles,
    'returned_to_source', v_returned_to_source,
    'removed_from_workspace', v_removed_from_workspace
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_branch(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_branch(uuid, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.restore_branch(
  p_source_workspace_id uuid,
  p_branch_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_branch_record public.workspace_branches%ROWTYPE;
  v_source_workspace public.workspaces%ROWTYPE;
  v_active_branch_count integer;
BEGIN
  SELECT *
  INTO v_source_workspace
  FROM public.workspaces
  WHERE id = p_source_workspace_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source workspace not found';
  END IF;

  SELECT *
  INTO v_branch_record
  FROM public.workspace_branches
  WHERE source_workspace_id = p_source_workspace_id
    AND branch_workspace_id = p_branch_workspace_id
    AND archived_at IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Archived branch relationship not found for source % and branch %',
      p_source_workspace_id,
      p_branch_workspace_id;
  END IF;

  SELECT count(*)
  INTO v_active_branch_count
  FROM public.workspace_branches
  WHERE source_workspace_id = p_source_workspace_id
    AND archived_at IS NULL
    AND id IS DISTINCT FROM v_branch_record.id;

  IF v_active_branch_count >= public.workspace_max_branches(
    p_source_workspace_id,
    v_source_workspace.plan::text
  ) THEN
    RAISE EXCEPTION 'Workspace branch limit reached for current plan'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.workspaces
  SET deleted_at = NULL,
      locked_workspace = v_source_workspace.locked_workspace,
      subscription_expires_at = v_source_workspace.subscription_expires_at
  WHERE id = p_branch_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch workspace not found';
  END IF;

  UPDATE public.workspace_branches
  SET archived_at = NULL,
      archived_by = NULL,
      archive_reason = NULL
  WHERE id = v_branch_record.id;

  RETURN jsonb_build_object(
    'success', true,
    'source_workspace_id', p_source_workspace_id,
    'branch_workspace_id', p_branch_workspace_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_branch(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_branch(uuid, uuid) TO service_role;

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
    WHERE source_workspace_id = NEW.id
      AND archived_at IS NULL;

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

CREATE OR REPLACE FUNCTION public.enforce_workspace_branch_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
  v_branch_count integer;
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan::text INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.source_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.workspace_max_branches(NEW.source_workspace_id, v_plan) <= 0 THEN
    RAISE EXCEPTION 'Branches are not included in the current workspace plan'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_branch_count
  FROM public.workspace_branches
  WHERE source_workspace_id = NEW.source_workspace_id
    AND archived_at IS NULL
    AND (TG_OP <> 'UPDATE' OR id IS DISTINCT FROM OLD.id);

  IF v_branch_count >= public.workspace_max_branches(NEW.source_workspace_id, v_plan) THEN
    RAISE EXCEPTION 'Workspace branch limit reached for current plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_workspace_branch_plan_limit_on_workspace_branches
  ON public.workspace_branches;

CREATE TRIGGER enforce_workspace_branch_plan_limit_on_workspace_branches
BEFORE INSERT OR UPDATE OF source_workspace_id, archived_at
ON public.workspace_branches
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workspace_branch_plan_limit();

CREATE OR REPLACE FUNCTION public.sync_branch_workspace_status_from_source()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.workspaces AS branch_workspace
  SET
    locked_workspace = NEW.locked_workspace,
    subscription_expires_at = NEW.subscription_expires_at
  WHERE branch_workspace.id IN (
      SELECT wb.branch_workspace_id
      FROM public.workspace_branches wb
      WHERE wb.source_workspace_id = NEW.id
        AND wb.archived_at IS NULL
    )
    AND branch_workspace.deleted_at IS NULL
    AND (
      branch_workspace.locked_workspace IS DISTINCT FROM NEW.locked_workspace
      OR branch_workspace.subscription_expires_at IS DISTINCT FROM NEW.subscription_expires_at
    );

  RETURN NEW;
END;
$function$;
