CREATE OR REPLACE FUNCTION public.return_whole_sale(
  p_sale_id uuid,
  p_return_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_workspace_id uuid;
  v_user_role text;
  v_items jsonb;
BEGIN
  SELECT s.workspace_id, p.role
  INTO v_workspace_id, v_user_role
  FROM public.sales s
  JOIN public.profiles p
    ON p.id = auth.uid()
   AND p.current_workspace = s.workspace_id
  WHERE s.id = p_sale_id;

  IF v_user_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can return whole sales';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', gen_random_uuid(),
      'sale_item_id', id,
      'quantity', quantity - COALESCE(returned_quantity, 0)
    )
  )
  INTO v_items
  FROM public.sale_items
  WHERE sale_id = p_sale_id
    AND quantity - COALESCE(returned_quantity, 0) > 0;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'No returnable items found in this sale';
  END IF;

  RETURN public.process_sale_return(
    gen_random_uuid(),
    p_sale_id,
    v_items,
    p_return_reason,
    NULL
  );
END;
$function$;
