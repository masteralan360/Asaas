-- Workspace Soft Delete Migration
-- Adds deleted_at column to workspaces table

ALTER TABLE public.workspaces 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for performance when filtering
CREATE INDEX IF NOT EXISTS idx_workspaces_deleted_at ON public.workspaces(deleted_at);
