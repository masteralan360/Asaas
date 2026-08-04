-- View-own permissions are intentionally opt-in. Without the matching
-- workspace permission, existing workspace-wide visibility is unchanged.
-- `invoice_history.view_own` is intentionally snake_case to match the
-- supported module key, so permit underscores in every permission-key part.
ALTER TABLE public.workspace_permissions
  DROP CONSTRAINT IF EXISTS workspace_permissions_key_format_check;

ALTER TABLE public.workspace_permissions
  ADD CONSTRAINT workspace_permissions_key_format_check CHECK (
    key ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'
  );

CREATE OR REPLACE FUNCTION public.current_user_has_view_own_permission(
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND public.current_user_role() IS DISTINCT FROM 'admin'
    AND EXISTS (
      SELECT 1
      FROM public.workspace_permissions AS permission
      WHERE permission.workspace_id = public.current_workspace_id()
        AND permission.user_uuid = (SELECT auth.uid())
        AND permission.key = p_permission_key
    );
$function$;

REVOKE ALL ON FUNCTION public.current_user_has_view_own_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_view_own_permission(text) TO authenticated, service_role;

-- These tables are already protected in existing deployments. Declare the
-- requirement here as well so a fresh or older deployment cannot apply the
-- policies without RLS being active.
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_exchange ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_product_exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.order_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;

-- Ownership predicates used by the parent tables below. Keep auth.uid() in
-- the policy as an initPlan so it is evaluated once per statement.
DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select
  ON public.sales
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
      OR cashier_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS loans_select ON public.loans;
CREATE POLICY loans_select
  ON public.loans
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      (
        COALESCE(loan_category, 'standard') = 'simple'
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('loans.view_own'))
          OR created_by = (SELECT auth.uid())
        )
      )
      OR (
        COALESCE(loan_category, 'standard') <> 'simple'
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('installments.view_own'))
          OR created_by = (SELECT auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('invoice_history.view_own'))
      OR created_by = (SELECT auth.uid())
      OR user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS crm_sales_orders_select ON crm.sales_orders;
CREATE POLICY crm_sales_orders_select
  ON crm.sales_orders
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = sales_orders.workspace_id),
      'orders'
    )
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
      OR created_by = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS crm_purchase_orders_select ON crm.purchase_orders;
CREATE POLICY crm_purchase_orders_select
  ON crm.purchase_orders
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = purchase_orders.workspace_id),
      'orders'
    )
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
      OR created_by = (SELECT auth.uid())
    )
  );

-- Child records inherit the visibility of their parent. This closes direct
-- table/API reads that would otherwise reveal details of hidden records.
DROP POLICY IF EXISTS sale_items_select ON public.sale_items;
CREATE POLICY sale_items_select
  ON public.sale_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales AS sale
      WHERE sale.id = sale_items.sale_id
        AND sale.workspace_id = public.current_workspace_id()
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
          OR sale.cashier_id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS sales_exchange_select ON public.sales_exchange;
CREATE POLICY sales_exchange_select
  ON public.sales_exchange
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM public.sales AS sale
      WHERE sale.id = sales_exchange.sale_id
        AND sale.workspace_id = sales_exchange.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
          OR sale.cashier_id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS sale_returns_select ON public.sale_returns;
CREATE POLICY sale_returns_select
  ON public.sale_returns
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM public.sales AS sale
      WHERE sale.id = sale_returns.sale_id
        AND sale.workspace_id = sale_returns.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
          OR sale.cashier_id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS sale_return_items_select ON public.sale_return_items;
CREATE POLICY sale_return_items_select
  ON public.sale_return_items
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM public.sales AS sale
      WHERE sale.id = sale_return_items.sale_id
        AND sale.workspace_id = sale_return_items.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
          OR sale.cashier_id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS sale_product_exchanges_select ON public.sale_product_exchanges;
CREATE POLICY sale_product_exchanges_select
  ON public.sale_product_exchanges
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM public.sales AS sale
      WHERE sale.id = sale_product_exchanges.sale_id
        AND sale.workspace_id = sale_product_exchanges.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
          OR sale.cashier_id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS loan_installments_select ON public.loan_installments;
CREATE POLICY loan_installments_select
  ON public.loan_installments
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM public.loans AS loan
      WHERE loan.id = loan_installments.loan_id
        AND loan.workspace_id = loan_installments.workspace_id
        AND (
          (
            COALESCE(loan.loan_category, 'standard') = 'simple'
            AND (
              NOT (SELECT public.current_user_has_view_own_permission('loans.view_own'))
              OR loan.created_by = (SELECT auth.uid())
            )
          )
          OR (
            COALESCE(loan.loan_category, 'standard') <> 'simple'
            AND (
              NOT (SELECT public.current_user_has_view_own_permission('installments.view_own'))
              OR loan.created_by = (SELECT auth.uid())
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS loan_payments_select ON public.loan_payments;
CREATE POLICY loan_payments_select
  ON public.loan_payments
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM public.loans AS loan
      WHERE loan.id = loan_payments.loan_id
        AND loan.workspace_id = loan_payments.workspace_id
        AND (
          (
            COALESCE(loan.loan_category, 'standard') = 'simple'
            AND (
              NOT (SELECT public.current_user_has_view_own_permission('loans.view_own'))
              OR loan.created_by = (SELECT auth.uid())
            )
          )
          OR (
            COALESCE(loan.loan_category, 'standard') <> 'simple'
            AND (
              NOT (SELECT public.current_user_has_view_own_permission('installments.view_own'))
              OR loan.created_by = (SELECT auth.uid())
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS crm_order_installments_select ON crm.order_installments;
CREATE POLICY crm_order_installments_select
  ON crm.order_installments
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND public.workspace_module_allowed(
      workspace_id,
      (SELECT w.plan::text FROM public.workspaces w WHERE w.id = order_installments.workspace_id),
      'orders'
    )
    AND (
      (
        order_type = 'sales'
        AND EXISTS (
          SELECT 1
          FROM crm.sales_orders AS sale_order
          WHERE sale_order.id = order_installments.order_id
            AND sale_order.workspace_id = order_installments.workspace_id
            AND (
              NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
              OR sale_order.created_by = (SELECT auth.uid())
            )
        )
      )
      OR (
        order_type = 'purchase'
        AND EXISTS (
          SELECT 1
          FROM crm.purchase_orders AS purchase_order
          WHERE purchase_order.id = order_installments.order_id
            AND purchase_order.workspace_id = order_installments.workspace_id
            AND (
              NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
              OR purchase_order.created_by = (SELECT auth.uid())
            )
        )
      )
    )
  );

DROP POLICY IF EXISTS order_returns_select ON public.order_returns;
CREATE POLICY order_returns_select
  ON public.order_returns
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM crm.sales_orders AS sale_order
      WHERE sale_order.id = order_returns.order_id
        AND sale_order.workspace_id = order_returns.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
          OR sale_order.created_by = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS order_return_items_select ON public.order_return_items;
CREATE POLICY order_return_items_select
  ON public.order_return_items
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM crm.sales_orders AS sale_order
      WHERE sale_order.id = order_return_items.order_id
        AND sale_order.workspace_id = order_return_items.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('orders.view_own'))
          OR sale_order.created_by = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS invoice_versions_select ON public.invoice_versions;
CREATE POLICY invoice_versions_select
  ON public.invoice_versions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM public.invoices AS invoice
      WHERE invoice.id = invoice_versions.invoice_id
        AND invoice.workspace_id = invoice_versions.workspace_id
        AND (
          NOT (SELECT public.current_user_has_view_own_permission('invoice_history.view_own'))
          OR invoice.created_by = (SELECT auth.uid())
          OR invoice.user_id = (SELECT auth.uid())
        )
    )
  );

-- Indexes keep creator-scoped queries and the parent lookups in the policies
-- fast as workspaces grow.
CREATE INDEX IF NOT EXISTS idx_sales_workspace_cashier_created
  ON public.sales (workspace_id, cashier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loans_workspace_category_creator
  ON public.loans (workspace_id, loan_category, created_by)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_loan_installments_workspace_loan
  ON public.loan_installments (workspace_id, loan_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_loan_payments_workspace_loan
  ON public.loan_payments (workspace_id, loan_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_invoices_workspace_creator
  ON public.invoices (workspace_id, created_by)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_invoices_workspace_user
  ON public.invoices (workspace_id, user_id)
  WHERE is_deleted = false;

-- SECURITY DEFINER report functions bypass table RLS, so their source rows
-- must explicitly use the same visibility scope as normal queries.
CREATE OR REPLACE FUNCTION public.get_net_revenue(
  p_workspace_id uuid DEFAULT NULL::uuid,
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS TABLE(total_revenue numeric, total_cost numeric, net_profit numeric, total_sales_count bigint, total_items_count numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid := COALESCE(p_workspace_id, public.current_workspace_id());
BEGIN
  IF v_workspace_id IS NULL OR v_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM((sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_unit_price, sale_item.unit_price)), 0),
    COALESCE(SUM((sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_cost_price, sale_item.cost_price)), 0),
    COALESCE(SUM(
      ((sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_unit_price, sale_item.unit_price))
      - ((sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_cost_price, sale_item.cost_price))
    ), 0),
    COUNT(DISTINCT sale.id),
    COALESCE(SUM(sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)), 0)
  FROM public.sales AS sale
  INNER JOIN public.sale_items AS sale_item ON sale_item.sale_id = sale.id
  WHERE sale.workspace_id = v_workspace_id
    AND COALESCE(sale.is_returned, false) = false
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
      OR sale.cashier_id = (SELECT auth.uid())
    )
    AND (p_start_date IS NULL OR sale.created_at >= p_start_date)
    AND (p_end_date IS NULL OR sale.created_at <= p_end_date);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_summary(
  p_workspace_id uuid DEFAULT NULL::uuid,
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid := COALESCE(p_workspace_id, public.current_workspace_id());
  result jsonb;
BEGIN
  IF v_workspace_id IS NULL OR v_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  SELECT jsonb_build_object(
    'totalRevenue', COALESCE(SUM(CASE WHEN COALESCE(sale.is_returned, false) = false THEN (sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_unit_price, sale_item.unit_price) ELSE 0 END), 0),
    'totalCost', COALESCE(SUM(CASE WHEN COALESCE(sale.is_returned, false) = false THEN (sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_cost_price, sale_item.cost_price) ELSE 0 END), 0),
    'netProfit', COALESCE(SUM(CASE WHEN COALESCE(sale.is_returned, false) = false THEN ((sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_unit_price, sale_item.unit_price)) - ((sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_cost_price, sale_item.cost_price)) ELSE 0 END), 0),
    'totalSales', COUNT(DISTINCT CASE WHEN COALESCE(sale.is_returned, false) = false THEN sale.id END),
    'totalItems', COALESCE(SUM(CASE WHEN COALESCE(sale.is_returned, false) = false THEN sale_item.quantity - COALESCE(sale_item.returned_quantity, 0) ELSE 0 END), 0),
    'averageSaleValue', COALESCE(AVG(CASE WHEN COALESCE(sale.is_returned, false) = false THEN sale.total_amount END), 0),
    'returnedSales', COUNT(DISTINCT CASE WHEN sale.is_returned = true THEN sale.id END),
    'returnedItems', COALESCE(SUM(sale_item.returned_quantity), 0)
  )
  INTO result
  FROM public.sales AS sale
  INNER JOIN public.sale_items AS sale_item ON sale_item.sale_id = sale.id
  WHERE sale.workspace_id = v_workspace_id
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
      OR sale.cashier_id = (SELECT auth.uid())
    )
    AND (p_start_date IS NULL OR sale.created_at >= p_start_date)
    AND (p_end_date IS NULL OR sale.created_at <= p_end_date);

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_top_products(
  p_workspace_id uuid DEFAULT NULL::uuid,
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(product_id uuid, product_name text, product_sku text, total_quantity_sold numeric, total_revenue numeric, total_sales_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid := COALESCE(p_workspace_id, public.current_workspace_id());
BEGIN
  IF v_workspace_id IS NULL OR v_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  RETURN QUERY
  SELECT
    product.id,
    product.name,
    product.sku,
    COALESCE(SUM(sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)), 0),
    COALESCE(SUM((sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_unit_price, sale_item.unit_price)), 0),
    COUNT(DISTINCT sale_item.sale_id)
  FROM public.sale_items AS sale_item
  INNER JOIN public.sales AS sale ON sale_item.sale_id = sale.id
  INNER JOIN public.products AS product ON sale_item.product_id = product.id
  WHERE sale.workspace_id = v_workspace_id
    AND COALESCE(sale.is_returned, false) = false
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
      OR sale.cashier_id = (SELECT auth.uid())
    )
    AND (p_start_date IS NULL OR sale.created_at >= p_start_date)
    AND (p_end_date IS NULL OR sale.created_at <= p_end_date)
  GROUP BY product.id, product.name, product.sku
  ORDER BY total_quantity_sold DESC
  LIMIT GREATEST(COALESCE(p_limit, 10), 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_team_performance(
  p_workspace_id uuid DEFAULT NULL::uuid,
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS TABLE(cashier_id uuid, cashier_name text, total_sales_count bigint, total_revenue numeric, total_items_count numeric, average_sale_value numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid := COALESCE(p_workspace_id, public.current_workspace_id());
BEGIN
  IF v_workspace_id IS NULL OR v_workspace_id IS DISTINCT FROM public.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace access denied';
  END IF;

  RETURN QUERY
  SELECT
    sale.cashier_id,
    COALESCE(profile.name, 'Unknown'),
    COUNT(DISTINCT sale.id),
    COALESCE(SUM((sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)) * COALESCE(sale_item.converted_unit_price, sale_item.unit_price)), 0),
    COALESCE(SUM(sale_item.quantity - COALESCE(sale_item.returned_quantity, 0)), 0),
    COALESCE(AVG(sale.total_amount), 0)
  FROM public.sales AS sale
  INNER JOIN public.sale_items AS sale_item ON sale_item.sale_id = sale.id
  LEFT JOIN public.profiles AS profile ON sale.cashier_id = profile.id
  WHERE sale.workspace_id = v_workspace_id
    AND COALESCE(sale.is_returned, false) = false
    AND (
      NOT (SELECT public.current_user_has_view_own_permission('sales.view_own'))
      OR sale.cashier_id = (SELECT auth.uid())
    )
    AND (p_start_date IS NULL OR sale.created_at >= p_start_date)
    AND (p_end_date IS NULL OR sale.created_at <= p_end_date)
  GROUP BY sale.cashier_id, profile.name
  ORDER BY total_revenue DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_net_revenue(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_summary(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_top_products(uuid, timestamp with time zone, timestamp with time zone, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_performance(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_net_revenue(uuid, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_summary(uuid, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_top_products(uuid, timestamp with time zone, timestamp with time zone, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_performance(uuid, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;
