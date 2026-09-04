CREATE TABLE IF NOT EXISTS public.workspace_access_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type text NOT NULL,
  key text NOT NULL,
  value text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_access_overrides_unique UNIQUE (workspace_id, type, key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_access_overrides_lookup
  ON public.workspace_access_overrides (workspace_id, type);

ALTER TABLE public.workspace_access_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_access_overrides_select ON public.workspace_access_overrides;
CREATE POLICY workspace_access_overrides_select
  ON public.workspace_access_overrides
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS workspace_access_overrides_insert ON public.workspace_access_overrides;
CREATE POLICY workspace_access_overrides_insert
  ON public.workspace_access_overrides
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS workspace_access_overrides_update ON public.workspace_access_overrides;
CREATE POLICY workspace_access_overrides_update
  ON public.workspace_access_overrides
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS workspace_access_overrides_delete ON public.workspace_access_overrides;
CREATE POLICY workspace_access_overrides_delete
  ON public.workspace_access_overrides
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  );

CREATE OR REPLACE FUNCTION public.workspace_get_override_value(
  p_workspace_id uuid,
  p_type text,
  p_key text
)
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT value
  FROM public.workspace_access_overrides
  WHERE workspace_id = p_workspace_id
    AND type = p_type
    AND key = p_key
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_has_override(
  p_workspace_id uuid,
  p_type text,
  p_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_access_overrides
    WHERE workspace_id = p_workspace_id
      AND type = p_type
      AND key = p_key
  );
$function$;

CREATE OR REPLACE FUNCTION public.workspace_module_allowed(
  p_workspace_id uuid,
  p_plan text,
  p_module text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.workspace_has_override(p_workspace_id, 'module', p_module) THEN
      COALESCE(public.workspace_get_override_value(p_workspace_id, 'module', p_module), 'grant') = 'grant'
    ELSE public.workspace_plan_has_module(p_plan, p_module)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_capability_allowed(
  p_workspace_id uuid,
  p_plan text,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.workspace_has_override(p_workspace_id, 'capability', p_capability) THEN
      COALESCE(public.workspace_get_override_value(p_workspace_id, 'capability', p_capability), 'grant') = 'grant'
    ELSE public.workspace_plan_has_capability(p_plan, p_capability)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_currency_allowed(
  p_workspace_id uuid,
  p_plan text,
  p_currency text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.workspace_has_override(p_workspace_id, 'currency', p_currency) THEN
      COALESCE(public.workspace_get_override_value(p_workspace_id, 'currency', p_currency), 'grant') = 'grant'
    ELSE public.workspace_plan_allows_currency(p_plan, p_currency)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_max_members(
  p_workspace_id uuid,
  p_plan text
)
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.workspace_has_override(p_workspace_id, 'limit', 'maxMembers') THEN
      public.workspace_get_override_value(p_workspace_id, 'limit', 'maxMembers')::integer
    ELSE public.workspace_plan_max_members(p_plan)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_max_branches(
  p_workspace_id uuid,
  p_plan text
)
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.workspace_has_override(p_workspace_id, 'limit', 'maxBranches') THEN
      public.workspace_get_override_value(p_workspace_id, 'limit', 'maxBranches')::integer
    ELSE public.workspace_plan_max_branches(p_plan)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_max_contacts(
  p_workspace_id uuid,
  p_plan text
)
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.workspace_has_override(p_workspace_id, 'limit', 'maxWorkspaceContacts') THEN
      public.workspace_get_override_value(p_workspace_id, 'limit', 'maxWorkspaceContacts')::integer
    ELSE public.workspace_plan_max_contacts(p_plan)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_max_upload_bytes(
  p_workspace_id uuid,
  p_plan text
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.workspace_has_override(p_workspace_id, 'limit', 'maxUploadSizeMb') THEN
      public.workspace_get_override_value(p_workspace_id, 'limit', 'maxUploadSizeMb')::bigint * 1048576
    ELSE public.workspace_plan_max_upload_bytes(p_plan)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_upload_mime_allowed(
  p_workspace_id uuid,
  p_plan text,
  p_mime text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.workspace_has_override(p_workspace_id, 'limit', 'allowedUploadMimeTypes') THEN
      lower(coalesce(p_mime, '')) = lower(coalesce(public.workspace_get_override_value(p_workspace_id, 'limit', 'allowedUploadMimeTypes'), ''))
    ELSE public.workspace_plan_allows_upload_mime(p_plan, p_mime)
  END;
$function$;

DROP POLICY IF EXISTS workspace_permissions_select ON public.workspace_permissions;
CREATE POLICY workspace_permissions_select
  ON public.workspace_permissions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_capability_allowed(
      workspace_permissions.workspace_id,
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
    AND (
      user_uuid = auth.uid()
      OR public.current_user_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS workspace_permissions_insert ON public.workspace_permissions;
CREATE POLICY workspace_permissions_insert
  ON public.workspace_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_capability_allowed(
      workspace_permissions.workspace_id,
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
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

DROP POLICY IF EXISTS workspace_permissions_update ON public.workspace_permissions;
CREATE POLICY workspace_permissions_update
  ON public.workspace_permissions
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_capability_allowed(
      workspace_permissions.workspace_id,
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_capability_allowed(
      workspace_permissions.workspace_id,
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
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

DROP POLICY IF EXISTS workspace_permissions_delete ON public.workspace_permissions;
CREATE POLICY workspace_permissions_delete
  ON public.workspace_permissions
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
    AND public.workspace_capability_allowed(
      workspace_permissions.workspace_id,
      (SELECT w.plan FROM public.workspaces w WHERE w.id = workspace_permissions.workspace_id),
      'workspaceManagementPermissions'
    )
  );

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

  IF TG_OP = 'UPDATE' AND NEW.plan IS DISTINCT FROM OLD.plan THEN
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
    NEW.real_estate := false;
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
    NEW.default_currency := 'usd';
  END IF;

  NEW.eur_conversion_enabled := public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'multiCurrency');
  NEW.try_conversion_enabled := public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'multiCurrency');
  NEW.kds_enabled := public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'kds')
    AND COALESCE(NEW.instant_pos, true)
    AND COALESCE(NEW.kds_enabled, true);

  IF NOT public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'marketplaceStorefronts') THEN
    NEW.visibility := 'private';
    NEW.store_slug := NULL;
    NEW.store_description := NULL;
  END IF;

  IF NOT public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'a4PdfInvoices') THEN
    NEW.print_quality := 'low';
  END IF;

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
  SELECT plan INTO v_plan
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
    AND (TG_OP <> 'UPDATE' OR id IS DISTINCT FROM OLD.id);

  IF v_branch_count >= public.workspace_max_branches(NEW.source_workspace_id, v_plan) THEN
    RAISE EXCEPTION 'Workspace branch limit reached for current plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_contact_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
  v_contact_count integer;
  v_max_contacts integer;
BEGIN
  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  v_max_contacts := public.workspace_max_contacts(NEW.workspace_id, v_plan);
  IF v_max_contacts IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.is_primary := true;

  SELECT count(*) INTO v_contact_count
  FROM public.workspace_contacts
  WHERE workspace_id = NEW.workspace_id
    AND (TG_OP <> 'UPDATE' OR id IS DISTINCT FROM OLD.id);

  IF v_contact_count >= v_max_contacts THEN
    RAISE EXCEPTION 'Workspace contact limit reached for current plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_invoice_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
  v_is_upload boolean;
  v_upload_mime text;
  v_upload_limit bigint;
  v_workspace_id uuid;
BEGIN
  v_workspace_id := NEW.workspace_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = v_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.settlement_currency IS NOT NULL
    AND NOT public.workspace_currency_allowed(v_workspace_id, v_plan, NEW.settlement_currency::text) THEN
    RAISE EXCEPTION 'Currency % is not included in the current workspace plan', NEW.settlement_currency
      USING ERRCODE = '42501';
  END IF;

  v_is_upload :=
    lower(coalesce(NEW.origin, '')) = 'upload'
    OR coalesce(NEW.r2_path_a4, '') LIKE '%/uploads/%'
    OR coalesce(NEW.r2_path_receipt, '') LIKE '%/uploads/%';

  IF v_is_upload THEN
    v_upload_limit := public.workspace_max_upload_bytes(v_workspace_id, v_plan);
    v_upload_mime := coalesce(
      nullif(lower(NEW.file_mime_type), ''),
      public.detect_workspace_upload_mime(NEW.r2_path_a4),
      public.detect_workspace_upload_mime(NEW.r2_path_receipt)
    );

    IF v_upload_limit <= 0 THEN
      RAISE EXCEPTION 'Workspace uploads are not included in the current plan'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.file_size IS NULL OR NEW.file_size <= 0 OR NEW.file_size > v_upload_limit THEN
      RAISE EXCEPTION 'Upload size exceeds the current workspace plan limit'
        USING ERRCODE = '42501';
    END IF;

    IF NOT public.workspace_upload_mime_allowed(v_workspace_id, v_plan, v_upload_mime) THEN
      RAISE EXCEPTION 'Upload file type is not included in the current workspace plan'
        USING ERRCODE = '42501';
    END IF;

    NEW.file_mime_type := v_upload_mime;
  END IF;

  IF NOT v_is_upload
    AND lower(coalesce(NEW.print_format, '')) = 'a4'
    AND NOT public.workspace_capability_allowed(v_workspace_id, v_plan, 'a4PdfInvoices') THEN
    RAISE EXCEPTION 'A4 invoice generation is not included in the current workspace plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_currency_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid;
  v_plan text;
  v_currency text;
BEGIN
  v_workspace_id := nullif(to_jsonb(NEW)->>'workspace_id', '')::uuid;
  v_currency := lower(coalesce(
    nullif(to_jsonb(NEW)->>'settlement_currency', ''),
    nullif(to_jsonb(NEW)->>'currency', '')
  ));

  IF v_workspace_id IS NULL OR v_currency IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = v_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NOT NULL AND NOT public.workspace_currency_allowed(v_workspace_id, v_plan, v_currency) THEN
    RAISE EXCEPTION 'Currency % is not included in the current workspace plan', v_currency
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_module_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid;
  v_plan text;
  v_module text;
BEGIN
  v_workspace_id := nullif(to_jsonb(NEW)->>'workspace_id', '')::uuid;
  v_module := TG_ARGV[0];

  IF v_workspace_id IS NULL OR v_module IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = v_workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NOT NULL AND NOT public.workspace_module_allowed(v_workspace_id, v_plan, v_module) THEN
    RAISE EXCEPTION 'Module % is not included in the current workspace plan', v_module
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_permissions_plan_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan text;
BEGIN
  SELECT plan INTO v_plan
  FROM public.workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL;

  IF v_plan IS NULL OR NOT public.workspace_capability_allowed(NEW.workspace_id, v_plan, 'workspaceManagementPermissions') THEN
    RAISE EXCEPTION 'Workspace management permissions are not included in the current workspace plan'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_access_overrides TO authenticated;
GRANT ALL ON public.workspace_access_overrides TO service_role;

GRANT EXECUTE ON FUNCTION public.workspace_get_override_value(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_has_override(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_module_allowed(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_capability_allowed(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_currency_allowed(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_max_members(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_max_branches(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_max_contacts(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_max_upload_bytes(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_upload_mime_allowed(uuid, text, text) TO authenticated, service_role;
