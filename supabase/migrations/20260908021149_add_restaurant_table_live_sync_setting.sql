-- Restaurant tickets are local by default. Workspace admins can opt in to
-- Supabase-backed live actions and realtime synchronization when needed.
ALTER TABLE public.restaurant_table_settings
  ADD COLUMN IF NOT EXISTS live_sync_enabled boolean NOT NULL DEFAULT false;
