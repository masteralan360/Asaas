-- A delivered COD can only be corrected before its per-post settlement has
-- started. Keep the new value, its two signed obligation deltas, and the
-- administrator who made the correction together in one database operation.

CREATE TABLE IF NOT EXISTS delivery.delivery_shipment_cod_corrections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES delivery.delivery_shipments(id) ON DELETE RESTRICT,
  currency text NOT NULL,
  original_cod_amount numeric NOT NULL CHECK (original_cod_amount >= 0),
  corrected_cod_amount numeric NOT NULL CHECK (corrected_cod_amount > 0),
  corrected_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  courier_ledger_entry_id uuid NULL REFERENCES delivery.delivery_ledger_entries(id) ON DELETE RESTRICT,
  merchant_ledger_entry_id uuid NULL REFERENCES delivery.delivery_ledger_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_shipment_cod_correction_amounts_differ
    CHECK (corrected_cod_amount <> original_cod_amount),
  CONSTRAINT delivery_shipment_cod_correction_distinct_ledger_entries
    CHECK (
      courier_ledger_entry_id IS NULL
      OR merchant_ledger_entry_id IS NULL
      OR courier_ledger_entry_id <> merchant_ledger_entry_id
    )
);

CREATE INDEX IF NOT EXISTS delivery_shipment_cod_corrections_by_shipment
  ON delivery.delivery_shipment_cod_corrections (workspace_id, shipment_id, corrected_at DESC)
  WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_shipment_cod_corrections_courier_ledger_unique
  ON delivery.delivery_shipment_cod_corrections (courier_ledger_entry_id)
  WHERE courier_ledger_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_shipment_cod_corrections_merchant_ledger_unique
  ON delivery.delivery_shipment_cod_corrections (merchant_ledger_entry_id)
  WHERE merchant_ledger_entry_id IS NOT NULL;

ALTER TABLE delivery.delivery_ledger_entries
  ADD COLUMN IF NOT EXISTS cod_correction_id uuid NULL
    REFERENCES delivery.delivery_shipment_cod_corrections(id) ON DELETE RESTRICT;

ALTER TABLE delivery.delivery_ledger_entries
  DROP CONSTRAINT IF EXISTS delivery_ledger_entries_kind_check,
  ADD CONSTRAINT delivery_ledger_entries_kind_check
    CHECK (kind IN (
      'courier_collection',
      'courier_cod_correction',
      'courier_delivery_fee',
      'courier_recipient_advance',
      'courier_remittance',
      'courier_fee_payout',
      'courier_reimbursement',
      'merchant_cod_payable',
      'merchant_cod_correction',
      'merchant_fee',
      'merchant_recipient_payout',
      'merchant_payout',
      'merchant_repayment',
      'adjustment'
    )),
  DROP CONSTRAINT IF EXISTS delivery_ledger_party_check,
  ADD CONSTRAINT delivery_ledger_party_check
    CHECK (
      (
        kind IN (
          'courier_collection',
          'courier_cod_correction',
          'courier_delivery_fee',
          'courier_recipient_advance',
          'courier_remittance',
          'courier_fee_payout',
          'courier_reimbursement'
        )
        AND agent_id IS NOT NULL
        AND merchant_profile_id IS NULL
      )
      OR (
        kind IN (
          'merchant_cod_payable',
          'merchant_cod_correction',
          'merchant_fee',
          'merchant_recipient_payout',
          'merchant_payout',
          'merchant_repayment'
        )
        AND merchant_profile_id IS NOT NULL
        AND agent_id IS NULL
      )
      OR kind = 'adjustment'
    ),
  DROP CONSTRAINT IF EXISTS delivery_ledger_cod_correction_link_check,
  ADD CONSTRAINT delivery_ledger_cod_correction_link_check
    CHECK (
      (
        kind IN ('courier_cod_correction', 'merchant_cod_correction')
        AND cod_correction_id IS NOT NULL
      )
      OR (
        kind NOT IN ('courier_cod_correction', 'merchant_cod_correction')
        AND cod_correction_id IS NULL
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS delivery_one_courier_cod_correction_entry
  ON delivery.delivery_ledger_entries (cod_correction_id)
  WHERE kind = 'courier_cod_correction' AND NOT is_deleted;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_one_merchant_cod_correction_entry
  ON delivery.delivery_ledger_entries (cod_correction_id)
  WHERE kind = 'merchant_cod_correction' AND NOT is_deleted;

-- Match the client-side per-party FIFO settlement calculation. The function
-- returns true only when the requested post still has a positive obligation
-- and none of that obligation has been cleared.
CREATE OR REPLACE FUNCTION delivery.delivery_obligation_is_fully_outstanding(
  p_workspace_id uuid,
  p_party_id uuid,
  p_currency text,
  p_shipment_id uuid,
  p_party_type text,
  p_obligation_kinds text[],
  p_clearing_kinds text[],
  p_invert_obligation boolean DEFAULT false,
  p_invert_clearing boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  epsilon constant numeric := 0.000001;
  obligation record;
  clearance record;
  shipment_ids uuid[] := ARRAY[]::uuid[];
  obligation_amounts numeric[] := ARRAY[]::numeric[];
  remaining_amounts numeric[] := ARRAY[]::numeric[];
  target_index integer;
  matching_index integer;
  index integer;
  credit numeric;
  amount_to_clear numeric;
BEGIN
  IF p_party_type NOT IN ('agent', 'merchant') THEN
    RAISE EXCEPTION 'Invalid delivery settlement party type' USING ERRCODE = '22023';
  END IF;

  FOR obligation IN
    SELECT
      ledger.shipment_id,
      SUM(CASE WHEN p_invert_obligation THEN -ledger.amount ELSE ledger.amount END) AS amount,
      MIN(ledger.occurred_at) AS occurred_at
    FROM delivery.delivery_ledger_entries AS ledger
    WHERE ledger.workspace_id = p_workspace_id
      AND ledger.currency = p_currency
      AND NOT ledger.is_deleted
      AND ledger.shipment_id IS NOT NULL
      AND ledger.kind = ANY(p_obligation_kinds)
      AND (
        (p_party_type = 'agent' AND ledger.agent_id = p_party_id)
        OR (p_party_type = 'merchant' AND ledger.merchant_profile_id = p_party_id)
      )
    GROUP BY ledger.shipment_id
    HAVING SUM(CASE WHEN p_invert_obligation THEN -ledger.amount ELSE ledger.amount END) > epsilon
    ORDER BY MIN(ledger.occurred_at), ledger.shipment_id
  LOOP
    shipment_ids := array_append(shipment_ids, obligation.shipment_id);
    obligation_amounts := array_append(obligation_amounts, obligation.amount);
    remaining_amounts := array_append(remaining_amounts, obligation.amount);
  END LOOP;

  target_index := array_position(shipment_ids, p_shipment_id);
  IF target_index IS NULL THEN
    RETURN false;
  END IF;

  FOR clearance IN
    SELECT
      ledger.shipment_id,
      CASE WHEN p_invert_clearing THEN ledger.amount ELSE -ledger.amount END AS credit
    FROM delivery.delivery_ledger_entries AS ledger
    WHERE ledger.workspace_id = p_workspace_id
      AND ledger.currency = p_currency
      AND NOT ledger.is_deleted
      AND ledger.kind = ANY(p_clearing_kinds)
      AND (
        (p_party_type = 'agent' AND ledger.agent_id = p_party_id)
        OR (p_party_type = 'merchant' AND ledger.merchant_profile_id = p_party_id)
      )
    ORDER BY ledger.occurred_at, ledger.created_at, ledger.id
  LOOP
    credit := clearance.credit;
    IF credit <= epsilon THEN
      CONTINUE;
    END IF;

    IF clearance.shipment_id IS NOT NULL THEN
      matching_index := array_position(shipment_ids, clearance.shipment_id);
      IF matching_index IS NOT NULL AND remaining_amounts[matching_index] > epsilon THEN
        amount_to_clear := LEAST(remaining_amounts[matching_index], credit);
        remaining_amounts[matching_index] := remaining_amounts[matching_index] - amount_to_clear;
        credit := credit - amount_to_clear;
      END IF;
    END IF;

    FOR index IN 1..COALESCE(array_length(shipment_ids, 1), 0) LOOP
      EXIT WHEN credit <= epsilon;
      IF remaining_amounts[index] <= epsilon THEN
        CONTINUE;
      END IF;
      amount_to_clear := LEAST(remaining_amounts[index], credit);
      remaining_amounts[index] := remaining_amounts[index] - amount_to_clear;
      credit := credit - amount_to_clear;
    END LOOP;
  END LOOP;

  RETURN remaining_amounts[target_index] >= obligation_amounts[target_index] - epsilon;
END;
$$;

CREATE OR REPLACE FUNCTION delivery.guard_delivered_shipment_cod_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'delivered'
    AND NEW.cod_amount IS DISTINCT FROM OLD.cod_amount
    AND COALESCE(current_setting('delivery.allow_delivered_cod_correction', true), '') <> 'enabled'
  THEN
    RAISE EXCEPTION 'Use the delivered COD correction action before settlement begins'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_guard_delivered_shipment_cod_change ON delivery.delivery_shipments;
CREATE TRIGGER delivery_guard_delivered_shipment_cod_change
  BEFORE UPDATE ON delivery.delivery_shipments
  FOR EACH ROW EXECUTE FUNCTION delivery.guard_delivered_shipment_cod_change();

CREATE OR REPLACE FUNCTION delivery.assert_delivered_cod_correction_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  correction delivery.delivery_shipment_cod_corrections%ROWTYPE;
  shipment delivery.delivery_shipments%ROWTYPE;
  expected_delta numeric;
BEGIN
  IF NEW.kind NOT IN ('courier_cod_correction', 'merchant_cod_correction') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('delivery.allow_delivered_cod_correction', true), '') <> 'enabled' THEN
    RAISE EXCEPTION 'Delivered COD correction ledger entries can only be created by the correction action'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO correction
  FROM delivery.delivery_shipment_cod_corrections
  WHERE id = NEW.cod_correction_id
    AND workspace_id = NEW.workspace_id
    AND NOT is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivered COD correction ledger entry must reference its audit record'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO shipment
  FROM delivery.delivery_shipments
  WHERE id = correction.shipment_id
    AND workspace_id = correction.workspace_id
    AND NOT is_deleted;
  IF NOT FOUND
    OR shipment.status <> 'delivered'
    OR shipment.cod_amount IS DISTINCT FROM correction.corrected_cod_amount
  THEN
    RAISE EXCEPTION 'Delivered COD correction does not match the shipment state'
      USING ERRCODE = '23514';
  END IF;

  expected_delta := correction.corrected_cod_amount - correction.original_cod_amount;
  IF NEW.shipment_id IS DISTINCT FROM correction.shipment_id
    OR NEW.currency IS DISTINCT FROM correction.currency
    OR NEW.settlement_id IS NOT NULL
    OR NEW.amount IS DISTINCT FROM expected_delta
    OR NEW.created_by IS DISTINCT FROM correction.corrected_by
  THEN
    RAISE EXCEPTION 'Delivered COD correction ledger entry does not match its audit record'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'courier_cod_correction' AND (
    NEW.agent_id IS DISTINCT FROM shipment.assigned_agent_id
    OR NEW.merchant_profile_id IS NOT NULL
    OR NEW.business_partner_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Courier COD correction must belong to the delivering courier'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'merchant_cod_correction' AND (
    NEW.agent_id IS NOT NULL
    OR NEW.merchant_profile_id IS DISTINCT FROM shipment.merchant_profile_id
    OR NEW.business_partner_id IS DISTINCT FROM shipment.merchant_business_partner_id
  ) THEN
    RAISE EXCEPTION 'Merchant COD correction must belong to the shipment merchant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_assert_delivered_cod_correction_ledger_entry
  ON delivery.delivery_ledger_entries;
CREATE TRIGGER delivery_assert_delivered_cod_correction_ledger_entry
  BEFORE INSERT OR UPDATE ON delivery.delivery_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION delivery.assert_delivered_cod_correction_ledger_entry();

CREATE OR REPLACE FUNCTION delivery.correct_delivered_shipment_cod(
  p_workspace_id uuid,
  p_shipment_id uuid,
  p_expected_version bigint,
  p_corrected_cod_amount numeric,
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  shipment delivery.delivery_shipments%ROWTYPE;
  existing_correction delivery.delivery_shipment_cod_corrections%ROWTYPE;
  correction delivery.delivery_shipment_cod_corrections%ROWTYPE;
  correction_delta numeric;
  now_at timestamptz := now();
  v_courier_ledger_entry_id uuid := gen_random_uuid();
  v_merchant_ledger_entry_id uuid := gen_random_uuid();
  courier_is_outstanding boolean;
  merchant_is_outstanding boolean;
BEGIN
  IF auth.uid() IS NULL
    OR public.current_user_role() IS DISTINCT FROM 'admin'
    OR p_workspace_id IS DISTINCT FROM public.current_workspace_id()
    OR NOT delivery.module_allowed(p_workspace_id)
  THEN
    RAISE EXCEPTION 'Only an administrator can correct a delivered COD amount'
      USING ERRCODE = '42501';
  END IF;

  IF p_corrected_cod_amount IS NULL OR p_corrected_cod_amount <= 0 THEN
    RAISE EXCEPTION 'Corrected COD amount must be greater than zero' USING ERRCODE = '23514';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'A delivered COD correction operation ID is required' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO existing_correction
  FROM delivery.delivery_shipment_cod_corrections
  WHERE id = p_operation_id;
  IF FOUND THEN
    IF existing_correction.workspace_id <> p_workspace_id
      OR existing_correction.shipment_id <> p_shipment_id
      OR existing_correction.corrected_cod_amount <> p_corrected_cod_amount
    THEN
      RAISE EXCEPTION 'This delivered COD correction operation cannot be reused'
        USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'shipment_id', existing_correction.shipment_id,
      'correction_id', existing_correction.id
    );
  END IF;

  SELECT * INTO shipment
  FROM delivery.delivery_shipments
  WHERE id = p_shipment_id
    AND workspace_id = p_workspace_id
    AND NOT is_deleted
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment not found' USING ERRCODE = 'P0002';
  END IF;
  IF shipment.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'This post has changed. Refresh it before correcting the COD'
      USING ERRCODE = '23514';
  END IF;
  IF shipment.status <> 'delivered' OR shipment.customer_payment_status <> 'cash_on_delivery' THEN
    RAISE EXCEPTION 'Only delivered cash-on-delivery posts can have their COD corrected'
      USING ERRCODE = '23514';
  END IF;
  IF shipment.assigned_agent_id IS NULL THEN
    RAISE EXCEPTION 'A delivered post must have a courier assignment' USING ERRCODE = '23514';
  END IF;
  IF shipment.cod_amount = p_corrected_cod_amount THEN
    RAISE EXCEPTION 'Corrected COD amount must differ from the current COD amount'
      USING ERRCODE = '23514';
  END IF;

  courier_is_outstanding :=
    delivery.delivery_obligation_is_fully_outstanding(
      p_workspace_id,
      shipment.assigned_agent_id,
      shipment.currency,
      shipment.id,
      'agent',
      ARRAY['courier_collection', 'courier_cod_correction', 'courier_delivery_fee', 'courier_recipient_advance'],
      ARRAY['courier_remittance', 'adjustment'],
      false,
      false
    )
    OR delivery.delivery_obligation_is_fully_outstanding(
      p_workspace_id,
      shipment.assigned_agent_id,
      shipment.currency,
      shipment.id,
      'agent',
      ARRAY['courier_collection', 'courier_cod_correction', 'courier_delivery_fee', 'courier_recipient_advance'],
      ARRAY['courier_reimbursement'],
      true,
      true
    );
  merchant_is_outstanding :=
    delivery.delivery_obligation_is_fully_outstanding(
      p_workspace_id,
      shipment.merchant_profile_id,
      shipment.currency,
      shipment.id,
      'merchant',
      ARRAY['merchant_cod_payable', 'merchant_cod_correction', 'merchant_fee', 'merchant_recipient_payout'],
      ARRAY['merchant_payout', 'adjustment'],
      false,
      false
    )
    OR delivery.delivery_obligation_is_fully_outstanding(
      p_workspace_id,
      shipment.merchant_profile_id,
      shipment.currency,
      shipment.id,
      'merchant',
      ARRAY['merchant_cod_payable', 'merchant_cod_correction', 'merchant_fee', 'merchant_recipient_payout'],
      ARRAY['merchant_repayment'],
      true,
      true
    );
  IF NOT courier_is_outstanding OR NOT merchant_is_outstanding THEN
    RAISE EXCEPTION 'Both related settlement obligations must still be fully outstanding'
      USING ERRCODE = '23514';
  END IF;

  correction_delta := p_corrected_cod_amount - shipment.cod_amount;
  INSERT INTO delivery.delivery_shipment_cod_corrections (
    id,
    workspace_id,
    shipment_id,
    currency,
    original_cod_amount,
    corrected_cod_amount,
    corrected_by,
    corrected_at,
    created_at,
    updated_at,
    sync_status,
    version,
    is_deleted
  ) VALUES (
    p_operation_id,
    p_workspace_id,
    shipment.id,
    shipment.currency,
    shipment.cod_amount,
    p_corrected_cod_amount,
    auth.uid(),
    now_at,
    now_at,
    now_at,
    'synced',
    1,
    false
  ) RETURNING * INTO correction;

  PERFORM set_config('delivery.allow_delivered_cod_correction', 'enabled', true);

  UPDATE delivery.delivery_shipments
  SET cod_amount = p_corrected_cod_amount,
      updated_at = now_at,
      version = shipment.version + 1,
      sync_status = 'synced'
  WHERE id = shipment.id;

  INSERT INTO delivery.delivery_ledger_entries (
    id,
    workspace_id,
    kind,
    shipment_id,
    cod_correction_id,
    settlement_id,
    agent_id,
    merchant_profile_id,
    business_partner_id,
    amount,
    currency,
    occurred_at,
    note,
    created_by,
    created_at,
    updated_at,
    sync_status,
    version,
    is_deleted
  ) VALUES
    (
      v_courier_ledger_entry_id,
      p_workspace_id,
      'courier_cod_correction',
      shipment.id,
      correction.id,
      NULL,
      shipment.assigned_agent_id,
      NULL,
      NULL,
      correction_delta,
      shipment.currency,
      now_at,
      NULL,
      auth.uid(),
      now_at,
      now_at,
      'synced',
      1,
      false
    ),
    (
      v_merchant_ledger_entry_id,
      p_workspace_id,
      'merchant_cod_correction',
      shipment.id,
      correction.id,
      NULL,
      NULL,
      shipment.merchant_profile_id,
      shipment.merchant_business_partner_id,
      correction_delta,
      shipment.currency,
      now_at,
      NULL,
      auth.uid(),
      now_at,
      now_at,
      'synced',
      1,
      false
    );

  UPDATE delivery.delivery_shipment_cod_corrections
  SET courier_ledger_entry_id = v_courier_ledger_entry_id,
      merchant_ledger_entry_id = v_merchant_ledger_entry_id,
      updated_at = now_at,
      version = correction.version + 1
  WHERE id = correction.id;

  RETURN jsonb_build_object(
    'shipment_id', shipment.id,
    'correction_id', correction.id
  );
END;
$$;

DROP TRIGGER IF EXISTS touch_delivery_shipment_cod_corrections_updated_at
  ON delivery.delivery_shipment_cod_corrections;
CREATE TRIGGER touch_delivery_shipment_cod_corrections_updated_at
  BEFORE UPDATE ON delivery.delivery_shipment_cod_corrections
  FOR EACH ROW EXECUTE FUNCTION delivery.touch_updated_at();

ALTER TABLE delivery.delivery_shipment_cod_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE delivery.delivery_shipment_cod_corrections FROM anon, authenticated;
GRANT SELECT ON TABLE delivery.delivery_shipment_cod_corrections TO authenticated, service_role;

DROP POLICY IF EXISTS delivery_shipment_cod_corrections_read
  ON delivery.delivery_shipment_cod_corrections;
CREATE POLICY delivery_shipment_cod_corrections_read
  ON delivery.delivery_shipment_cod_corrections
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND public.current_user_role() = 'admin'
  );

REVOKE ALL ON FUNCTION delivery.delivery_obligation_is_fully_outstanding(uuid, uuid, text, uuid, text, text[], text[], boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery.guard_delivered_shipment_cod_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery.assert_delivered_cod_correction_ledger_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery.correct_delivered_shipment_cod(uuid, uuid, bigint, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delivery.correct_delivered_shipment_cod(uuid, uuid, bigint, numeric, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
