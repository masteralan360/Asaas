-- Backfill a display-only history field. It deliberately does not create or
-- modify inventory, payment, ledger, or return records: completed sales have
-- already posted those effects. Service lines receive zero because they do
-- not transfer physical stock.
-- The partner link is not changed. Run this historical maintenance operation
-- in the migration's privileged context so a now-unavailable partner cannot
-- block an otherwise safe update to its existing order.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  WITH legacy_completed_orders AS (
  SELECT
    sales_order.id,
    jsonb_agg(
      CASE
        WHEN item.value ? 'fulfilledQuantity'
          AND item.value -> 'fulfilledQuantity' <> 'null'::jsonb
          THEN item.value
        WHEN COALESCE(product.is_service, false)
          THEN item.value || jsonb_build_object('fulfilledQuantity', 0)
        ELSE item.value || jsonb_build_object(
          'fulfilledQuantity',
          round(
            greatest(
              CASE
                WHEN COALESCE(item.value ->> 'quantity', '') ~ '^-?[0-9]+([.][0-9]+)?$'
                  THEN (item.value ->> 'quantity')::numeric
                ELSE 0
              END
              + CASE
                WHEN COALESCE(item.value ->> 'freeBonusQuantity', item.value ->> 'freeQuantity', '') ~ '^-?[0-9]+([.][0-9]+)?$'
                  THEN COALESCE(item.value ->> 'freeBonusQuantity', item.value ->> 'freeQuantity')::numeric
                ELSE 0
              END,
              0
            ),
            6
          )
        )
      END
      ORDER BY item.ordinality
    ) AS updated_items
  FROM crm.sales_orders AS sales_order
  CROSS JOIN LATERAL jsonb_array_elements(sales_order.items) WITH ORDINALITY AS item(value, ordinality)
  LEFT JOIN public.products AS product
    ON product.id::text = item.value ->> 'productId'
  WHERE sales_order.status = 'completed'
    AND NOT COALESCE(sales_order.is_deleted, false)
    AND sales_order.created_at < timestamptz '2026-09-08 18:00:00+00'
    AND jsonb_typeof(sales_order.items) = 'array'
    -- Keep current product and price-book integrity rules intact. Orders that
    -- reference a now-unavailable or invalid-cost product remain unavailable
    -- in the UI until that historical data is repaired separately.
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(sales_order.items) AS validation_item(value)
      LEFT JOIN public.products AS validation_product
        ON validation_product.id::text = COALESCE(
          validation_item.value ->> 'productId',
          validation_item.value ->> 'product_id'
        )
        AND validation_product.workspace_id = sales_order.workspace_id
        AND NOT COALESCE(validation_product.is_deleted, false)
      LEFT JOIN crm.business_partners AS validation_partner
        ON validation_partner.id = sales_order.business_partner_id
        AND validation_partner.workspace_id = sales_order.workspace_id
        AND NOT COALESCE(validation_partner.is_deleted, false)
      LEFT JOIN public.price_books AS validation_price_book
        ON validation_price_book.id = validation_partner.price_book_id
        AND validation_price_book.workspace_id = sales_order.workspace_id
        AND NOT COALESCE(validation_price_book.is_deleted, false)
      LEFT JOIN public.price_book_items AS validation_price_book_item
        ON validation_price_book_item.price_book_id = validation_price_book.id
        AND validation_price_book_item.product_id = validation_product.id
        AND NOT COALESCE(validation_price_book_item.is_deleted, false)
      WHERE validation_product.id IS NULL
        OR (
          NOT COALESCE(validation_product.is_service, false)
          AND (validation_product.cost_price IS NULL OR validation_product.cost_price < 0)
        )
        OR (
          NOT COALESCE(validation_product.is_service, false)
          AND validation_price_book_item.id IS NOT NULL
          AND (validation_price_book_item.cost_price IS NULL OR validation_price_book_item.cost_price < 0)
        )
    )
  GROUP BY sales_order.id
  HAVING bool_or(
    NOT (item.value ? 'fulfilledQuantity')
    OR item.value -> 'fulfilledQuantity' = 'null'::jsonb
  )
)
  UPDATE crm.sales_orders AS sales_order
  SET
    items = legacy_completed_orders.updated_items,
    updated_at = now(),
    version = COALESCE(sales_order.version, 0) + 1,
    sync_status = 'synced'
  FROM legacy_completed_orders
  WHERE sales_order.id = legacy_completed_orders.id;
END;
$$;
