import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  clearWorkspaceModeSnapshot,
  writeWorkspaceModeSnapshot,
} from "@/workspace/workspaceMode";

import { db } from "./database";
import type { Agent, BusinessPartner } from "./models";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000909";
let createDeliveryMerchantProfile: typeof import("./postService").createDeliveryMerchantProfile;
let createDeliveryShipment: typeof import("./postService").createDeliveryShipment;
let createDeliveryRun: typeof import("./postService").createDeliveryRun;
let updateDeliveryShipmentStatus: typeof import("./postService").updateDeliveryShipmentStatus;
let settleDeliveryCourier: typeof import("./postService").settleDeliveryCourier;
let payDeliveryMerchant: typeof import("./postService").payDeliveryMerchant;
let updateDeliveryMerchantProfile: typeof import("./postService").updateDeliveryMerchantProfile;
let hardDeleteDeliveryMerchantProfile: typeof import("./postService").hardDeleteDeliveryMerchantProfile;
let toUISaleFromDeliveryShipment: typeof import("./postService").toUISaleFromDeliveryShipment;

function installBrowserEnvironment() {
  const rows = new Map<string, string>();
  const storage = {
    get length() { return rows.size; },
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
    clear: () => rows.clear(),
    key: (index: number) => Array.from(rows.keys())[index] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, sessionStorage: storage, location: { origin: "http://localhost", hash: "", pathname: "/" }, addEventListener: () => undefined, removeEventListener: () => undefined } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", documentElement: { lang: "en", dir: "ltr" }, addEventListener: () => undefined, removeEventListener: () => undefined } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
}

function partner(id: string): BusinessPartner {
  const now = new Date().toISOString();
  return {
    id, workspaceId: WORKSPACE_ID, name: "Shop A", role: "customer", defaultCurrency: "iqd",
    creditLimit: 0, receivableCreditLimit: null, payableCreditLimit: null,
    customerFacetId: null, supplierFacetId: null, agentFacetId: null,
    totalSalesOrders: 0, totalSalesValue: 0, receivableBalance: 0,
    totalPurchaseOrders: 0, totalPurchaseValue: 0, payableBalance: 0,
    totalLoanCount: 0, loanOutstandingBalance: 0, netExposure: 0,
    mergedIntoBusinessPartnerId: null, createdAt: now, updatedAt: now,
    syncStatus: "synced", lastSyncedAt: now, version: 1, isDeleted: false,
  };
}

function courier(id: string): Agent {
  const now = new Date().toISOString();
  return {
    id, workspaceId: WORKSPACE_ID, businessPartnerId: crypto.randomUUID(), zone: "Baghdad",
    agentType: "courier", carModel: null, plateNumber: null, linkedUserId: null,
    status: "active", createdAt: now, updatedAt: now, syncStatus: "synced",
    lastSyncedAt: now, version: 1, isDeleted: false,
  };
}

describe("Post Service COD accounting", () => {
  beforeAll(async () => {
    installBrowserEnvironment();
    const postService = await import("./postService");
    ({ createDeliveryMerchantProfile, createDeliveryShipment, createDeliveryRun, updateDeliveryShipmentStatus, settleDeliveryCourier, payDeliveryMerchant, updateDeliveryMerchantProfile, hardDeleteDeliveryMerchantProfile, toUISaleFromDeliveryShipment } = postService);
  });

  beforeEach(async () => {
    await db.delete();
    await db.open();
    writeWorkspaceModeSnapshot({ workspaceId: WORKSPACE_ID, dataMode: "local" });
  });

  afterEach(() => clearWorkspaceModeSnapshot(WORKSPACE_ID));
  afterAll(async () => { await db.delete(); });

  it("keeps courier custody and merchant payout as separate balances", async () => {
    const merchant = partner(crypto.randomUUID());
    const deliveryCourier = courier(crypto.randomUUID());
    await db.business_partners.put(merchant);
    await db.agents.put(deliveryCourier);
    const profile = await createDeliveryMerchantProfile(WORKSPACE_ID, {
      businessPartnerId: merchant.id,
      defaultFeeAmount: 10,
      defaultFeePayer: "merchant",
    });
    const shipment = await createDeliveryShipment(WORKSPACE_ID, {
      merchantProfileId: profile.id,
      recipientName: "Recipient",
      recipientPhone: "07500000000",
      recipientAddress: "Baghdad",
      currency: "iqd",
      codAmount: 100,
    });
    await createDeliveryRun(WORKSPACE_ID, { agentId: deliveryCourier.id, shipmentIds: [shipment.id] });
    await updateDeliveryShipmentStatus(shipment.id, {
      status: "delivered",
      actorAgentId: deliveryCourier.id,
    });

    const deliveryEntries = await db.delivery_ledger_entries.where("workspaceId").equals(WORKSPACE_ID).toArray();
    expect(deliveryEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "courier_collection", amount: 100, agentId: deliveryCourier.id }),
      expect.objectContaining({ kind: "merchant_cod_payable", amount: 100, merchantProfileId: profile.id }),
      expect.objectContaining({ kind: "merchant_fee", amount: -10, merchantProfileId: profile.id }),
    ]));

    await settleDeliveryCourier(WORKSPACE_ID, {
      agentId: deliveryCourier.id, currency: "iqd", actualAmount: 100, paymentMethod: "cash",
    });
    await payDeliveryMerchant(WORKSPACE_ID, {
      merchantProfileId: profile.id, currency: "iqd", actualAmount: 90, paymentMethod: "cash",
    });

    const finalEntries = await db.delivery_ledger_entries.where("workspaceId").equals(WORKSPACE_ID).toArray();
    const courierBalance = finalEntries.filter((entry) => entry.agentId === deliveryCourier.id).reduce((sum, entry) => sum + entry.amount, 0);
    const merchantBalance = finalEntries.filter((entry) => entry.merchantProfileId === profile.id).reduce((sum, entry) => sum + entry.amount, 0);
    expect(courierBalance).toBe(0);
    expect(merchantBalance).toBe(0);

    const payments = await db.payment_transactions.where("workspaceId").equals(WORKSPACE_ID).toArray();
    expect(payments).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "delivery_courier_remittance", direction: "incoming", amount: 100 }),
      expect.objectContaining({ sourceType: "delivery_merchant_payout", direction: "outgoing", amount: 90 }),
    ]));
  });

  it("does not write zero-amount ledger entries when a COD-0 post is delivered", async () => {
    const merchant = partner(crypto.randomUUID());
    const deliveryCourier = courier(crypto.randomUUID());
    await db.business_partners.put(merchant);
    await db.agents.put(deliveryCourier);
    const profile = await createDeliveryMerchantProfile(WORKSPACE_ID, {
      businessPartnerId: merchant.id,
      defaultFeeAmount: 5000,
      defaultFeePayer: "recipient",
    });
    const shipment = await createDeliveryShipment(WORKSPACE_ID, {
      merchantProfileId: profile.id, recipientName: "Recipient", recipientPhone: "07500000000",
      recipientAddress: "Baghdad", currency: "iqd", codAmount: 0,
      deliveryFee: 5000,
    });
    await createDeliveryRun(WORKSPACE_ID, { agentId: deliveryCourier.id, shipmentIds: [shipment.id] });
    await updateDeliveryShipmentStatus(shipment.id, { status: "delivered", actorAgentId: deliveryCourier.id });

    const entries = await db.delivery_ledger_entries.where("workspaceId").equals(WORKSPACE_ID).toArray();
    expect(entries).toEqual([expect.objectContaining({
      kind: "courier_collection",
      shipmentId: shipment.id,
      amount: 5000,
    })]);
    expect(entries.some((entry) => entry.amount === 0)).toBe(false);
  });

  it("includes unpaid merchant payout posts and courier custody in partner balances", async () => {
    const merchant = partner(crypto.randomUUID());
    const deliveryCourier = courier(crypto.randomUUID());
    const courierPartner: BusinessPartner = { ...partner(deliveryCourier.businessPartnerId), agentFacetId: deliveryCourier.id }
    await db.business_partners.put(merchant);
    await db.business_partners.put(courierPartner);
    await db.agents.put(deliveryCourier);
    const profile = await createDeliveryMerchantProfile(WORKSPACE_ID, {
      businessPartnerId: merchant.id,
      defaultFeeAmount: 10,
      defaultFeePayer: "merchant",
    });
    const shipment = await createDeliveryShipment(WORKSPACE_ID, {
      merchantProfileId: profile.id, recipientName: "Recipient", recipientPhone: "07500000000",
      recipientAddress: "Baghdad", currency: "iqd", codAmount: 100,
      deliveryFee: 10,
    });
    await createDeliveryRun(WORKSPACE_ID, { agentId: deliveryCourier.id, shipmentIds: [shipment.id] });
    await updateDeliveryShipmentStatus(shipment.id, { status: "delivered", actorAgentId: deliveryCourier.id });

    const { recalculateBusinessPartnerSummary } = await import("./businessPartners");

    const merchantWithOutstanding = await recalculateBusinessPartnerSummary(WORKSPACE_ID, merchant.id);
    expect(merchantWithOutstanding?.payableBalance).toBe(90);

    const courierWithCustody = await recalculateBusinessPartnerSummary(WORKSPACE_ID, deliveryCourier.businessPartnerId);
    expect(courierWithCustody?.receivableBalance).toBe(100);

    await payDeliveryMerchant(WORKSPACE_ID, {
      merchantProfileId: profile.id, currency: "iqd", actualAmount: 90, paymentMethod: "cash",
    });
    const settledMerchant = await recalculateBusinessPartnerSummary(WORKSPACE_ID, merchant.id);
    expect(settledMerchant?.payableBalance).toBe(0);
  });

  it("requires a reason when a courier postpones a post", async () => {
    const merchant = partner(crypto.randomUUID());
    const deliveryCourier = courier(crypto.randomUUID());
    await db.business_partners.put(merchant);
    await db.agents.put(deliveryCourier);
    const profile = await createDeliveryMerchantProfile(WORKSPACE_ID, { businessPartnerId: merchant.id });
    const shipment = await createDeliveryShipment(WORKSPACE_ID, {
      merchantProfileId: profile.id, recipientName: "Recipient", recipientPhone: "07500000000",
      recipientAddress: "Baghdad", currency: "iqd", codAmount: 1,
    });
    await createDeliveryRun(WORKSPACE_ID, { agentId: deliveryCourier.id, shipmentIds: [shipment.id] });
    await expect(updateDeliveryShipmentStatus(shipment.id, { status: "postponed", actorAgentId: deliveryCourier.id })).rejects.toThrow("reason is required");
  });

  it("uses a daily PST tracking sequence in local workspaces", async () => {
    const merchant = partner(crypto.randomUUID());
    await db.business_partners.put(merchant);
    const profile = await createDeliveryMerchantProfile(WORKSPACE_ID, { businessPartnerId: merchant.id });
    const input = {
      merchantProfileId: profile.id,
      recipientName: "Recipient",
      recipientPhone: "07500000000",
      recipientAddress: "Baghdad",
      currency: "iqd" as const,
      codAmount: 1,
    };

    const first = await createDeliveryShipment(WORKSPACE_ID, input);
    const second = await createDeliveryShipment(WORKSPACE_ID, input);

    expect(first.trackingNumber).toMatch(/^PST-\d{8}-00001$/);
    expect(second.trackingNumber).toBe(
      first.trackingNumber.replace(/00001$/, "00002"),
    );
  });

  it("projects only the delivery fee, never the merchant COD, into sales reporting", async () => {
    const merchant = partner(crypto.randomUUID());
    await db.business_partners.put(merchant);
    const profile = await createDeliveryMerchantProfile(WORKSPACE_ID, {
      businessPartnerId: merchant.id,
      defaultFeeAmount: 5,
    });
    const shipment = await createDeliveryShipment(WORKSPACE_ID, {
      merchantProfileId: profile.id,
      recipientName: "Recipient",
      recipientPhone: "07500000000",
      recipientAddress: "Baghdad",
      currency: "iqd",
      codAmount: 25000,
      deliveryFee: 5000,
    });

    const sale = toUISaleFromDeliveryShipment({
      ...shipment,
      status: "delivered",
      deliveredAt: "2026-08-15T12:00:00.000Z",
    }, { merchantName: merchant.name, merchantBusinessPartnerId: merchant.id });

    expect(sale).toMatchObject({
      origin: "post_service",
      total_amount: 5000,
      partyName: merchant.name,
      business_partner_id: merchant.id,
      _trackingNumber: shipment.trackingNumber,
    });
    expect(sale.items).toEqual([expect.objectContaining({
      product_id: "delivery_service_fee",
      unit_price: 5000,
      cost_price: 0,
    })]);
    expect(JSON.stringify(sale)).not.toContain("25000");
  });

  it("updates an unused merchant profile and permanently deletes it", async () => {
    const merchant = partner(crypto.randomUUID());
    await db.business_partners.put(merchant);
    const profile = await createDeliveryMerchantProfile(WORKSPACE_ID, { businessPartnerId: merchant.id, defaultFeeAmount: 5 });

    const updated = await updateDeliveryMerchantProfile(profile.id, {
      defaultFeeAmount: 15,
      defaultFeePayer: "recipient",
      payoutSchedule: "weekly",
      isActive: false,
    });
    expect(updated).toMatchObject({ defaultFeeAmount: 15, defaultFeePayer: "recipient", payoutSchedule: "weekly", isActive: false });

    await hardDeleteDeliveryMerchantProfile(profile.id);
    expect(await db.delivery_merchant_profiles.get(profile.id)).toBeUndefined();
    expect(await db.business_partners.get(merchant.id)).toBeDefined();
  });

  it("settles a single post when shipmentId is provided", async () => {
    const merchant = partner(crypto.randomUUID());
    const deliveryCourier = courier(crypto.randomUUID());
    await db.business_partners.put(merchant);
    await db.agents.put(deliveryCourier);
    const profile = await createDeliveryMerchantProfile(WORKSPACE_ID, {
      businessPartnerId: merchant.id,
      defaultFeeAmount: 0,
      defaultFeePayer: "recipient",
    });
    const first = await createDeliveryShipment(WORKSPACE_ID, {
      merchantProfileId: profile.id, recipientName: "Recipient", recipientPhone: "07500000000",
      recipientAddress: "Baghdad", currency: "iqd", codAmount: 100,
    });
    const second = await createDeliveryShipment(WORKSPACE_ID, {
      merchantProfileId: profile.id, recipientName: "Recipient", recipientPhone: "07500000000",
      recipientAddress: "Baghdad", currency: "iqd", codAmount: 50,
    });
    await createDeliveryRun(WORKSPACE_ID, { agentId: deliveryCourier.id, shipmentIds: [first.id, second.id] });
    await updateDeliveryShipmentStatus(first.id, { status: "delivered", actorAgentId: deliveryCourier.id });
    await updateDeliveryShipmentStatus(second.id, { status: "delivered", actorAgentId: deliveryCourier.id });

    const settlement = await settleDeliveryCourier(WORKSPACE_ID, {
      agentId: deliveryCourier.id, currency: "iqd", actualAmount: 50, paymentMethod: "cash",
      shipmentId: second.id,
    });
    expect(settlement.shipmentId).toBe(second.id);
    expect(settlement.expectedAmount).toBe(50);

    const entries = await db.delivery_ledger_entries.where("workspaceId").equals(WORKSPACE_ID).toArray();
    const remittances = entries.filter((entry) => entry.kind === "courier_remittance");
    expect(remittances).toEqual([expect.objectContaining({ shipmentId: second.id, amount: -50 })]);

    const courierBalance = entries.filter((entry) => entry.agentId === deliveryCourier.id).reduce((sum, entry) => sum + entry.amount, 0);
    expect(courierBalance).toBe(100);

    await expect(settleDeliveryCourier(WORKSPACE_ID, {
      agentId: deliveryCourier.id, currency: "iqd", actualAmount: 50, paymentMethod: "cash",
      shipmentId: second.id,
    })).rejects.toThrow("no outstanding amount");
  });

  it("does not permanently delete a merchant profile with delivery history", async () => {
    const merchant = partner(crypto.randomUUID());
    await db.business_partners.put(merchant);
    const profile = await createDeliveryMerchantProfile(WORKSPACE_ID, { businessPartnerId: merchant.id });
    await createDeliveryShipment(WORKSPACE_ID, {
      merchantProfileId: profile.id, recipientName: "Recipient", recipientPhone: "07500000000",
      recipientAddress: "Baghdad", currency: "iqd", codAmount: 1,
    });

    await expect(hardDeleteDeliveryMerchantProfile(profile.id)).rejects.toThrow("delivery history");
    expect(await db.delivery_merchant_profiles.get(profile.id)).toBeDefined();
  });
});
