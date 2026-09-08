-- Apply a manual stock adjustment as one authoritative, idempotent database
-- transaction. The inventory transaction id is the operation id, so retries
-- cannot change stock twice after a network timeout.
CREATE OR REPLACE FUNCTION public.apply_stock_adjustment(
  p_transaction jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_transaction_id uuid;
  v_workspace_id uuid;
  v_product_id uuid;
  v_storage_id uuid;
  v_delta numeric;
  v_previous_quantity numeric;
  v_new_quantity numeric;
  v_adjustment_reason text;
  v_reference_id text;
  v_reference_type text;
  v_notes text;
  v_created_at timestamptz;
  v_existing_transaction public.inventory_transactions%ROWTYPE;
  v_inventory public.inventory%ROWTYPE;
  v_transaction public.inventory_transactions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_transaction IS NULL OR pg_catalog.jsonb_typeof(p_transaction) <> 'object' THEN
    RAISE EXCEPTION 'Stock adjustment payload must be an object'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_transaction_id := NULLIF(pg_catalog.btrim(p_transaction->>'id'), '')::uuid;
    v_workspace_id := NULLIF(pg_catalog.btrim(p_transaction->>'workspace_id'), '')::uuid;
    v_product_id := NULLIF(pg_catalog.btrim(p_transaction->>'product_id'), '')::uuid;
    v_storage_id := NULLIF(pg_catalog.btrim(p_transaction->>'storage_id'), '')::uuid;
    v_delta := pg_catalog.round(NULLIF(pg_catalog.btrim(p_transaction->>'quantity_delta'), '')::numeric, 6);
    v_created_at := COALESCE(
      NULLIF(pg_catalog.btrim(p_transaction->>'created_at'), '')::timestamptz,
      pg_catalog.now()
    );
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Stock adjustment payload contains an invalid identifier, quantity, or timestamp'
        USING ERRCODE = '22023';
  END;

  IF v_transaction_id IS NULL
    OR v_workspace_id IS NULL
    OR v_product_id IS NULL
    OR v_storage_id IS NULL
  THEN
    RAISE EXCEPTION 'Stock adjustment identifiers are required'
      USING ERRCODE = '22023';
  END IF;

  IF v_workspace_id IS DISTINCT FROM public.current_workspace_id()
    OR public.current_user_role() NOT IN ('admin', 'staff')
  THEN
    RAISE EXCEPTION 'You are not allowed to adjust stock in this workspace'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.products
  WHERE id = v_product_id
    AND workspace_id = v_workspace_id
    AND COALESCE(is_deleted, false) = false
    AND COALESCE(is_service, false) = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock adjustment product is not an active inventory item in this workspace'
      USING ERRCODE = '23503';
  END IF;

  PERFORM 1
  FROM public.storages
  WHERE id = v_storage_id
    AND workspace_id = v_workspace_id
    AND COALESCE(is_deleted, false) = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock adjustment storage is not active in this workspace'
      USING ERRCODE = '23503';
  END IF;

  IF p_transaction->>'transaction_type' IS DISTINCT FROM 'stock_adjustment' THEN
    RAISE EXCEPTION 'Only stock adjustment transactions are accepted'
      USING ERRCODE = '22023';
  END IF;

  IF v_delta IS NULL
    OR v_delta::text IN ('NaN', 'Infinity', '-Infinity')
    OR pg_catalog.abs(v_delta) <= 0.0000005
  THEN
    RAISE EXCEPTION 'Stock adjustment quantity must be a finite non-zero value'
      USING ERRCODE = '22023';
  END IF;

  v_adjustment_reason := NULLIF(pg_catalog.btrim(p_transaction->>'adjustment_reason'), '');
  IF v_adjustment_reason IS NULL OR v_adjustment_reason NOT IN (
    'purchase',
    'return',
    'correction',
    'damage',
    'theft',
    'expired',
    'production',
    'other'
  ) THEN
    RAISE EXCEPTION 'Stock adjustment reason is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_reference_id := NULLIF(pg_catalog.btrim(p_transaction->>'reference_id'), '');
  v_reference_type := NULLIF(pg_catalog.btrim(p_transaction->>'reference_type'), '');
  v_notes := NULLIF(pg_catalog.btrim(p_transaction->>'notes'), '');

  -- Serialize retries of this operation before testing the append-only ledger.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stock-adjustment:' || v_transaction_id::text, 0)
  );

  SELECT *
  INTO v_existing_transaction
  FROM public.inventory_transactions
  WHERE id = v_transaction_id;

  IF FOUND THEN
    IF v_existing_transaction.workspace_id IS DISTINCT FROM v_workspace_id
      OR v_existing_transaction.product_id IS DISTINCT FROM v_product_id
      OR v_existing_transaction.storage_id IS DISTINCT FROM v_storage_id
      OR v_existing_transaction.transaction_type IS DISTINCT FROM 'stock_adjustment'
      OR pg_catalog.round(v_existing_transaction.quantity_delta, 6) IS DISTINCT FROM v_delta
      OR v_existing_transaction.adjustment_reason IS DISTINCT FROM v_adjustment_reason
    THEN
      RAISE EXCEPTION 'Stock adjustment id is already used by another operation'
        USING ERRCODE = '23505';
    END IF;

    SELECT *
    INTO v_inventory
    FROM public.inventory
    WHERE workspace_id = v_workspace_id
      AND product_id = v_product_id
      AND storage_id = v_storage_id;

    RETURN pg_catalog.jsonb_build_object(
      'transaction', pg_catalog.to_jsonb(v_existing_transaction),
      'inventory', pg_catalog.to_jsonb(v_inventory),
      'already_applied', true
    );
  END IF;

  -- A position-level lock also serializes two different adjustment ids aimed
  -- at the same stock row, including when that row does not exist yet.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'inventory:' || v_workspace_id::text || ':' || v_product_id::text || ':' || v_storage_id::text,
      0
    )
  );

  SELECT *
  INTO v_inventory
  FROM public.inventory
  WHERE workspace_id = v_workspace_id
    AND product_id = v_product_id
    AND storage_id = v_storage_id
  FOR UPDATE;

  v_previous_quantity := CASE
    WHEN FOUND AND COALESCE(v_inventory.is_deleted, false) = false
      THEN pg_catalog.round(COALESCE(v_inventory.quantity, 0), 6)
    ELSE 0::numeric
  END;
  v_new_quantity := pg_catalog.round(v_previous_quantity + v_delta, 6);

  IF v_new_quantity < -0.0000005 THEN
    RAISE EXCEPTION 'Insufficient inventory for this stock adjustment'
      USING ERRCODE = '23514';
  END IF;

  IF pg_catalog.abs(v_new_quantity) <= 0.0000005 THEN
    v_new_quantity := 0;
  END IF;

  INSERT INTO public.inventory (
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
    v_workspace_id,
    v_product_id,
    v_storage_id,
    v_new_quantity,
    pg_catalog.now(),
    pg_catalog.now(),
    1,
    v_new_quantity <= 0.0000005
  )
  ON CONFLICT (workspace_id, product_id, storage_id)
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    updated_at = pg_catalog.now(),
    version = COALESCE(public.inventory.version, 0) + 1,
    is_deleted = EXCLUDED.is_deleted
  RETURNING * INTO v_inventory;

  INSERT INTO public.inventory_transactions (
    id,
    workspace_id,
    product_id,
    storage_id,
    transaction_type,
    quantity_delta,
    previous_quantity,
    new_quantity,
    adjustment_reason,
    reference_id,
    reference_type,
    notes,
    created_by,
    created_at,
    updated_at,
    version,
    is_deleted
  )
  VALUES (
    v_transaction_id,
    v_workspace_id,
    v_product_id,
    v_storage_id,
    'stock_adjustment',
    v_delta,
    v_previous_quantity,
    v_new_quantity,
    v_adjustment_reason,
    v_reference_id,
    v_reference_type,
    v_notes,
    auth.uid()::text,
    v_created_at,
    pg_catalog.now(),
    1,
    false
  )
  RETURNING * INTO v_transaction;

  RETURN pg_catalog.jsonb_build_object(
    'transaction', pg_catalog.to_jsonb(v_transaction),
    'inventory', pg_catalog.to_jsonb(v_inventory),
    'already_applied', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_stock_adjustment(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_stock_adjustment(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_stock_adjustment(jsonb) TO authenticated, service_role;

-- Cloud stock-adjustment ledger writes must pass through the atomic function.
-- SELECT remains governed by the existing workspace RLS policy.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.inventory_transactions FROM anon, authenticated;
