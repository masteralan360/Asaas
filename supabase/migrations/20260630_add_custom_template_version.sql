ALTER TABLE public.custom_templates
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.increment_custom_template_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    OLD.layout_json IS DISTINCT FROM NEW.layout_json
    OR OLD.label IS DISTINCT FROM NEW.label
  ) THEN
    NEW.version = OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_templates_increment_version ON public.custom_templates;

CREATE TRIGGER trg_custom_templates_increment_version
  BEFORE UPDATE ON public.custom_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_custom_template_version();
