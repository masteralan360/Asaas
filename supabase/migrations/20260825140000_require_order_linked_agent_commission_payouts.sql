-- Order-linked Agent Commission Payouts
--
-- A sales order number is now the authoritative payout reference. Payouts
-- remain append-only and may be recorded in several partial payments, so the
-- former globally unique free-text reference is intentionally removed.

DROP INDEX IF EXISTS crm.agent_commission_entries_payout_reference_idx;
CREATE INDEX IF NOT EXISTS agent_commission_entries_payout_order_idx
  ON crm.agent_commission_entries (
    workspace_id, agent_id, currency, order_id, occurred_at DESC
  )
  WHERE kind = 'payout';

CREATE OR REPLACE FUNCTION private.enforce_order_linked_agent_commission_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order_number text;
  v_recognized numeric := 0;
BEGIN
  IF NEW.kind <> 'payout' THEN
    RETURN NEW;
  END IF;

  IF NEW.order_id IS NULL OR NEW.assignment_id IS NULL THEN
    RAISE EXCEPTION 'Commission payouts require a linked sales order and assignment'
      USING ERRCODE = '23514';
  END IF;

  SELECT NULLIF(btrim(sales_order.order_number), '')
  INTO v_order_number
  FROM crm.sales_orders AS sales_order
  WHERE sales_order.id = NEW.order_id
    AND sales_order.workspace_id = NEW.workspace_id
    AND sales_order.is_deleted = false;

  IF v_order_number IS NULL THEN
    RAISE EXCEPTION 'Commission payout sales order must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(sum(entry.amount), 0)
  INTO v_recognized
  FROM crm.agent_commission_entries AS entry
  WHERE entry.workspace_id = NEW.workspace_id
    AND entry.agent_id = NEW.agent_id
    AND entry.currency = NEW.currency
    AND entry.order_id = NEW.order_id
    AND entry.kind NOT IN ('estimate', 'approval');

  IF -NEW.amount > GREATEST(v_recognized, 0) + 0.000001 THEN
    RAISE EXCEPTION 'Commission payout exceeds the selected order''s outstanding commission'
      USING ERRCODE = '23514';
  END IF;

  -- Ignore any client-provided text and persist the immutable SO- reference.
  NEW.payout_reference := v_order_number;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_order_linked_agent_commission_payout
  ON crm.agent_commission_entries;
CREATE TRIGGER validate_order_linked_agent_commission_payout
  BEFORE INSERT ON crm.agent_commission_entries
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_order_linked_agent_commission_payout();

REVOKE ALL ON FUNCTION private.enforce_order_linked_agent_commission_payout() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
