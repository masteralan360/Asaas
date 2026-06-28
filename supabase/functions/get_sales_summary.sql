CREATE OR REPLACE FUNCTION public.get_sales_summary(p_workspace_id uuid DEFAULT NULL::uuid, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    result JSONB;
BEGIN
    IF p_workspace_id IS NULL THEN
        SELECT current_workspace INTO p_workspace_id FROM public.profiles WHERE id = auth.uid();
    END IF;

    SELECT jsonb_build_object(
        'totalRevenue', COALESCE(SUM(CASE WHEN COALESCE(s.is_returned, FALSE) = FALSE THEN (si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_unit_price, si.unit_price) ELSE 0 END), 0),
        'totalCost', COALESCE(SUM(CASE WHEN COALESCE(s.is_returned, FALSE) = FALSE THEN (si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_cost_price, si.cost_price) ELSE 0 END), 0),
        'netProfit', COALESCE(SUM(CASE WHEN COALESCE(s.is_returned, FALSE) = FALSE THEN ((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_unit_price, si.unit_price)) - ((si.quantity - COALESCE(si.returned_quantity, 0)) * COALESCE(si.converted_cost_price, si.cost_price)) ELSE 0 END), 0),
        'totalSales', COUNT(DISTINCT CASE WHEN COALESCE(s.is_returned, FALSE) = FALSE THEN s.id END),
        'totalItems', COALESCE(SUM(CASE WHEN COALESCE(s.is_returned, FALSE) = FALSE THEN si.quantity - COALESCE(si.returned_quantity, 0) ELSE 0 END), 0),
        'averageSaleValue', COALESCE(AVG(CASE WHEN COALESCE(s.is_returned, FALSE) = FALSE THEN s.total_amount END), 0),
        'returnedSales', COUNT(DISTINCT CASE WHEN s.is_returned = TRUE THEN s.id END),
        'returnedItems', COALESCE(SUM(COALESCE(si.returned_quantity, 0)), 0)
    ) INTO result
    FROM public.sales s
    INNER JOIN public.sale_items si ON s.id = si.sale_id
    WHERE s.workspace_id = p_workspace_id
      AND (p_start_date IS NULL OR s.created_at >= p_start_date)
      AND (p_end_date IS NULL OR s.created_at <= p_end_date);

    RETURN result;
END;
$function$
