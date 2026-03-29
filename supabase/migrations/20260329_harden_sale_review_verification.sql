ALTER TABLE public.sales
  ALTER COLUMN system_verified DROP DEFAULT,
  ALTER COLUMN system_review_status DROP DEFAULT;

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_system_review_status_check;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_system_review_status_check
  CHECK (
    system_review_status IS NULL
    OR system_review_status = ANY (ARRAY['approved'::text, 'flagged'::text, 'inconsistent'::text])
  );

CREATE OR REPLACE FUNCTION public.complete_sale(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    new_sale_id UUID;
    v_sequence_id BIGINT;
    item JSONB;
    snapshot JSONB;
    p_workspace_id UUID;
    total_sale_amount NUMERIC := 0;
    v_pos BOOLEAN;
    v_max_discount_percent INTEGER := 100;
    v_product_id UUID;
    v_storage_id UUID;
    v_quantity INTEGER;
    v_item_index INTEGER := 0;
    v_exchange_source TEXT;
    v_exchange_rate NUMERIC;
    v_exchange_rate_timestamp TIMESTAMPTZ;
    v_exchange_rates JSONB;
    v_original_currency TEXT;
    v_item_settlement_currency TEXT;
    v_original_unit_price NUMERIC;
    v_negotiated_price NUMERIC;
    v_discount_percent NUMERIC;
    v_converted_unit_price NUMERIC;
    v_inventory_snapshot INTEGER;
    v_items_total NUMERIC := 0;
    v_flags TEXT[] := ARRAY[]::TEXT[];
    v_has_mixed_currency BOOLEAN := false;
    v_has_exchange_snapshot_rate BOOLEAN := false;
    v_has_exchange_snapshot_source BOOLEAN := false;
    v_system_verified BOOLEAN := true;
    v_system_review_status TEXT := 'approved';
    v_system_review_reason TEXT := NULL;
BEGIN
    SELECT workspace_id INTO p_workspace_id
    FROM public.profiles
    WHERE id = auth.uid();

    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'User does not belong to a workspace';
    END IF;

    SELECT pos, COALESCE(max_discount_percent, 100)
    INTO v_pos, v_max_discount_percent
    FROM public.workspaces
    WHERE id = p_workspace_id;

    IF NOT COALESCE(v_pos, false) THEN
        RAISE EXCEPTION 'POS feature is not enabled for this workspace';
    END IF;

    total_sale_amount := COALESCE((payload->>'total_amount')::NUMERIC, 0);
    v_exchange_source := NULLIF(payload->>'exchange_source', '');
    v_exchange_rate := (payload->>'exchange_rate')::NUMERIC;
    v_exchange_rate_timestamp := (payload->>'exchange_rate_timestamp')::TIMESTAMPTZ;
    v_exchange_rates := CASE
        WHEN jsonb_typeof(payload->'exchange_rates') = 'array' THEN
            CASE
                WHEN jsonb_array_length(payload->'exchange_rates') > 0 THEN payload->'exchange_rates'
                ELSE NULL
            END
        ELSE NULL
    END;

    IF v_exchange_rates IS NOT NULL THEN
        FOR snapshot IN SELECT * FROM jsonb_array_elements(v_exchange_rates)
        LOOP
            IF COALESCE((snapshot->>'rate')::NUMERIC, 0) > 0 THEN
                v_has_exchange_snapshot_rate := true;
            END IF;

            IF COALESCE(NULLIF(snapshot->>'source', ''), 'none') <> 'none' THEN
                v_has_exchange_snapshot_source := true;
            END IF;
        END LOOP;
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
    LOOP
        v_item_index := v_item_index + 1;
        v_quantity := COALESCE((item->>'quantity')::INTEGER, 0);
        v_converted_unit_price := COALESCE((item->>'converted_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC, 0);
        v_items_total := v_items_total + (v_converted_unit_price * v_quantity);

        IF v_quantity <= 0 THEN
            v_flags := array_append(v_flags, format('Item %s: Invalid quantity (%s)', v_item_index, v_quantity));
        END IF;

        IF item->>'negotiated_price' IS NOT NULL THEN
            v_negotiated_price := (item->>'negotiated_price')::NUMERIC;

            IF v_negotiated_price < 0 THEN
                v_flags := array_append(v_flags, format('Item %s: Negative negotiated price', v_item_index));
            ELSE
                v_original_unit_price := COALESCE((item->>'original_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC, 0);

                IF v_original_unit_price > 0 THEN
                    v_discount_percent := ((v_original_unit_price - v_negotiated_price) / v_original_unit_price) * 100;
                    IF v_discount_percent > v_max_discount_percent THEN
                        v_flags := array_append(
                            v_flags,
                            format(
                                'Item %s: Discount %s%% exceeds limit of %s%%',
                                v_item_index,
                                trim(to_char(v_discount_percent, 'FM999999990.0')),
                                v_max_discount_percent
                            )
                        );
                    END IF;
                END IF;
            END IF;
        END IF;

        v_original_currency := COALESCE(item->>'original_currency', 'usd');
        v_item_settlement_currency := COALESCE(item->>'settlement_currency', COALESCE(payload->>'settlement_currency', 'usd'));
        IF v_original_currency IS DISTINCT FROM v_item_settlement_currency THEN
            v_has_mixed_currency := true;
        END IF;

        v_inventory_snapshot := COALESCE((item->>'inventory_snapshot')::INTEGER, 0);
        IF v_quantity > v_inventory_snapshot THEN
            v_flags := array_append(
                v_flags,
                format(
                    'Item %s: Quantity %s exceeds inventory snapshot %s',
                    v_item_index,
                    v_quantity,
                    v_inventory_snapshot
                )
            );
        END IF;
    END LOOP;

    IF ABS(v_items_total - total_sale_amount) > 0.01 THEN
        v_flags := array_append(
            v_flags,
            format(
                'Total mismatch: items sum to %s, sale total is %s',
                trim(to_char(v_items_total, 'FM999999990.00')),
                trim(to_char(total_sale_amount, 'FM999999990.00'))
            )
        );
    END IF;

    IF v_has_mixed_currency THEN
        IF NOT v_has_exchange_snapshot_rate AND COALESCE(v_exchange_rate, 0) = 0 THEN
            v_flags := array_append(v_flags, 'Missing exchange rate for multi-currency sale');
        END IF;

        IF NOT v_has_exchange_snapshot_source
            AND COALESCE(v_exchange_source, 'none') = 'none' THEN
            v_flags := array_append(v_flags, 'Missing exchange rate source');
        END IF;
    END IF;

    IF COALESCE(array_length(v_flags, 1), 0) > 0 THEN
        v_system_verified := false;
        v_system_review_status := 'flagged';
        v_system_review_reason := array_to_string(v_flags, '; ');
    END IF;

    INSERT INTO public.sales (
        id,
        workspace_id,
        cashier_id,
        total_amount,
        settlement_currency,
        exchange_source,
        exchange_rate,
        exchange_rate_timestamp,
        exchange_rates,
        origin,
        payment_method,
        system_verified,
        system_review_status,
        system_review_reason,
        notes
    )
    VALUES (
        COALESCE((payload->>'id')::UUID, gen_random_uuid()),
        p_workspace_id,
        auth.uid(),
        total_sale_amount,
        COALESCE(payload->>'settlement_currency', 'usd'),
        v_exchange_source,
        v_exchange_rate,
        v_exchange_rate_timestamp,
        v_exchange_rates,
        COALESCE(payload->>'origin', 'pos'),
        COALESCE(payload->>'payment_method', 'cash'),
        v_system_verified,
        v_system_review_status,
        v_system_review_reason,
        payload->>'notes'
    )
    RETURNING id, sequence_id INTO new_sale_id, v_sequence_id;

    FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
    LOOP
        v_product_id := (item->>'product_id')::UUID;
        v_quantity := COALESCE((item->>'quantity')::INTEGER, 0);
        v_storage_id := NULLIF(item->>'storage_id', '')::UUID;

        IF v_product_id IS NULL OR v_quantity <= 0 THEN
            RAISE EXCEPTION 'Invalid sale item payload';
        END IF;

        IF v_storage_id IS NULL THEN
            SELECT CASE WHEN COUNT(*) = 1 THEN MIN(storage_id::text)::uuid ELSE NULL END
            INTO v_storage_id
            FROM public.inventory
            WHERE workspace_id = p_workspace_id
              AND product_id = v_product_id
              AND COALESCE(is_deleted, false) = false;
        END IF;

        IF v_storage_id IS NULL THEN
            SELECT storage_id
            INTO v_storage_id
            FROM public.products
            WHERE id = v_product_id
              AND workspace_id = p_workspace_id;
        END IF;

        IF v_storage_id IS NULL THEN
            RAISE EXCEPTION 'Storage not found for product %', v_product_id;
        END IF;

        INSERT INTO public.sale_items (
            sale_id,
            product_id,
            storage_id,
            quantity,
            unit_price,
            total_price,
            cost_price,
            converted_cost_price,
            original_currency,
            original_unit_price,
            converted_unit_price,
            settlement_currency,
            negotiated_price,
            inventory_snapshot
        )
        VALUES (
            new_sale_id,
            v_product_id,
            v_storage_id,
            v_quantity,
            (item->>'unit_price')::NUMERIC,
            (item->>'total_price')::NUMERIC,
            COALESCE((item->>'cost_price')::NUMERIC, 0),
            COALESCE((item->>'converted_cost_price')::NUMERIC, 0),
            COALESCE(item->>'original_currency', 'usd'),
            COALESCE((item->>'original_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE((item->>'converted_unit_price')::NUMERIC, (item->>'unit_price')::NUMERIC),
            COALESCE(item->>'settlement_currency', 'usd'),
            (item->>'negotiated_price')::NUMERIC,
            COALESCE((item->>'inventory_snapshot')::INTEGER, 0)
        );

        UPDATE public.inventory
        SET
            quantity = quantity - v_quantity,
            updated_at = NOW(),
            version = COALESCE(version, 0) + 1,
            is_deleted = (quantity - v_quantity) <= 0
        WHERE workspace_id = p_workspace_id
          AND product_id = v_product_id
          AND storage_id = v_storage_id
          AND COALESCE(is_deleted, false) = false
          AND quantity >= v_quantity;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Insufficient inventory for product % in storage %', v_product_id, v_storage_id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', new_sale_id,
        'sequence_id', v_sequence_id,
        'system_verified', v_system_verified,
        'system_review_status', v_system_review_status,
        'system_review_reason', v_system_review_reason
    );
END;
$function$;
