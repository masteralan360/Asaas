CREATE OR REPLACE FUNCTION public.check_return_permissions(p_sale_id uuid, p_user_id uuid)
 RETURNS TABLE(workspace_id uuid, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        s.workspace_id,
        pr.role
    FROM public.sales s
    JOIN public.profiles pr ON pr.id = p_user_id AND pr.current_workspace = s.workspace_id
    WHERE s.id = p_sale_id;
END;
$function$;
