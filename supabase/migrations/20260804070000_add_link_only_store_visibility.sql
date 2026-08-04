-- Add a link-only store visibility mode: the storefront stays reachable via
-- its /s/:slug link, but the store no longer appears in marketplace discover.

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_visibility_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_visibility_check
  CHECK (visibility IN ('private', 'public', 'link_only'));

CREATE OR REPLACE FUNCTION public.normalize_marketplace_workspace_settings()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.visibility := COALESCE(NULLIF(lower(trim(COALESCE(NEW.visibility, 'private'))), ''), 'private');
  NEW.store_slug := NULLIF(lower(trim(COALESCE(NEW.store_slug, ''))), '');
  NEW.store_description := NULLIF(trim(COALESCE(NEW.store_description, '')), '');
  NEW.ecommerce := COALESCE(NEW.ecommerce, false);

  IF NEW.visibility NOT IN ('private', 'public', 'link_only') THEN
    RAISE EXCEPTION 'Workspace visibility must be private, public, or link_only';
  END IF;

  IF NEW.visibility IN ('public', 'link_only') AND NEW.deleted_at IS NULL THEN
    IF COALESCE(NEW.data_mode, 'cloud') = 'local' THEN
      RAISE EXCEPTION 'Local workspaces cannot be published to the marketplace';
    END IF;

    IF NEW.store_slug IS NULL THEN
      RAISE EXCEPTION 'A store slug is required before a workspace can be published';
    END IF;

    NEW.ecommerce := true;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_marketplace_workspace_settings_on_workspaces ON public.workspaces;
CREATE TRIGGER normalize_marketplace_workspace_settings_on_workspaces
BEFORE INSERT OR UPDATE ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.normalize_marketplace_workspace_settings();

CREATE INDEX IF NOT EXISTS idx_workspaces_visibility_link_only
  ON public.workspaces (visibility)
  WHERE visibility = 'link_only'
    AND deleted_at IS NULL;