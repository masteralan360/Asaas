-- A Price Book cost is optional at data entry. NULL is deliberately distinct
-- from zero, which is a valid cost.
ALTER TABLE public.price_book_items
  ALTER COLUMN cost_price DROP NOT NULL,
  ALTER COLUMN cost_price DROP DEFAULT;

-- Extend the product-cost guard from the previous migration: when a sales
-- order's business partner is assigned a Price Book, a product that has an
-- item in that book must have a valid cost. Products not assigned to the book
-- continue to use their normal product cost. Read database values rather than
-- a client-side item snapshot.
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

    IF v_partner_price_book_id IS NOT NULL THEN
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

DROP TRIGGER IF EXISTS enforce_sales_order_product_cost_on_sales_orders ON crm.sales_orders;
CREATE TRIGGER enforce_sales_order_product_cost_on_sales_orders
BEFORE INSERT OR UPDATE OF items, business_partner_id, status ON crm.sales_orders
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM 'cancelled')
EXECUTE FUNCTION crm.enforce_sales_order_product_cost();

REVOKE ALL ON FUNCTION crm.enforce_sales_order_product_cost() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.enforce_sales_order_product_cost() TO authenticated, service_role;
