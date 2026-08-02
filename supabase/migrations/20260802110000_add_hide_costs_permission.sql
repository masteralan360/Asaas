-- A zero cost is valid.  NULL is the only representation for a missing cost.
ALTER TABLE public.products
  ALTER COLUMN cost_price DROP NOT NULL,
  ALTER COLUMN cost_price DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.current_user_hides_costs(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_permissions AS permission
    INNER JOIN public.profiles AS profile ON profile.id = permission.user_uuid
    WHERE permission.workspace_id = p_workspace_id
      AND permission.user_uuid = auth.uid()
      AND permission.key = 'global.hideCosts'
      AND profile.role <> 'admin'
  );
$function$;

-- Restricted members may supply a cost only while creating a new product.
-- Any later attempt to change, clear, or infer the existing cost is rejected
-- at the database boundary.
CREATE OR REPLACE FUNCTION public.prevent_hidden_cost_product_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price
    AND public.current_user_hides_costs(NEW.workspace_id) THEN
    RAISE EXCEPTION 'You do not have permission to modify product cost.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_hidden_cost_product_updates_on_products ON public.products;
CREATE TRIGGER prevent_hidden_cost_product_updates_on_products
BEFORE UPDATE OF cost_price ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.prevent_hidden_cost_product_updates();

-- Enforce the rule at the final POS write boundary. This protects RPC calls,
-- direct table writes, and future sale-producing modules.
CREATE OR REPLACE FUNCTION public.enforce_sale_product_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid;
  v_product_name text;
  v_cost_price numeric;
BEGIN
  SELECT workspace_id
  INTO v_workspace_id
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Sale not found for sale item';
  END IF;

  SELECT name, cost_price
  INTO v_product_name, v_cost_price
  FROM public.products
  WHERE id = NEW.product_id
    AND workspace_id = v_workspace_id
    AND COALESCE(is_deleted, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found for this workspace';
  END IF;

  IF v_cost_price IS NULL OR v_cost_price < 0 THEN
    RAISE EXCEPTION '% cannot be sold until a cost is added.', COALESCE(v_product_name, 'This product');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_sale_product_cost_on_sale_items ON public.sale_items;
CREATE TRIGGER enforce_sale_product_cost_on_sale_items
BEFORE INSERT OR UPDATE OF product_id ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_sale_product_cost();

-- Sales orders persist their items as JSONB instead of rows.  Reject an order
-- that references a product without a valid cost before it is saved or moved
-- into a sale workflow.
CREATE OR REPLACE FUNCTION crm.enforce_sales_order_product_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_cost_price numeric;
BEGIN
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb))
  LOOP
    v_product_id := NULLIF(COALESCE(v_item->>'productId', v_item->>'product_id'), '')::uuid;
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Sales order contains an invalid product';
    END IF;

    SELECT name, cost_price
    INTO v_product_name, v_cost_price
    FROM public.products
    WHERE id = v_product_id
      AND workspace_id = NEW.workspace_id
      AND COALESCE(is_deleted, false) = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found for this workspace';
    END IF;

    IF v_cost_price IS NULL OR v_cost_price < 0 THEN
      RAISE EXCEPTION '% cannot be sold until a cost is added.', COALESCE(v_product_name, 'This product');
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_sales_order_product_cost_on_sales_orders ON crm.sales_orders;
CREATE TRIGGER enforce_sales_order_product_cost_on_sales_orders
BEFORE INSERT OR UPDATE OF items ON crm.sales_orders
FOR EACH ROW
EXECUTE FUNCTION crm.enforce_sales_order_product_cost();

REVOKE ALL ON FUNCTION public.enforce_sale_product_cost() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.enforce_sales_order_product_cost() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_hides_costs(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_hidden_cost_product_updates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_sale_product_cost() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.enforce_sales_order_product_cost() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_hides_costs(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_hidden_cost_product_updates() TO authenticated, service_role;
