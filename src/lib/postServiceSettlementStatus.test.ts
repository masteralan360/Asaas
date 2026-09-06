import { describe, expect, it } from "vitest";

import type { DeliveryLedgerEntry } from "@/local-db";

import { activeDeliveryShipmentSettlementObligationCount, courierHandoverStatusByShipment, courierReimbursementBreakdownByParty, courierReimbursementOutstandingByParty, courierReimbursementOutstandingByShipment, courierReimbursementPaidByShipment, courierReimbursementStatusByShipment, courierSettlementBreakdownByParty, isDeliveryShipmentCompleted, isDeliveryShipmentDone, merchantAccountSettlementBreakdownByParty, merchantPayoutStatusByShipment, merchantRepaymentOutstandingByParty, merchantRepaymentOutstandingByShipment, merchantRepaymentStatusByShipment, merchantSettlementBreakdownByParty } from "./postServiceSettlementStatus";

const NOW = "2026-08-17T10:00:00.000Z";

function entry(partial: Partial<DeliveryLedgerEntry> & Pick<DeliveryLedgerEntry, "kind" | "amount" | "currency">): DeliveryLedgerEntry {
  return {
    id: crypto.randomUUID(),
    workspaceId: "ws-1",
    shipmentId: null,
    settlementId: null,
    agentId: null,
    merchantProfileId: null,
    businessPartnerId: null,
    occurredAt: NOW,
    note: null,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    isDeleted: false,
    syncStatus: "synced",
    lastSyncedAt: NOW,
    ...partial,
  };
}

describe("isDeliveryShipmentCompleted", () => {
  it("requires delivery plus settled COD handover and merchant payout", () => {
    const settlement = new Map([["s1", "settled" as const]]);
    expect(isDeliveryShipmentCompleted({ id: "s1", status: "delivered" }, settlement, settlement)).toBe(true);
    expect(isDeliveryShipmentCompleted({ id: "s1", status: "delivered" }, new Map([["s1", "partial" as const]]), settlement)).toBe(false);
    expect(isDeliveryShipmentCompleted({ id: "s1", status: "assigned" }, settlement, settlement)).toBe(false);
  });

  it("uses reimbursed courier and received merchant obligations for prepaid posts", () => {
    const settled = new Map([["s1", "settled" as const]]);
    const partial = new Map([["s1", "partial" as const]]);
    const prepaidShipment = { id: "s1", status: "delivered" as const, customerPaymentStatus: "prepaid_electronically" as const };

    expect(isDeliveryShipmentCompleted(prepaidShipment, new Map(), new Map(), settled, settled)).toBe(true);
    expect(isDeliveryShipmentCompleted(prepaidShipment, new Map(), new Map(), partial, settled)).toBe(false);
    expect(isDeliveryShipmentCompleted({ ...prepaidShipment, status: "assigned" }, new Map(), new Map(), settled, settled)).toBe(false);
  });
});

describe("isDeliveryShipmentDone", () => {
  it("uses each post status and settlement state to split active and done posts", () => {
    const settled = new Map([["settled-post", "settled" as const]]);
    const partial = new Map([["partial-post", "partial" as const]]);

    expect(isDeliveryShipmentDone({ id: "received-post", status: "received" }, settled, settled)).toBe(false);
    expect(isDeliveryShipmentDone({ id: "assigned-post", status: "assigned" }, settled, settled)).toBe(false);
    expect(isDeliveryShipmentDone({ id: "postponed-post", status: "postponed" }, settled, settled)).toBe(false);
    expect(isDeliveryShipmentDone({ id: "partial-post", status: "delivered" }, partial, settled)).toBe(false);
    expect(isDeliveryShipmentDone({ id: "settled-post", status: "delivered" }, settled, settled)).toBe(true);
    expect(isDeliveryShipmentDone({ id: "return-pending", status: "returned", returnReceivedAt: null }, settled, settled)).toBe(false);
    expect(isDeliveryShipmentDone({ id: "return-received", status: "returned", returnReceivedAt: NOW }, settled, settled)).toBe(true);
    expect(isDeliveryShipmentDone({ id: "cancelled-post", status: "cancelled" }, settled, settled)).toBe(true);
  });
});

describe("activeDeliveryShipmentSettlementObligationCount", () => {
  it("counts only outstanding or partial obligations for the post payment model", () => {
    const active = new Map([["s1", "outstanding" as const], ["s2", "partial" as const]]);
    const settled = new Map([["s1", "settled" as const]]);

    expect(activeDeliveryShipmentSettlementObligationCount(
      { id: "s1", customerPaymentStatus: "cash_on_delivery" },
      active,
      settled,
      active,
      active,
    )).toBe(1);
    expect(activeDeliveryShipmentSettlementObligationCount(
      { id: "s1", customerPaymentStatus: "prepaid_electronically" },
      active,
      active,
      active,
      settled,
    )).toBe(1);
    expect(activeDeliveryShipmentSettlementObligationCount(
      { id: "s2", customerPaymentStatus: "prepaid_electronically" },
      new Map(),
      new Map(),
      active,
      active,
    )).toBe(2);
  });
});

describe("courierHandoverStatusByShipment", () => {
  it("marks delivered collections as outstanding until remitted", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "courier_collection", shipmentId: "s1", agentId: "a1", amount: 10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
    ];
    expect(courierHandoverStatusByShipment(entries)).toEqual(new Map([["s1", "outstanding"]]));
  });

  it("clears the oldest shipments first (FIFO) and splits partial remittances", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "courier_collection", shipmentId: "s1", agentId: "a1", amount: 10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "courier_collection", shipmentId: "s2", agentId: "a1", amount: 5_000, currency: "iqd", occurredAt: "2026-08-11T08:00:00.000Z" }),
      entry({ kind: "courier_remittance", agentId: "a1", amount: -12_000, currency: "iqd", occurredAt: "2026-08-12T08:00:00.000Z" }),
    ];
    expect(courierHandoverStatusByShipment(entries)).toEqual(
      new Map([["s1", "settled"], ["s2", "partial"]]),
    );
  });

  it("does not mix couriers or currencies", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "courier_collection", shipmentId: "s1", agentId: "a1", amount: 10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "courier_collection", shipmentId: "s2", agentId: "a2", amount: 10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "courier_remittance", agentId: "a1", amount: -10_000, currency: "iqd", occurredAt: "2026-08-12T08:00:00.000Z" }),
    ];
    expect(courierHandoverStatusByShipment(entries)).toEqual(
      new Map([["s1", "settled"], ["s2", "outstanding"]]),
    );
  });

  it("totals collective courier reimbursements without offsetting a cash handover", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "courier_delivery_fee", shipmentId: "s1", agentId: "a1", amount: -2_000, currency: "iqd" }),
      entry({ kind: "courier_recipient_advance", shipmentId: "s2", agentId: "a1", amount: -3_000, currency: "iqd" }),
      entry({ kind: "courier_reimbursement", shipmentId: "s1", agentId: "a1", amount: 1_000, currency: "iqd" }),
      entry({ kind: "courier_collection", shipmentId: "s3", agentId: "a1", amount: 5_000, currency: "iqd" }),
      entry({ kind: "courier_delivery_fee", shipmentId: "s4", agentId: "a2", amount: -4_000, currency: "iqd" }),
    ];

    expect(courierReimbursementBreakdownByParty(entries).get("a1:iqd")).toEqual([
      { shipmentId: "s1", amount: 1_000 },
      { shipmentId: "s2", amount: 3_000 },
    ]);
    expect(courierReimbursementOutstandingByParty(entries)).toEqual(
      new Map([["a1:iqd", 4_000], ["a2:iqd", 4_000]]),
    );
    expect(courierReimbursementOutstandingByShipment(entries)).toEqual(
      new Map([["s1", 1_000], ["s2", 3_000], ["s4", 4_000]]),
    );
    expect(courierReimbursementPaidByShipment(entries)).toEqual(new Map([["s1", 1_000]]));
    expect(courierReimbursementStatusByShipment(entries)).toEqual(
      new Map([["s1", "partial"], ["s2", "outstanding"], ["s4", "outstanding"]]),
    );
  });

  it("marks a fully reimbursed courier advance as settled", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "courier_delivery_fee", shipmentId: "s1", agentId: "a1", amount: -1_750, currency: "iqd" }),
      entry({ kind: "courier_reimbursement", shipmentId: "s1", agentId: "a1", amount: 1_750, currency: "iqd" }),
    ];

    expect(courierReimbursementStatusByShipment(entries)).toEqual(new Map([["s1", "settled"]]));
  });
});

describe("merchantPayoutStatusByShipment", () => {
  it("nets the merchant fee out of the payable before matching payouts", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "merchant_cod_payable", shipmentId: "s1", merchantProfileId: "m1", amount: 10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "merchant_fee", shipmentId: "s1", merchantProfileId: "m1", amount: -1_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "merchant_payout", merchantProfileId: "m1", amount: -9_000, currency: "iqd", occurredAt: "2026-08-13T08:00:00.000Z" }),
    ];
    expect(merchantPayoutStatusByShipment(entries)).toEqual(new Map([["s1", "settled"]]));
  });

  it("marks partial payouts as partial", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "merchant_cod_payable", shipmentId: "s1", merchantProfileId: "m1", amount: 10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "merchant_payout", merchantProfileId: "m1", amount: -4_000, currency: "iqd", occurredAt: "2026-08-13T08:00:00.000Z" }),
    ];
    expect(merchantPayoutStatusByShipment(entries)).toEqual(new Map([["s1", "partial"]]));
  });
});

describe("merchant repayment settlements", () => {
  it("counts received merchant payments against their post without mixing them with merchant payouts", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "merchant_fee", shipmentId: "s1", merchantProfileId: "m1", amount: -3_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "merchant_recipient_payout", shipmentId: "s1", merchantProfileId: "m1", amount: -10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "merchant_repayment", shipmentId: "s1", merchantProfileId: "m1", amount: 8_000, currency: "iqd", occurredAt: "2026-08-13T08:00:00.000Z" }),
    ];

    expect(merchantAccountSettlementBreakdownByParty(entries).get("m1:iqd")).toEqual([
      { shipmentId: "s1", amount: 13_000, paid: 8_000, outstanding: 5_000, direction: "repayment" },
    ]);
    expect(merchantRepaymentOutstandingByParty(entries)).toEqual(new Map([["m1:iqd", 5_000]]));
    expect(merchantRepaymentOutstandingByShipment(entries)).toEqual(new Map([["s1", 5_000]]));
    expect(merchantRepaymentStatusByShipment(entries)).toEqual(new Map([["s1", "partial"]]));
  });

  it("removes fully repaid posts from the receive-payment action map", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "merchant_fee", shipmentId: "s1", merchantProfileId: "m1", amount: -2_750, currency: "iqd" }),
      entry({ kind: "merchant_repayment", shipmentId: "s1", merchantProfileId: "m1", amount: 2_750, currency: "iqd" }),
    ];

    expect(merchantRepaymentOutstandingByShipment(entries)).toEqual(new Map());
    expect(merchantRepaymentStatusByShipment(entries)).toEqual(new Map([["s1", "settled"]]));
  });
});

describe("settlement breakdown by party", () => {
  it("returns per-post paid and outstanding amounts that match the party totals", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "courier_collection", shipmentId: "s1", agentId: "a1", amount: 10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "courier_collection", shipmentId: "s2", agentId: "a1", amount: 5_000, currency: "iqd", occurredAt: "2026-08-11T08:00:00.000Z" }),
      entry({ kind: "courier_remittance", agentId: "a1", amount: -12_000, currency: "iqd", occurredAt: "2026-08-12T08:00:00.000Z" }),
    ];
    const breakdown = courierSettlementBreakdownByParty(entries);
    const posts = breakdown.get("a1:iqd") ?? [];
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual({ shipmentId: "s1", amount: 10_000, paid: 10_000, outstanding: 0 });
    expect(posts[1]).toEqual({ shipmentId: "s2", amount: 5_000, paid: 2_000, outstanding: 3_000 });
    expect(posts.reduce((sum, post) => sum + post.paid, 0)).toBe(12_000);
    expect(posts.reduce((sum, post) => sum + post.outstanding, 0)).toBe(3_000);
  });

  it("keys merchant breakdowns by merchant profile and currency", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "merchant_cod_payable", shipmentId: "s1", merchantProfileId: "m1", amount: 10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "merchant_cod_payable", shipmentId: "s2", merchantProfileId: "m1", amount: 20_000, currency: "usd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "merchant_payout", merchantProfileId: "m1", amount: -8_000, currency: "iqd", occurredAt: "2026-08-13T08:00:00.000Z" }),
    ];
    const breakdown = merchantSettlementBreakdownByParty(entries);
    expect([...breakdown.keys()].sort()).toEqual(["m1:iqd", "m1:usd"]);
    expect(breakdown.get("m1:iqd")?.[0]).toEqual({ shipmentId: "s1", amount: 10_000, paid: 8_000, outstanding: 2_000 });
    expect(breakdown.get("m1:usd")?.[0]).toEqual({ shipmentId: "s2", amount: 20_000, paid: 0, outstanding: 20_000 });
  });

  it("clears the settlement's own post first, then spills into FIFO", () => {
    const entries: DeliveryLedgerEntry[] = [
      entry({ kind: "courier_collection", shipmentId: "s1", agentId: "a1", amount: 10_000, currency: "iqd", occurredAt: "2026-08-10T08:00:00.000Z" }),
      entry({ kind: "courier_collection", shipmentId: "s2", agentId: "a1", amount: 5_000, currency: "iqd", occurredAt: "2026-08-11T08:00:00.000Z" }),
      entry({ kind: "courier_remittance", shipmentId: "s2", agentId: "a1", amount: -7_000, currency: "iqd", occurredAt: "2026-08-12T08:00:00.000Z" }),
    ];
    const breakdown = courierSettlementBreakdownByParty(entries);
    const posts = breakdown.get("a1:iqd") ?? [];
    expect(posts[0]).toEqual({ shipmentId: "s1", amount: 10_000, paid: 2_000, outstanding: 8_000 });
    expect(posts[1]).toEqual({ shipmentId: "s2", amount: 5_000, paid: 5_000, outstanding: 0 });
    expect(courierHandoverStatusByShipment(entries)).toEqual(
      new Map([["s1", "partial"], ["s2", "settled"]]),
    );
  });
});
