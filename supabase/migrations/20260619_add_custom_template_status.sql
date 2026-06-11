ALTER TABLE public.custom_templates
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "primary" boolean NOT NULL DEFAULT false;

ALTER TABLE public.custom_templates
  DROP CONSTRAINT IF EXISTS custom_templates_workspace_module_type_unique;

UPDATE public.custom_templates
SET active = true,
    "primary" = false;

WITH ranked_templates AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY workspace_id, module_type_key
      ORDER BY updated_at DESC, created_at DESC, id
    ) AS row_number
  FROM public.custom_templates
  WHERE active = true
)
UPDATE public.custom_templates AS template
SET "primary" = true
FROM ranked_templates
WHERE template.id = ranked_templates.id
  AND ranked_templates.row_number = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_templates_one_primary
  ON public.custom_templates (workspace_id, module_type_key)
  WHERE "primary" = true;

CREATE INDEX IF NOT EXISTS idx_custom_templates_workspace_module_active
  ON public.custom_templates (workspace_id, module_type_key, active, updated_at DESC);

ALTER TABLE public.custom_templates
  DROP CONSTRAINT IF EXISTS custom_templates_primary_requires_active;

ALTER TABLE public.custom_templates
  ADD CONSTRAINT custom_templates_primary_requires_active
  CHECK (NOT "primary" OR active);

CREATE OR REPLACE FUNCTION public.enforce_custom_template_status_before()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF NOT NEW.active THEN
      NEW."primary" := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT NEW.active THEN
    NEW."primary" := false;

    IF NOT EXISTS (
      SELECT 1
      FROM public.custom_templates AS candidate
      WHERE candidate.workspace_id = NEW.workspace_id
        AND candidate.module_type_key = NEW.module_type_key
        AND candidate.id <> NEW.id
        AND candidate.active = true
    ) THEN
      RAISE EXCEPTION 'At least one active template is required for each module type.';
    END IF;
  ELSIF NEW."primary" THEN
    UPDATE public.custom_templates
    SET "primary" = false
    WHERE workspace_id = NEW.workspace_id
      AND module_type_key = NEW.module_type_key
      AND id <> NEW.id
      AND "primary" = true;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.custom_templates AS candidate
    WHERE candidate.workspace_id = NEW.workspace_id
      AND candidate.module_type_key = NEW.module_type_key
      AND candidate.id <> NEW.id
      AND candidate.active = true
      AND candidate."primary" = true
  ) THEN
    NEW."primary" := true;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_custom_template_status_after()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.custom_templates AS candidate
    WHERE candidate.workspace_id = NEW.workspace_id
      AND candidate.module_type_key = NEW.module_type_key
      AND candidate.active = true
      AND candidate."primary" = true
  ) THEN
    UPDATE public.custom_templates
    SET "primary" = true
    WHERE id = (
      SELECT candidate.id
      FROM public.custom_templates AS candidate
      WHERE candidate.workspace_id = NEW.workspace_id
        AND candidate.module_type_key = NEW.module_type_key
        AND candidate.active = true
      ORDER BY candidate.updated_at DESC, candidate.created_at DESC, candidate.id
      LIMIT 1
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_custom_template_status_before
  ON public.custom_templates;

CREATE TRIGGER enforce_custom_template_status_before
BEFORE INSERT OR UPDATE OF active, "primary", workspace_id, module_type_key
ON public.custom_templates
FOR EACH ROW
EXECUTE FUNCTION public.enforce_custom_template_status_before();

DROP TRIGGER IF EXISTS enforce_custom_template_status_after
  ON public.custom_templates;

CREATE TRIGGER enforce_custom_template_status_after
AFTER INSERT OR UPDATE OF active, "primary", workspace_id, module_type_key
ON public.custom_templates
FOR EACH ROW
EXECUTE FUNCTION public.enforce_custom_template_status_after();
