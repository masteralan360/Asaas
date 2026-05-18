ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS file_size bigint NULL;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS upload_limit_mb integer NULL;

ALTER TABLE public.workspaces
  DROP COLUMN IF EXISTS upload_limit_bytes;
