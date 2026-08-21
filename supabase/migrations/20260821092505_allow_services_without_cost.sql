-- Services are sellable catalog entries, but do not require an inventory cost.
-- These checks run at the database write boundary, so the exemption must be
-- based on the canonical product flag rather than a client-provided payload.

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
  v_is_service boolean;
BEGIN
  SELECT workspace_id
  INTO v_workspace_id
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Sale not found for sale item';
  END IF;

  SELECT name, cost_price, COALESCE(is_service, false)
  INTO v_product_name, v_cost_price, v_is_service
  FROM public.products
  WHERE id = NEW.product_id
    AND workspace_id = v_workspace_id
    AND COALESCE(is_deleted, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found for this workspace';
  END IF;

  IF NOT v_is_service AND (v_cost_price IS NULL OR v_cost_price < 0) THEN
    RAISE EXCEPTION '% cannot be sold until a cost is added.', COALESCE(v_product_name, 'This product');
  END IF;

  RETURN NEW;
END;
$function$;

-- Sales orders use a JSONB item list and additionally enforce Price Book
-- costs. The same service exemption applies to both cost requirements.
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
  v_snapshot_product_name text;
  v_snapshot_product_sku text;
  v_cost_price numeric;
  v_is_service boolean;
  v_partner_price_book_id uuid;
  v_price_book_name text;
  v_price_book_item_id uuid;
  v_price_book_cost numeric;
BEGIN
  SELECT partner.price_book_id
  INTO v_partner_price_book_id
  FROM crm.business_partners AS partner
  WHERE partner.id = NEW.business_partner_id
    AND partner.workspace_id = NEW.workspace_id
    AND COALESCE(partner.is_deleted, false) = false;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb))
  LOOP
    v_product_id := NULLIF(COALESCE(v_item->>'productId', v_item->>'product_id'), '')::uuid;
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Sales order contains an invalid product';
    END IF;

    v_snapshot_product_name := COALESCE(
      NULLIF(v_item->>'productName', ''),
      NULLIF(v_item->>'product_name', ''),
      'Unknown product'
    );
    v_snapshot_product_sku := COALESCE(
      NULLIF(v_item->>'productSku', ''),
      NULLIF(v_item->>'product_sku', ''),
      NULLIF(v_item->>'sku', ''),
      'not recorded'
    );

    SELECT name, cost_price, COALESCE(is_service, false)
    INTO v_product_name, v_cost_price, v_is_service
    FROM public.products
    WHERE id = v_product_id
      AND workspace_id = NEW.workspace_id
      AND COALESCE(is_deleted, false) = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Product "%" (SKU: %, ID: %) is not available in this workspace. Restore it in Products or replace it in the order before continuing.',
        v_snapshot_product_name,
        v_snapshot_product_sku,
        v_product_id;
    END IF;

    IF NOT v_is_service AND (v_cost_price IS NULL OR v_cost_price < 0) THEN
      RAISE EXCEPTION '% cannot be sold until a cost is added.', COALESCE(v_product_name, 'This product');
    END IF;

    IF NOT v_is_service AND v_partner_price_book_id IS NOT NULL THEN
      SELECT price_book.name, price_book_item.id, price_book_item.cost_price
      INTO v_price_book_name, v_price_book_item_id, v_price_book_cost
      FROM public.price_books AS price_book
      LEFT JOIN public.price_book_items AS price_book_item
        ON price_book_item.price_book_id = price_book.id
        AND price_book_item.product_id = v_product_id
        AND COALESCE(price_book_item.is_deleted, false) = false
      WHERE price_book.id = v_partner_price_book_id
        AND price_book.workspace_id = NEW.workspace_id
        AND COALESCE(price_book.is_deleted, false) = false;

      IF v_price_book_item_id IS NOT NULL
        AND (v_price_book_cost IS NULL OR v_price_book_cost < 0) THEN
        RAISE EXCEPTION '% cannot be sold to this business partner until a Price Book cost is added in %.',
          COALESCE(v_product_name, 'This product'),
          COALESCE(v_price_book_name, 'the assigned Price Book');
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_sale_product_cost() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_sale_product_cost() TO authenticated, service_role;
REVOKE ALL ON FUNCTION crm.enforce_sales_order_product_cost() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.enforce_sales_order_product_cost() TO authenticated, service_role;
