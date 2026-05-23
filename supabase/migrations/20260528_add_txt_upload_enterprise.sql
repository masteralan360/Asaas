-- Allow .txt (text/plain) files to be uploaded for enterprise plan

CREATE OR REPLACE FUNCTION public.workspace_plan_allows_upload_mime(p_plan text, p_mime text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE public.normalize_workspace_plan(p_plan)
    WHEN 'enterprise' THEN lower(coalesce(p_mime, '')) IN ('application/pdf', 'image/png', 'image/jpeg', 'audio/mpeg', 'text/plain')
    WHEN 'business' THEN lower(coalesce(p_mime, '')) = 'application/pdf'
    ELSE false
  END;
$function$;
