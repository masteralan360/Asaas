-- A courier-funded recipient payout is an unpaid pair of obligations: the
-- courier is reimbursed by the workspace and the merchant repays the
-- workspace. Correct both sides together before either settlement starts.

CREATE TABLE IF NOT EXISTS delivery.delivery_shipment_recipient_payout_corrections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES delivery.delivery_shipments(id) ON DELETE RESTRICT,
  currency text NOT NULL,
  original_recipient_payout_amount numeric NOT NULL CHECK (original_recipient_payout_amount >= 0),
  corrected_recipient_payout_amount numeric NOT NULL CHECK (corrected_recipient_payout_amount >= 0),
  corrected_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  courier_ledger_entry_id uuid NULL REFERENCES delivery.delivery_ledger_entries(id) ON DELETE RESTRICT,
  merchant_ledger_entry_id uuid NULL REFERENCES delivery.delivery_ledger_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced',
  version bigint NOT NULL DEFAULT 1,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT delivery_shipment_recipient_payout_correction_amounts_differ
    CHECK (corrected_recipient_payout_amount <> original_recipient_payout_amount),
  CONSTRAINT delivery_shipment_recipient_payout_correction_distinct_ledger_entries
    CHECK (
      courier_ledger_entry_id IS NULL
      OR merchant_ledger_entry_id IS NULL
      OR courier_ledger_entry_id <> merchant_ledger_entry_id
    )
);

CREATE INDEX IF NOT EXISTS delivery_shipment_recipient_payout_corrections_by_shipment
  ON delivery.delivery_shipment_recipient_payout_corrections (workspace_id, shipment_id, corrected_at DESC)
  WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_shipment_recipient_payout_corrections_courier_ledger_unique
  ON delivery.delivery_shipment_recipient_payout_corrections (courier_ledger_entry_id)
  WHERE courier_ledger_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_shipment_recipient_payout_corrections_merchant_ledger_unique
  ON delivery.delivery_shipment_recipient_payout_corrections (merchant_ledger_entry_id)
  WHERE merchant_ledger_entry_id IS NOT NULL;

ALTER TABLE delivery.delivery_ledger_entries
  ADD COLUMN IF NOT EXISTS recipient_payout_correction_id uuid NULL
    REFERENCES delivery.delivery_shipment_recipient_payout_corrections(id) ON DELETE RESTRICT;

ALTER TABLE delivery.delivery_ledger_entries
  DROP CONSTRAINT IF EXISTS delivery_ledger_entries_kind_check,
  ADD CONSTRAINT delivery_ledger_entries_kind_check
    CHECK (kind IN (
      'courier_collection',
      'courier_cod_correction',
      'courier_recipient_payout_correction',
      'courier_delivery_fee',
      'courier_recipient_advance',
      'courier_remittance',
      'courier_fee_payout',
      'courier_reimbursement',
      'merchant_cod_payable',
      'merchant_cod_correction',
      'merchant_recipient_payout_correction',
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
          'courier_recipient_payout_correction',
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
          'merchant_recipient_payout_correction',
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
  DROP CONSTRAINT IF EXISTS delivery_ledger_recipient_payout_correction_link_check,
  ADD CONSTRAINT delivery_ledger_recipient_payout_correction_link_check
    CHECK (
      (
        kind IN ('courier_recipient_payout_correction', 'merchant_recipient_payout_correction')
        AND recipient_payout_correction_id IS NOT NULL
      )
      OR (
        kind NOT IN ('courier_recipient_payout_correction', 'merchant_recipient_payout_correction')
        AND recipient_payout_correction_id IS NULL
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS delivery_one_courier_recipient_payout_correction_entry
  ON delivery.delivery_ledger_entries (recipient_payout_correction_id)
  WHERE kind = 'courier_recipient_payout_correction' AND NOT is_deleted;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_one_merchant_recipient_payout_correction_entry
  ON delivery.delivery_ledger_entries (recipient_payout_correction_id)
  WHERE kind = 'merchant_recipient_payout_correction' AND NOT is_deleted;

CREATE OR REPLACE FUNCTION delivery.guard_delivery_shipment_recipient_payout_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Direct Dashboard/SQL and service-role work remains an administrator-level
  -- override, matching the existing delivery COD guard.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.status = 'delivered'
    AND NEW.recipient_payout_amount IS DISTINCT FROM OLD.recipient_payout_amount
    AND COALESCE(current_setting('delivery.allow_delivered_recipient_payout_correction', true), '') <> 'enabled'
  THEN
    RAISE EXCEPTION 'Use the delivered recipient payout correction action before settlement begins'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW.recipient_payout_amount IS DISTINCT FROM OLD.recipient_payout_amount
      OR NEW.recipient_payout_funding IS DISTINCT FROM OLD.recipient_payout_funding
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.customer_payment_status IS DISTINCT FROM OLD.customer_payment_status
    )
    AND EXISTS (
      SELECT 1
      FROM delivery.delivery_shipment_recipient_payout_adjustment_requests AS request
      WHERE request.shipment_id = NEW.id
        AND request.workspace_id = NEW.workspace_id
        AND request.status = 'pending'
        AND NOT request.is_deleted
    ) THEN
    RAISE EXCEPTION 'Review the pending recipient payout change before changing the post payout details' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'delivered' AND EXISTS (
    SELECT 1
    FROM delivery.delivery_shipment_recipient_payout_adjustment_requests AS request
    WHERE request.shipment_id = NEW.id
      AND request.workspace_id = NEW.workspace_id
      AND request.status = 'pending'
      AND NOT request.is_deleted
  ) THEN
    RAISE EXCEPTION 'Review the pending recipient payout change before marking the post delivered' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION delivery.assert_delivered_recipient_payout_correction_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  correction delivery.delivery_shipment_recipient_payout_corrections%ROWTYPE;
  shipment delivery.delivery_shipments%ROWTYPE;
  expected_delta numeric;
BEGIN
  IF NEW.kind NOT IN ('courier_recipient_payout_correction', 'merchant_recipient_payout_correction') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('delivery.allow_delivered_recipient_payout_correction', true), '') <> 'enabled' THEN
    RAISE EXCEPTION 'Delivered recipient payout correction ledger entries can only be created by the correction action'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO correction
  FROM delivery.delivery_shipment_recipient_payout_corrections
  WHERE id = NEW.recipient_payout_correction_id
    AND workspace_id = NEW.workspace_id
    AND NOT is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivered recipient payout correction ledger entry must reference its audit record'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO shipment
  FROM delivery.delivery_shipments
  WHERE id = correction.shipment_id
    AND workspace_id = correction.workspace_id
    AND NOT is_deleted;
  IF NOT FOUND
    OR shipment.status <> 'delivered'
    OR shipment.customer_payment_status <> 'prepaid_electronically'
    OR shipment.recipient_payout_funding <> 'courier_advance'
    OR shipment.recipient_payout_amount IS DISTINCT FROM correction.corrected_recipient_payout_amount
  THEN
    RAISE EXCEPTION 'Delivered recipient payout correction does not match the shipment state'
      USING ERRCODE = '23514';
  END IF;

  expected_delta := correction.corrected_recipient_payout_amount - correction.original_recipient_payout_amount;
  IF NEW.shipment_id IS DISTINCT FROM correction.shipment_id
    OR NEW.currency IS DISTINCT FROM correction.currency
    OR NEW.settlement_id IS NOT NULL
    OR NEW.amount IS DISTINCT FROM -expected_delta
    OR NEW.created_by IS DISTINCT FROM correction.corrected_by
  THEN
    RAISE EXCEPTION 'Delivered recipient payout correction ledger entry does not match its audit record'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'courier_recipient_payout_correction' AND (
    NEW.agent_id IS DISTINCT FROM shipment.assigned_agent_id
    OR NEW.merchant_profile_id IS NOT NULL
    OR NEW.business_partner_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Courier recipient payout correction must belong to the delivering courier'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'merchant_recipient_payout_correction' AND (
    NEW.agent_id IS NOT NULL
    OR NEW.merchant_profile_id IS DISTINCT FROM shipment.merchant_profile_id
    OR NEW.business_partner_id IS DISTINCT FROM shipment.merchant_business_partner_id
  ) THEN
    RAISE EXCEPTION 'Merchant recipient payout correction must belong to the shipment merchant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_assert_delivered_recipient_payout_correction_ledger_entry
  ON delivery.delivery_ledger_entries;
CREATE TRIGGER delivery_assert_delivered_recipient_payout_correction_ledger_entry
  BEFORE INSERT OR UPDATE ON delivery.delivery_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION delivery.assert_delivered_recipient_payout_correction_ledger_entry();

CREATE OR REPLACE FUNCTION delivery.correct_delivered_shipment_recipient_payout(
  p_workspace_id uuid,
  p_shipment_id uuid,
  p_expected_version bigint,
  p_corrected_recipient_payout_amount numeric,
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  shipment delivery.delivery_shipments%ROWTYPE;
  existing_correction delivery.delivery_shipment_recipient_payout_corrections%ROWTYPE;
  correction delivery.delivery_shipment_recipient_payout_corrections%ROWTYPE;
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
    RAISE EXCEPTION 'Only an administrator can correct a delivered recipient payout amount'
      USING ERRCODE = '42501';
  END IF;

  IF p_corrected_recipient_payout_amount IS NULL OR p_corrected_recipient_payout_amount < 0 THEN
    RAISE EXCEPTION 'Corrected recipient payout amount must be zero or greater' USING ERRCODE = '23514';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'A delivered recipient payout correction operation ID is required' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO existing_correction
  FROM delivery.delivery_shipment_recipient_payout_corrections
  WHERE id = p_operation_id;
  IF FOUND THEN
    IF existing_correction.workspace_id <> p_workspace_id
      OR existing_correction.shipment_id <> p_shipment_id
      OR existing_correction.corrected_recipient_payout_amount <> p_corrected_recipient_payout_amount
    THEN
      RAISE EXCEPTION 'This delivered recipient payout correction operation cannot be reused'
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
    RAISE EXCEPTION 'This post has changed. Refresh it before correcting the recipient payout'
      USING ERRCODE = '23514';
  END IF;
  IF shipment.status <> 'delivered'
    OR shipment.customer_payment_status <> 'prepaid_electronically'
    OR shipment.recipient_payout_funding <> 'courier_advance'
  THEN
    RAISE EXCEPTION 'Only delivered courier-funded electronically prepaid posts can have their recipient payout corrected'
      USING ERRCODE = '23514';
  END IF;
  IF shipment.assigned_agent_id IS NULL THEN
    RAISE EXCEPTION 'A delivered post must have a courier assignment' USING ERRCODE = '23514';
  END IF;
  IF shipment.recipient_payout_amount IS NOT DISTINCT FROM p_corrected_recipient_payout_amount THEN
    RAISE EXCEPTION 'Corrected recipient payout amount must differ from the current recipient payout amount'
      USING ERRCODE = '23514';
  END IF;

  courier_is_outstanding := delivery.delivery_obligation_is_fully_outstanding(
    p_workspace_id,
    shipment.assigned_agent_id,
    shipment.currency,
    shipment.id,
    'agent',
    ARRAY[
      'courier_collection',
      'courier_cod_correction',
      'courier_recipient_payout_correction',
      'courier_delivery_fee',
      'courier_recipient_advance'
    ],
    ARRAY['courier_reimbursement'],
    true,
    true
  );
  merchant_is_outstanding := delivery.delivery_obligation_is_fully_outstanding(
    p_workspace_id,
    shipment.merchant_profile_id,
    shipment.currency,
    shipment.id,
    'merchant',
    ARRAY[
      'merchant_cod_payable',
      'merchant_cod_correction',
      'merchant_recipient_payout_correction',
      'merchant_fee',
      'merchant_recipient_payout'
    ],
    ARRAY['merchant_repayment'],
    true,
    true
  );
  IF NOT courier_is_outstanding OR NOT merchant_is_outstanding THEN
    RAISE EXCEPTION 'Courier reimbursement and merchant repayment must still be fully outstanding'
      USING ERRCODE = '23514';
  END IF;

  correction_delta := p_corrected_recipient_payout_amount - shipment.recipient_payout_amount;
  INSERT INTO delivery.delivery_shipment_recipient_payout_corrections (
    id,
    workspace_id,
    shipment_id,
    currency,
    original_recipient_payout_amount,
    corrected_recipient_payout_amount,
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
    shipment.recipient_payout_amount,
    p_corrected_recipient_payout_amount,
    auth.uid(),
    now_at,
    now_at,
    now_at,
    'synced',
    1,
    false
  ) RETURNING * INTO correction;

  PERFORM set_config('delivery.allow_delivered_recipient_payout_correction', 'enabled', true);

  UPDATE delivery.delivery_shipments
  SET recipient_payout_amount = p_corrected_recipient_payout_amount,
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
    recipient_payout_correction_id,
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
      'courier_recipient_payout_correction',
      shipment.id,
      NULL,
      correction.id,
      NULL,
      shipment.assigned_agent_id,
      NULL,
      NULL,
      -correction_delta,
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
      'merchant_recipient_payout_correction',
      shipment.id,
      NULL,
      correction.id,
      NULL,
      NULL,
      shipment.merchant_profile_id,
      shipment.merchant_business_partner_id,
      -correction_delta,
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

  UPDATE delivery.delivery_shipment_recipient_payout_corrections
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

DROP TRIGGER IF EXISTS touch_delivery_shipment_recipient_payout_corrections_updated_at
  ON delivery.delivery_shipment_recipient_payout_corrections;
CREATE TRIGGER touch_delivery_shipment_recipient_payout_corrections_updated_at
  BEFORE UPDATE ON delivery.delivery_shipment_recipient_payout_corrections
  FOR EACH ROW EXECUTE FUNCTION delivery.touch_updated_at();

ALTER TABLE delivery.delivery_shipment_recipient_payout_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE delivery.delivery_shipment_recipient_payout_corrections FROM anon, authenticated;
GRANT SELECT ON TABLE delivery.delivery_shipment_recipient_payout_corrections TO authenticated, service_role;

DROP POLICY IF EXISTS delivery_shipment_recipient_payout_corrections_read
  ON delivery.delivery_shipment_recipient_payout_corrections;
CREATE POLICY delivery_shipment_recipient_payout_corrections_read
  ON delivery.delivery_shipment_recipient_payout_corrections
  FOR SELECT TO authenticated
  USING (
    workspace_id = public.current_workspace_id()
    AND delivery.module_allowed(workspace_id)
    AND public.current_user_role() = 'admin'
  );

REVOKE ALL ON FUNCTION delivery.guard_delivery_shipment_recipient_payout_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery.assert_delivered_recipient_payout_correction_ledger_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery.correct_delivered_shipment_recipient_payout(uuid, uuid, bigint, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delivery.correct_delivered_shipment_recipient_payout(uuid, uuid, bigint, numeric, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
