CREATE OR REPLACE FUNCTION public.list_workspace_disabled_notification_types()
RETURNS TABLE(notification_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, notifications
AS $function$
  SELECT disabled_type.notification_type
  FROM notifications.workspace_disabled_types disabled_type
  WHERE disabled_type.workspace_id = public.current_workspace_id()
    AND public.current_user_role() = 'admin'
  ORDER BY disabled_type.notification_type;
$function$;
