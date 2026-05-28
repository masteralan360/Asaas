ALTER TABLE public.custom_templates
  ADD COLUMN IF NOT EXISTS label text;

UPDATE public.custom_templates
SET label = COALESCE(NULLIF(BTRIM(label), ''), module_type_key)
WHERE label IS NULL OR BTRIM(label) = '';

ALTER TABLE public.custom_templates
  ALTER COLUMN label SET DEFAULT 'Custom Template',
  ALTER COLUMN label SET NOT NULL;

ALTER TABLE public.custom_templates
  DROP CONSTRAINT IF EXISTS custom_templates_label_not_blank;

ALTER TABLE public.custom_templates
  ADD CONSTRAINT custom_templates_label_not_blank CHECK (char_length(BTRIM(label)) > 0);

CREATE INDEX IF NOT EXISTS idx_custom_templates_workspace_label
  ON public.custom_templates (workspace_id, label);
