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

export type PostServiceTab = "posts" | "dispatch" | "my-deliveries" | "merchants" | "settlements";
type PostServiceRefreshTableName = DeliveryTableName | "business_partners" | "agents" | "fleet_vehicles";

const POST_SERVICE_TAB_REFRESH_TABLES: Record<PostServiceTab, readonly PostServiceRefreshTableName[]> = {
  posts: ["business_partners", PROFILE_TABLE, SHIPMENT_TABLE],
  dispatch: ["business_partners", "agents", "fleet_vehicles", SHIPMENT_TABLE, RUN_TABLE],
  "my-deliveries": ["business_partners", "agents", SHIPMENT_TABLE],
  merchants: ["business_partners", PROFILE_TABLE],
  settlements: ["business_partners", "agents", PROFILE_TABLE, SETTLEMENT_TABLE, LEDGER_TABLE],
};

export interface DeliveryMerchantProfileInput {
  businessPartnerId: string;
  defaultFeeAmount?: number;
  defaultFeePayer?: DeliveryFeePayer;
  defaultPickupAddress?: string | null;
  payoutSchedule?: DeliveryPayoutSchedule;
  isActive?: boolean;
}

export interface UpdateDeliveryMerchantProfileInput {
  defaultFeeAmount: number;
  defaultFeePayer: DeliveryFeePayer;
  defaultPickupAddress?: string | null;
  payoutSchedule: DeliveryPayoutSchedule;
  isActive: boolean;
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

/**
 * A display-only sale projection for the reporting surfaces. A delivery post
 * is not a POS sale: the COD amount belongs to the merchant. Only the fee
 * earned for a delivered shipment is exposed as revenue.
 */
export interface DeliverySaleProjectionOptions {
  merchantName?: string | null;
  merchantBusinessPartnerId?: string | null;
  serviceName?: string;
  serviceCategory?: string;
  feePayerNote?: string | null;
}

export function toUISaleFromDeliveryShipment(
  shipment: DeliveryShipment,
  options: DeliverySaleProjectionOptions = {},
): any {
  const serviceName = options.serviceName?.trim() || "Delivery service";
  const serviceCategory = options.serviceCategory?.trim() || serviceName;
  const deliveryFee = Number(shipment.deliveryFee || 0);
  const notes = [shipment.description?.trim(), options.feePayerNote?.trim()]
    .filter((value): value is string => !!value)
    .join(" | ") || null;

  return {
    id: shipment.id,
    workspace_id: shipment.workspaceId,
    cashier_id: shipment.createdBy || "",
    total_amount: deliveryFee,
    settlement_currency: shipment.currency,
    created_at: shipment.deliveredAt || shipment.updatedAt,
    updated_at: shipment.updatedAt,
    origin: "post_service",
    // Settlement methods can differ from one post to another, so the actual
    // cash method stays on the settlement in the ledger rather than being
    // guessed on this earned-revenue projection.
    payment_method: null,
    cashier_name: serviceName,
    items: [{
      id: `delivery-fee:${shipment.id}`,
      sale_id: shipment.id,
      product_id: "delivery_service_fee",
      product_name: `${serviceName} · ${shipment.trackingNumber}`,
      product_sku: "DELIVERY-FEE",
      product_category: serviceCategory,
      quantity: 1,
      unit_price: deliveryFee,
      total_price: deliveryFee,
      cost_price: 0,
      converted_cost_price: 0,
      original_currency: shipment.currency,
      original_unit_price: deliveryFee,
      converted_unit_price: deliveryFee,
      settlement_currency: shipment.currency,
      returned_quantity: 0,
      is_returned: false,
      product: {
        name: `${serviceName} · ${shipment.trackingNumber}`,
        sku: "DELIVERY-FEE",
        category: serviceCategory,
        can_be_returned: false,
      },
    }],
    is_returned: false,
    has_partial_return: false,
    sequenceId: shipment.trackingNumber,
    notes,
    partyName: options.merchantName?.trim() || null,
    business_partner_id: options.merchantBusinessPartnerId ?? null,
    _isPostService: true,
    _deliveryShipmentId: shipment.id,
    _trackingNumber: shipment.trackingNumber,
    _deliveryFeePayer: shipment.feePayer,
  };
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

function getPostServiceRefreshTable(tableName: PostServiceRefreshTableName) {
  switch (tableName) {
    case "business_partners":
      return db.business_partners;
    case "agents":
      return db.agents;
    case "fleet_vehicles":
      return db.fleet_vehicles;
    default:
      return getTable(tableName);
  }
}

/** Refresh only the records rendered by the selected Post Service tab. */
export async function refreshPostServiceTab(workspaceId: string, tab: PostServiceTab) {
  if (!shouldUseCloudDeliveryData(workspaceId)) return;

  await Promise.all(
    POST_SERVICE_TAB_REFRESH_TABLES[tab].map((tableName) =>
      fetchTableFromSupabase(tableName, getPostServiceRefreshTable(tableName), workspaceId),
    ),
  );
}

async function syncEntities(
  tableName: DeliveryTableName,
  entities: DeliveryEntity[],
  workspaceId: string,
): Promise<boolean> {
  if (entities.length === 0 || !shouldUseCloudDeliveryData(workspaceId)) {
    return true;
  }

  if (!isOnline(workspaceId)) {
    await queueSyncEntities(tableName, entities, workspaceId);
    return false;
  }

  try {
    const client = getSupabaseClientForTable(tableName);
    const receivesTrackingNumber = tableName === SHIPMENT_TABLE;
    let result: { data?: unknown; error?: unknown };
    if (receivesTrackingNumber) {
      result = await runSupabaseAction(`${tableName}.sync`, () =>
        client.from(SHIPMENT_TABLE).upsert(entities.map(sanitizePayload)).select("id, tracking_number"),
      );
    } else {
      result = await runSupabaseAction(`${tableName}.sync`, () =>
        client.from(tableName).upsert(entities.map(sanitizePayload)),
      );
    }
    const { data, error } = result as { data?: unknown; error?: unknown };
    if (error) throw error;

    const trackingNumbers = new Map<string, string>();
    if (receivesTrackingNumber && Array.isArray(data)) {
      for (const row of data) {
        if (!row || typeof row !== "object") continue;
        const remoteShipment = row as { id?: unknown; tracking_number?: unknown };
        if (typeof remoteShipment.id === "string" && typeof remoteShipment.tracking_number === "string") {
          trackingNumbers.set(remoteShipment.id, remoteShipment.tracking_number);
        }
      }
    }

    const syncedAt = new Date().toISOString();
    await getTable(tableName).bulkUpdate(
      entities.map((entity) => {
        const trackingNumber = trackingNumbers.get(entity.id);
        if (trackingNumber && tableName === SHIPMENT_TABLE) {
          (entity as DeliveryShipment).trackingNumber = trackingNumber;
        }
        return {
          key: entity.id,
          changes: {
            ...(trackingNumber ? { trackingNumber } : {}),
            syncStatus: "synced",
            lastSyncedAt: syncedAt,
          },
        };
      }) as never,
    );
    return true;
  } catch (error) {
    console.error(`[Post Service] Failed to sync ${tableName}:`, error);
    await queueSyncEntities(tableName, entities, workspaceId);
    return false;
  }
}

async function queueSyncEntities(
  tableName: DeliveryTableName,
  entities: DeliveryEntity[],
  workspaceId: string,
) {
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

/**
 * Delivery rows have foreign-key links. Keep their cloud writes in the same
 * order as the relationship graph, and queue dependants without attempting a
 * server write when a parent could not be accepted yet.
 */
async function syncEntitiesInDependencyOrder(
  workspaceId: string,
  operations: Array<readonly [DeliveryTableName, DeliveryEntity[]]>,
) {
  let canSyncDependants = true;

  for (const [tableName, entities] of operations) {
    if (!canSyncDependants) {
      await queueSyncEntities(tableName, entities, workspaceId);
      continue;
    }

    canSyncDependants = await syncEntities(tableName, entities, workspaceId);
  }
}

async function syncHardDeleteProfile(profileId: string, workspaceId: string) {
  if (!shouldUseCloudDeliveryData(workspaceId)) return;

  if (!isOnline(workspaceId)) {
    await addToOfflineMutations(PROFILE_TABLE, profileId, "delete", { id: profileId, hardDelete: true }, workspaceId);
    return;
  }

  try {
    const client = getSupabaseClientForTable(PROFILE_TABLE);
    const { error } = (await runSupabaseAction(`${PROFILE_TABLE}.hardDelete`, () =>
      client.from(PROFILE_TABLE).delete().eq("id", profileId),
    )) as { error?: unknown };
    if (error) throw error;
  } catch (error) {
    console.error(`[Post Service] Failed to hard delete ${PROFILE_TABLE}:`, error);
    await addToOfflineMutations(PROFILE_TABLE, profileId, "delete", { id: profileId, hardDelete: true }, workspaceId);
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
  const date = timestamp.toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${date}-${generateId().slice(0, 6).toUpperCase()}`;
}

function getBaghdadDate(timestamp = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}${values.month}${values.day}`;
}

async function getInitialShipmentTrackingNumber(workspaceId: string) {
  if (shouldUseCloudDeliveryData(workspaceId)) {
    // Supabase replaces this during the insert with the authoritative,
    // workspace-wide daily sequence. A non-numeric placeholder cannot be
    // mistaken for a final tracking number while the device is offline.
    return `PST-PENDING-${generateId().toUpperCase()}`;
  }

  const trackingDay = getBaghdadDate();
  const trackingPattern = new RegExp(`^PST-${trackingDay}-(\\d+)$`);
  const shipments = await db.delivery_shipments
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  const nextSequence = shipments.reduce((highest, shipment) => {
    const match = shipment.trackingNumber.match(trackingPattern);
    return Math.max(highest, match ? Number(match[1]) : 0);
  }, 0) + 1;

  return `PST-${trackingDay}-${String(nextSequence).padStart(5, "0")}`;
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

export async function updateDeliveryMerchantProfile(
  profileId: string,
  input: UpdateDeliveryMerchantProfileInput,
) {
  const profile = await db.delivery_merchant_profiles.get(profileId);
  if (!profile || profile.isDeleted) throw new Error("Merchant not found");

  const now = new Date().toISOString();
  const updated: DeliveryMerchantProfile = {
    ...profile,
    defaultFeeAmount: positiveMoney(input.defaultFeeAmount, "Default delivery fee"),
    defaultFeePayer: input.defaultFeePayer,
    defaultPickupAddress: normalizeText(input.defaultPickupAddress),
    payoutSchedule: input.payoutSchedule,
    isActive: input.isActive,
    updatedAt: now,
    version: profile.version + 1,
    ...getSyncMetadata(profile.workspaceId, now),
  };
  await db.delivery_merchant_profiles.put(updated);
  await syncEntities(PROFILE_TABLE, [updated], profile.workspaceId);
  return updated;
}

export async function hardDeleteDeliveryMerchantProfile(profileId: string) {
  const profile = await db.delivery_merchant_profiles.get(profileId);
  if (!profile || profile.isDeleted) return;

  const [shipment, ledgerEntry] = await Promise.all([
    db.delivery_shipments.where("merchantProfileId").equals(profile.id).first(),
    db.delivery_ledger_entries.where("merchantProfileId").equals(profile.id).first(),
  ]);
  if (shipment || ledgerEntry) {
    throw new Error("A merchant with delivery history cannot be permanently deleted. Make it inactive instead.");
  }

  await db.delivery_merchant_profiles.delete(profile.id);
  await syncHardDeleteProfile(profile.id, profile.workspaceId);
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
  const trackingNumber = await getInitialShipmentTrackingNumber(workspaceId);
  const shipment = makeBase(workspaceId, {
    trackingNumber,
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
  await syncEntitiesInDependencyOrder(workspaceId, [
    [PROFILE_TABLE, [profile]],
    [SHIPMENT_TABLE, [shipment]],
    [EVENT_TABLE, [event]],
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
  await syncEntitiesInDependencyOrder(workspaceId, [
    [RUN_TABLE, [run]],
    [SHIPMENT_TABLE, updates],
    [RUN_ITEM_TABLE, items],
    [EVENT_TABLE, events],
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
  await syncEntitiesInDependencyOrder(original.workspaceId, [
    [SHIPMENT_TABLE, [updated]],
    [EVENT_TABLE, [event]],
    [LEDGER_TABLE, ledgerEntries],
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
  await syncEntitiesInDependencyOrder(workspaceId, [
    [SETTLEMENT_TABLE, [settlement]],
    [LEDGER_TABLE, [ledgerEntry]],
  ]);

  const linkedBusinessPartnerId = type === "courier_remittance"
    ? (options.agentId ? (await db.agents.get(options.agentId))?.businessPartnerId ?? null : null)
    : options.businessPartnerId ?? (options.merchantProfileId
      ? (await db.delivery_merchant_profiles.get(options.merchantProfileId))?.businessPartnerId ?? null
      : null);
  const counterparty = linkedBusinessPartnerId
    ? await db.business_partners.get(linkedBusinessPartnerId)
    : null;

  const payment = await appendPaymentTransaction(workspaceId, {
    sourceModule: "post_service",
    sourceType: type === "courier_remittance" ? "delivery_courier_remittance" : "delivery_merchant_payout",
    sourceRecordId: settlement.id,
    direction: type === "courier_remittance" ? "incoming" : "outgoing",
    amount: actual,
    currency: options.currency,
    paymentMethod: options.paymentMethod,
    paidAt: settledAt,
    counterpartyName: counterparty?.name ?? null,
    referenceLabel: settlement.settlementNumber,
    note: normalizeText(options.note),
    createdBy: options.createdBy ?? null,
    metadata: {
      deliverySettlementId: settlement.id,
      deliverySettlementType: type,
      deliveryAgentId: options.agentId ?? null,
      deliveryMerchantProfileId: options.merchantProfileId ?? null,
      businessPartnerId: linkedBusinessPartnerId,
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
