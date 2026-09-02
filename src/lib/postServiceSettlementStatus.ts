import type { DeliveryLedgerEntry, DeliveryShipment } from "@/local-db";

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

export type MerchantSettlementDirection = "payout" | "repayment";

/** A per-post merchant settlement, whether the workspace pays or receives it. */
export type MerchantAccountSettlementBreakdown = ShipmentSettlementBreakdown & {
  direction: MerchantSettlementDirection;
};

/**
 * A delivery post is complete only after delivery and both settlement
 * obligations for its payment model have been cleared.
 */
export function isDeliveryShipmentCompleted(
  shipment: Pick<DeliveryShipment, "id" | "status"> & Partial<Pick<DeliveryShipment, "customerPaymentStatus">>,
  courierHandoverStatuses: ReadonlyMap<string, ShipmentSettlementStatus>,
  merchantPayoutStatuses: ReadonlyMap<string, ShipmentSettlementStatus>,
  courierReimbursementStatuses: ReadonlyMap<string, ShipmentSettlementStatus> = new Map(),
  merchantRepaymentStatuses: ReadonlyMap<string, ShipmentSettlementStatus> = new Map(),
) {
  if (shipment.status !== "delivered") return false;
  if (shipment.customerPaymentStatus === "prepaid_electronically") {
    return courierReimbursementStatuses.get(shipment.id) === "settled"
      && merchantRepaymentStatuses.get(shipment.id) === "settled";
  }
  return courierHandoverStatuses.get(shipment.id) === "settled"
    && merchantPayoutStatuses.get(shipment.id) === "settled";
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
  options?: {
    obligationAmount?: (entry: DeliveryLedgerEntry) => number;
    clearingAmount?: (entry: DeliveryLedgerEntry) => number;
  },
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
      const amount = options?.obligationAmount?.(entry) ?? Number(entry.amount || 0);
      if (Math.abs(amount) > EPSILON) {
        group.obligations.push({ shipmentId: entry.shipmentId ?? "", amount, occurredAt: entry.occurredAt });
      }
    } else if (clearingKinds.includes(entry.kind)) {
      const credit = options?.clearingAmount?.(entry) ?? -Number(entry.amount || 0);
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
    // Both the courier's fee and a recipient payout the courier funded are
    // negative custody entries, so they reduce the cash due for that exact
    // post before any remittance is made.
    ["courier_collection", "courier_delivery_fee", "courier_recipient_advance"],
    ["courier_remittance", "adjustment"],
    (entry) => entry.agentId,
  ));
}

/** Per-shipment merchant payout status derived from the merchant-payable ledger. */
export function merchantPayoutStatusByShipment(entries: DeliveryLedgerEntry[]) {
  return toStatuses(computeSettlementBreakdown(
    entries,
    ["merchant_cod_payable", "merchant_fee", "merchant_recipient_payout"],
    ["merchant_payout", "adjustment"],
    (entry) => entry.merchantProfileId,
  ));
}

/** Per-courier (per-currency) post breakdown with FIFO paid/outstanding amounts. */
export function courierSettlementBreakdownByParty(entries: DeliveryLedgerEntry[]) {
  return toBreakdown(computeSettlementBreakdown(
    entries,
    ["courier_collection", "courier_delivery_fee", "courier_recipient_advance"],
    ["courier_remittance", "adjustment"],
    (entry) => entry.agentId,
  ));
}

export interface CourierReimbursementBreakdown {
  shipmentId: string;
  /** Outstanding amount the workspace owes the courier for this post. */
  amount: number;
}

/** Per-courier post reimbursements, in chronological order. */
export function courierReimbursementBreakdownByParty(entries: DeliveryLedgerEntry[]) {
  const groups = new Map<string, Map<string, { balance: number; occurredAt: string }>>();
  for (const entry of entries) {
    if (
      entry.isDeleted
      || !entry.agentId
      || !entry.shipmentId
      || ![
        "courier_collection",
        "courier_delivery_fee",
        "courier_recipient_advance",
        "courier_remittance",
        "courier_fee_payout",
        "courier_reimbursement",
      ].includes(entry.kind)
    ) continue;
    const partyKey = `${entry.agentId}:${entry.currency}`;
    const posts = groups.get(partyKey) ?? new Map<string, { balance: number; occurredAt: string }>();
    const current = posts.get(entry.shipmentId);
    posts.set(entry.shipmentId, {
      balance: (current?.balance ?? 0) + Number(entry.amount || 0),
      occurredAt: current && current.occurredAt <= entry.occurredAt ? current.occurredAt : entry.occurredAt,
    });
    groups.set(partyKey, posts);
  }
  const results = new Map<string, CourierReimbursementBreakdown[]>();
  for (const [partyKey, posts] of groups) {
    const reimbursements = [...posts.entries()]
      .filter(([, post]) => post.balance < -EPSILON)
      .map(([shipmentId, post]) => ({ shipmentId, amount: -post.balance, occurredAt: post.occurredAt }))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      .map(({ shipmentId, amount }) => ({ shipmentId, amount }));
    if (reimbursements.length > 0) results.set(partyKey, reimbursements);
  }
  return results;
}

/** Amounts the workspace owes each courier, grouped by courier and currency. */
export function courierReimbursementOutstandingByParty(entries: DeliveryLedgerEntry[]) {
  const results = new Map<string, number>();
  for (const [partyKey, posts] of courierReimbursementBreakdownByParty(entries)) {
    results.set(partyKey, posts.reduce((total, post) => total + post.amount, 0));
  }
  return results;
}

/** Outstanding courier reimbursements, keyed by delivery post. */
export function courierReimbursementOutstandingByShipment(entries: DeliveryLedgerEntry[]) {
  const results = new Map<string, number>();
  for (const posts of courierReimbursementBreakdownByParty(entries).values()) {
    for (const post of posts) {
      results.set(post.shipmentId, (results.get(post.shipmentId) ?? 0) + post.amount);
    }
  }
  return results;
}

/** Real courier reimbursement payments allocated to each delivery post. */
export function courierReimbursementPaidByShipment(entries: DeliveryLedgerEntry[]) {
  const results = new Map<string, number>();
  for (const entry of entries) {
    if (entry.isDeleted || entry.kind !== "courier_reimbursement" || !entry.shipmentId) continue;
    results.set(entry.shipmentId, (results.get(entry.shipmentId) ?? 0) + Number(entry.amount || 0));
  }
  return results;
}

/**
 * Per-shipment status of the workspace reimbursing a courier's own advance.
 * Reimbursements are always explicitly linked to the post they clear, so this
 * intentionally does not use FIFO allocation.
 */
export function courierReimbursementStatusByShipment(entries: DeliveryLedgerEntry[]) {
  const expectedByShipment = new Map<string, number>();
  const paidByShipment = courierReimbursementPaidByShipment(entries);

  for (const entry of entries) {
    if (
      entry.isDeleted
      || !entry.shipmentId
      || !["courier_delivery_fee", "courier_recipient_advance"].includes(entry.kind)
    ) continue;
    const amount = Number(entry.amount || 0);
    if (amount >= -EPSILON) continue;
    expectedByShipment.set(entry.shipmentId, (expectedByShipment.get(entry.shipmentId) ?? 0) - amount);
  }

  const results = new Map<string, ShipmentSettlementStatus>();
  for (const [shipmentId, expected] of expectedByShipment) {
    const paid = paidByShipment.get(shipmentId) ?? 0;
    if (paid >= expected - EPSILON) results.set(shipmentId, "settled");
    else if (paid <= EPSILON) results.set(shipmentId, "outstanding");
    else results.set(shipmentId, "partial");
  }
  return results;
}

/** Per-merchant (per-currency) post breakdown with FIFO paid/outstanding amounts. */
export function merchantSettlementBreakdownByParty(entries: DeliveryLedgerEntry[]) {
  return toBreakdown(computeSettlementBreakdown(
    entries,
    ["merchant_cod_payable", "merchant_fee", "merchant_recipient_payout"],
    ["merchant_payout", "adjustment"],
    (entry) => entry.merchantProfileId,
  ));
}

/**
 * Per-merchant settlement rows for both directions of the account. Payouts
 * reduce money owed to the merchant; repayments reduce money owed by them.
 */
export function merchantAccountSettlementBreakdownByParty(entries: DeliveryLedgerEntry[]) {
  const payouts = merchantSettlementBreakdownByParty(entries);
  const repayments = toBreakdown(computeSettlementBreakdown(
    entries,
    ["merchant_cod_payable", "merchant_fee", "merchant_recipient_payout"],
    ["merchant_repayment"],
    (entry) => entry.merchantProfileId,
    {
      obligationAmount: (entry) => -Number(entry.amount || 0),
      clearingAmount: (entry) => Number(entry.amount || 0),
    },
  ));
  const results = new Map<string, MerchantAccountSettlementBreakdown[]>();
  for (const [partyKey, posts] of payouts) {
    results.set(partyKey, posts.map((post) => ({ ...post, direction: "payout" })));
  }
  for (const [partyKey, posts] of repayments) {
    const rows = results.get(partyKey) ?? [];
    rows.push(...posts.map((post) => ({ ...post, direction: "repayment" as const })));
    results.set(partyKey, rows);
  }
  return results;
}

/** Per-shipment status of incoming merchant repayments. */
export function merchantRepaymentStatusByShipment(entries: DeliveryLedgerEntry[]) {
  const results = new Map<string, ShipmentSettlementStatus>();
  for (const posts of merchantAccountSettlementBreakdownByParty(entries).values()) {
    for (const post of posts) {
      if (post.direction !== "repayment") continue;
      if (post.outstanding <= EPSILON) results.set(post.shipmentId, "settled");
      else if (post.paid <= EPSILON) results.set(post.shipmentId, "outstanding");
      else results.set(post.shipmentId, "partial");
    }
  }
  return results;
}

/** Outstanding incoming merchant repayments, keyed by delivery post. */
export function merchantRepaymentOutstandingByShipment(entries: DeliveryLedgerEntry[]) {
  const results = new Map<string, number>();
  for (const posts of merchantAccountSettlementBreakdownByParty(entries).values()) {
    for (const post of posts) {
      if (post.direction !== "repayment" || post.outstanding <= EPSILON) continue;
      results.set(post.shipmentId, (results.get(post.shipmentId) ?? 0) + post.outstanding);
    }
  }
  return results;
}

/** Outstanding incoming merchant repayments, keyed by merchant and currency. */
export function merchantRepaymentOutstandingByParty(entries: DeliveryLedgerEntry[]) {
  const results = new Map<string, number>();
  for (const [partyKey, posts] of merchantAccountSettlementBreakdownByParty(entries)) {
    const outstanding = posts.reduce(
      (total, post) => total + (post.direction === "repayment" ? post.outstanding : 0),
      0,
    );
    if (outstanding > EPSILON) results.set(partyKey, outstanding);
  }
  return results;
}
