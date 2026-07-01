CREATE TABLE public.tauri_versions (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tauri_versions_version_check CHECK (char_length(BTRIM(version)) BETWEEN 1 AND 64),
  PRIMARY KEY (user_id)
);

CREATE INDEX IF NOT EXISTS idx_tauri_versions_workspace_id
  ON public.tauri_versions (workspace_id);
