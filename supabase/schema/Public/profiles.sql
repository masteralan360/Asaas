CREATE TABLE public.profiles (
  id uuid NOT NULL,
  name text NULL,
  role text NULL,
  workspace_id uuid NULL,
  current_workspace uuid NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  monthly_target numeric NULL DEFAULT 0,
  profile_url text NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_current_workspace
  ON public.profiles (current_workspace);
