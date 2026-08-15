import { useEffect, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { isOnline } from "@/lib/network";
import { getSupabaseClientForTable } from "@/lib/supabaseSchema";
import { runSupabaseAction } from "@/lib/supabaseRequest";
import { generateId, toSnakeCase } from "@/lib/utils";
import { isLocalWorkspaceMode } from "@/workspace/workspaceMode";

import { db } from "./database";
import { fetchTableFromSupabase } from "./hooks";
import { addToOfflineMutations } from "./offlineMutations";
import { appendPaymentTransaction } from "./payments";
import type {
  CurrencyCode,
  DeliveryFeePayer,
  DeliveryLedgerEntry,
  DeliveryLedgerEntryKind,
  DeliveryMerchantProfile,
  DeliveryPayoutSchedule,
  DeliveryRun,
  DeliveryRunItem,
  DeliverySettlement,
  DeliverySettlementType,
  DeliveryShipment,
  DeliveryShipmentEvent,
  DeliveryShipmentStatus,
  WorkspacePaymentMethod,
} from "./models";

const PROFILE_TABLE = "delivery_merchant_profiles";
const SHIPMENT_TABLE = "delivery_shipments";
const EVENT_TABLE = "delivery_shipment_events";
const RUN_TABLE = "delivery_runs";
const RUN_ITEM_TABLE = "delivery_run_items";
const SETTLEMENT_TABLE = "delivery_settlements";
const LEDGER_TABLE = "delivery_ledger_entries";

type DeliveryTableName =
  | typeof PROFILE_TABLE
  | typeof SHIPMENT_TABLE
  | typeof EVENT_TABLE
  | typeof RUN_TABLE
  | typeof RUN_ITEM_TABLE
  | typeof SETTLEMENT_TABLE
  | typeof LEDGER_TABLE;
type DeliveryEntity =
  | DeliveryMerchantProfile
  | DeliveryShipment
  | DeliveryShipmentEvent
  | DeliveryRun
  | DeliveryRunItem
  | DeliverySettlement
  | DeliveryLedgerEntry;

export interface DeliveryMerchantProfileInput {
  businessPartnerId: string;
  defaultFeeAmount?: number;
  defaultFeePayer?: DeliveryFeePayer;
  defaultPickupAddress?: string | null;
  payoutSchedule?: DeliveryPayoutSchedule;
  isActive?: boolean;
}

export interface CreateDeliveryShipmentInput {
  merchantProfileId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAlternatePhone?: string | null;
  recipientAddress: string;
  recipientCity?: string | null;
  description?: string | null;
  currency: CurrencyCode;
  codAmount: number;
  deliveryFee?: number;
  feePayer?: DeliveryFeePayer;
  sourceSalesOrderId?: string | null;
  createdBy?: string | null;
}

export interface CreateDeliveryRunInput {
  agentId: string;
  shipmentIds: string[];
  vehicleId?: string | null;
  dispatchedAt?: string;
  notes?: string | null;
  createdBy?: string | null;
}

export interface UpdateDeliveryShipmentStatusInput {
  status: Extract<
    DeliveryShipmentStatus,
    "ready_for_dispatch" | "delivered" | "postponed" | "returned" | "cancelled"
  >;
  note?: string | null;
  actorUserId?: string | null;
  actorAgentId?: string | null;
}

export interface SettleCourierInput {
  agentId: string;
  currency: CurrencyCode;
  actualAmount: number;
  paymentMethod: WorkspacePaymentMethod;
  settledAt?: string;
  note?: string | null;
  varianceNote?: string | null;
  createdBy?: string | null;
}

export interface PayDeliveryMerchantInput {
  merchantProfileId: string;
  currency: CurrencyCode;
  actualAmount: number;
  paymentMethod: WorkspacePaymentMethod;
  settledAt?: string;
  note?: string | null;
  varianceNote?: string | null;
  createdBy?: string | null;
}

export interface DeliveryBalance {
  id: string;
  currency: CurrencyCode;
  amount: number;
}

function shouldUseCloudDeliveryData(workspaceId?: string | null) {
  return !!workspaceId && !isLocalWorkspaceMode(workspaceId);
}

function getSyncMetadata(workspaceId: string, timestamp: string) {
  return shouldUseCloudDeliveryData(workspaceId)
    ? { syncStatus: "pending" as const, lastSyncedAt: null }
    : { syncStatus: "synced" as const, lastSyncedAt: timestamp };
}

function sanitizePayload(entity: DeliveryEntity) {
  const payload = toSnakeCase(entity as unknown as Record<string, unknown>);
  delete payload.sync_status;
  delete payload.last_synced_at;
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

function getTable(tableName: DeliveryTableName) {
  switch (tableName) {
    case PROFILE_TABLE:
      return db.delivery_merchant_profiles;
    case SHIPMENT_TABLE:
      return db.delivery_shipments;
    case EVENT_TABLE:
      return db.delivery_shipment_events;
    case RUN_TABLE:
      return db.delivery_runs;
    case RUN_ITEM_TABLE:
      return db.delivery_run_items;
    case SETTLEMENT_TABLE:
      return db.delivery_settlements;
    case LEDGER_TABLE:
      return db.delivery_ledger_entries;
  }
}

async function syncEntities(
  tableName: DeliveryTableName,
  entities: DeliveryEntity[],
  workspaceId: string,
) {
  if (entities.length === 0 || !shouldUseCloudDeliveryData(workspaceId)) {
    return;
  }

  if (!isOnline(workspaceId)) {
    await Promise.all(
      entities.map((entity) =>
        addToOfflineMutations(
          tableName,
          entity.id,
          entity.version > 1 ? "update" : "create",
          entity as unknown as Record<string, unknown>,
          workspaceId,
        ),
      ),
    );
    return;
  }

  try {
    const client = getSupabaseClientForTable(tableName);
    const { error } = (await runSupabaseAction(`${tableName}.sync`, () =>
      client.from(tableName).upsert(entities.map(sanitizePayload)),
    )) as { error?: unknown };
    if (error) throw error;

    const syncedAt = new Date().toISOString();
    await getTable(tableName).bulkUpdate(
      entities.map((entity) => ({
        key: entity.id,
        changes: { syncStatus: "synced", lastSyncedAt: syncedAt },
      })) as never,
    );
  } catch (error) {
    console.error(`[Post Service] Failed to sync ${tableName}:`, error);
    await Promise.all(
      entities.map((entity) =>
        addToOfflineMutations(
          tableName,
          entity.id,
          entity.version > 1 ? "update" : "create",
          entity as unknown as Record<string, unknown>,
          workspaceId,
        ),
      ),
    );
  }
}

async function hydrateTable(tableName: DeliveryTableName, workspaceId: string) {
  if (!shouldUseCloudDeliveryData(workspaceId)) return;
  await fetchTableFromSupabase(tableName, getTable(tableName), workspaceId);
}

function normalizeText(value?: string | null) {
  const result = String(value ?? "").trim();
  return result || null;
}

function positiveMoney(value: number, label: string, allowZero = true) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount <= 0)) {
    throw new Error(`${label} must be ${allowZero ? "zero or greater" : "greater than zero"}`);
  }
  return amount;
}

function makeReference(prefix: string, timestamp = new Date()) {
  const date = timestamp.toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${generateId().slice(0, 6).toUpperCase()}`;
}

function makeBase<T extends Record<string, unknown>>(
  workspaceId: string,
  data: T,
): T & { id: string; workspaceId: string; createdAt: string; updatedAt: string; version: number; isDeleted: false; syncStatus: "pending" | "synced"; lastSyncedAt: string | null } {
  const now = new Date().toISOString();
  return {
    ...data,
    id: generateId(),
    workspaceId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
    ...getSyncMetadata(workspaceId, now),
  };
}

function makeLedgerEntry(
  workspaceId: string,
  input: Omit<DeliveryLedgerEntry, "id" | "workspaceId" | "createdAt" | "updatedAt" | "version" | "isDeleted" | "syncStatus" | "lastSyncedAt">,
) {
  return makeBase(workspaceId, input) as DeliveryLedgerEntry;
}

function sumLedger(rows: DeliveryLedgerEntry[], predicate: (row: DeliveryLedgerEntry) => boolean) {
  return rows.filter((row) => !row.isDeleted && predicate(row)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function assertSettlementAmount(expectedAmount: number, actualAmount: number, varianceNote?: string | null) {
  const expected = Math.max(0, Number(expectedAmount || 0));
  const actual = positiveMoney(actualAmount, "Settlement amount", false);
  if (actual > expected + 0.000001) {
    throw new Error("Settlement amount cannot exceed the outstanding balance");
  }
  if (Math.abs(expected - actual) > 0.000001 && !normalizeText(varianceNote)) {
    throw new Error("Explain a partial settlement before confirming it");
  }
  return { expected, actual };
}

export function useDeliveryMerchantProfiles(workspaceId?: string) {
  const online = useNetworkStatus();
  const rows = useLiveQuery(
    () => workspaceId
      ? db.delivery_merchant_profiles.where("workspaceId").equals(workspaceId).and((row) => !row.isDeleted).toArray()
      : [],
    [workspaceId],
  ) ?? [];

  useEffect(() => {
    if (workspaceId && online) {
      void hydrateTable(PROFILE_TABLE, workspaceId).catch((error) =>
        console.error("[Post Service] Failed to hydrate merchant profiles:", error),
      );
    }
  }, [online, workspaceId]);

  return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function useDeliveryShipments(workspaceId?: string) {
  const online = useNetworkStatus();
  const rows = useLiveQuery(
    () => workspaceId
      ? db.delivery_shipments.where("workspaceId").equals(workspaceId).and((row) => !row.isDeleted).toArray()
      : [],
    [workspaceId],
  ) ?? [];

  useEffect(() => {
    if (workspaceId && online) {
      void hydrateTable(SHIPMENT_TABLE, workspaceId).catch((error) =>
        console.error("[Post Service] Failed to hydrate shipments:", error),
      );
    }
  }, [online, workspaceId]);

  return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function useDeliveryRuns(workspaceId?: string) {
  const online = useNetworkStatus();
  const rows = useLiveQuery(
    () => workspaceId
      ? db.delivery_runs.where("workspaceId").equals(workspaceId).and((row) => !row.isDeleted).toArray()
      : [],
    [workspaceId],
  ) ?? [];

  useEffect(() => {
    if (workspaceId && online) {
      void hydrateTable(RUN_TABLE, workspaceId).catch((error) =>
        console.error("[Post Service] Failed to hydrate dispatch runs:", error),
      );
    }
  }, [online, workspaceId]);

  return rows.sort((left, right) => right.dispatchedAt.localeCompare(left.dispatchedAt));
}

export function useDeliverySettlements(workspaceId?: string) {
  const online = useNetworkStatus();
  const rows = useLiveQuery(
    () => workspaceId
      ? db.delivery_settlements.where("workspaceId").equals(workspaceId).and((row) => !row.isDeleted).toArray()
      : [],
    [workspaceId],
  ) ?? [];

  useEffect(() => {
    if (workspaceId && online) {
      void hydrateTable(SETTLEMENT_TABLE, workspaceId).catch((error) =>
        console.error("[Post Service] Failed to hydrate settlements:", error),
      );
    }
  }, [online, workspaceId]);

  return rows.sort((left, right) => right.settledAt.localeCompare(left.settledAt));
}

export function useDeliveryLedgerEntries(workspaceId?: string) {
  const online = useNetworkStatus();
  const rows = useLiveQuery(
    () => workspaceId
      ? db.delivery_ledger_entries.where("workspaceId").equals(workspaceId).and((row) => !row.isDeleted).toArray()
      : [],
    [workspaceId],
  ) ?? [];

  useEffect(() => {
    if (workspaceId && online) {
      void hydrateTable(LEDGER_TABLE, workspaceId).catch((error) =>
        console.error("[Post Service] Failed to hydrate delivery balances:", error),
      );
    }
  }, [online, workspaceId]);

  return rows;
}

export function useCourierDeliveryBalances(workspaceId?: string) {
  const entries = useDeliveryLedgerEntries(workspaceId);
  return useMemo<DeliveryBalance[]>(() => {
    const totals = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.agentId) continue;
      const key = `${entry.agentId}:${entry.currency}`;
      totals.set(key, (totals.get(key) ?? 0) + Number(entry.amount || 0));
    }
    return [...totals.entries()]
      .map(([key, amount]) => {
        const [id, currency] = key.split(":");
        return { id, currency: currency as CurrencyCode, amount };
      })
      .filter((item) => Math.abs(item.amount) > 0.000001);
  }, [entries]);
}

export function useMerchantDeliveryBalances(workspaceId?: string) {
  const entries = useDeliveryLedgerEntries(workspaceId);
  return useMemo<DeliveryBalance[]>(() => {
    const totals = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.merchantProfileId) continue;
      const key = `${entry.merchantProfileId}:${entry.currency}`;
      totals.set(key, (totals.get(key) ?? 0) + Number(entry.amount || 0));
    }
    return [...totals.entries()]
      .map(([key, amount]) => {
        const [id, currency] = key.split(":");
        return { id, currency: currency as CurrencyCode, amount };
      })
      .filter((item) => Math.abs(item.amount) > 0.000001);
  }, [entries]);
}

export async function createDeliveryMerchantProfile(
  workspaceId: string,
  input: DeliveryMerchantProfileInput,
) {
  const partner = await db.business_partners.get(input.businessPartnerId);
  if (!partner || partner.isDeleted || partner.workspaceId !== workspaceId) {
    throw new Error("Select a business partner in this workspace");
  }
  const current = await db.delivery_merchant_profiles
    .where("[workspaceId+businessPartnerId]")
    .equals([workspaceId, input.businessPartnerId])
    .and((row) => !row.isDeleted)
    .first();
  if (current) return current;

  const profile = makeBase(workspaceId, {
    businessPartnerId: input.businessPartnerId,
    defaultFeeAmount: positiveMoney(input.defaultFeeAmount ?? 0, "Default delivery fee"),
    defaultFeePayer: input.defaultFeePayer ?? "merchant",
    defaultPickupAddress: normalizeText(input.defaultPickupAddress),
    payoutSchedule: input.payoutSchedule ?? "daily",
    isActive: input.isActive ?? true,
  }) as DeliveryMerchantProfile;
  await db.delivery_merchant_profiles.put(profile);
  await syncEntities(PROFILE_TABLE, [profile], workspaceId);
  return profile;
}

export async function createDeliveryShipment(
  workspaceId: string,
  input: CreateDeliveryShipmentInput,
) {
  const profile = await db.delivery_merchant_profiles.get(input.merchantProfileId);
  if (!profile || profile.isDeleted || !profile.isActive || profile.workspaceId !== workspaceId) {
    throw new Error("Select an active delivery merchant");
  }
  if (!input.recipientName.trim() || !input.recipientPhone.trim() || !input.recipientAddress.trim()) {
    throw new Error("Recipient name, phone, and address are required");
  }
  const now = new Date().toISOString();
  const shipment = makeBase(workspaceId, {
    trackingNumber: makeReference("PST"),
    merchantProfileId: profile.id,
    merchantBusinessPartnerId: profile.businessPartnerId,
    recipientName: input.recipientName.trim(),
    recipientPhone: input.recipientPhone.trim(),
    recipientAlternatePhone: normalizeText(input.recipientAlternatePhone),
    recipientAddress: input.recipientAddress.trim(),
    recipientCity: normalizeText(input.recipientCity),
    recipientLatitude: null,
    recipientLongitude: null,
    description: normalizeText(input.description),
    currency: input.currency,
    codAmount: positiveMoney(input.codAmount, "COD amount"),
    deliveryFee: positiveMoney(input.deliveryFee ?? profile.defaultFeeAmount, "Delivery fee"),
    feePayer: input.feePayer ?? profile.defaultFeePayer,
    status: "received" as const,
    assignedAgentId: null,
    assignedRunId: null,
    deliveredAt: null,
    postponedAt: null,
    returnedAt: null,
    statusNote: null,
    sourceSalesOrderId: input.sourceSalesOrderId ?? null,
    createdBy: input.createdBy ?? null,
  }) as DeliveryShipment;
  const event = makeBase(workspaceId, {
    shipmentId: shipment.id,
    previousStatus: null,
    status: "received" as const,
    note: null,
    actorUserId: input.createdBy ?? null,
    actorAgentId: null,
    occurredAt: now,
  }) as DeliveryShipmentEvent;

  await db.transaction("rw", [db.delivery_shipments, db.delivery_shipment_events], async () => {
    await db.delivery_shipments.put(shipment);
    await db.delivery_shipment_events.put(event);
  });
  await Promise.all([
    syncEntities(SHIPMENT_TABLE, [shipment], workspaceId),
    syncEntities(EVENT_TABLE, [event], workspaceId),
  ]);
  return shipment;
}

export async function createDeliveryRun(workspaceId: string, input: CreateDeliveryRunInput) {
  const agent = await db.agents.get(input.agentId);
  if (!agent || agent.isDeleted || agent.workspaceId !== workspaceId || agent.status !== "active") {
    throw new Error("Select an active courier");
  }
  const shipmentIds = [...new Set(input.shipmentIds.filter(Boolean))];
  if (shipmentIds.length === 0) throw new Error("Select at least one shipment");
  const shipments = await db.delivery_shipments.bulkGet(shipmentIds);
  if (shipments.some((shipment) => !shipment || shipment.isDeleted || shipment.workspaceId !== workspaceId || !["received", "ready_for_dispatch", "postponed"].includes(shipment.status))) {
    throw new Error("Only unassigned, ready, or postponed shipments can be dispatched");
  }

  const now = input.dispatchedAt ? new Date(input.dispatchedAt).toISOString() : new Date().toISOString();
  const run = makeBase(workspaceId, {
    runNumber: makeReference("RUN", new Date(now)),
    agentId: agent.id,
    vehicleId: input.vehicleId ?? null,
    status: "open" as const,
    dispatchedAt: now,
    closedAt: null,
    notes: normalizeText(input.notes),
    createdBy: input.createdBy ?? null,
  }) as DeliveryRun;
  const updates: DeliveryShipment[] = [];
  const items: DeliveryRunItem[] = [];
  const events: DeliveryShipmentEvent[] = [];
  for (const original of shipments as DeliveryShipment[]) {
    const updated: DeliveryShipment = {
      ...original,
      status: "assigned",
      assignedAgentId: agent.id,
      assignedRunId: run.id,
      statusNote: null,
      updatedAt: now,
      version: original.version + 1,
      ...getSyncMetadata(workspaceId, now),
    };
    updates.push(updated);
    items.push(makeBase(workspaceId, {
      runId: run.id,
      shipmentId: original.id,
      assignedAt: now,
      returnedAt: null,
    }) as DeliveryRunItem);
    events.push(makeBase(workspaceId, {
      shipmentId: original.id,
      previousStatus: original.status,
      status: "assigned",
      note: normalizeText(input.notes),
      actorUserId: input.createdBy ?? null,
      actorAgentId: agent.id,
      occurredAt: now,
    }) as DeliveryShipmentEvent);
  }

  await db.transaction("rw", [db.delivery_runs, db.delivery_shipments, db.delivery_run_items, db.delivery_shipment_events], async () => {
    await db.delivery_runs.put(run);
    await db.delivery_shipments.bulkPut(updates);
    await db.delivery_run_items.bulkPut(items);
    await db.delivery_shipment_events.bulkPut(events);
  });
  await Promise.all([
    syncEntities(RUN_TABLE, [run], workspaceId),
    syncEntities(SHIPMENT_TABLE, updates, workspaceId),
    syncEntities(RUN_ITEM_TABLE, items, workspaceId),
    syncEntities(EVENT_TABLE, events, workspaceId),
  ]);
  return run;
}

export async function updateDeliveryShipmentStatus(
  shipmentId: string,
  input: UpdateDeliveryShipmentStatusInput,
) {
  const original = await db.delivery_shipments.get(shipmentId);
  if (!original || original.isDeleted) throw new Error("Shipment not found");
  if (["delivered", "returned", "cancelled"].includes(original.status)) {
    throw new Error("A completed shipment cannot be changed. Record an adjustment instead.");
  }
  const note = normalizeText(input.note);
  if (["postponed", "returned", "cancelled"].includes(input.status) && !note) {
    throw new Error("A reason is required for this status");
  }
  if (["delivered", "postponed", "returned"].includes(input.status) && !original.assignedAgentId) {
    throw new Error("Assign the shipment to a courier first");
  }
  if (input.actorAgentId && original.assignedAgentId && input.actorAgentId !== original.assignedAgentId) {
    throw new Error("A courier can only update shipments assigned to them");
  }

  const now = new Date().toISOString();
  const updated: DeliveryShipment = {
    ...original,
    status: input.status,
    statusNote: note,
    deliveredAt: input.status === "delivered" ? now : null,
    postponedAt: input.status === "postponed" ? now : original.postponedAt ?? null,
    returnedAt: input.status === "returned" ? now : null,
    updatedAt: now,
    version: original.version + 1,
    ...getSyncMetadata(original.workspaceId, now),
  };
  const event = makeBase(original.workspaceId, {
    shipmentId: original.id,
    previousStatus: original.status,
    status: input.status,
    note,
    actorUserId: input.actorUserId ?? null,
    actorAgentId: input.actorAgentId ?? original.assignedAgentId ?? null,
    occurredAt: now,
  }) as DeliveryShipmentEvent;
  const ledgerEntries: DeliveryLedgerEntry[] = [];
  if (input.status === "delivered") {
    const collected = original.codAmount + (original.feePayer === "recipient" ? original.deliveryFee : 0);
    ledgerEntries.push(
      makeLedgerEntry(original.workspaceId, {
        kind: "courier_collection",
        shipmentId: original.id,
        settlementId: null,
        agentId: original.assignedAgentId,
        merchantProfileId: null,
        businessPartnerId: null,
        amount: collected,
        currency: original.currency,
        occurredAt: now,
        note: `Collected on ${original.trackingNumber}`,
        createdBy: input.actorUserId ?? null,
      }),
      makeLedgerEntry(original.workspaceId, {
        kind: "merchant_cod_payable",
        shipmentId: original.id,
        settlementId: null,
        agentId: null,
        merchantProfileId: original.merchantProfileId,
        businessPartnerId: original.merchantBusinessPartnerId,
        amount: original.codAmount,
        currency: original.currency,
        occurredAt: now,
        note: `COD from ${original.trackingNumber}`,
        createdBy: input.actorUserId ?? null,
      }),
    );
    if (original.feePayer === "merchant" && original.deliveryFee > 0) {
      ledgerEntries.push(makeLedgerEntry(original.workspaceId, {
        kind: "merchant_fee",
        shipmentId: original.id,
        settlementId: null,
        agentId: null,
        merchantProfileId: original.merchantProfileId,
        businessPartnerId: original.merchantBusinessPartnerId,
        amount: -original.deliveryFee,
        currency: original.currency,
        occurredAt: now,
        note: `Delivery fee for ${original.trackingNumber}`,
        createdBy: input.actorUserId ?? null,
      }));
    }
  }

  await db.transaction("rw", [db.delivery_shipments, db.delivery_shipment_events, db.delivery_ledger_entries], async () => {
    await db.delivery_shipments.put(updated);
    await db.delivery_shipment_events.put(event);
    if (ledgerEntries.length > 0) await db.delivery_ledger_entries.bulkPut(ledgerEntries);
  });
  await Promise.all([
    syncEntities(SHIPMENT_TABLE, [updated], original.workspaceId),
    syncEntities(EVENT_TABLE, [event], original.workspaceId),
    syncEntities(LEDGER_TABLE, ledgerEntries, original.workspaceId),
  ]);
  return updated;
}

async function createSettlement(
  workspaceId: string,
  type: DeliverySettlementType,
  options: {
    agentId?: string | null;
    merchantProfileId?: string | null;
    businessPartnerId?: string | null;
    currency: CurrencyCode;
    actualAmount: number;
    paymentMethod: WorkspacePaymentMethod;
    settledAt?: string;
    note?: string | null;
    varianceNote?: string | null;
    createdBy?: string | null;
  },
) {
  const entries = await db.delivery_ledger_entries.where("workspaceId").equals(workspaceId).toArray();
  const expectedAmount = type === "courier_remittance"
    ? sumLedger(entries, (entry) => entry.agentId === options.agentId && entry.currency === options.currency)
    : sumLedger(entries, (entry) => entry.merchantProfileId === options.merchantProfileId && entry.currency === options.currency);
  const { expected, actual } = assertSettlementAmount(expectedAmount, options.actualAmount, options.varianceNote);
  const settledAt = options.settledAt ? new Date(options.settledAt).toISOString() : new Date().toISOString();
  const settlement = makeBase(workspaceId, {
    settlementNumber: makeReference(type === "courier_remittance" ? "CR" : "MP", new Date(settledAt)),
    type,
    agentId: options.agentId ?? null,
    merchantProfileId: options.merchantProfileId ?? null,
    businessPartnerId: options.businessPartnerId ?? null,
    currency: options.currency,
    expectedAmount: expected,
    actualAmount: actual,
    varianceAmount: actual - expected,
    varianceNote: normalizeText(options.varianceNote),
    paymentMethod: options.paymentMethod,
    settledAt,
    note: normalizeText(options.note),
    paymentTransactionId: null,
    createdBy: options.createdBy ?? null,
  }) as DeliverySettlement;
  const entryKind: DeliveryLedgerEntryKind = type === "courier_remittance"
    ? "courier_remittance"
    : "merchant_payout";
  const ledgerEntry = makeLedgerEntry(workspaceId, {
    kind: entryKind,
    shipmentId: null,
    settlementId: settlement.id,
    agentId: type === "courier_remittance" ? options.agentId ?? null : null,
    merchantProfileId: type === "merchant_payout" ? options.merchantProfileId ?? null : null,
    businessPartnerId: type === "merchant_payout" ? options.businessPartnerId ?? null : null,
    amount: -actual,
    currency: options.currency,
    occurredAt: settledAt,
    note: normalizeText(options.note),
    createdBy: options.createdBy ?? null,
  });

  await db.transaction("rw", [db.delivery_settlements, db.delivery_ledger_entries], async () => {
    await db.delivery_settlements.put(settlement);
    await db.delivery_ledger_entries.put(ledgerEntry);
  });
  await Promise.all([
    syncEntities(SETTLEMENT_TABLE, [settlement], workspaceId),
    syncEntities(LEDGER_TABLE, [ledgerEntry], workspaceId),
  ]);

  const payment = await appendPaymentTransaction(workspaceId, {
    sourceModule: "post_service",
    sourceType: type === "courier_remittance" ? "delivery_courier_remittance" : "delivery_merchant_payout",
    sourceRecordId: settlement.id,
    direction: type === "courier_remittance" ? "incoming" : "outgoing",
    amount: actual,
    currency: options.currency,
    paymentMethod: options.paymentMethod,
    paidAt: settledAt,
    counterpartyName: null,
    referenceLabel: settlement.settlementNumber,
    note: normalizeText(options.note),
    createdBy: options.createdBy ?? null,
    metadata: {
      deliverySettlementId: settlement.id,
      expectedAmount: expected,
      varianceAmount: actual - expected,
    },
  });
  const settlementWithPayment: DeliverySettlement = {
    ...settlement,
    paymentTransactionId: payment.id,
    updatedAt: new Date().toISOString(),
    version: settlement.version + 1,
    ...getSyncMetadata(workspaceId, new Date().toISOString()),
  };
  await db.delivery_settlements.put(settlementWithPayment);
  await syncEntities(SETTLEMENT_TABLE, [settlementWithPayment], workspaceId);
  return settlementWithPayment;
}

export async function settleDeliveryCourier(workspaceId: string, input: SettleCourierInput) {
  const agent = await db.agents.get(input.agentId);
  if (!agent || agent.isDeleted || agent.workspaceId !== workspaceId) {
    throw new Error("Courier not found");
  }
  return createSettlement(workspaceId, "courier_remittance", input);
}

export async function payDeliveryMerchant(workspaceId: string, input: PayDeliveryMerchantInput) {
  const profile = await db.delivery_merchant_profiles.get(input.merchantProfileId);
  if (!profile || profile.isDeleted || profile.workspaceId !== workspaceId) {
    throw new Error("Merchant not found");
  }
  return createSettlement(workspaceId, "merchant_payout", {
    ...input,
    businessPartnerId: profile.businessPartnerId,
  });
}

export async function closeDeliveryRun(runId: string) {
  const current = await db.delivery_runs.get(runId);
  if (!current || current.isDeleted || current.status !== "open") return current;
  const now = new Date().toISOString();
  const updated: DeliveryRun = {
    ...current,
    status: "closed",
    closedAt: now,
    updatedAt: now,
    version: current.version + 1,
    ...getSyncMetadata(current.workspaceId, now),
  };
  await db.delivery_runs.put(updated);
  await syncEntities(RUN_TABLE, [updated], current.workspaceId);
  return updated;
}

