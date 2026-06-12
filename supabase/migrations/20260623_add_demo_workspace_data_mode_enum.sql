-- The deployed workspaces.data_mode column uses this enum even though the
-- checked-in schema snapshot currently represents it as text.
ALTER TYPE public.workspace_data_mode
  ADD VALUE IF NOT EXISTS 'demo';
