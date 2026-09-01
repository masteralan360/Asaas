-- A merchant payout may settle several posts. Store a ledger line for each
-- post it clears so linked couriers can read only their own post's allocation
-- through the existing shipment-scoped RLS policy.
--
-- The real payment and its delivery_settlements record remain singular. This
-- migration only turns legacy, merchant-wide payout ledger entries into the
-- same post-level allocation shape that the application now writes.
DO $$
DECLARE
  payout_group record;
  ledger_event record;
  debt record;
  first_allocation_shipment_id uuid;
  first_allocation_amount numeric;
  allocation numeric;
  remaining_credit numeric;
  allocated_any boolean;
  epsilon constant numeric := 0.000001;
BEGIN
  CREATE TEMP TABLE merchant_payout_remaining (
    merchant_profile_id uuid NOT NULL,
    currency text NOT NULL,
    shipment_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    remaining_amount numeric NOT NULL,
    PRIMARY KEY (merchant_profile_id, currency, shipment_id)
  ) ON COMMIT DROP;

  FOR payout_group IN
    SELECT DISTINCT workspace_id, merchant_profile_id, currency
    FROM delivery.delivery_ledger_entries
    WHERE kind = 'merchant_payout'
      AND shipment_id IS NULL
      AND merchant_profile_id IS NOT NULL
      AND NOT is_deleted
  LOOP
    TRUNCATE merchant_payout_remaining;

    -- Replay the merchant ledger in the same chronological, per-post FIFO
    -- order used by the application. Existing post-scoped clearances are
    -- honored before each legacy merchant-wide payout is allocated.
    FOR ledger_event IN
      SELECT *
      FROM delivery.delivery_ledger_entries
      WHERE workspace_id = payout_group.workspace_id
        AND merchant_profile_id = payout_group.merchant_profile_id
        AND currency = payout_group.currency
        AND NOT is_deleted
        AND kind IN (
          'merchant_cod_payable',
          'merchant_fee',
          'merchant_recipient_payout',
          'merchant_payout',
          'adjustment'
        )
      ORDER BY occurred_at, created_at, id
    LOOP
      IF ledger_event.kind IN ('merchant_cod_payable', 'merchant_fee', 'merchant_recipient_payout') THEN
        IF ledger_event.shipment_id IS NOT NULL THEN
          INSERT INTO merchant_payout_remaining (
            merchant_profile_id,
            currency,
            shipment_id,
            occurred_at,
            remaining_amount
          ) VALUES (
            payout_group.merchant_profile_id,
            payout_group.currency,
            ledger_event.shipment_id,
            ledger_event.occurred_at,
            ledger_event.amount
          )
          ON CONFLICT (merchant_profile_id, currency, shipment_id) DO UPDATE
          SET remaining_amount = merchant_payout_remaining.remaining_amount + EXCLUDED.remaining_amount,
              occurred_at = LEAST(merchant_payout_remaining.occurred_at, EXCLUDED.occurred_at);
        END IF;
        CONTINUE;
      END IF;

      remaining_credit := -ledger_event.amount;
      IF remaining_credit <= epsilon THEN
        CONTINUE;
      END IF;

      first_allocation_shipment_id := NULL;
      first_allocation_amount := NULL;
      allocated_any := FALSE;

      -- A pre-existing post-scoped payout/adjustment clears that post first.
      IF ledger_event.shipment_id IS NOT NULL THEN
        SELECT shipment_id, remaining_amount
        INTO debt
        FROM merchant_payout_remaining
        WHERE merchant_profile_id = payout_group.merchant_profile_id
          AND currency = payout_group.currency
          AND shipment_id = ledger_event.shipment_id
          AND remaining_amount > epsilon;

        IF FOUND THEN
          allocation := LEAST(remaining_credit, debt.remaining_amount);
          UPDATE merchant_payout_remaining
          SET remaining_amount = remaining_amount - allocation
          WHERE merchant_profile_id = payout_group.merchant_profile_id
            AND currency = payout_group.currency
            AND shipment_id = debt.shipment_id;
          remaining_credit := remaining_credit - allocation;
        END IF;
      END IF;

      -- Merchant-wide clearances (including legacy payouts) apply FIFO.
      FOR debt IN
        SELECT shipment_id, remaining_amount
        FROM merchant_payout_remaining
        WHERE merchant_profile_id = payout_group.merchant_profile_id
          AND currency = payout_group.currency
          AND remaining_amount > epsilon
        ORDER BY occurred_at, shipment_id
      LOOP
        EXIT WHEN remaining_credit <= epsilon;

        allocation := LEAST(remaining_credit, debt.remaining_amount);
        UPDATE merchant_payout_remaining
        SET remaining_amount = remaining_amount - allocation
        WHERE merchant_profile_id = payout_group.merchant_profile_id
          AND currency = payout_group.currency
          AND shipment_id = debt.shipment_id;
        remaining_credit := remaining_credit - allocation;

        IF ledger_event.kind = 'merchant_payout' AND ledger_event.shipment_id IS NULL THEN
          IF first_allocation_shipment_id IS NULL THEN
            first_allocation_shipment_id := debt.shipment_id;
            first_allocation_amount := allocation;
          ELSE
            INSERT INTO delivery.delivery_ledger_entries (
              workspace_id,
              kind,
              shipment_id,
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
            ) VALUES (
              ledger_event.workspace_id,
              ledger_event.kind,
              debt.shipment_id,
              ledger_event.settlement_id,
              ledger_event.agent_id,
              ledger_event.merchant_profile_id,
              ledger_event.business_partner_id,
              -allocation,
              ledger_event.currency,
              ledger_event.occurred_at,
              ledger_event.note,
              ledger_event.created_by,
              ledger_event.created_at,
              NOW(),
              'synced',
              1,
              FALSE
            );
          END IF;
          allocated_any := TRUE;
        END IF;
      END LOOP;

      IF ledger_event.kind = 'merchant_payout'
        AND ledger_event.shipment_id IS NULL
        AND allocated_any
      THEN
        -- Reuse the original row for the first allocation and retain a
        -- merchant-wide residual only if historic data contains an overpay.
        IF remaining_credit <= epsilon THEN
          UPDATE delivery.delivery_ledger_entries
          SET shipment_id = first_allocation_shipment_id,
              amount = -first_allocation_amount,
              updated_at = NOW(),
              version = version + 1
          WHERE id = ledger_event.id;
        ELSE
          UPDATE delivery.delivery_ledger_entries
          SET amount = -remaining_credit,
              updated_at = NOW(),
              version = version + 1
          WHERE id = ledger_event.id;

          INSERT INTO delivery.delivery_ledger_entries (
            workspace_id,
            kind,
            shipment_id,
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
          ) VALUES (
            ledger_event.workspace_id,
            ledger_event.kind,
            first_allocation_shipment_id,
            ledger_event.settlement_id,
            ledger_event.agent_id,
            ledger_event.merchant_profile_id,
            ledger_event.business_partner_id,
            -first_allocation_amount,
            ledger_event.currency,
            ledger_event.occurred_at,
            ledger_event.note,
            ledger_event.created_by,
            ledger_event.created_at,
            NOW(),
            'synced',
            1,
            FALSE
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
