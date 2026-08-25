import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  clearWorkspaceModeSnapshot,
  writeWorkspaceModeSnapshot,
} from "@/workspace/workspaceMode";

import { db } from "./database";
import type { Agent, OrderReturn, SalesOrder } from "./models";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000919";
let commissions: typeof import("./agentCommissions");

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
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      sessionStorage: storage,
      location: { origin: "http://localhost", hash: "", pathname: "/" },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      documentElement: { lang: "en", dir: "ltr" },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
}

function fieldAgent(id: string, type: Agent["agentType"] = "field_agent"): Agent {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: WORKSPACE_ID,
    businessPartnerId: crypto.randomUUID(),
    zone: "Baghdad",
    agentType: type,
    carModel: type === "driver" ? "Hilux" : null,
    plateNumber: type === "driver" ? "22-A-1" : null,
    linkedUserId: crypto.randomUUID(),
    status: "active",
    createdAt: now,
    updatedAt: now,
    syncStatus: "synced",
    lastSyncedAt: now,
    version: 1,
    isDeleted: false,
  };
}

function completedOrder(id: string): SalesOrder {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: WORKSPACE_ID,
    orderNumber: "SO-1001",
    businessPartnerId: null,
    customerId: crypto.randomUUID(),
    customerName: "Customer",
    sourceStorageId: null,
    items: [{
      id: "line-1",
      productId: crypto.randomUUID(),
      productName: "Product",
      productSku: "P-1",
      quantity: 10,
      freeBonusQuantity: 0,
      lineTotal: 1_000,
      originalCurrency: "usd",
      originalUnitPrice: 100,
      convertedUnitPrice: 100,
      settlementCurrency: "usd",
      costPrice: 60,
      convertedCostPrice: 60,
      returnedQuantity: 0,
    }],
    subtotal: 1_000,
    discount: 0,
    tax: 0,
    total: 1_000,
    currency: "usd",
    exchangeRate: null,
    exchangeRateSource: null,
    exchangeRateTimestamp: null,
    status: "completed",
    actualDeliveryDate: now,
    expectedDeliveryDate: null,
    isPaid: true,
    paymentStatus: "paid",
    paidAmount: 1_000,
    balanceAmount: 0,
    paidAt: now,
    paymentMethod: "cash",
    initialPaymentAmount: 0,
    linkedLoanId: null,
    isInstallmentBased: false,
    installmentCount: 0,
    installmentFrequency: null,
    firstDueDate: null,
    nextDueDate: null,
    reservedAt: now,
    returnStatus: "none",
    returnedAmount: 0,
    createdBy: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    syncStatus: "synced",
    lastSyncedAt: now,
    version: 1,
    isDeleted: false,
  };
}

describe("sales agent commission lifecycle", () => {
  beforeAll(async () => {
    installBrowserEnvironment();
    commissions = await import("./agentCommissions");
  });

  beforeEach(async () => {
    await db.delete();
    await db.open();
    writeWorkspaceModeSnapshot({ workspaceId: WORKSPACE_ID, dataMode: "local" });
  });

  afterEach(() => clearWorkspaceModeSnapshot(WORKSPACE_ID));
  afterAll(async () => { await db.delete(); });

  it("calculates return-aware profit commission from frozen delivery snapshots", () => {
    const order = completedOrder(crypto.randomUUID());
    order.items[0].returnedQuantity = 4;
    order.returnStatus = "partial";
    const calculation = commissions.calculateSalesOrderCommission(order, {
      ratePercent: 10,
      calculationBasis: "net_profit",
      includeTax: false,
      includeDeliveryCharge: true,
    }, {
      deliveryChargeAmount: 50,
      internalDeliveryCostAmount: 10,
    });

    // Revenue: 6 * 100 + 50. Cost: 6 * 60 + 10. Profit: 280.
    expect(calculation).toMatchObject({
      revenueAmount: 650,
      costAmount: 370,
      basisAmount: 280,
      commissionAmount: 28,
    });
  });

  it("stores fixed cross-currency manual commissions in the order currency for agents without a plan", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    const order = { ...completedOrder(crypto.randomUUID()), currency: "iqd" as const };
    order.exchangeRates = [{
      pair: "USD/IQD",
      rate: 150_000,
      priceBasisAmount: 100,
      source: "test",
      timestamp: new Date().toISOString(),
    }];
    await db.agents.put(agent);
    await db.sales_orders.put(order);

    const assignment = await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
      manualCommission: {
        type: "fixed_amount",
        amount: 10,
        currency: "usd",
        exchangeRates: order.exchangeRates,
      },
    });
    const accrual = await db.agent_commission_entries
      .where("assignmentId")
      .equals(assignment!.id)
      .and((entry) => entry.kind === "accrual")
      .first();

    expect(assignment).toMatchObject({
      manualCommissionType: "fixed_amount",
      manualCommissionSourceAmount: 10,
      manualCommissionSourceCurrency: "usd",
      manualCommissionConvertedAmount: 15_000,
      manualCommissionExchangeRate: 1_500,
    });
    expect(accrual).toMatchObject({
      membershipId: null,
      planId: null,
      currency: "iqd",
      amount: 15_000,
      ratePercent: 0,
    });
  });

  it("recalculates percentage manual commissions from the current order total", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    const order = completedOrder(crypto.randomUUID());
    await db.agents.put(agent);
    await db.sales_orders.put(order);

    const assignment = await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
      manualCommission: {
        type: "percentage",
        amount: 5,
        currency: "usd",
      },
    });
    expect(assignment).toMatchObject({
      manualCommissionType: "percentage",
      manualCommissionSourceAmount: 5,
      manualCommissionConvertedAmount: 50,
      manualCommissionSourceCurrency: "usd",
    });

    await db.sales_orders.put({
      ...order,
      total: 1_200,
      subtotal: 1_200,
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
      version: 2,
    });
    const adjustment = await commissions.reconcileSalesOrderCommission(WORKSPACE_ID, order.id);
    expect(adjustment).toMatchObject({ kind: "adjustment", amount: 10, currency: "usd" });
  });

  it("rejects manual order commission when the assigned agent has an effective plan", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    const order = completedOrder(crypto.randomUUID());
    await db.agents.put(agent);
    await db.sales_orders.put(order);
    const plan = await commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Level 1",
      level: "level_1",
      ratePercent: 10,
    });
    await commissions.setAgentCommissionMembership(WORKSPACE_ID, {
      agentId: agent.id,
      planId: plan.id,
    });

    await expect(commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
      manualCommission: {
        type: "fixed_amount",
        amount: 25,
        currency: "usd",
      },
    })).rejects.toThrow("commission plan");
  });

  it("includes standard and post-return order adjustments in commissionable revenue", () => {
    const order = completedOrder(crypto.randomUUID());
    const adjustmentBase = {
      currency: "usd" as const,
      orderCurrency: "usd" as const,
      exchangeRate: 1,
      exchangeRateSource: "native",
      exchangeRateTimestamp: new Date(0).toISOString(),
      exchangeRates: [],
    };
    order.orderAdjustments = [
      { ...adjustmentBase, id: "add", type: "addition", name: "Handling", amount: 20, convertedAmount: 20 },
      { ...adjustmentBase, id: "deduct", type: "deduction", name: "Commercial credit", amount: 50, convertedAmount: 50 },
      {
        ...adjustmentBase,
        id: "post-return",
        type: "addition",
        name: "Refund correction",
        amount: 999,
        convertedAmount: 999,
        scope: "post_return",
        returnId: crypto.randomUUID(),
      },
    ];

    const calculation = commissions.calculateSalesOrderCommission(order, {
      ratePercent: 10,
      calculationBasis: "net_profit",
      includeTax: false,
      includeDeliveryCharge: false,
    });

    expect(calculation).toMatchObject({
      revenueAmount: 1969,
      costAmount: 600,
      basisAmount: 1369,
      commissionAmount: 136.9,
    });
  });

  it("ignores malformed persisted order adjustments", () => {
    const order = completedOrder(crypto.randomUUID());
    order.orderAdjustments = [
      {
        id: "valid",
        type: "addition",
        name: "Handling",
        currency: "usd",
        amount: 10,
        orderCurrency: "usd",
        convertedAmount: 10,
        exchangeRate: 1,
        exchangeRateSource: "native",
        exchangeRateTimestamp: new Date(0).toISOString(),
        exchangeRates: [],
      },
      { id: "bad-type", type: "mystery", name: "Bad", convertedAmount: 500 },
      { id: "", type: "deduction", name: "Missing id", convertedAmount: 500 },
      { id: "bad-amount", type: "deduction", name: "Bad amount", convertedAmount: -500 },
    ] as any;

    expect(commissions.calculateSalesOrderCommission(order, {
      ratePercent: 10,
      calculationBasis: "net_revenue",
      includeTax: false,
      includeDeliveryCharge: false,
    })).toMatchObject({ revenueAmount: 1010, commissionAmount: 101 });
  });

  it("accrues, reverses a partial return, and stores payouts as negative ledger events", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    const order = completedOrder(crypto.randomUUID());
    await db.agents.put(agent);
    await db.sales_orders.put(order);

    const plan = await commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Level 1",
      level: "level_1",
      ratePercent: 10,
      calculationBasis: "net_profit",
    });
    await commissions.setAgentCommissionMembership(WORKSPACE_ID, {
      agentId: agent.id,
      planId: plan.id,
    });
    const assignment = await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
      customerCitySnapshot: "Baghdad",
    });
    expect(assignment).not.toBeNull();

    const initialEntries = await db.agent_commission_entries.where("orderId").equals(order.id).toArray();
    expect(initialEntries).toEqual([
      expect.objectContaining({ kind: "accrual", status: "earned", amount: 40 }),
    ]);

    const returnedAt = new Date().toISOString();
    const updatedOrder: SalesOrder = {
      ...order,
      items: [{ ...order.items[0], returnedQuantity: 5 }],
      returnStatus: "partial",
      returnedAmount: 500,
      total: 500,
      subtotal: 500,
      updatedAt: returnedAt,
      version: 2,
    };
    const orderReturn: OrderReturn = {
      id: crypto.randomUUID(),
      workspaceId: WORKSPACE_ID,
      orderId: order.id,
      reason: "Customer return",
      status: "posted",
      refundAmount: 500,
      returnedBy: crypto.randomUUID(),
      returnedAt,
      createdAt: returnedAt,
      updatedAt: returnedAt,
      syncStatus: "synced",
      lastSyncedAt: returnedAt,
      version: 1,
      isDeleted: false,
    };
    await db.sales_orders.put(updatedOrder);
    await db.order_returns.put(orderReturn);
    const reversals = await commissions.reverseCommissionForOrderReturn(
      WORKSPACE_ID,
      orderReturn.id,
    );
    expect(reversals).toEqual([
      expect.objectContaining({ kind: "reversal", status: "reversed", amount: -20 }),
    ]);

    const payout = await commissions.recordCommissionPayout(WORKSPACE_ID, {
      agentId: agent.id,
      orderId: order.id,
      amount: 10,
      currency: "usd",
      paymentMethod: "cash",
    });
    expect(payout.amount).toBe(-10);
    expect(payout).toMatchObject({ orderId: order.id, payoutReference: order.orderNumber });
    const finalPayout = await commissions.recordCommissionPayout(WORKSPACE_ID, {
      agentId: agent.id,
      orderId: order.id,
      amount: 10,
      currency: "usd",
      paymentMethod: "cash",
    });
    expect(finalPayout.id).not.toBe(payout.id);
    await expect(commissions.recordCommissionPayout(WORKSPACE_ID, {
      agentId: agent.id,
      orderId: order.id,
      amount: 1,
      currency: "usd",
      paymentMethod: "cash",
    })).rejects.toThrow("selected order's outstanding commission");

    const allEntries = await db.agent_commission_entries.where("agentId").equals(agent.id).toArray();
    expect(allEntries.filter((entry) => entry.kind === "payout")).toHaveLength(2);
    const outstanding = allEntries
      .filter((entry) => entry.kind !== "approval" && entry.kind !== "estimate")
      .reduce((sum, entry) => sum + entry.amount, 0);
    expect(outstanding).toBe(0);

    const payoutTransactions = await db.payment_transactions
      .where("[workspaceId+sourceType+sourceRecordId]")
      .equals([WORKSPACE_ID, "agent_commission_payout", agent.id])
      .toArray();
    expect(payoutTransactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceModule: "orders",
        sourceType: "agent_commission_payout",
        sourceRecordId: agent.id,
        sourceSubrecordId: payout.id,
        direction: "outgoing",
        amount: 10,
        currency: "usd",
        paymentMethod: "cash",
        metadata: expect.objectContaining({ agentCommissionEntryId: payout.id }),
      }),
      expect.objectContaining({
        sourceSubrecordId: finalPayout.id,
        metadata: expect.objectContaining({ agentCommissionEntryId: finalPayout.id }),
      }),
    ]));
  });

  it("rejects commission payouts that cannot be paid through a real payment method", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    await db.agents.put(agent);
    const plan = await commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Level 1",
      level: "level_1",
      ratePercent: 10,
    });
    await commissions.setAgentCommissionMembership(WORKSPACE_ID, {
      agentId: agent.id,
      planId: plan.id,
    });
    const order = completedOrder(crypto.randomUUID());
    await db.sales_orders.put(order);
    await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
    });
    await commissions.accrueSalesOrderCommission(WORKSPACE_ID, order.id);

    await expect(commissions.recordCommissionPayout(WORKSPACE_ID, {
      agentId: agent.id,
      orderId: order.id,
      amount: 1,
      currency: "usd",
      paymentMethod: "credit",
    })).rejects.toThrow("valid commission payout payment method");
    expect(await db.payment_transactions.count()).toBe(0);
  });

  it("reuses only field agents and preserves membership history before replacement", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    const driver = fieldAgent(crypto.randomUUID(), "driver");
    await db.agents.bulkPut([agent, driver]);
    const level1 = await commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Level 1",
      level: "level_1",
      ratePercent: 5,
    });
    const level2 = await commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Level 2",
      level: "level_2",
      ratePercent: 7.5,
    });

    await expect(commissions.setAgentCommissionMembership(WORKSPACE_ID, {
      agentId: driver.id,
      planId: level1.id,
    })).rejects.toThrow("field agent");

    const first = await commissions.setAgentCommissionMembership(WORKSPACE_ID, {
      agentId: agent.id,
      planId: level1.id,
    });
    const second = await commissions.setAgentCommissionMembership(WORKSPACE_ID, {
      agentId: agent.id,
      planId: level2.id,
    });
    const history = await db.agent_commission_memberships.where("agentId").equals(agent.id).toArray();
    expect(first).not.toBeNull();
    expect(second?.planId).toBe(level2.id);
    expect(history.find((row) => row.id === first?.id)?.effectiveTo).toBeTruthy();
    expect(history.filter((row) => !row.effectiveTo)).toHaveLength(1);
  });

  it("allows only one configured plan for each commission level", async () => {
    await commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Level 1",
      level: "level_1",
      ratePercent: 5,
    });
    await expect(commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Duplicate level",
      level: "level_1",
      ratePercent: 7,
    })).rejects.toThrow("already has a commission plan");
  });

  it("revises used plan terms without rewriting accruals or late historical events", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    const order = completedOrder(crypto.randomUUID());
    const historicalOrder = {
      ...completedOrder(crypto.randomUUID()),
      orderNumber: "SO-1002",
      isPaid: false,
      paymentStatus: "unpaid" as const,
      paidAt: null,
      paidAmount: 0,
      balanceAmount: 1_000,
    };
    const futureOrder = { ...completedOrder(crypto.randomUUID()), orderNumber: "SO-1002" };
    await db.agents.put(agent);
    await db.sales_orders.bulkPut([order, historicalOrder, futureOrder]);
    const plan = await commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Level 1",
      level: "level_1",
      ratePercent: 10,
    });
    await commissions.setAgentCommissionMembership(WORKSPACE_ID, {
      agentId: agent.id,
      planId: plan.id,
    });
    await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
    });
    await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: historicalOrder.id,
      agentId: agent.id,
    });
    const original = await db.agent_commission_entries
      .where("orderId")
      .equals(order.id)
      .and((entry) => entry.kind === "accrual")
      .first();

    const actorId = crypto.randomUUID();
    const updated = await commissions.updateAgentCommissionPlan(plan.id, {
      ratePercent: 20,
      createdBy: actorId,
    });
    const frozen = await db.agent_commission_entries.get(original!.id);
    const closedPlan = await db.agent_commission_plans.get(plan.id);
    const membershipHistory = await db.agent_commission_memberships
      .where("agentId")
      .equals(agent.id)
      .sortBy("effectiveFrom");

    await db.sales_orders.put({
      ...historicalOrder,
      isPaid: true,
      paymentStatus: "paid",
      paidAt: historicalOrder.updatedAt,
      paidAmount: 1_000,
      balanceAmount: 0,
      version: historicalOrder.version + 1,
    });
    await commissions.accrueSalesOrderCommission(WORKSPACE_ID, historicalOrder.id);
    const historicalAccrual = await db.agent_commission_entries
      .where("orderId")
      .equals(historicalOrder.id)
      .and((entry) => entry.kind === "accrual")
      .first();

    await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: futureOrder.id,
      agentId: agent.id,
    });
    const futureAccrual = await db.agent_commission_entries
      .where("orderId")
      .equals(futureOrder.id)
      .and((entry) => entry.kind === "accrual")
      .first();

    expect(updated.id).not.toBe(plan.id);
    expect(updated.ratePercent).toBe(20);
    expect(closedPlan).toMatchObject({ isActive: false, effectiveTo: updated.effectiveFrom });
    expect(membershipHistory).toHaveLength(2);
    expect(membershipHistory[0]).toMatchObject({
      planId: plan.id,
      effectiveTo: updated.effectiveFrom,
      endedBy: actorId,
    });
    expect(membershipHistory[1]).toMatchObject({
      planId: updated.id,
      effectiveFrom: updated.effectiveFrom,
      effectiveTo: null,
      assignedBy: actorId,
    });
    expect(frozen).toMatchObject({ ratePercent: 10, amount: 40 });
    expect(historicalAccrual).toMatchObject({ planId: plan.id, ratePercent: 10, amount: 40 });
    expect(futureAccrual).toMatchObject({ ratePercent: 20, amount: 80 });
  });

  it("does not use a later generic order update to make a new membership retroactive", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    const order = completedOrder(crypto.randomUUID());
    order.actualDeliveryDate = "2026-01-01T10:00:00.000Z";
    order.paidAt = "2026-01-01T11:00:00.000Z";
    order.updatedAt = "2026-01-03T10:00:00.000Z";
    await db.agents.put(agent);
    await db.sales_orders.put(order);
    const plan = await commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Level 1",
      level: "level_1",
      ratePercent: 10,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    await commissions.setAgentCommissionMembership(WORKSPACE_ID, {
      agentId: agent.id,
      planId: plan.id,
      effectiveAt: "2026-01-02T00:00:00.000Z",
    });
    await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
      assignedAt: "2026-01-01T12:00:00.000Z",
    });

    expect(await db.agent_commission_entries.where("orderId").equals(order.id).count()).toBe(0);
  });

  it("records same-agent snapshot edits as assignment history", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    const order = completedOrder(crypto.randomUUID());
    await db.agents.put(agent);
    await db.sales_orders.put(order);

    const original = await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
      customerCitySnapshot: "Baghdad",
      deliveryChargeAmount: 5,
    });
    const updated = await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
      customerCitySnapshot: "Erbil",
      deliveryChargeAmount: 12,
      internalDeliveryCostAmount: 3,
      reason: "Corrected delivery snapshot",
    });

    expect(updated?.id).not.toBe(original?.id);
    expect(updated).toMatchObject({
      previousAssignmentId: original?.id,
      customerCitySnapshot: "Erbil",
      deliveryChargeAmount: 12,
      internalDeliveryCostAmount: 3,
    });
    const history = await db.sales_order_agent_assignments.where("orderId").equals(order.id).toArray();
    expect(history.find((row) => row.id === original?.id)?.unassignedAt).toBeTruthy();
    expect(history.filter((row) => !row.unassignedAt)).toHaveLength(1);
  });

  it("reconciles payment reversal and repayment with signed immutable adjustments", async () => {
    const agent = fieldAgent(crypto.randomUUID());
    const order = completedOrder(crypto.randomUUID());
    await db.agents.put(agent);
    await db.sales_orders.put(order);
    const plan = await commissions.createAgentCommissionPlan(WORKSPACE_ID, {
      name: "Level 1",
      level: "level_1",
      ratePercent: 10,
    });
    await commissions.setAgentCommissionMembership(WORKSPACE_ID, {
      agentId: agent.id,
      planId: plan.id,
    });
    await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: agent.id,
    });

    const suspendedAt = new Date(Date.now() + 1_000).toISOString();
    await db.sales_orders.put({
      ...order,
      isPaid: false,
      paymentStatus: "partial",
      paidAmount: 500,
      balanceAmount: 500,
      paidAt: null,
      updatedAt: suspendedAt,
      version: 2,
    });
    const suspended = await commissions.reconcileSalesOrderCommission(WORKSPACE_ID, order.id);
    expect(suspended).toMatchObject({ kind: "adjustment", status: "reversed", amount: -40 });
    await expect(commissions.reconcileSalesOrderCommission(WORKSPACE_ID, order.id)).resolves.toBeNull();

    const repaidAt = new Date(Date.now() + 2_000).toISOString();
    await db.sales_orders.put({ ...order, updatedAt: repaidAt, version: 3 });
    const restored = await commissions.reconcileSalesOrderCommission(WORKSPACE_ID, order.id);
    expect(restored).toMatchObject({ kind: "adjustment", status: "earned", amount: 40 });
    const recognized = (await db.agent_commission_entries.where("orderId").equals(order.id).toArray())
      .filter((entry) => ["accrual", "reversal", "adjustment"].includes(entry.kind))
      .reduce((sum, entry) => sum + entry.amount, 0);
    expect(recognized).toBe(40);
  });

  it("requires an order-linked adjustment to use that agent's assignment", async () => {
    const assignedAgent = fieldAgent(crypto.randomUUID());
    const otherAgent = fieldAgent(crypto.randomUUID());
    const order = completedOrder(crypto.randomUUID());
    await db.agents.bulkPut([assignedAgent, otherAgent]);
    await db.sales_orders.put(order);
    const assignment = await commissions.assignSalesOrderAgent(WORKSPACE_ID, {
      orderId: order.id,
      agentId: assignedAgent.id,
    });

    const adjustment = await commissions.recordCommissionAdjustment(WORKSPACE_ID, {
      agentId: assignedAgent.id,
      orderId: order.id,
      amount: 5,
      currency: "usd",
      notes: "Manual correction",
    });
    expect(adjustment.assignmentId).toBe(assignment?.id);

    await expect(commissions.recordCommissionAdjustment(WORKSPACE_ID, {
      agentId: assignedAgent.id,
      orderId: order.id,
      amount: 5,
      currency: "eur",
      notes: "Wrong currency",
    })).rejects.toThrow("must use the sales order currency");

    await expect(commissions.recordCommissionAdjustment(WORKSPACE_ID, {
      agentId: otherAgent.id,
      orderId: order.id,
      amount: 5,
      currency: "usd",
      notes: "Wrong agent",
    })).rejects.toThrow("not assigned to this agent");
  });
});
