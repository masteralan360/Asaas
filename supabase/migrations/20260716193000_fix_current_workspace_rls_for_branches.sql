-- Branch users must be authorized against the workspace currently selected in
-- their profile. The source workspace remains in profiles.workspace_id for
-- membership and branch ownership, while profiles.current_workspace drives RLS
-- for business data.
CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT current_workspace
  FROM public.profiles
  WHERE id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.current_workspace_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO authenticated, service_role;
