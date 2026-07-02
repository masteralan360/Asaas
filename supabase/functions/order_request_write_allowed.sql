CREATE OR REPLACE FUNCTION crm.order_request_write_allowed(
  p_workspace_id uuid,
  p_permission_key text,
  p_approval_status text,
  p_approval_requested_by uuid,
  p_approval_requested_at timestamp with time zone
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $function$
  SELECT
    public.current_user_role() = 'admin'
    OR NOT public.workspace_capability_allowed(
      p_workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = p_workspace_id),
      'workspaceManagementPermissions'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.workspace_permissions permission
      WHERE permission.workspace_id = p_workspace_id
        AND permission.user_uuid = auth.uid()
        AND permission.key = p_permission_key
    )
    OR (
      p_approval_status = 'requested'
      AND p_approval_requested_by = auth.uid()
      AND p_approval_requested_at IS NOT NULL
    );
$function$;

REVOKE ALL ON FUNCTION crm.order_request_write_allowed(uuid, text, text, uuid, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.order_request_write_allowed(uuid, text, text, uuid, timestamp with time zone) TO authenticated, service_role;
