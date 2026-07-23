-- New workspaces should use the Professional A4 invoice layout unless an
-- administrator explicitly selects another template.
ALTER TABLE public.workspaces
  ALTER COLUMN a4_template SET DEFAULT 'professional';
