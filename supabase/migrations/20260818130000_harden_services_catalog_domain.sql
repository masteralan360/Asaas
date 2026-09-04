-- Services are intentionally an admin-granted module.  The two earlier
-- migrations remain untouched because they have already been applied.
CREATE OR REPLACE FUNCTION public.workspace_plan_has_module(p_plan text, p_module text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(p_module, ''))
    WHEN 'pos' THEN true
    WHEN 'instant_pos' THEN false
    WHEN 'kds' THEN false
    WHEN 'sales_history' THEN true
    WHEN 'products' THEN true
    WHEN 'services' THEN false
    WHEN 'storages' THEN true
    WHEN 'inventory_transfer' THEN true
    WHEN 'inventory_transactions' THEN true
    WHEN 'stock_adjustments' THEN true
    WHEN 'ledger' THEN true
    WHEN 'payments' THEN true
    WHEN 'direct_transactions' THEN true
    WHEN 'members' THEN true
    WHEN 'business_partners' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'agents' THEN false
    WHEN 'post_service' THEN false
    WHEN 'customers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'suppliers' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'orders' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'ecommerce' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'real_estate' THEN false
    WHEN 'currency_exchange' THEN false
    WHEN 'clinical_appointments' THEN false
    WHEN 'loans' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'installments' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'discounts' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'revenue_analytics' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'team_performance' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'invoice_history' THEN public.normalize_workspace_plan(p_plan) IN ('business', 'enterprise')
    WHEN 'accounting' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'hr' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'expenses' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'payroll' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    WHEN 'whatsapp' THEN public.normalize_workspace_plan(p_plan) = 'enterprise'
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.services_module_allowed(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.workspace_module_allowed(w.id, w.plan::text, 'services')
  FROM public.workspaces AS w
  WHERE w.id = p_workspace_id
    AND w.deleted_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_services_override_admin_console()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF (
      (TG_OP <> 'INSERT' AND OLD.type = 'module' AND lower(OLD.key) = 'services')
      OR (TG_OP <> 'DELETE' AND NEW.type = 'module' AND lower(NEW.key) = 'services')
    )
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Services access can only be changed from the platform admin dashboard'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_services_override_admin_console ON public.workspace_access_overrides;
CREATE TRIGGER enforce_services_override_admin_console
  BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_access_overrides
  FOR EACH ROW EXECUTE FUNCTION public.enforce_services_override_admin_console();

-- Nullable in storage is important: a service has no hidden physical default.
ALTER TABLE public.products
  ALTER COLUMN quantity DROP NOT NULL,
  ALTER COLUMN min_stock_level DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_service_product_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF COALESCE(NEW.is_service, false) THEN
    IF NOT public.services_module_allowed(NEW.workspace_id) THEN
      RAISE EXCEPTION 'Services feature is not enabled for this workspace'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.parent_product_id IS NOT NULL THEN
      RAISE EXCEPTION 'Services cannot be variant parents or variants.';
    END IF;

    IF TG_OP = 'UPDATE' AND NOT COALESCE(OLD.is_service, false) AND EXISTS (
      SELECT 1
      FROM public.inventory AS i
      WHERE i.workspace_id = NEW.workspace_id
        AND i.product_id = NEW.id
        AND NOT COALESCE(i.is_deleted, false)
    ) THEN
      RAISE EXCEPTION 'A stocked product cannot be converted into a service.' USING ERRCODE = '23514';
    END IF;

    NEW.sku := NULL;
    NEW.unit := NULL;
    NEW.quantity := NULL;
    NEW.min_stock_level := NULL;
    NEW.storage_id := NULL;
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.is_service, false) AND NOT COALESCE(NEW.is_service, false) THEN
    RAISE EXCEPTION 'Services cannot be converted into inventory products.' USING ERRCODE = '23514';
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.is_service, false) AND NOT public.services_module_allowed(OLD.workspace_id) THEN
    RAISE EXCEPTION 'Services feature is not enabled for this workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_service_product_invariants ON public.products;
CREATE TRIGGER trg_enforce_service_product_invariants
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_product_invariants();

-- Keep the stock snapshot trigger compatible with NULL service fields.
CREATE OR REPLACE FUNCTION public.refresh_product_inventory_snapshot(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_workspace_id uuid;
    v_is_service boolean := false;
    v_total_quantity numeric := 0;
    v_storage_count integer := 0;
    v_single_storage_id uuid := NULL;
BEGIN
    SELECT workspace_id, COALESCE(is_service, false)
    INTO v_workspace_id, v_is_service
    FROM public.products
    WHERE id = p_product_id;

    IF NOT FOUND OR v_is_service THEN RETURN; END IF;

    SELECT COALESCE(SUM(i.quantity), 0)::numeric,
           COUNT(*)::integer,
           CASE WHEN COUNT(*) = 1 THEN MIN(i.storage_id::text)::uuid ELSE NULL END
    INTO v_total_quantity, v_storage_count, v_single_storage_id
    FROM public.inventory AS i
    WHERE i.workspace_id = v_workspace_id
      AND i.product_id = p_product_id
      AND COALESCE(i.is_deleted, false) = false;

    UPDATE public.products
    SET quantity = v_total_quantity,
        storage_id = CASE WHEN v_storage_count = 1 THEN v_single_storage_id ELSE NULL END,
        updated_at = timezone('utc', now()),
        version = COALESCE(version, 0) + 1
    WHERE id = p_product_id
      AND (quantity IS DISTINCT FROM v_total_quantity
        OR storage_id IS DISTINCT FROM CASE WHEN v_storage_count = 1 THEN v_single_storage_id ELSE NULL END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_product_inventory_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_total_quantity numeric := 0;
    v_storage_count integer := 0;
    v_single_storage_id uuid := NULL;
BEGIN
    IF COALESCE(NEW.is_service, false) THEN
      NEW.quantity := NULL;
      NEW.storage_id := NULL;
      RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.quantity := 0;
        NEW.storage_id := NULL;
        RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(i.quantity), 0)::numeric,
           COUNT(*)::integer,
           CASE WHEN COUNT(*) = 1 THEN MIN(i.storage_id::text)::uuid ELSE NULL END
    INTO v_total_quantity, v_storage_count, v_single_storage_id
    FROM public.inventory AS i
    WHERE i.workspace_id = NEW.workspace_id
      AND i.product_id = NEW.id
      AND COALESCE(i.is_deleted, false) = false;

    NEW.quantity := v_total_quantity;
    NEW.storage_id := CASE WHEN v_storage_count = 1 THEN v_single_storage_id ELSE NULL END;
    RETURN NEW;
END;
$function$;

-- One common guard is used by every physical inventory table.
CREATE OR REPLACE FUNCTION public.prevent_service_inventory_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_product_id uuid;
  v_workspace_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
    v_workspace_id := OLD.workspace_id;
  ELSE
    v_product_id := NEW.product_id;
    v_workspace_id := NEW.workspace_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.products AS p
    WHERE p.id = v_product_id
      AND p.workspace_id = v_workspace_id
      AND COALESCE(p.is_service, false)
  ) THEN
    RAISE EXCEPTION 'Services cannot have inventory, stock batches, transfers, or inventory transactions.'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_service_inventory_mutation ON public.inventory;
CREATE TRIGGER trg_prevent_service_inventory_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.prevent_service_inventory_mutation();

DROP TRIGGER IF EXISTS trg_prevent_service_batch_mutation ON public.stock_batches;
CREATE TRIGGER trg_prevent_service_batch_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.stock_batches
  FOR EACH ROW EXECUTE FUNCTION public.prevent_service_inventory_mutation();

DROP TRIGGER IF EXISTS trg_prevent_service_transfer_mutation ON public.inventory_transfer_transactions;
CREATE TRIGGER trg_prevent_service_transfer_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transfer_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_service_inventory_mutation();

DROP TRIGGER IF EXISTS trg_prevent_service_transaction_mutation ON public.inventory_transactions;
CREATE TRIGGER trg_prevent_service_transaction_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_service_inventory_mutation();

-- stock_adjustments was unified into inventory_transactions; its trigger is
-- installed only if a legacy table still exists (covered by the
-- inventory_transactions trigger otherwise).
DO $$
BEGIN
  IF to_regclass('public.stock_adjustments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_prevent_service_stock_adjustment ON public.stock_adjustments;
    CREATE TRIGGER trg_prevent_service_stock_adjustment
      BEFORE INSERT OR UPDATE OR DELETE ON public.stock_adjustments
      FOR EACH ROW EXECUTE FUNCTION public.prevent_service_inventory_mutation();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_service_sale_item_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id uuid;
  v_is_service boolean;
BEGIN
  SELECT s.workspace_id, COALESCE(p.is_service, false)
  INTO v_workspace_id, v_is_service
  FROM public.sales AS s
  JOIN public.products AS p ON p.id = NEW.product_id AND p.workspace_id = s.workspace_id
  WHERE s.id = NEW.sale_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Sale item product is not in the sale workspace'; END IF;
  IF NOT v_is_service THEN RETURN NEW; END IF;
  IF NOT public.services_module_allowed(v_workspace_id) THEN
    RAISE EXCEPTION 'Services feature is not enabled for this workspace' USING ERRCODE = '42501';
  END IF;
  IF NEW.storage_id IS NOT NULL OR NEW.inventory_snapshot IS NOT NULL
     OR NEW.batch_allocations IS NOT NULL OR NEW.original_batch_allocations IS NOT NULL THEN
    RAISE EXCEPTION 'Service sale items cannot contain storage, inventory, or batch data.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_service_sale_item_rules ON public.sale_items;
CREATE TRIGGER trg_enforce_service_sale_item_rules
  BEFORE INSERT OR UPDATE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_sale_item_rules();

CREATE OR REPLACE FUNCTION public.enforce_service_return_item_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_is_service boolean;
BEGIN
  SELECT COALESCE(p.is_service, false) INTO v_is_service
  FROM public.sale_items si JOIN public.products p ON p.id = si.product_id
  WHERE si.id = NEW.sale_item_id;
  IF v_is_service AND (NEW.restored_storage_id IS NOT NULL OR NEW.restored_batch_allocations IS NOT NULL) THEN
    RAISE EXCEPTION 'Service returns cannot restore inventory.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_service_return_item_rules ON public.sale_return_items;
CREATE TRIGGER trg_enforce_service_return_item_rules
  BEFORE INSERT OR UPDATE ON public.sale_return_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_return_item_rules();

CREATE OR REPLACE FUNCTION crm.enforce_service_order_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $function$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_is_service boolean;
  v_storage_id text;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
    v_product_id := NULLIF(COALESCE(v_item->>'productId', v_item->>'product_id'), '')::uuid;
    SELECT COALESCE(is_service, false) INTO v_is_service
    FROM public.products WHERE id = v_product_id AND workspace_id = NEW.workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order item product is not in this workspace'; END IF;
    v_storage_id := COALESCE(v_item->>'storageId', v_item->>'storage_id', '');

    IF TG_TABLE_NAME = 'purchase_orders' AND v_is_service THEN
      RAISE EXCEPTION 'Services cannot be added to purchase orders.' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'sales_orders' AND v_is_service THEN
      IF NOT public.services_module_allowed(NEW.workspace_id) THEN
        RAISE EXCEPTION 'Services feature is not enabled for this workspace' USING ERRCODE = '42501';
      END IF;
      IF v_storage_id <> '' AND v_storage_id <> '__atlas_services__' THEN
        RAISE EXCEPTION 'Service order items must use the Services virtual location.' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_service_sales_order_items ON crm.sales_orders;
CREATE TRIGGER trg_enforce_service_sales_order_items
  BEFORE INSERT OR UPDATE OF items, workspace_id ON crm.sales_orders
  FOR EACH ROW EXECUTE FUNCTION crm.enforce_service_order_items();

DROP TRIGGER IF EXISTS trg_enforce_service_purchase_order_items ON crm.purchase_orders;
CREATE TRIGGER trg_enforce_service_purchase_order_items
  BEFORE INSERT OR UPDATE OF items, workspace_id ON crm.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION crm.enforce_service_order_items();

-- Prevent direct REST access to service rows when the commercial feature is
-- revoked, in addition to the product mutation trigger above.
DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_select ON public.products FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id()
    AND (NOT COALESCE(is_service, false) OR public.services_module_allowed(workspace_id)));

DROP POLICY IF EXISTS products_insert ON public.products;
CREATE POLICY products_insert ON public.products FOR INSERT TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND (NOT COALESCE(is_service, false) OR public.services_module_allowed(workspace_id)));

DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update ON public.products FOR UPDATE TO authenticated
  USING (workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND (NOT COALESCE(is_service, false) OR public.services_module_allowed(workspace_id)))
  WITH CHECK (workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND (NOT COALESCE(is_service, false) OR public.services_module_allowed(workspace_id)));

DROP POLICY IF EXISTS products_delete ON public.products;
CREATE POLICY products_delete ON public.products FOR DELETE TO authenticated
  USING (workspace_id = public.current_workspace_id()
    AND public.current_user_role() IN ('admin', 'staff')
    AND (NOT COALESCE(is_service, false) OR public.services_module_allowed(workspace_id)));

GRANT EXECUTE ON FUNCTION public.workspace_plan_has_module(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.services_module_allowed(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_services_override_admin_console() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_service_product_invariants() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_service_inventory_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_service_sale_item_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_service_return_item_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.enforce_service_order_items() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
