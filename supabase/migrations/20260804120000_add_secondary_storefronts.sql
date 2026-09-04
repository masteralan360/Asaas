-- Secondary storefronts: an optional additional marketplace storefront per
-- workspace with its own visibility, slug, description, and catalog rules.
-- Rows are hard-deleted. Catalog rules attach via storefront_id on
-- workspace_storefront_catalog_rules (NULL = the primary storefront).

CREATE TABLE IF NOT EXISTS public.workspace_storefronts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'private'::text,
  slug text NOT NULL DEFAULT '',
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT workspace_storefronts_visibility_check
    CHECK (visibility IN ('private', 'public', 'link_only')),
  CONSTRAINT workspace_storefronts_slug_format_check
    CHECK (
      slug = ''
      OR slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_storefronts_slug
  ON public.workspace_storefronts (lower(slug))
  WHERE slug <> '';

CREATE INDEX IF NOT EXISTS idx_workspace_storefronts_workspace
  ON public.workspace_storefronts (workspace_id);

CREATE OR REPLACE FUNCTION public.normalize_storefront_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.visibility := COALESCE(NULLIF(lower(trim(COALESCE(NEW.visibility, 'private'))), ''), 'private');
  NEW.slug := lower(trim(COALESCE(NEW.slug, '')));
  NEW.description := NULLIF(trim(COALESCE(NEW.description, '')), '');

  IF NEW.visibility NOT IN ('private', 'public', 'link_only') THEN
    RAISE EXCEPTION 'Storefront visibility must be private, public, or link_only';
  END IF;

  IF NEW.slug <> '' AND NEW.slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN
    RAISE EXCEPTION 'Storefront slug format is invalid';
  END IF;

  IF NEW.slug <> '' THEN
    IF EXISTS (
      SELECT 1
      FROM public.workspaces AS workspace
      WHERE workspace.deleted_at IS NULL
        AND lower(workspace.store_slug) = NEW.slug
    ) THEN
      RAISE EXCEPTION 'This store slug is already in use';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.workspace_storefronts AS storefront
      WHERE storefront.slug <> ''
        AND lower(storefront.slug) = NEW.slug
        AND storefront.id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'This store slug is already in use';
    END IF;
  END IF;

  IF NEW.visibility IN ('public', 'link_only') THEN
    IF NEW.slug = '' THEN
      RAISE EXCEPTION 'A store slug is required before a storefront can be published';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.workspaces AS workspace
      WHERE workspace.id = NEW.workspace_id
        AND workspace.deleted_at IS NULL
        AND COALESCE(workspace.data_mode, 'cloud') <> 'local'
    ) THEN
      RAISE EXCEPTION 'Storefronts cannot be published for local or deleted workspaces';
    END IF;

    IF NOT public.workspace_capability_allowed(
      NEW.workspace_id,
      (SELECT workspace.plan::text FROM public.workspaces AS workspace WHERE workspace.id = NEW.workspace_id),
      'marketplaceStorefronts'
    ) THEN
      RAISE EXCEPTION 'The workspace plan does not allow marketplace storefronts';
    END IF;

    UPDATE public.workspaces
    SET ecommerce = true
    WHERE id = NEW.workspace_id
      AND COALESCE(ecommerce, false) = false;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_storefront_settings_on_storefronts ON public.workspace_storefronts;
CREATE TRIGGER normalize_storefront_settings_on_storefronts
BEFORE INSERT OR UPDATE ON public.workspace_storefronts
FOR EACH ROW
EXECUTE FUNCTION public.normalize_storefront_settings();

DROP TRIGGER IF EXISTS update_storefronts_updated_at ON public.workspace_storefronts;
CREATE TRIGGER update_storefronts_updated_at
BEFORE UPDATE ON public.workspace_storefronts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_storefronts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_storefronts_select ON public.workspace_storefronts;
CREATE POLICY workspace_storefronts_select
  ON public.workspace_storefronts
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS workspace_storefronts_insert ON public.workspace_storefronts;
CREATE POLICY workspace_storefronts_insert
  ON public.workspace_storefronts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

DROP POLICY IF EXISTS workspace_storefronts_update ON public.workspace_storefronts;
CREATE POLICY workspace_storefronts_update
  ON public.workspace_storefronts
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  )
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

DROP POLICY IF EXISTS workspace_storefronts_delete ON public.workspace_storefronts;
CREATE POLICY workspace_storefronts_delete
  ON public.workspace_storefronts
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
  );

-- Attach catalog rules to a storefront. NULL storefront_id = primary storefront.
ALTER TABLE public.workspace_storefront_catalog_rules
  ADD COLUMN IF NOT EXISTS storefront_id uuid REFERENCES public.workspace_storefronts(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS uq_storefront_catalog_rules_native;
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_catalog_rules_native
  ON public.workspace_storefront_catalog_rules (
    workspace_id,
    COALESCE(storefront_id, '00000000-0000-0000-0000-000000000000'),
    rule_type
  )
  WHERE price_book_id IS NULL;

DROP INDEX IF EXISTS uq_storefront_catalog_rules_price_book;
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_catalog_rules_price_book
  ON public.workspace_storefront_catalog_rules (
    workspace_id,
    COALESCE(storefront_id, '00000000-0000-0000-0000-000000000000'),
    rule_type,
    price_book_id
  )
  WHERE price_book_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_storefront_catalog_rule_workspace_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.price_book_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.price_books AS price_book
       WHERE price_book.id = NEW.price_book_id
         AND price_book.workspace_id = NEW.workspace_id
     )
  THEN
    RAISE EXCEPTION 'Storefront catalog rule must reference a price book in the same workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.storefront_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.workspace_storefronts AS storefront
       WHERE storefront.id = NEW.storefront_id
         AND storefront.workspace_id = NEW.workspace_id
     )
  THEN
    RAISE EXCEPTION 'Storefront catalog rule must reference a storefront in the same workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_storefront_catalog_rule_workspace_links ON public.workspace_storefront_catalog_rules;
CREATE TRIGGER enforce_storefront_catalog_rule_workspace_links
BEFORE INSERT OR UPDATE ON public.workspace_storefront_catalog_rules
FOR EACH ROW
EXECUTE FUNCTION public.enforce_storefront_catalog_rule_workspace_links();

-- Primary storefront slug availability now also covers secondary storefronts.
CREATE OR REPLACE FUNCTION public.check_store_slug_available(p_slug text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_slug text := NULLIF(lower(trim(COALESCE(p_slug, ''))), '');
BEGIN
  IF v_slug IS NULL THEN
    RETURN false;
  END IF;

  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE deleted_at IS NULL
      AND lower(store_slug) = v_slug
      AND id IS DISTINCT FROM public.current_workspace_id()
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workspace_storefronts
    WHERE slug <> ''
      AND lower(slug) = v_slug
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

-- Secondary storefront slug availability: conflicts with every workspace
-- primary slug and every other storefront slug.
CREATE OR REPLACE FUNCTION public.check_storefront_slug_available(p_slug text, p_exclude_storefront_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_slug text := NULLIF(lower(trim(COALESCE(p_slug, ''))), '');
BEGIN
  IF v_slug IS NULL THEN
    RETURN false;
  END IF;

  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE deleted_at IS NULL
      AND lower(store_slug) = v_slug
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workspace_storefronts
    WHERE slug <> ''
      AND lower(slug) = v_slug
      AND (p_exclude_storefront_id IS NULL OR id IS DISTINCT FROM p_exclude_storefront_id)
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_store_slug_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_store_slug_available(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_storefront_slug_available(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_storefront_slug_available(text, uuid) TO authenticated, service_role;

-- When the plan loses marketplace storefronts, remove secondary storefronts
-- along with the primary storefront fields.
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

  IF NOT public.workspace_capability_allowed(NEW.id, NEW.plan::text, 'marketplaceStorefronts') THEN
    NEW.visibility := 'private';
    NEW.store_slug := NULL;
    NEW.store_description := NULL;
    DELETE FROM public.workspace_storefronts
    WHERE workspace_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS apply_workspace_plan_access_on_workspaces ON public.workspaces;
CREATE TRIGGER apply_workspace_plan_access_on_workspaces
BEFORE INSERT OR UPDATE ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.apply_workspace_plan_access();
