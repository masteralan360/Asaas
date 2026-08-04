-- Restore the workspaces.ecommerce column. The plan-capability refactor
-- (20260525) dropped it in favor of plan-derived module checks, but remaining
-- marketplace/e-commerce code still reads it. The visibility trigger maintains
-- it again: publishing a store (public or link_only) enables e-commerce.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ecommerce boolean;

UPDATE public.workspaces
SET ecommerce = COALESCE(ecommerce, false);

ALTER TABLE public.workspaces
  ALTER COLUMN ecommerce SET DEFAULT false;

ALTER TABLE public.workspaces
  ALTER COLUMN ecommerce SET NOT NULL;

-- Backfill the flag for workspaces that are already published.
UPDATE public.workspaces
SET ecommerce = true
WHERE visibility IN ('public', 'link_only')
  AND deleted_at IS NULL
  AND COALESCE(data_mode, 'cloud') <> 'local'
  AND store_slug IS NOT NULL;

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