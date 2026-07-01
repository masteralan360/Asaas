CREATE TABLE IF NOT EXISTS public.tauri_versions (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tauri_versions_version_check CHECK (char_length(BTRIM(version)) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS idx_tauri_versions_workspace_id
  ON public.tauri_versions (workspace_id);

ALTER TABLE public.tauri_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tauri_versions FROM PUBLIC;
REVOKE ALL ON TABLE public.tauri_versions FROM anon, authenticated;
GRANT ALL ON TABLE public.tauri_versions TO service_role;

CREATE OR REPLACE FUNCTION public.record_tauri_startup_version(p_version text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := public.current_workspace_id();
  v_version text := NULLIF(BTRIM(COALESCE(p_version, '')), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated_user_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'version_required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_version) > 64 THEN
    RAISE EXCEPTION 'version_too_long'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tauri_versions (
    user_id,
    workspace_id,
    version,
    last_seen_at
  )
  VALUES (
    v_user_id,
    v_workspace_id,
    v_version,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    workspace_id = EXCLUDED.workspace_id,
    version = EXCLUDED.version,
    last_seen_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.record_tauri_startup_version(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tauri_startup_version(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
