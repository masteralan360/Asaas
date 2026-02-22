-- Migration to remove soft delete from workspace_contacts
ALTER TABLE public.workspace_contacts DROP COLUMN IF EXISTS is_deleted;
