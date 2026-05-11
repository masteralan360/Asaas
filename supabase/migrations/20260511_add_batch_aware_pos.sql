ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS batch_allocations jsonb NULL;

ALTER TABLE public.stock_batches
  DROP CONSTRAINT IF EXISTS stock_batches_quantity_check;

ALTER TABLE public.stock_batches
  ADD CONSTRAINT stock_batches_quantity_check CHECK (
    (
      COALESCE(is_deleted, false) = false
      AND quantity > 0
    )
    OR (
      COALESCE(is_deleted, false) = true
      AND quantity >= 0
    )
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
    v_batch_record RECORD;
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
    v_has_active_batches BOOLEAN := false;
    v_batch_remaining INTEGER := 0;
    v_allocated_quantity INTEGER := 0;
    v_batch_allocations JSONB := '[]'::jsonb;
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
        v_has_active_batches := false;
        v_batch_remaining := v_quantity;
        v_batch_allocations := '[]'::jsonb;

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

        SELECT EXISTS (
            SELECT 1
            FROM public.stock_batches
            WHERE workspace_id = p_workspace_id
              AND product_id = v_product_id
              AND storage_id = v_storage_id
              AND COALESCE(is_deleted, false) = false
        )
        INTO v_has_active_batches;

        IF v_has_active_batches THEN
            FOR v_batch_record IN
                SELECT *
                FROM public.stock_batches
                WHERE workspace_id = p_workspace_id
                  AND product_id = v_product_id
                  AND storage_id = v_storage_id
                  AND COALESCE(is_deleted, false) = false
                ORDER BY expiry_date ASC NULLS LAST, manufacturing_date ASC NULLS LAST, created_at ASC, batch_number ASC
                FOR UPDATE
            LOOP
                EXIT WHEN v_batch_remaining <= 0;

                v_allocated_quantity := LEAST(v_batch_remaining, COALESCE(v_batch_record.quantity, 0));
                IF v_allocated_quantity <= 0 THEN
                    CONTINUE;
                END IF;

                UPDATE public.stock_batches
                SET
                    quantity = v_batch_record.quantity - v_allocated_quantity,
                    updated_at = NOW(),
                    version = COALESCE(version, 0) + 1,
                    is_deleted = (v_batch_record.quantity - v_allocated_quantity) <= 0
                WHERE id = v_batch_record.id;

                v_batch_allocations := v_batch_allocations || jsonb_build_array(
                    jsonb_build_object(
                        'batch_id', v_batch_record.id,
                        'batch_number', v_batch_record.batch_number,
                        'quantity', v_allocated_quantity,
                        'expiry_date', v_batch_record.expiry_date,
                        'manufacturing_date', v_batch_record.manufacturing_date
                    )
                );
                v_batch_remaining := v_batch_remaining - v_allocated_quantity;
            END LOOP;

            IF v_batch_remaining > 0 THEN
                RAISE EXCEPTION 'Insufficient batched inventory for product % in storage %', v_product_id, v_storage_id;
            END IF;
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
            inventory_snapshot,
            batch_allocations
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
            COALESCE((item->>'inventory_snapshot')::INTEGER, 0),
            CASE
                WHEN v_has_active_batches AND jsonb_array_length(v_batch_allocations) > 0 THEN v_batch_allocations
                ELSE NULL
            END
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

CREATE OR REPLACE FUNCTION public.return_sale_items(
    p_sale_item_ids uuid[],
    p_return_quantities integer[],
    p_return_reason text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    item_record RECORD;
    v_batch_allocation JSONB;
    v_target_batch_record RECORD;
    p_workspace_id UUID;
    v_user_role TEXT;
    v_pos BOOLEAN;
    v_sale_id UUID;
    v_requested_quantity INTEGER;
    v_return_quantity INTEGER;
    v_storage_id UUID;
    v_primary_storage_id UUID;
    v_original_storage_missing BOOLEAN := false;
    v_total_return_value NUMERIC := 0;
    v_sale_fully_returned BOOLEAN := false;
    idx INTEGER;
    v_existing_batch_allocations JSONB := '[]'::jsonb;
    v_remaining_batch_allocations JSONB := '[]'::jsonb;
    v_remaining_to_restore INTEGER := 0;
    v_batch_quantity INTEGER := 0;
    v_restore_quantity INTEGER := 0;
    v_leftover_batch_quantity INTEGER := 0;
    v_batch_id UUID;
    v_batch_number TEXT;
    v_batch_expiry_date DATE;
    v_batch_manufacturing_date DATE;
    v_new_batch_id UUID;
BEGIN
    IF p_sale_item_ids IS NULL OR array_length(p_sale_item_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'No items selected for return';
    END IF;

    IF p_return_quantities IS NULL OR array_length(p_return_quantities, 1) IS DISTINCT FROM array_length(p_sale_item_ids, 1) THEN
        RAISE EXCEPTION 'Return quantities must match selected sale items';
    END IF;

    SELECT si.*, s.workspace_id, s.id AS sale_id
    INTO item_record
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE si.id = ANY(p_sale_item_ids)
    LIMIT 1;

    IF item_record IS NULL THEN
        RAISE EXCEPTION 'Sale items not found';
    END IF;

    p_workspace_id := item_record.workspace_id;
    v_sale_id := item_record.sale_id;

    SELECT pos INTO v_pos
    FROM public.workspaces
    WHERE id = p_workspace_id;

    IF NOT COALESCE(v_pos, false) THEN
        RAISE EXCEPTION 'POS feature is not enabled for this workspace';
    END IF;

    SELECT role INTO v_user_role
    FROM public.profiles
    WHERE id = auth.uid()
      AND workspace_id = p_workspace_id;

    IF v_user_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins and staff can return items';
    END IF;

    v_primary_storage_id := public.ensure_primary_storage(p_workspace_id);

    FOR idx IN 1..array_length(p_sale_item_ids, 1)
    LOOP
        SELECT si.*, s.workspace_id, s.id AS sale_id
        INTO item_record
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        WHERE si.id = p_sale_item_ids[idx]
        FOR UPDATE;

        IF item_record IS NULL THEN
            CONTINUE;
        END IF;

        IF item_record.sale_id IS DISTINCT FROM v_sale_id THEN
            RAISE EXCEPTION 'Selected sale items must belong to the same sale';
        END IF;

        v_requested_quantity := COALESCE(p_return_quantities[idx], 0);
        v_return_quantity := LEAST(
            GREATEST(v_requested_quantity, 0),
            item_record.quantity - COALESCE(item_record.returned_quantity, 0)
        );

        IF v_return_quantity <= 0 THEN
            CONTINUE;
        END IF;

        v_storage_id := item_record.storage_id;
        v_original_storage_missing := false;

        IF v_storage_id IS NOT NULL THEN
            PERFORM 1
            FROM public.storages
            WHERE id = v_storage_id
              AND workspace_id = p_workspace_id
              AND COALESCE(is_deleted, false) = false;

            IF NOT FOUND THEN
                v_original_storage_missing := true;
                v_storage_id := v_primary_storage_id;
            END IF;
        END IF;

        IF v_storage_id IS NULL THEN
            SELECT CASE WHEN COUNT(*) = 1 THEN MIN(i.storage_id::text)::uuid ELSE NULL END
            INTO v_storage_id
            FROM public.inventory i
            JOIN public.storages st
              ON st.id = i.storage_id
             AND st.workspace_id = p_workspace_id
             AND COALESCE(st.is_deleted, false) = false
            WHERE i.workspace_id = p_workspace_id
              AND i.product_id = item_record.product_id
              AND COALESCE(i.is_deleted, false) = false;
        END IF;

        IF v_storage_id IS NULL THEN
            SELECT p.storage_id
            INTO v_storage_id
            FROM public.products p
            JOIN public.storages st
              ON st.id = p.storage_id
             AND st.workspace_id = p_workspace_id
             AND COALESCE(st.is_deleted, false) = false
            WHERE p.id = item_record.product_id
              AND p.workspace_id = p_workspace_id;
        END IF;

        IF v_storage_id IS NULL THEN
            v_storage_id := v_primary_storage_id;
        END IF;

        IF v_storage_id IS NULL THEN
            RAISE EXCEPTION 'Storage not found for returned product %', item_record.product_id;
        END IF;

        INSERT INTO public.inventory (
            id,
            workspace_id,
            product_id,
            storage_id,
            quantity,
            created_at,
            updated_at,
            version,
            is_deleted
        )
        VALUES (
            gen_random_uuid(),
            p_workspace_id,
            item_record.product_id,
            v_storage_id,
            v_return_quantity,
            NOW(),
            NOW(),
            1,
            false
        )
        ON CONFLICT (workspace_id, product_id, storage_id) DO UPDATE
        SET
            quantity = public.inventory.quantity + EXCLUDED.quantity,
            updated_at = NOW(),
            version = COALESCE(public.inventory.version, 0) + 1,
            is_deleted = false;

        v_existing_batch_allocations := CASE
            WHEN jsonb_typeof(item_record.batch_allocations) = 'array' THEN item_record.batch_allocations
            ELSE '[]'::jsonb
        END;
        v_remaining_batch_allocations := '[]'::jsonb;

        IF jsonb_array_length(v_existing_batch_allocations) > 0 THEN
            v_remaining_to_restore := v_return_quantity;

            FOR v_batch_allocation IN SELECT * FROM jsonb_array_elements(v_existing_batch_allocations)
            LOOP
                v_batch_quantity := COALESCE((v_batch_allocation->>'quantity')::INTEGER, 0);
                v_restore_quantity := LEAST(v_remaining_to_restore, v_batch_quantity);
                v_leftover_batch_quantity := GREATEST(v_batch_quantity - v_restore_quantity, 0);
                v_batch_id := NULLIF(v_batch_allocation->>'batch_id', '')::UUID;
                v_batch_number := COALESCE(NULLIF(v_batch_allocation->>'batch_number', ''), 'Restored Batch');
                v_batch_expiry_date := NULLIF(v_batch_allocation->>'expiry_date', '')::DATE;
                v_batch_manufacturing_date := NULLIF(v_batch_allocation->>'manufacturing_date', '')::DATE;
                v_target_batch_record := NULL;

                IF v_restore_quantity > 0 THEN
                    IF v_batch_id IS NOT NULL THEN
                        SELECT *
                        INTO v_target_batch_record
                        FROM public.stock_batches
                        WHERE id = v_batch_id
                          AND workspace_id = p_workspace_id
                          AND product_id = item_record.product_id
                          AND storage_id = v_storage_id
                        FOR UPDATE;
                    END IF;

                    IF v_target_batch_record IS NULL THEN
                        SELECT *
                        INTO v_target_batch_record
                        FROM public.stock_batches
                        WHERE workspace_id = p_workspace_id
                          AND product_id = item_record.product_id
                          AND storage_id = v_storage_id
                          AND lower(batch_number) = lower(v_batch_number)
                        ORDER BY COALESCE(is_deleted, false) ASC, created_at ASC NULLS LAST, id ASC
                        LIMIT 1
                        FOR UPDATE;
                    END IF;

                    IF v_target_batch_record IS NOT NULL THEN
                        UPDATE public.stock_batches
                        SET
                            quantity = COALESCE(v_target_batch_record.quantity, 0) + v_restore_quantity,
                            expiry_date = COALESCE(v_target_batch_record.expiry_date, v_batch_expiry_date),
                            manufacturing_date = COALESCE(v_target_batch_record.manufacturing_date, v_batch_manufacturing_date),
                            updated_at = NOW(),
                            version = COALESCE(version, 0) + 1,
                            is_deleted = false
                        WHERE id = v_target_batch_record.id;
                    ELSE
                        v_new_batch_id := CASE
                            WHEN v_batch_id IS NOT NULL
                              AND NOT EXISTS (
                                  SELECT 1
                                  FROM public.stock_batches
                                  WHERE id = v_batch_id
                              )
                            THEN v_batch_id
                            ELSE gen_random_uuid()
                        END;

                        INSERT INTO public.stock_batches (
                            id,
                            workspace_id,
                            product_id,
                            storage_id,
                            batch_number,
                            quantity,
                            expiry_date,
                            manufacturing_date,
                            created_at,
                            updated_at,
                            version,
                            is_deleted
                        )
                        VALUES (
                            v_new_batch_id,
                            p_workspace_id,
                            item_record.product_id,
                            v_storage_id,
                            v_batch_number,
                            v_restore_quantity,
                            v_batch_expiry_date,
                            v_batch_manufacturing_date,
                            NOW(),
                            NOW(),
                            1,
                            false
                        );
                    END IF;
                END IF;

                IF v_leftover_batch_quantity > 0 THEN
                    v_remaining_batch_allocations := v_remaining_batch_allocations || jsonb_build_array(
                        jsonb_build_object(
                            'batch_id', v_batch_id,
                            'batch_number', v_batch_number,
                            'quantity', v_leftover_batch_quantity,
                            'expiry_date', v_batch_expiry_date,
                            'manufacturing_date', v_batch_manufacturing_date
                        )
                    );
                END IF;

                v_remaining_to_restore := v_remaining_to_restore - v_restore_quantity;
            END LOOP;

            IF v_remaining_to_restore > 0 THEN
                RAISE EXCEPTION 'Return quantity exceeds stored batch allocations for sale item %', item_record.id;
            END IF;
        END IF;

        UPDATE public.sale_items
        SET
            storage_id = CASE
                WHEN storage_id IS NULL OR v_original_storage_missing THEN v_storage_id
                ELSE storage_id
            END,
            returned_quantity = COALESCE(returned_quantity, 0) + v_return_quantity,
            is_returned = (COALESCE(returned_quantity, 0) + v_return_quantity) >= quantity,
            return_reason = p_return_reason,
            returned_at = NOW(),
            returned_by = auth.uid(),
            batch_allocations = CASE
                WHEN jsonb_array_length(v_remaining_batch_allocations) > 0 THEN v_remaining_batch_allocations
                ELSE NULL
            END
        WHERE id = item_record.id;

        v_total_return_value := v_total_return_value + (
            v_return_quantity * COALESCE(item_record.converted_unit_price, item_record.unit_price, 0)
        );
    END LOOP;

    SELECT NOT EXISTS (
        SELECT 1
        FROM public.sale_items
        WHERE sale_id = v_sale_id
          AND COALESCE(returned_quantity, 0) < quantity
    )
    INTO v_sale_fully_returned;

    UPDATE public.sales
    SET
        total_amount = GREATEST(0, COALESCE(total_amount, 0) - v_total_return_value),
        is_returned = v_sale_fully_returned,
        return_reason = CASE WHEN v_sale_fully_returned THEN p_return_reason ELSE return_reason END,
        returned_at = CASE WHEN v_sale_fully_returned THEN NOW() ELSE returned_at END,
        returned_by = CASE WHEN v_sale_fully_returned THEN auth.uid() ELSE returned_by END,
        updated_at = timezone('utc', now())
    WHERE id = v_sale_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Items returned successfully',
        'return_value', v_total_return_value
    );
END;
$function$;
