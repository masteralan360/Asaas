import type { DeliveryLedgerEntry } from "@/local-db";

export type ShipmentSettlementStatus = "settled" | "partial" | "outstanding";

export interface ShipmentSettlementBreakdown {
  shipmentId: string;
  /** Total obligation for the post (collected cash / net merchant payable). */
  amount: number;
  /** FIFO-allocated share of this post's obligation already settled. */
  paid: number;
  /** Remaining obligation after FIFO allocation. */
  outstanding: number;
}

/** Grouped by `${partyId}:${currency}` in chronological (oldest first) order. */
export type PartySettlementBreakdown = ReadonlyMap<string, readonly ShipmentSettlementBreakdown[]>;

const EPSILON = 0.000001;

type FifoObligation = {
  shipmentId: string;
  amount: number;
  occurredAt: string;
};

type FifoRow = { shipmentId: string; amount: number; remaining: number };

/**
 * Allocates settlement credits (negative entries) against per-shipment
 * obligations (positive entries) in chronological FIFO order using the same
 * per-party-per-currency grouping the settlement dialogs use.
 */
function computeSettlementBreakdown(
  entries: DeliveryLedgerEntry[],
  obligationKinds: DeliveryLedgerEntry["kind"][],
  clearingKinds: DeliveryLedgerEntry["kind"][],
  partyKey: (entry: DeliveryLedgerEntry) => string | null | undefined,
) {
  const groups = new Map<string, { obligations: FifoObligation[]; clearances: Array<{ occurredAt: string; amount: number; shipmentId: string | null }> }>();
  for (const entry of entries) {
    if (entry.isDeleted) continue;
    const key = partyKey(entry);
    if (!key) continue;
    const groupKey = `${key}:${entry.currency}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { obligations: [], clearances: [] };
      groups.set(groupKey, group);
    }
    if (obligationKinds.includes(entry.kind)) {
      const amount = Number(entry.amount || 0);
      if (Math.abs(amount) > EPSILON) {
        group.obligations.push({ shipmentId: entry.shipmentId ?? "", amount, occurredAt: entry.occurredAt });
      }
    } else if (clearingKinds.includes(entry.kind)) {
      const credit = -Number(entry.amount || 0);
      if (credit > EPSILON) {
        group.clearances.push({ occurredAt: entry.occurredAt, amount: credit, shipmentId: entry.shipmentId ?? null });
      }
    }
  }

  const breakdown = new Map<string, FifoRow[]>();
  for (const [groupKey, group] of groups) {
    const byShipment = new Map<string, { amount: number; occurredAt: string }>();
    for (const obligation of group.obligations) {
      if (!obligation.shipmentId) continue;
      const merged = byShipment.get(obligation.shipmentId);
      byShipment.set(obligation.shipmentId, {
        amount: (merged?.amount ?? 0) + obligation.amount,
        occurredAt: merged && merged.occurredAt <= obligation.occurredAt ? merged.occurredAt : obligation.occurredAt,
      });
    }
    const obligations = [...byShipment.entries()]
      .map(([shipmentId, value]) => ({ shipmentId, amount: value.amount, occurredAt: value.occurredAt }))
      .filter((obligation) => obligation.amount > EPSILON)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const clearances = group.clearances.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

    const remaining = new Map(obligations.map((obligation) => [obligation.shipmentId, obligation.amount]));
    for (const clearance of clearances) {
      let credit = clearance.amount;
      const clearanceShipmentId = clearance.shipmentId;
      const byShipment = clearanceShipmentId ? remaining.get(clearanceShipmentId) : undefined;
      if (clearanceShipmentId && byShipment !== undefined && byShipment > EPSILON) {
        const consume = Math.min(byShipment, credit);
        remaining.set(clearanceShipmentId, byShipment - consume);
        credit -= consume;
      }
      for (const obligation of obligations) {
        if (credit <= EPSILON) break;
        const current = remaining.get(obligation.shipmentId);
        if (current === undefined || current <= EPSILON) continue;
        const consume = Math.min(current, credit);
        remaining.set(obligation.shipmentId, current - consume);
        credit -= consume;
      }
    }

    const rows = obligations.map((obligation) => ({
      shipmentId: obligation.shipmentId,
      amount: obligation.amount,
      remaining: remaining.get(obligation.shipmentId) ?? obligation.amount,
    }));
    if (rows.length > 0) breakdown.set(groupKey, rows);
  }
  return breakdown;
}

function toStatuses(breakdown: ReadonlyMap<string, FifoRow[]>) {
  const statuses = new Map<string, ShipmentSettlementStatus>();
  for (const rows of breakdown.values()) {
    for (const row of rows) {
      if (row.remaining <= EPSILON) statuses.set(row.shipmentId, "settled");
      else if (row.remaining >= row.amount - EPSILON) statuses.set(row.shipmentId, "outstanding");
      else statuses.set(row.shipmentId, "partial");
    }
  }
  return statuses;
}

function toBreakdown(breakdown: ReadonlyMap<string, FifoRow[]>) {
  const result = new Map<string, ShipmentSettlementBreakdown[]>();
  for (const [key, rows] of breakdown) {
    result.set(key, rows.map((row) => ({
      shipmentId: row.shipmentId,
      amount: row.amount,
      paid: Math.max(0, row.amount - row.remaining),
      outstanding: row.remaining,
    })));
  }
  return result;
}

/** Per-shipment courier cash handover status derived from the custody ledger. */
export function courierHandoverStatusByShipment(entries: DeliveryLedgerEntry[]) {
  return toStatuses(computeSettlementBreakdown(
    entries,
    // The courier's delivery fee is a negative custody entry, so it reduces
    // the cash amount due for that exact post before any remittance is made.
    ["courier_collection", "courier_delivery_fee"],
    ["courier_remittance", "adjustment"],
    (entry) => entry.agentId,
  ));
}

/** Per-shipment merchant payout status derived from the merchant-payable ledger. */
export function merchantPayoutStatusByShipment(entries: DeliveryLedgerEntry[]) {
  return toStatuses(computeSettlementBreakdown(
    entries,
    ["merchant_cod_payable", "merchant_fee"],
    ["merchant_payout", "adjustment"],
    (entry) => entry.merchantProfileId,
  ));
}

/** Per-courier (per-currency) post breakdown with FIFO paid/outstanding amounts. */
export function courierSettlementBreakdownByParty(entries: DeliveryLedgerEntry[]) {
  return toBreakdown(computeSettlementBreakdown(
    entries,
    ["courier_collection", "courier_delivery_fee"],
    ["courier_remittance", "adjustment"],
    (entry) => entry.agentId,
  ));
}

/** Per-merchant (per-currency) post breakdown with FIFO paid/outstanding amounts. */
export function merchantSettlementBreakdownByParty(entries: DeliveryLedgerEntry[]) {
  return toBreakdown(computeSettlementBreakdown(
    entries,
    ["merchant_cod_payable", "merchant_fee"],
    ["merchant_payout", "adjustment"],
    (entry) => entry.merchantProfileId,
  ));
}
