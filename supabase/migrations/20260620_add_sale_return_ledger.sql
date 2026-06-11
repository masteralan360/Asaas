ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS original_total_amount numeric NULL,
  ADD COLUMN IF NOT EXISTS returned_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_status text NOT NULL DEFAULT 'none';

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS original_batch_allocations jsonb NULL;

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_return_status_check;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_return_status_check
  CHECK (return_status IN ('none', 'partial', 'full'));

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_returned_amount_check;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_returned_amount_check
  CHECK (returned_amount >= 0);

CREATE TABLE IF NOT EXISTS public.sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  refund_method text NULL,
  refund_amount numeric NOT NULL DEFAULT 0,
  returned_by uuid NULL,
  returned_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sale_returns_status_check CHECK (status IN ('posted', 'voided')),
  CONSTRAINT sale_returns_source_check CHECK (source IN ('app', 'legacy_backfill', 'system')),
  CONSTRAINT sale_returns_refund_amount_check CHECK (refund_amount >= 0)
);

CREATE TABLE IF NOT EXISTS public.sale_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  return_id uuid NOT NULL REFERENCES public.sale_returns(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  sale_item_id uuid NOT NULL REFERENCES public.sale_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  unit_refund_amount numeric NOT NULL DEFAULT 0,
  refund_amount numeric NOT NULL DEFAULT 0,
  restored_storage_id uuid NULL REFERENCES public.storages(id) ON DELETE SET NULL,
  restored_batch_allocations jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sale_return_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT sale_return_items_unit_refund_amount_check CHECK (unit_refund_amount >= 0),
  CONSTRAINT sale_return_items_refund_amount_check CHECK (refund_amount >= 0),
  CONSTRAINT sale_return_items_return_sale_item_key UNIQUE (return_id, sale_item_id)
);

CREATE INDEX IF NOT EXISTS sale_returns_workspace_returned_at_idx
  ON public.sale_returns (workspace_id, returned_at DESC);

CREATE INDEX IF NOT EXISTS sale_returns_sale_id_idx
  ON public.sale_returns (sale_id);

CREATE UNIQUE INDEX IF NOT EXISTS sale_returns_legacy_backfill_sale_idx
  ON public.sale_returns (sale_id)
  WHERE source = 'legacy_backfill';

CREATE INDEX IF NOT EXISTS sale_return_items_workspace_sale_idx
  ON public.sale_return_items (workspace_id, sale_id);

CREATE INDEX IF NOT EXISTS sale_return_items_return_id_idx
  ON public.sale_return_items (return_id);

CREATE INDEX IF NOT EXISTS sale_return_items_sale_item_id_idx
  ON public.sale_return_items (sale_item_id);

WITH legacy_sales AS (
  SELECT
    s.id AS sale_id,
    s.workspace_id,
    COALESCE(
      NULLIF(s.return_reason, ''),
      NULLIF(MAX(si.return_reason), ''),
      'Legacy return'
    ) AS reason,
    s.returned_by,
    COALESCE(s.returned_at, MAX(si.returned_at), s.updated_at, s.created_at, now()) AS returned_at,
    COALESCE(
      SUM(
        GREATEST(
          COALESCE(
            NULLIF(si.returned_quantity, 0),
            CASE WHEN COALESCE(si.is_returned, false) THEN si.quantity ELSE 0 END
          ),
          0
        )
        * COALESCE(si.converted_unit_price, si.unit_price, 0)
      ),
      0
    ) AS refund_amount
  FROM public.sales s
  JOIN public.sale_items si ON si.sale_id = s.id
  WHERE COALESCE(s.is_returned, false)
     OR COALESCE(si.returned_quantity, 0) > 0
     OR COALESCE(si.is_returned, false)
  GROUP BY
    s.id,
    s.workspace_id,
    s.return_reason,
    s.returned_by,
    s.returned_at,
    s.updated_at,
    s.created_at
)
INSERT INTO public.sale_returns (
  workspace_id,
  sale_id,
  reason,
  status,
  refund_amount,
  returned_by,
  returned_at,
  source,
  created_at,
  updated_at
)
SELECT
  workspace_id,
  sale_id,
  reason,
  'posted',
  refund_amount,
  returned_by,
  returned_at,
  'legacy_backfill',
  returned_at,
  returned_at
FROM legacy_sales
ON CONFLICT (sale_id) WHERE source = 'legacy_backfill' DO NOTHING;

INSERT INTO public.sale_return_items (
  workspace_id,
  return_id,
  sale_id,
  sale_item_id,
  quantity,
  unit_refund_amount,
  refund_amount,
  restored_storage_id,
  restored_batch_allocations,
  created_at,
  updated_at
)
SELECT
  legacy_return.workspace_id,
  legacy_return.id,
  legacy_return.sale_id,
  si.id,
  GREATEST(
    COALESCE(
      NULLIF(si.returned_quantity, 0),
      CASE WHEN COALESCE(si.is_returned, false) THEN si.quantity ELSE 0 END
    ),
    0
  ),
  COALESCE(si.converted_unit_price, si.unit_price, 0),
  GREATEST(
    COALESCE(
      NULLIF(si.returned_quantity, 0),
      CASE WHEN COALESCE(si.is_returned, false) THEN si.quantity ELSE 0 END
    ),
    0
  ) * COALESCE(si.converted_unit_price, si.unit_price, 0),
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.storages storage
      WHERE storage.id = si.storage_id
        AND storage.workspace_id = legacy_return.workspace_id
    )
    THEN si.storage_id
    ELSE NULL
  END,
  NULL,
  COALESCE(si.returned_at, now()),
  COALESCE(si.returned_at, now())
FROM public.sale_returns legacy_return
JOIN public.sale_items si
  ON si.sale_id = legacy_return.sale_id
WHERE legacy_return.source = 'legacy_backfill'
  AND (
    COALESCE(si.returned_quantity, 0) > 0
    OR COALESCE(si.is_returned, false)
  )
ON CONFLICT (return_id, sale_item_id) DO NOTHING;

WITH return_totals AS (
  SELECT
    sale_id,
    COALESCE(SUM(refund_amount), 0) AS returned_amount
  FROM public.sale_returns
  WHERE status = 'posted'
  GROUP BY sale_id
)
UPDATE public.sales s
SET
  returned_amount = COALESCE(return_totals.returned_amount, 0),
  original_total_amount = COALESCE(
    s.original_total_amount,
    COALESCE(s.total_amount, 0) + COALESCE(return_totals.returned_amount, 0)
  ),
  return_status = CASE
    WHEN COALESCE(s.is_returned, false) THEN 'full'
    WHEN COALESCE(return_totals.returned_amount, 0) > 0 THEN 'partial'
    ELSE 'none'
  END
FROM return_totals
WHERE return_totals.sale_id = s.id;

UPDATE public.sales
SET original_total_amount = COALESCE(original_total_amount, total_amount, 0)
WHERE original_total_amount IS NULL;

UPDATE public.sale_items
SET original_batch_allocations = batch_allocations
WHERE original_batch_allocations IS NULL
  AND batch_allocations IS NOT NULL;

ALTER TABLE public.sales
  ALTER COLUMN original_total_amount SET NOT NULL;

CREATE OR REPLACE FUNCTION public.capture_sale_original_values()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_total_amount := COALESCE(NEW.original_total_amount, NEW.total_amount, 0);
  ELSE
    NEW.original_total_amount := OLD.original_total_amount;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS capture_sale_original_values ON public.sales;
CREATE TRIGGER capture_sale_original_values
BEFORE INSERT OR UPDATE ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.capture_sale_original_values();

CREATE OR REPLACE FUNCTION public.capture_sale_item_original_batch_allocations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_batch_allocations := COALESCE(
      NEW.original_batch_allocations,
      NEW.batch_allocations
    );
  ELSE
    NEW.original_batch_allocations := OLD.original_batch_allocations;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS capture_sale_item_original_batch_allocations ON public.sale_items;
CREATE TRIGGER capture_sale_item_original_batch_allocations
BEFORE INSERT OR UPDATE ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.capture_sale_item_original_batch_allocations();

ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_returns_select ON public.sale_returns;
CREATE POLICY sale_returns_select
  ON public.sale_returns
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS sale_return_items_select ON public.sale_return_items;
CREATE POLICY sale_return_items_select
  ON public.sale_return_items
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.current_workspace_id());

GRANT SELECT ON public.sale_returns TO authenticated;
GRANT SELECT ON public.sale_return_items TO authenticated;

CREATE OR REPLACE FUNCTION public.process_sale_return(
  p_return_id uuid,
  p_sale_id uuid,
  p_items jsonb,
  p_return_reason text,
  p_refund_method text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sale_record RECORD;
  v_existing_return RECORD;
  v_item_record RECORD;
  v_item_payload jsonb;
  v_batch_allocation jsonb;
  v_target_batch_record RECORD;
  v_workspace_id uuid;
  v_user_role text;
  v_plan text;
  v_pos boolean;
  v_requested_quantity integer;
  v_return_quantity integer;
  v_storage_id uuid;
  v_primary_storage_id uuid;
  v_original_storage_missing boolean := false;
  v_total_return_value numeric := 0;
  v_unit_refund_amount numeric := 0;
  v_line_refund_amount numeric := 0;
  v_sale_fully_returned boolean := false;
  v_processed_items integer := 0;
  v_existing_batch_allocations jsonb := '[]'::jsonb;
  v_remaining_batch_allocations jsonb := '[]'::jsonb;
  v_restored_batch_allocations jsonb := '[]'::jsonb;
  v_remaining_to_restore integer := 0;
  v_batch_quantity integer := 0;
  v_restore_quantity integer := 0;
  v_leftover_batch_quantity integer := 0;
  v_batch_id uuid;
  v_restored_batch_id uuid;
  v_batch_number text;
  v_batch_price numeric;
  v_batch_cost_price numeric;
  v_batch_currency text;
  v_batch_expiry_date date;
  v_batch_manufacturing_date date;
  v_new_batch_id uuid;
  v_line_id uuid;
  v_return_lines jsonb := '[]'::jsonb;
BEGIN
  IF p_return_id IS NULL THEN
    RAISE EXCEPTION 'Return ID is required';
  END IF;

  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale ID is required';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one return item is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT value->>'sale_item_id' AS sale_item_id, COUNT(*) AS item_count
      FROM jsonb_array_elements(p_items)
      GROUP BY value->>'sale_item_id'
    ) duplicate_items
    WHERE duplicate_items.sale_item_id IS NULL
       OR duplicate_items.item_count > 1
  ) THEN
    RAISE EXCEPTION 'Return items must contain unique sale item IDs';
  END IF;

  SELECT *
  INTO v_sale_record
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  v_workspace_id := v_sale_record.workspace_id;

  SELECT role
  INTO v_user_role
  FROM public.profiles
  WHERE id = auth.uid()
    AND workspace_id = v_workspace_id;

  IF v_user_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized: Only admins and staff can return items';
  END IF;

  SELECT plan
  INTO v_plan
  FROM public.workspaces
  WHERE id = v_workspace_id;

  v_pos := public.workspace_module_allowed(v_workspace_id, v_plan, 'pos');

  IF NOT COALESCE(v_pos, false) THEN
    RAISE EXCEPTION 'POS feature is not enabled for this workspace';
  END IF;

  SELECT *
  INTO v_existing_return
  FROM public.sale_returns
  WHERE id = p_return_id;

  IF FOUND THEN
    IF v_existing_return.sale_id IS DISTINCT FROM p_sale_id
       OR v_existing_return.workspace_id IS DISTINCT FROM v_workspace_id THEN
      RAISE EXCEPTION 'Return ID is already assigned to another sale';
    END IF;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', sri.id,
          'sale_item_id', sri.sale_item_id,
          'quantity', sri.quantity,
          'refund_amount', sri.refund_amount,
          'restored_storage_id', sri.restored_storage_id,
          'restored_batch_allocations', sri.restored_batch_allocations
        )
        ORDER BY sri.created_at, sri.id
      ),
      '[]'::jsonb
    )
    INTO v_return_lines
    FROM public.sale_return_items sri
    WHERE sri.return_id = p_return_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Return already processed',
      'return_id', p_return_id,
      'return_value', v_existing_return.refund_amount,
      'items', v_return_lines,
      'idempotent_replay', true
    );
  END IF;

  v_primary_storage_id := public.ensure_primary_storage(v_workspace_id);

  INSERT INTO public.sale_returns (
    id,
    workspace_id,
    sale_id,
    reason,
    status,
    refund_method,
    refund_amount,
    returned_by,
    returned_at,
    source,
    created_at,
    updated_at
  )
  VALUES (
    p_return_id,
    v_workspace_id,
    p_sale_id,
    COALESCE(NULLIF(BTRIM(p_return_reason), ''), 'Return'),
    'posted',
    NULLIF(BTRIM(p_refund_method), ''),
    0,
    auth.uid(),
    now(),
    'app',
    now(),
    timezone('utc', now())
  );

  FOR v_item_payload IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    SELECT si.*
    INTO v_item_record
    FROM public.sale_items si
    WHERE si.id = NULLIF(v_item_payload->>'sale_item_id', '')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale item not found';
    END IF;

    IF v_item_record.sale_id IS DISTINCT FROM p_sale_id THEN
      RAISE EXCEPTION 'Selected sale items must belong to the requested sale';
    END IF;

    v_requested_quantity := COALESCE((v_item_payload->>'quantity')::integer, 0);

    IF v_requested_quantity <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be greater than zero';
    END IF;

    IF v_requested_quantity > (
      v_item_record.quantity - COALESCE(v_item_record.returned_quantity, 0)
    ) THEN
      RAISE EXCEPTION 'Return quantity exceeds the remaining quantity for sale item %', v_item_record.id;
    END IF;

    v_return_quantity := v_requested_quantity;
    v_storage_id := v_item_record.storage_id;
    v_original_storage_missing := false;

    IF v_storage_id IS NOT NULL THEN
      PERFORM 1
      FROM public.storages
      WHERE id = v_storage_id
        AND workspace_id = v_workspace_id
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
       AND st.workspace_id = v_workspace_id
       AND COALESCE(st.is_deleted, false) = false
      WHERE i.workspace_id = v_workspace_id
        AND i.product_id = v_item_record.product_id
        AND COALESCE(i.is_deleted, false) = false;
    END IF;

    IF v_storage_id IS NULL THEN
      SELECT p.storage_id
      INTO v_storage_id
      FROM public.products p
      JOIN public.storages st
        ON st.id = p.storage_id
       AND st.workspace_id = v_workspace_id
       AND COALESCE(st.is_deleted, false) = false
      WHERE p.id = v_item_record.product_id
        AND p.workspace_id = v_workspace_id;
    END IF;

    IF v_storage_id IS NULL THEN
      v_storage_id := v_primary_storage_id;
    END IF;

    IF v_storage_id IS NULL THEN
      RAISE EXCEPTION 'Storage not found for returned product %', v_item_record.product_id;
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
      v_workspace_id,
      v_item_record.product_id,
      v_storage_id,
      v_return_quantity,
      now(),
      now(),
      1,
      false
    )
    ON CONFLICT (workspace_id, product_id, storage_id) DO UPDATE
    SET
      quantity = public.inventory.quantity + EXCLUDED.quantity,
      updated_at = now(),
      version = COALESCE(public.inventory.version, 0) + 1,
      is_deleted = false;

    v_existing_batch_allocations := CASE
      WHEN jsonb_typeof(v_item_record.batch_allocations) = 'array'
        THEN v_item_record.batch_allocations
      ELSE '[]'::jsonb
    END;
    v_remaining_batch_allocations := '[]'::jsonb;
    v_restored_batch_allocations := '[]'::jsonb;

    IF jsonb_array_length(v_existing_batch_allocations) > 0 THEN
      v_remaining_to_restore := v_return_quantity;

      FOR v_batch_allocation IN
        SELECT value
        FROM jsonb_array_elements(v_existing_batch_allocations)
      LOOP
        v_batch_quantity := COALESCE((v_batch_allocation->>'quantity')::integer, 0);
        v_restore_quantity := LEAST(v_remaining_to_restore, v_batch_quantity);
        v_leftover_batch_quantity := GREATEST(v_batch_quantity - v_restore_quantity, 0);
        v_batch_id := NULLIF(v_batch_allocation->>'batch_id', '')::uuid;
        v_batch_number := COALESCE(
          NULLIF(v_batch_allocation->>'batch_number', ''),
          'Restored Batch'
        );
        v_batch_price := NULLIF(v_batch_allocation->>'price', '')::numeric;
        v_batch_cost_price := NULLIF(v_batch_allocation->>'cost_price', '')::numeric;
        v_batch_currency := lower(
          COALESCE(NULLIF(v_batch_allocation->>'currency', ''), 'usd')
        );
        v_batch_expiry_date := NULLIF(v_batch_allocation->>'expiry_date', '')::date;
        v_batch_manufacturing_date := NULLIF(
          v_batch_allocation->>'manufacturing_date',
          ''
        )::date;
        v_target_batch_record := NULL;
        v_restored_batch_id := NULL;

        IF v_restore_quantity > 0 THEN
          IF v_batch_id IS NOT NULL THEN
            SELECT *
            INTO v_target_batch_record
            FROM public.stock_batches
            WHERE id = v_batch_id
              AND workspace_id = v_workspace_id
              AND product_id = v_item_record.product_id
              AND storage_id = v_storage_id
            FOR UPDATE;
          END IF;

          IF v_target_batch_record IS NULL THEN
            SELECT *
            INTO v_target_batch_record
            FROM public.stock_batches
            WHERE workspace_id = v_workspace_id
              AND product_id = v_item_record.product_id
              AND storage_id = v_storage_id
              AND lower(batch_number) = lower(v_batch_number)
            ORDER BY COALESCE(is_deleted, false) ASC, created_at ASC NULLS LAST, id ASC
            LIMIT 1
            FOR UPDATE;
          END IF;

          IF v_target_batch_record IS NOT NULL THEN
            v_restored_batch_id := v_target_batch_record.id;

            UPDATE public.stock_batches
            SET
              quantity = COALESCE(v_target_batch_record.quantity, 0) + v_restore_quantity,
              price = COALESCE(v_target_batch_record.price, v_batch_price),
              cost_price = COALESCE(v_target_batch_record.cost_price, v_batch_cost_price),
              currency = lower(COALESCE(v_target_batch_record.currency, v_batch_currency, 'usd')),
              expiry_date = COALESCE(v_target_batch_record.expiry_date, v_batch_expiry_date),
              manufacturing_date = COALESCE(
                v_target_batch_record.manufacturing_date,
                v_batch_manufacturing_date
              ),
              updated_at = now(),
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
            v_restored_batch_id := v_new_batch_id;

            INSERT INTO public.stock_batches (
              id,
              workspace_id,
              product_id,
              storage_id,
              batch_number,
              quantity,
              price,
              cost_price,
              currency,
              expiry_date,
              manufacturing_date,
              created_at,
              updated_at,
              version,
              is_deleted
            )
            VALUES (
              v_new_batch_id,
              v_workspace_id,
              v_item_record.product_id,
              v_storage_id,
              v_batch_number,
              v_restore_quantity,
              v_batch_price,
              v_batch_cost_price,
              v_batch_currency,
              v_batch_expiry_date,
              v_batch_manufacturing_date,
              now(),
              now(),
              1,
              false
            );
          END IF;

          v_restored_batch_allocations := v_restored_batch_allocations || jsonb_build_array(
            jsonb_build_object(
              'batch_id', v_restored_batch_id,
              'batch_number', v_batch_number,
              'quantity', v_restore_quantity,
              'price', v_batch_price,
              'cost_price', v_batch_cost_price,
              'currency', v_batch_currency,
              'expiry_date', v_batch_expiry_date,
              'manufacturing_date', v_batch_manufacturing_date
            )
          );
        END IF;

        IF v_leftover_batch_quantity > 0 THEN
          v_remaining_batch_allocations := v_remaining_batch_allocations || jsonb_build_array(
            jsonb_build_object(
              'batch_id', v_batch_id,
              'batch_number', v_batch_number,
              'quantity', v_leftover_batch_quantity,
              'price', v_batch_price,
              'cost_price', v_batch_cost_price,
              'currency', v_batch_currency,
              'expiry_date', v_batch_expiry_date,
              'manufacturing_date', v_batch_manufacturing_date
            )
          );
        END IF;

        v_remaining_to_restore := v_remaining_to_restore - v_restore_quantity;
      END LOOP;

      IF v_remaining_to_restore > 0 THEN
        RAISE EXCEPTION 'Return quantity exceeds stored batch allocations for sale item %', v_item_record.id;
      END IF;
    END IF;

    v_unit_refund_amount := COALESCE(
      v_item_record.converted_unit_price,
      v_item_record.unit_price,
      0
    );
    v_line_refund_amount := v_return_quantity * v_unit_refund_amount;
    v_line_id := COALESCE(
      NULLIF(v_item_payload->>'id', '')::uuid,
      gen_random_uuid()
    );

    INSERT INTO public.sale_return_items (
      id,
      workspace_id,
      return_id,
      sale_id,
      sale_item_id,
      quantity,
      unit_refund_amount,
      refund_amount,
      restored_storage_id,
      restored_batch_allocations,
      created_at,
      updated_at
    )
    VALUES (
      v_line_id,
      v_workspace_id,
      p_return_id,
      p_sale_id,
      v_item_record.id,
      v_return_quantity,
      v_unit_refund_amount,
      v_line_refund_amount,
      v_storage_id,
      CASE
        WHEN jsonb_array_length(v_restored_batch_allocations) > 0
          THEN v_restored_batch_allocations
        ELSE NULL
      END,
      now(),
      timezone('utc', now())
    );

    UPDATE public.sale_items
    SET
      storage_id = CASE
        WHEN storage_id IS NULL OR v_original_storage_missing THEN v_storage_id
        ELSE storage_id
      END,
      original_batch_allocations = COALESCE(
        original_batch_allocations,
        v_item_record.batch_allocations
      ),
      returned_quantity = COALESCE(returned_quantity, 0) + v_return_quantity,
      is_returned = (
        COALESCE(returned_quantity, 0) + v_return_quantity
      ) >= quantity,
      return_reason = COALESCE(NULLIF(BTRIM(p_return_reason), ''), 'Return'),
      returned_at = now(),
      returned_by = auth.uid(),
      batch_allocations = CASE
        WHEN jsonb_array_length(v_remaining_batch_allocations) > 0
          THEN v_remaining_batch_allocations
        ELSE NULL
      END
    WHERE id = v_item_record.id;

    v_total_return_value := v_total_return_value + v_line_refund_amount;
    v_processed_items := v_processed_items + 1;
    v_return_lines := v_return_lines || jsonb_build_array(
      jsonb_build_object(
        'id', v_line_id,
        'sale_item_id', v_item_record.id,
        'quantity', v_return_quantity,
        'unit_refund_amount', v_unit_refund_amount,
        'refund_amount', v_line_refund_amount,
        'restored_storage_id', v_storage_id,
        'restored_batch_allocations', CASE
          WHEN jsonb_array_length(v_restored_batch_allocations) > 0
            THEN v_restored_batch_allocations
          ELSE NULL
        END
      )
    );
  END LOOP;

  IF v_processed_items = 0 THEN
    RAISE EXCEPTION 'No returnable items were processed';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.sale_items
    WHERE sale_id = p_sale_id
      AND COALESCE(returned_quantity, 0) < quantity
  )
  INTO v_sale_fully_returned;

  UPDATE public.sales
  SET
    original_total_amount = COALESCE(original_total_amount, total_amount, 0),
    total_amount = GREATEST(0, COALESCE(total_amount, 0) - v_total_return_value),
    returned_amount = COALESCE(returned_amount, 0) + v_total_return_value,
    return_status = CASE WHEN v_sale_fully_returned THEN 'full' ELSE 'partial' END,
    is_returned = v_sale_fully_returned,
    return_reason = CASE
      WHEN v_sale_fully_returned
        THEN COALESCE(NULLIF(BTRIM(p_return_reason), ''), 'Return')
      ELSE return_reason
    END,
    returned_at = CASE WHEN v_sale_fully_returned THEN now() ELSE returned_at END,
    returned_by = CASE WHEN v_sale_fully_returned THEN auth.uid() ELSE returned_by END,
    updated_at = timezone('utc', now())
  WHERE id = p_sale_id;

  UPDATE public.sale_returns
  SET
    refund_amount = v_total_return_value,
    updated_at = timezone('utc', now())
  WHERE id = p_return_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Items returned successfully',
    'return_id', p_return_id,
    'return_value', v_total_return_value,
    'items', v_return_lines,
    'idempotent_replay', false
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
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sale_id uuid;
  v_items jsonb;
BEGIN
  IF p_sale_item_ids IS NULL
     OR array_length(p_sale_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No items selected for return';
  END IF;

  IF p_return_quantities IS NULL
     OR array_length(p_return_quantities, 1)
        IS DISTINCT FROM array_length(p_sale_item_ids, 1) THEN
    RAISE EXCEPTION 'Return quantities must match selected sale items';
  END IF;

  SELECT sale_id
  INTO v_sale_id
  FROM public.sale_items
  WHERE id = p_sale_item_ids[1];

  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale items not found';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', gen_random_uuid(),
      'sale_item_id', item_id,
      'quantity', return_quantity
    )
  )
  INTO v_items
  FROM unnest(p_sale_item_ids, p_return_quantities)
    AS requested_items(item_id, return_quantity);

  RETURN public.process_sale_return(
    gen_random_uuid(),
    v_sale_id,
    v_items,
    p_return_reason,
    NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.return_whole_sale(
  p_sale_id uuid,
  p_return_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_workspace_id uuid;
  v_user_role text;
  v_items jsonb;
BEGIN
  SELECT s.workspace_id, p.role
  INTO v_workspace_id, v_user_role
  FROM public.sales s
  JOIN public.profiles p
    ON p.id = auth.uid()
   AND p.workspace_id = s.workspace_id
  WHERE s.id = p_sale_id;

  IF v_user_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can return whole sales';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', gen_random_uuid(),
      'sale_item_id', id,
      'quantity', quantity - COALESCE(returned_quantity, 0)
    )
  )
  INTO v_items
  FROM public.sale_items
  WHERE sale_id = p_sale_id
    AND quantity - COALESCE(returned_quantity, 0) > 0;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'No returnable items found in this sale';
  END IF;

  RETURN public.process_sale_return(
    gen_random_uuid(),
    p_sale_id,
    v_items,
    p_return_reason,
    NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.process_sale_return(uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_sale_return(uuid, uuid, jsonb, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.return_sale_items(uuid[], integer[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_sale_items(uuid[], integer[], text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.return_whole_sale(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_whole_sale(uuid, text)
  TO authenticated, service_role;
