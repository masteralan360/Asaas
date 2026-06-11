CREATE OR REPLACE FUNCTION public.return_sale_items(
  p_sale_item_ids uuid[],
  p_return_quantities integer[],
  p_return_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sale_id uuid;
  v_items jsonb;
BEGIN
  IF p_sale_item_ids IS NULL
     OR array_length(p_sale_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No items selected for return';
  END IF;

  IF p_return_quantities IS NULL
     OR array_length(p_return_quantities, 1)
        IS DISTINCT FROM array_length(p_sale_item_ids, 1) THEN
    RAISE EXCEPTION 'Return quantities must match selected sale items';
  END IF;

  SELECT sale_id
  INTO v_sale_id
  FROM public.sale_items
  WHERE id = p_sale_item_ids[1];

  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale items not found';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', gen_random_uuid(),
      'sale_item_id', item_id,
      'quantity', return_quantity
    )
  )
  INTO v_items
  FROM unnest(p_sale_item_ids, p_return_quantities)
    AS requested_items(item_id, return_quantity);

  RETURN public.process_sale_return(
    gen_random_uuid(),
    v_sale_id,
    v_items,
    p_return_reason,
    NULL
  );
END;
$function$;
