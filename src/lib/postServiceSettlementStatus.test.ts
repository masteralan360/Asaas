import { describe, expect, it } from "vitest";

import type { DeliveryLedgerEntry } from "@/local-db";

import { courierHandoverStatusByShipment, courierSettlementBreakdownByParty, merchantPayoutStatusByShipment, merchantSettlementBreakdownByParty } from "./postServiceSettlementStatus";

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
