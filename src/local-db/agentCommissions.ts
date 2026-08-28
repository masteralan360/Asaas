import { useEffect } from "react";
import type { Table } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";

import { supabase } from "@/auth/supabase";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { getOrderLineInventoryQuantity, getOrderLinePaidQuantity } from "@/lib/orderLineItems";
import { isOnline } from "@/lib/network";
import { normalizeOrderAdjustments } from "@/lib/orderAdjustments";
import { getAppliedCurrencyConversion } from "@/lib/orderCurrency";
import { getSupabaseClientForTable } from "@/lib/supabaseSchema";
import { runSupabaseAction } from "@/lib/supabaseRequest";
import { generateId, toSnakeCase } from "@/lib/utils";
import { isLocalWorkspaceMode } from "@/workspace/workspaceMode";
import { readWorkspaceCache } from "@/workspace/workspaceCache";

import { db } from "./database";
import { fetchTableFromSupabase } from "./hooks";
import type {
  AgentCommissionEntry,
  AgentCommissionMembership,
  AgentCommissionPlan,
  CommissionCalculation,
  CommissionCalculationBasis,
  CommissionPlanLevel,
  CommissionPlanType,
  CurrencyCode,
  ExchangeRateSnapshot,
  ManualSalesAgentCommissionType,
  SalesOrder,
  SalesOrderAgentAssignment,
  WorkspacePaymentMethod,
} from "./models";
import { addToOfflineMutations } from "./offlineMutations";

const PLAN_TABLE = "agent_commission_plans";
const MEMBERSHIP_TABLE = "agent_commission_memberships";
const ASSIGNMENT_TABLE = "sales_order_agent_assignments";
const ENTRY_TABLE = "agent_commission_entries";
const RECONCILIATION_ENTITY = "sales_agent_commission_reconciliation";

type CommissionTableName =
  | typeof PLAN_TABLE
  | typeof MEMBERSHIP_TABLE
  | typeof ASSIGNMENT_TABLE
  | typeof ENTRY_TABLE;
type CommissionEntity =
  | AgentCommissionPlan
  | AgentCommissionMembership
  | SalesOrderAgentAssignment
  | AgentCommissionEntry;

export interface CreateAgentCommissionPlanInput {
  name: string;
  level: CommissionPlanLevel;
  ratePercent: number;
  commissionType?: CommissionPlanType;
  fixedAmount?: number | null;
  fixedCurrency?: CurrencyCode | null;
  tierName?: string | null;
  calculationBasis?: CommissionCalculationBasis;
  includeTax?: boolean;
  includeDeliveryCharge?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
  notes?: string | null;
  createdBy?: string | null;
}

export interface UpdateAgentCommissionPlanInput {
  name?: string;
  level?: CommissionPlanLevel;
  ratePercent?: number;
  commissionType?: CommissionPlanType;
  fixedAmount?: number | null;
  fixedCurrency?: CurrencyCode | null;
  tierName?: string | null;
  calculationBasis?: CommissionCalculationBasis;
  includeTax?: boolean;
  includeDeliveryCharge?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
  notes?: string | null;
  /** Actor hint for local mode. Cloud audit fields are stamped from auth.uid(). */
  createdBy?: string | null;
}

export interface DeleteAgentCommissionPlanInput {
  /** Actor hint for local mode. Cloud audit fields are stamped from auth.uid(). */
  deletedBy?: string | null;
  effectiveAt?: string;
}

export interface SetAgentCommissionMembershipInput {
  agentId: string;
  planId: string | null;
  effectiveAt?: string;
  assignedBy?: string | null;
  notes?: string | null;
}

export interface AssignSalesOrderAgentInput {
  orderId: string;
  agentId: string | null;
  assignedAt?: string;
  assignedBy?: string | null;
  reason?: string | null;
  customerCitySnapshot?: string | null;
  deliveryChargeAmount?: number;
  internalDeliveryCostAmount?: number;
  manualCommission?: ManualSalesAgentCommissionInput | null;
}

export interface ReplaceSalesOrderAgentAssignmentsInput {
  orderId: string;
  assignments: Array<Omit<AssignSalesOrderAgentInput, "orderId" | "agentId" | "assignedBy"> & {
    agentId: string;
  }>;
  assignedBy?: string | null;
  reason?: string | null;
}

export interface ManualSalesAgentCommissionInput {
  type: ManualSalesAgentCommissionType;
  /** Fixed amount or percentage, depending on `type`. */
  amount: number;
  /** The entered fixed-amount currency. Percentage always uses order currency. */
  currency: CurrencyCode;
  /** The exact order-rate snapshot used to lock a fixed-amount conversion. */
  exchangeRates?: ExchangeRateSnapshot[] | null;
}

export interface RecordCommissionApprovalInput {
  entryId: string;
  approvedBy?: string | null;
  occurredAt?: string;
  notes?: string | null;
}

export interface RecordCommissionPayoutInput {
  agentId: string;
  orderId: string;
  amount: number;
  currency: CurrencyCode;
  paymentMethod?: WorkspacePaymentMethod;
  occurredAt?: string;
  notes?: string | null;
  createdBy?: string | null;
  accountId?: string | null;
  accountNameSnapshot?: string | null;
}

export interface RecordCommissionAdjustmentInput {
  agentId: string;
  amount: number;
  currency: CurrencyCode;
  orderId?: string | null;
  relatedEntryId?: string | null;
  occurredAt?: string;
  notes: string;
  createdBy?: string | null;
}

function shouldUseCloudData(workspaceId?: string | null) {
  return !!workspaceId && !isLocalWorkspaceMode(workspaceId);
}

function normalizeText(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeTimestamp(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error("Enter a valid date and time");
  }
  return date.toISOString();
}

function normalizePlanUpdateTimestamp(
  value: string | null | undefined,
  existing: string | null,
) {
  if (value === undefined) return existing;
  if (value === null || value === "") return null;
  // The settings form uses date-only controls. Preserve the original precise
  // revision boundary when the displayed calendar day was not changed.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && existing?.slice(0, 10) === value) {
    return existing;
  }
  return normalizeTimestamp(value);
}

function isCurrentPlanRevision(plan: AgentCommissionPlan) {
  return !plan.isDeleted && (plan.isActive || !plan.effectiveTo);
}

function roundCommissionAmount(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function assertMoney(value: number, label: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be zero or greater`);
  }
  return roundCommissionAmount(amount);
}

function assertRate(value: number) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error("Commission rate must be between 0 and 100 percent");
  }
  return roundCommissionAmount(rate);
}

function resolveCommissionPlanType(value?: CommissionPlanType | null): CommissionPlanType {
  return value === "fixed_amount" ? "fixed_amount" : "percentage";
}

function assertCommissionCurrency(value?: CurrencyCode | null): CurrencyCode {
  if (value === "usd" || value === "eur" || value === "iqd" || value === "try") {
    return value;
  }
  throw new Error("Select a valid commission currency");
}

function resolveCommissionPlanTerms(input: {
  commissionType?: CommissionPlanType | null;
  ratePercent?: number | null;
  fixedAmount?: number | null;
  fixedCurrency?: CurrencyCode | null;
}, fallback?: Pick<AgentCommissionPlan, "commissionType" | "ratePercent" | "fixedAmount" | "fixedCurrency">) {
  const commissionType = resolveCommissionPlanType(input.commissionType ?? fallback?.commissionType);
  if (commissionType === "percentage") {
    return {
      commissionType,
      ratePercent: assertRate(input.ratePercent ?? fallback?.ratePercent ?? 0),
      fixedAmount: null,
      fixedCurrency: null,
    };
  }

  const fixedAmount = assertMoney(input.fixedAmount ?? fallback?.fixedAmount ?? 0, "Fixed commission");
  if (fixedAmount <= 0) {
    throw new Error("Fixed commission amount must be greater than zero");
  }
  return {
    commissionType,
    ratePercent: 0,
    fixedAmount,
    fixedCurrency: assertCommissionCurrency(input.fixedCurrency ?? fallback?.fixedCurrency),
  };
}

type ResolvedManualSalesAgentCommission = {
  type: ManualSalesAgentCommissionType;
  sourceAmount: number;
  sourceCurrency: CurrencyCode;
  convertedAmount: number;
  exchangeRate: number;
  exchangeRateSource: string;
  exchangeRateTimestamp: string;
  exchangeRates: ExchangeRateSnapshot[];
};

function resolveManualSalesAgentCommission(
  order: Pick<SalesOrder, "currency" | "total" | "exchangeRates">,
  input: ManualSalesAgentCommissionInput,
): ResolvedManualSalesAgentCommission {
  const sourceAmount = assertMoney(input.amount, "Manual commission");
  if (sourceAmount <= 0) {
    throw new Error("Manual commission must be greater than zero");
  }

  if (input.type === "percentage") {
    const ratePercent = assertRate(sourceAmount);
    if (ratePercent <= 0) {
      throw new Error("Manual commission percentage must be greater than zero");
    }
    const now = new Date().toISOString();
    return {
      type: "percentage",
      sourceAmount: ratePercent,
      sourceCurrency: order.currency,
      convertedAmount: roundCommissionAmount(Math.max(0, Number(order.total || 0)) * ratePercent / 100),
      exchangeRate: 1,
      exchangeRateSource: "native",
      exchangeRateTimestamp: now,
      exchangeRates: [],
    };
  }

  const conversion = getAppliedCurrencyConversion(
    sourceAmount,
    input.currency,
    order.currency,
    order.exchangeRates ?? input.exchangeRates,
  );
  if (!conversion) {
    throw new Error("Exchange rate unavailable for the selected commission currency");
  }
  return {
    type: "fixed_amount",
    sourceAmount,
    sourceCurrency: input.currency,
    convertedAmount: roundCommissionAmount(conversion.convertedAmount),
    exchangeRate: conversion.exchangeRate,
    exchangeRateSource: conversion.exchangeRateSource,
    exchangeRateTimestamp: conversion.exchangeRateTimestamp,
    exchangeRates: conversion.exchangeRates,
  };
}

function getAssignmentManualSalesAgentCommission(
  assignment: Pick<
    SalesOrderAgentAssignment,
    | "manualCommissionType"
    | "manualCommissionSourceAmount"
    | "manualCommissionSourceCurrency"
    | "manualCommissionConvertedAmount"
    | "manualCommissionExchangeRate"
    | "manualCommissionExchangeRateSource"
    | "manualCommissionExchangeRateTimestamp"
    | "manualCommissionExchangeRates"
  >,
): ResolvedManualSalesAgentCommission | null {
  const type = assignment.manualCommissionType;
  const sourceAmount = Number(assignment.manualCommissionSourceAmount);
  const convertedAmount = Number(assignment.manualCommissionConvertedAmount);
  const exchangeRate = Number(assignment.manualCommissionExchangeRate);
  const sourceCurrency = assignment.manualCommissionSourceCurrency;
  if (
    (type !== "fixed_amount" && type !== "percentage")
    || !sourceCurrency
    || !Number.isFinite(sourceAmount)
    || sourceAmount <= 0
    || !Number.isFinite(convertedAmount)
    || convertedAmount <= 0
    || !Number.isFinite(exchangeRate)
    || exchangeRate <= 0
    || !assignment.manualCommissionExchangeRateSource
    || !assignment.manualCommissionExchangeRateTimestamp
  ) return null;

  return {
    type,
    sourceAmount: roundCommissionAmount(sourceAmount),
    sourceCurrency,
    convertedAmount: roundCommissionAmount(convertedAmount),
    exchangeRate,
    exchangeRateSource: assignment.manualCommissionExchangeRateSource,
    exchangeRateTimestamp: assignment.manualCommissionExchangeRateTimestamp,
    exchangeRates: assignment.manualCommissionExchangeRates ?? [],
  };
}

function hasSameManualSalesAgentCommission(
  assignment: SalesOrderAgentAssignment | null | undefined,
  manual: ResolvedManualSalesAgentCommission | null,
) {
  const existing = assignment ? getAssignmentManualSalesAgentCommission(assignment) : null;
  if (!existing || !manual) return existing === manual;
  return existing.type === manual.type
    && existing.sourceAmount === manual.sourceAmount
    && existing.sourceCurrency === manual.sourceCurrency
    && existing.convertedAmount === manual.convertedAmount
    && existing.exchangeRate === manual.exchangeRate
    && existing.exchangeRateSource === manual.exchangeRateSource
    && existing.exchangeRateTimestamp === manual.exchangeRateTimestamp
    && JSON.stringify(existing.exchangeRates) === JSON.stringify(manual.exchangeRates);
}

export function calculateManualSalesOrderCommission(
  order: SalesOrder,
  assignment: Pick<
    SalesOrderAgentAssignment,
    | "manualCommissionType"
    | "manualCommissionSourceAmount"
    | "manualCommissionSourceCurrency"
    | "manualCommissionConvertedAmount"
    | "manualCommissionExchangeRate"
    | "manualCommissionExchangeRateSource"
    | "manualCommissionExchangeRateTimestamp"
    | "manualCommissionExchangeRates"
  >,
): CommissionCalculation | null {
  const manual = getAssignmentManualSalesAgentCommission(assignment);
  if (!manual) return null;
  const orderTotal = Math.max(0, Number(order.total || 0));
  const isEligibleOrder = order.status !== "cancelled"
    && order.returnStatus !== "full"
    && !order.isDeleted;
  const commissionAmount = !isEligibleOrder
    ? 0
    : manual.type === "percentage"
      ? roundCommissionAmount(orderTotal * manual.sourceAmount / 100)
      : manual.convertedAmount;

  return {
    currency: order.currency,
    revenueAmount: isEligibleOrder ? roundCommissionAmount(orderTotal) : 0,
    costAmount: 0,
    taxAmount: 0,
    deliveryChargeAmount: 0,
    basisAmount: isEligibleOrder ? roundCommissionAmount(orderTotal) : 0,
    ratePercent: manual.type === "percentage" ? manual.sourceAmount : 0,
    commissionAmount,
  };
}

function getSyncMetadata(workspaceId: string, timestamp: string) {
  return shouldUseCloudData(workspaceId)
    ? { syncStatus: "pending" as const, lastSyncedAt: null }
    : { syncStatus: "synced" as const, lastSyncedAt: timestamp };
}

function getTable(tableName: CommissionTableName) {
  switch (tableName) {
    case PLAN_TABLE: return db.agent_commission_plans;
    case MEMBERSHIP_TABLE: return db.agent_commission_memberships;
    case ASSIGNMENT_TABLE: return db.sales_order_agent_assignments;
    case ENTRY_TABLE: return db.agent_commission_entries;
  }
}

function sanitizePayload(entity: CommissionEntity) {
  const payload = toSnakeCase(entity as unknown as Record<string, unknown>);
  delete payload.sync_status;
  delete payload.last_synced_at;
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

async function markSynced(tableName: CommissionTableName, id: string) {
  await getTable(tableName).update(id, {
    syncStatus: "synced",
    lastSyncedAt: new Date().toISOString(),
  } as never);
}

async function syncUpsert(tableName: CommissionTableName, entity: CommissionEntity) {
  if (!shouldUseCloudData(entity.workspaceId)) return;

  if (!isOnline(entity.workspaceId)) {
    await addToOfflineMutations(
      tableName,
      entity.id,
      entity.version > 1 ? "update" : "create",
      entity as unknown as Record<string, unknown>,
      entity.workspaceId,
    );
    return;
  }

  try {
    const client = getSupabaseClientForTable(tableName);
    const payload = sanitizePayload(entity);
    const { error } = (await runSupabaseAction(`${tableName}.sync`, () =>
      tableName === ENTRY_TABLE
        ? client.from(tableName).insert(payload)
        : client.from(tableName).upsert(payload),
    )) as { error?: { code?: unknown } | null };
    if (error) {
      if (tableName !== ENTRY_TABLE || error.code !== "23505") throw error;
      const { data: existingEntry, error: lookupError } = (await runSupabaseAction(
        `${tableName}.confirmRetry`,
        () => client.from(tableName).select("id").eq("id", entity.id).maybeSingle(),
      )) as { data?: { id?: unknown } | null; error?: unknown };
      if (lookupError || existingEntry?.id !== entity.id) throw error;
    }
    await markSynced(tableName, entity.id);
  } catch (error) {
    if (
      tableName === ENTRY_TABLE
      && (entity as AgentCommissionEntry).kind === "payout"
      && (error as { code?: unknown } | null)?.code === "23505"
    ) {
      await db.agent_commission_entries.delete(entity.id);
      throw new Error("That payout reference has already been recorded for this agent and currency");
    }
    console.error(`[Sales Agent Commissions] Failed to sync ${tableName}:`, error);
    await addToOfflineMutations(
      tableName,
      entity.id,
      entity.version > 1 ? "update" : "create",
      entity as unknown as Record<string, unknown>,
      entity.workspaceId,
    );
  }
}

type CommissionReconciliationRequestOptions = {
  orderReturnId?: string | null;
  assignmentId?: string | null;
  membershipId?: string | null;
  planId?: string | null;
};

async function requestServerCommissionReconciliation(
  workspaceId: string,
  orderId: string,
  options: CommissionReconciliationRequestOptions = {},
) {
  if (!shouldUseCloudData(workspaceId)) return false;

  const payload = {
    orderId,
    ...(options.orderReturnId ? { orderReturnId: options.orderReturnId } : {}),
    ...(options.assignmentId ? { assignmentId: options.assignmentId } : {}),
    ...(options.membershipId ? { membershipId: options.membershipId } : {}),
    ...(options.planId ? { planId: options.planId } : {}),
  };
  await addToOfflineMutations(
    RECONCILIATION_ENTITY,
    orderId,
    "update",
    payload,
    workspaceId,
  );
  if (!isOnline(workspaceId)) return false;

  const order = await db.sales_orders.get(orderId);
  if (!order || order.syncStatus !== "synced") return false;
  const [assignments, postedReturns] = await Promise.all([
    db.sales_order_agent_assignments
      .where("[workspaceId+orderId]")
      .equals([workspaceId, orderId])
      .and((row) => !row.isDeleted)
      .toArray(),
    db.order_returns
      .where("[workspaceId+orderId]")
      .equals([workspaceId, orderId])
      .and((row) => !row.isDeleted && row.status === "posted")
      .toArray(),
  ]);
  if (assignments.some((row) => row.syncStatus !== "synced")
    || postedReturns.some((row) => row.syncStatus !== "synced")) return false;

  const agentIds = new Set(assignments.map((assignment) => assignment.agentId));
  const memberships = (await db.agent_commission_memberships
    .where("workspaceId")
    .equals(workspaceId)
    .and((membership) => !membership.isDeleted && agentIds.has(membership.agentId))
    .toArray());
  if (memberships.some((membership) => membership.syncStatus !== "synced")) return false;
  const planIds = new Set(memberships.map((membership) => membership.planId));
  const plans = await db.agent_commission_plans
    .where("workspaceId")
    .equals(workspaceId)
    .and((plan) => !plan.isDeleted && planIds.has(plan.id))
    .toArray();
  if (plans.some((plan) => plan.syncStatus !== "synced")) return false;

  try {
    const { error } = (await runSupabaseAction(
      "salesAgentCommissions.reconcile",
      () => supabase.rpc("reconcile_sales_agent_commission", {
        p_order_id: orderId,
        p_order_return_id: options.orderReturnId ?? null,
      }),
    )) as { error?: unknown };
    if (error) throw error;
    const pendingIds = await db.offline_mutations
      .where("[entityType+entityId+status]")
      .equals([RECONCILIATION_ENTITY, orderId, "pending"])
      .primaryKeys();
    if (pendingIds.length > 0) {
      await db.offline_mutations.bulkUpdate(pendingIds.map((id) => ({
        key: id,
        changes: { status: "synced" as const, error: undefined },
      })));
    }
    return true;
  } catch (error) {
    console.error("[Sales Agent Commissions] Server reconciliation was queued:", error);
    return false;
  }
}

async function hydrateTable(tableName: CommissionTableName, workspaceId: string) {
  if (!shouldUseCloudData(workspaceId)) return;
  await fetchTableFromSupabase(tableName, getTable(tableName), workspaceId);
}

function useCommissionRows<T extends CommissionEntity>(
  tableName: CommissionTableName,
  workspaceId?: string,
) {
  const online = useNetworkStatus();
  const featureEnabled = Boolean(workspaceId && readWorkspaceCache<{
    sales_agent_commissions?: boolean;
  }>(workspaceId)?.features.sales_agent_commissions);
  const rows = useLiveQuery<T[]>(
    async () => {
      if (!workspaceId || !featureEnabled) return [];
      const table = getTable(tableName) as unknown as Table<T, string>;
      return table
        .where("workspaceId")
        .equals(workspaceId)
        .and((row) => !row.isDeleted)
        .toArray();
    },
    [featureEnabled, tableName, workspaceId],
  );

  useEffect(() => {
    if (!workspaceId || !online || !featureEnabled) return;
    void hydrateTable(tableName, workspaceId).catch((error) => {
      console.error(`[Sales Agent Commissions] Failed to hydrate ${tableName}:`, error);
    });
  }, [featureEnabled, online, tableName, workspaceId]);

  return rows ?? [];
}

export function useAgentCommissionPlans(workspaceId?: string) {
  return useCommissionRows<AgentCommissionPlan>(PLAN_TABLE, workspaceId)
    .sort((left, right) => left.level.localeCompare(right.level)
      || right.effectiveFrom.localeCompare(left.effectiveFrom));
}

export function useAgentCommissionMemberships(workspaceId?: string) {
  return useCommissionRows<AgentCommissionMembership>(MEMBERSHIP_TABLE, workspaceId)
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom));
}

export function useSalesOrderAgentAssignments(workspaceId?: string) {
  return useCommissionRows<SalesOrderAgentAssignment>(ASSIGNMENT_TABLE, workspaceId)
    .sort((left, right) => right.assignedAt.localeCompare(left.assignedAt));
}

export function useAgentCommissionEntries(workspaceId?: string) {
  return useCommissionRows<AgentCommissionEntry>(ENTRY_TABLE, workspaceId)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export function getActiveSalesOrderAgentAssignment(
  assignments: readonly SalesOrderAgentAssignment[],
  orderId: string,
) {
  return getActiveSalesOrderAgentAssignments(assignments, orderId)[0] ?? null;
}

export function getActiveSalesOrderAgentAssignments(
  assignments: readonly SalesOrderAgentAssignment[],
  orderId: string,
) {
  return assignments
    .filter((row) => !row.isDeleted && row.orderId === orderId && !row.unassignedAt)
    .sort((left, right) => right.assignedAt.localeCompare(left.assignedAt) || left.agentId.localeCompare(right.agentId));
}

export function getEffectiveAgentCommissionMembership(
  memberships: readonly AgentCommissionMembership[],
  agentId: string,
  at = new Date().toISOString(),
) {
  const timestamp = new Date(at).getTime();
  return memberships
    .filter((row) => {
      if (row.isDeleted || row.agentId !== agentId) return false;
      const starts = new Date(row.effectiveFrom).getTime();
      const ends = row.effectiveTo ? new Date(row.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      return starts <= timestamp && timestamp < ends;
    })
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0] ?? null;
}

export async function createAgentCommissionPlan(
  workspaceId: string,
  input: CreateAgentCommissionPlanInput,
) {
  const name = normalizeText(input.name);
  if (!name) throw new Error("Commission plan name is required");
  const level = normalizeText(input.level);
  if (!level) throw new Error("Commission level is required");
  const effectiveFrom = normalizeTimestamp(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? normalizeTimestamp(input.effectiveTo) : null;
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new Error("Commission plan end date must be after its start date");
  }
  const existingLevel = await db.agent_commission_plans
    .where("[workspaceId+level]")
    .equals([workspaceId, level])
    .and(isCurrentPlanRevision)
    .first();
  if (existingLevel) {
    throw new Error("This workspace already has a commission plan for that level");
  }
  const terms = resolveCommissionPlanTerms(input);
  const now = new Date().toISOString();
  const plan: AgentCommissionPlan = {
    id: generateId(),
    workspaceId,
    name,
    level,
    commissionType: terms.commissionType,
    ratePercent: terms.ratePercent,
    fixedAmount: terms.fixedAmount,
    fixedCurrency: terms.fixedCurrency,
    tierName: normalizeText(input.tierName),
    calculationBasis: input.calculationBasis ?? "net_profit",
    includeTax: input.includeTax ?? false,
    includeDeliveryCharge: input.includeDeliveryCharge ?? false,
    effectiveFrom,
    effectiveTo,
    isActive: input.isActive ?? true,
    notes: normalizeText(input.notes),
    createdBy: input.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
    ...getSyncMetadata(workspaceId, now),
  };
  await db.agent_commission_plans.put(plan);
  await syncUpsert(PLAN_TABLE, plan);
  return plan;
}

export async function updateAgentCommissionPlan(
  planId: string,
  input: UpdateAgentCommissionPlanInput,
) {
  const existing = await db.agent_commission_plans.get(planId);
  if (!existing || existing.isDeleted) throw new Error("Commission plan not found");
  const name = input.name === undefined ? existing.name : normalizeText(input.name);
  if (!name) throw new Error("Commission plan name is required");
  const effectiveFrom = normalizePlanUpdateTimestamp(
    input.effectiveFrom,
    existing.effectiveFrom,
  )!;
  const effectiveTo = normalizePlanUpdateTimestamp(
    input.effectiveTo,
    existing.effectiveTo ?? null,
  );
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new Error("Commission plan end date must be after its start date");
  }
  const nextLevel = input.level === undefined ? existing.level : normalizeText(input.level);
  if (!nextLevel) throw new Error("Commission level is required");
  const terms = resolveCommissionPlanTerms({
    commissionType: input.commissionType,
    ratePercent: input.ratePercent,
    fixedAmount: input.fixedAmount,
    fixedCurrency: input.fixedCurrency,
  }, existing);
  const { commissionType, ratePercent, fixedAmount, fixedCurrency } = terms;
  const tierName = input.tierName === undefined ? existing.tierName ?? null : normalizeText(input.tierName);
  const calculationBasis = input.calculationBasis ?? existing.calculationBasis;
  const includeTax = input.includeTax ?? existing.includeTax;
  const includeDeliveryCharge = input.includeDeliveryCharge ?? existing.includeDeliveryCharge;
  const isActive = input.isActive ?? existing.isActive;
  const notes = input.notes === undefined ? existing.notes ?? null : normalizeText(input.notes);
  if (nextLevel !== existing.level) {
    const existingLevel = await db.agent_commission_plans
      .where("[workspaceId+level]")
      .equals([existing.workspaceId, nextLevel])
      .and((plan) => plan.id !== existing.id && isCurrentPlanRevision(plan))
      .first();
    if (existingLevel) {
      throw new Error("This workspace already has a commission plan for that level");
    }
  }
  const now = new Date().toISOString();
  const memberships = await db.agent_commission_memberships
    .where("[workspaceId+planId]")
    .equals([existing.workspaceId, existing.id])
    .and((membership) => !membership.isDeleted)
    .toArray();
  const changesTerms = nextLevel !== existing.level
    || commissionType !== resolveCommissionPlanType(existing.commissionType)
    || ratePercent !== existing.ratePercent
    || fixedAmount !== (existing.fixedAmount ?? null)
    || fixedCurrency !== (existing.fixedCurrency ?? null)
    || calculationBasis !== existing.calculationBasis
    || includeTax !== existing.includeTax
    || includeDeliveryCharge !== existing.includeDeliveryCharge
    || effectiveFrom !== existing.effectiveFrom
    || effectiveTo !== (existing.effectiveTo ?? null)
    || isActive !== existing.isActive;

  if (memberships.length > 0 && changesTerms) {
    if (nextLevel !== existing.level) {
      throw new Error("A used commission plan keeps its level; create or edit that level's current revision instead");
    }
    if (existing.effectiveTo && existing.effectiveTo <= now && !existing.isActive) {
      throw new Error("Historical commission plan revisions cannot be changed");
    }

    const openMemberships = memberships.filter((membership) => !membership.effectiveTo);
    const revisionAtMs = Math.max(
      new Date(now).getTime(),
      new Date(existing.effectiveFrom).getTime() + 1,
      ...openMemberships.map((membership) => new Date(membership.effectiveFrom).getTime() + 1),
    );
    const revisionAt = new Date(revisionAtMs).toISOString();
    if (effectiveTo && effectiveTo <= revisionAt) {
      throw new Error("The revised plan end date must be after the new revision starts");
    }

    const actorId = input.createdBy ?? null;
    const closedPlan: AgentCommissionPlan = {
      ...existing,
      effectiveTo: revisionAt,
      isActive: false,
      updatedAt: now,
      version: existing.version + 1,
      ...getSyncMetadata(existing.workspaceId, now),
    };
    const revision: AgentCommissionPlan = {
      ...existing,
      id: generateId(),
      name,
      level: existing.level,
      commissionType,
      ratePercent,
      fixedAmount,
      fixedCurrency,
      tierName,
      calculationBasis,
      includeTax,
      includeDeliveryCharge,
      effectiveFrom: revisionAt,
      effectiveTo,
      isActive,
      notes,
      createdBy: actorId ?? existing.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
      ...getSyncMetadata(existing.workspaceId, now),
    };
    const closedMemberships = openMemberships.map((membership) => ({
      ...membership,
      effectiveTo: revisionAt,
      endedBy: actorId,
      updatedAt: now,
      version: membership.version + 1,
      ...getSyncMetadata(existing.workspaceId, now),
    } satisfies AgentCommissionMembership));
    const replacementMemberships = isActive
      ? openMemberships.map((membership) => ({
          ...membership,
          id: generateId(),
          planId: revision.id,
          effectiveFrom: revisionAt,
          effectiveTo: null,
          assignedBy: actorId,
          endedBy: null,
          createdAt: now,
          updatedAt: now,
          version: 1,
          isDeleted: false,
          ...getSyncMetadata(existing.workspaceId, now),
        } satisfies AgentCommissionMembership))
      : [];

    await db.transaction(
      "rw",
      db.agent_commission_plans,
      db.agent_commission_memberships,
      async () => {
        await db.agent_commission_plans.put(closedPlan);
        if (closedMemberships.length > 0) {
          await db.agent_commission_memberships.bulkPut(closedMemberships);
        }
        await db.agent_commission_plans.put(revision);
        if (replacementMemberships.length > 0) {
          await db.agent_commission_memberships.bulkPut(replacementMemberships);
        }
      },
    );

    await syncUpsert(PLAN_TABLE, closedPlan);
    for (const membership of closedMemberships) {
      await syncUpsert(MEMBERSHIP_TABLE, membership);
    }
    await syncUpsert(PLAN_TABLE, revision);
    for (const membership of replacementMemberships) {
      await syncUpsert(MEMBERSHIP_TABLE, membership);
    }

    if (shouldUseCloudData(existing.workspaceId)) {
      for (const membership of openMemberships) {
        const assignments = await db.sales_order_agent_assignments
          .where("[workspaceId+agentId]")
          .equals([existing.workspaceId, membership.agentId])
          .and((assignment) => !assignment.isDeleted && !assignment.unassignedAt)
          .toArray();
        const replacement = replacementMemberships.find((row) => row.agentId === membership.agentId);
        await Promise.all(assignments.map((assignment) => requestServerCommissionReconciliation(
          existing.workspaceId,
          assignment.orderId,
          {
            assignmentId: assignment.id,
            membershipId: replacement?.id ?? membership.id,
            planId: revision.id,
          },
        )));
      }
    }
    return revision;
  }

  const updated: AgentCommissionPlan = {
    ...existing,
    name,
    level: nextLevel,
    commissionType,
    ratePercent,
    fixedAmount,
    fixedCurrency,
    tierName,
    calculationBasis,
    includeTax,
    includeDeliveryCharge,
    effectiveFrom,
    effectiveTo,
    isActive,
    notes,
    updatedAt: now,
    version: existing.version + 1,
    ...getSyncMetadata(existing.workspaceId, now),
  };
  await db.agent_commission_plans.put(updated);
  await syncUpsert(PLAN_TABLE, updated);
  if (shouldUseCloudData(existing.workspaceId)) {
    for (const membership of memberships) {
      const assignments = await db.sales_order_agent_assignments
        .where("[workspaceId+agentId]")
        .equals([existing.workspaceId, membership.agentId])
        .and((assignment) => !assignment.isDeleted && !assignment.unassignedAt)
        .toArray();
      await Promise.all(assignments.map((assignment) => requestServerCommissionReconciliation(
        existing.workspaceId,
        assignment.orderId,
        { assignmentId: assignment.id, membershipId: membership.id, planId: existing.id },
      )));
    }
  }
  return updated;
}

/**
 * Retires a saved commission level without deleting any historical plan,
 * membership, order, or ledger records. Retired levels are excluded from
 * settings and can no longer be assigned to a field agent.
 */
export async function deleteAgentCommissionPlan(
  planId: string,
  input: DeleteAgentCommissionPlanInput = {},
) {
  const existing = await db.agent_commission_plans.get(planId);
  if (!existing || existing.isDeleted) throw new Error("Commission plan not found");
  if (!existing.isActive && existing.effectiveTo) {
    throw new Error("Commission plan has already been deleted");
  }

  const memberships = await db.agent_commission_memberships
    .where("[workspaceId+planId]")
    .equals([existing.workspaceId, existing.id])
    .and((membership) => !membership.isDeleted && !membership.effectiveTo)
    .toArray();
  const requestedAt = normalizeTimestamp(input.effectiveAt);
  const retiredAt = new Date(Math.max(
    new Date(requestedAt).getTime(),
    new Date(existing.effectiveFrom).getTime() + 1,
    ...memberships.map((membership) => new Date(membership.effectiveFrom).getTime() + 1),
  )).toISOString();
  const now = new Date().toISOString();
  const retiredPlan: AgentCommissionPlan = {
    ...existing,
    effectiveTo: retiredAt,
    isActive: false,
    updatedAt: now,
    version: existing.version + 1,
    ...getSyncMetadata(existing.workspaceId, now),
  };
  const endedMemberships = memberships.map((membership) => ({
    ...membership,
    effectiveTo: retiredAt,
    endedBy: input.deletedBy ?? null,
    updatedAt: now,
    version: membership.version + 1,
    ...getSyncMetadata(existing.workspaceId, now),
  } satisfies AgentCommissionMembership));

  await db.transaction(
    "rw",
    db.agent_commission_plans,
    db.agent_commission_memberships,
    async () => {
      if (endedMemberships.length > 0) {
        await db.agent_commission_memberships.bulkPut(endedMemberships);
      }
      await db.agent_commission_plans.put(retiredPlan);
    },
  );

  for (const membership of endedMemberships) {
    await syncUpsert(MEMBERSHIP_TABLE, membership);
  }
  await syncUpsert(PLAN_TABLE, retiredPlan);

  if (shouldUseCloudData(existing.workspaceId)) {
    for (const membership of endedMemberships) {
      const assignments = await db.sales_order_agent_assignments
        .where("[workspaceId+agentId]")
        .equals([existing.workspaceId, membership.agentId])
        .and((assignment) => !assignment.isDeleted && !assignment.unassignedAt)
        .toArray();
      await Promise.all(assignments.map((assignment) => requestServerCommissionReconciliation(
        existing.workspaceId,
        assignment.orderId,
        { membershipId: membership.id, planId: existing.id },
      )));
    }
  }

  return retiredPlan;
}

function closeTimestampAfter(start: string, requested: string) {
  const startMs = new Date(start).getTime();
  const requestedMs = new Date(requested).getTime();
  return new Date(Math.max(requestedMs, startMs + 1)).toISOString();
}

export async function setAgentCommissionMembership(
  workspaceId: string,
  input: SetAgentCommissionMembershipInput,
) {
  const agent = await db.agents.get(input.agentId);
  if (!agent || agent.isDeleted || agent.workspaceId !== workspaceId || agent.agentType !== "field_agent") {
    throw new Error("Select an active field agent from this workspace");
  }
  const requestedEffectiveAt = normalizeTimestamp(input.effectiveAt);
  const current = await db.agent_commission_memberships
    .where("[workspaceId+agentId]")
    .equals([workspaceId, input.agentId])
    .and((row) => !row.isDeleted && !row.effectiveTo)
    .first();
  if (current?.planId === input.planId) return current;

  const now = new Date().toISOString();
  const ended = current ? {
    ...current,
    effectiveTo: closeTimestampAfter(current.effectiveFrom, requestedEffectiveAt),
    endedBy: input.assignedBy ?? null,
    updatedAt: now,
    version: current.version + 1,
    ...getSyncMetadata(workspaceId, now),
  } satisfies AgentCommissionMembership : null;
  const effectiveAt = ended?.effectiveTo ?? requestedEffectiveAt;

  let membership: AgentCommissionMembership | null = null;
  if (input.planId) {
    const plan = await db.agent_commission_plans.get(input.planId);
    if (!plan || plan.isDeleted || !plan.isActive || plan.workspaceId !== workspaceId) {
      throw new Error("Select an active commission plan from this workspace");
    }
    membership = {
      id: generateId(),
      workspaceId,
      agentId: input.agentId,
      planId: input.planId,
      effectiveFrom: effectiveAt,
      effectiveTo: null,
      assignedBy: input.assignedBy ?? null,
      endedBy: null,
      notes: normalizeText(input.notes),
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
      ...getSyncMetadata(workspaceId, now),
    };
  }

  await db.transaction("rw", db.agent_commission_memberships, async () => {
    if (ended) await db.agent_commission_memberships.put(ended);
    if (membership) await db.agent_commission_memberships.put(membership);
  });
  if (ended) await syncUpsert(MEMBERSHIP_TABLE, ended);
  if (membership) await syncUpsert(MEMBERSHIP_TABLE, membership);
  if (shouldUseCloudData(workspaceId)) {
    const assignments = await db.sales_order_agent_assignments
      .where("[workspaceId+agentId]")
      .equals([workspaceId, input.agentId])
      .and((assignment) => !assignment.isDeleted && !assignment.unassignedAt)
      .toArray();
    await Promise.all(assignments.map((assignment) => requestServerCommissionReconciliation(
      workspaceId,
      assignment.orderId,
      { membershipId: membership?.id ?? ended?.id ?? null, planId: input.planId },
    )));
  }
  return membership;
}

export function calculateSalesOrderCommission(
  order: SalesOrder,
  plan: Pick<
    AgentCommissionPlan,
    | "commissionType"
    | "ratePercent"
    | "fixedAmount"
    | "fixedCurrency"
    | "calculationBasis"
    | "includeTax"
    | "includeDeliveryCharge"
  >,
  assignment?: Pick<
    SalesOrderAgentAssignment,
    "deliveryChargeAmount" | "internalDeliveryCostAmount"
  > | null,
): CommissionCalculation {
  const commissionType = resolveCommissionPlanType(plan.commissionType);
  const ratePercent = commissionType === "percentage" ? assertRate(plan.ratePercent) : 0;
  const zero: CommissionCalculation = {
    currency: order.currency,
    revenueAmount: 0,
    costAmount: 0,
    taxAmount: 0,
    deliveryChargeAmount: 0,
    basisAmount: 0,
    ratePercent,
    commissionAmount: 0,
  };
  if (order.status === "cancelled" || order.returnStatus === "full" || order.isDeleted) return zero;

  let itemRevenue = 0;
  let itemCost = 0;
  for (const item of order.items ?? []) {
    const returnedQuantity = Math.min(
      getOrderLineInventoryQuantity(item),
      Math.max(0, Number(item.returnedQuantity ?? 0)),
    );
    const netPaidQuantity = Math.max(0, getOrderLinePaidQuantity(item) - returnedQuantity);
    const netCostQuantity = Math.max(0, getOrderLineInventoryQuantity(item) - returnedQuantity);
    itemRevenue += netPaidQuantity * Math.max(0, Number(item.convertedUnitPrice || 0));
    itemCost += netCostQuantity * Math.max(0, Number(item.convertedCostPrice ?? item.costPrice ?? 0));
  }

  // Every normalized persisted adjustment changes the order's commercial
  // balance, including immutable post-return corrections.
  const orderAdjustmentNet = normalizeOrderAdjustments(
    order.orderAdjustments,
    order.currency,
  ).reduce((total, adjustment) => {
    const amount = Math.max(0, Number(adjustment.convertedAmount || 0));
    return total + (adjustment.type === "addition" ? amount : -amount);
  }, 0);
  const merchandiseRevenue = Math.max(
    0,
    itemRevenue - Math.max(0, Number(order.discount || 0)) + orderAdjustmentNet,
  );
  const taxAmount = plan.includeTax ? Math.max(0, Number(order.tax || 0)) : 0;
  const deliveryChargeAmount = plan.includeDeliveryCharge
    ? Math.max(0, Number(assignment?.deliveryChargeAmount || 0))
    : 0;
  const internalDeliveryCost = plan.includeDeliveryCharge
    ? Math.max(0, Number(assignment?.internalDeliveryCostAmount || 0))
    : 0;
  const revenueAmount = merchandiseRevenue + taxAmount + deliveryChargeAmount;
  const costAmount = itemCost + internalDeliveryCost;
  const basisAmount = Math.max(
    0,
    plan.calculationBasis === "net_revenue" ? revenueAmount : revenueAmount - costAmount,
  );
  const fixedCommission = commissionType === "fixed_amount"
    ? getAppliedCurrencyConversion(
      assertMoney(plan.fixedAmount ?? 0, "Fixed commission"),
      assertCommissionCurrency(plan.fixedCurrency),
      order.currency,
      order.exchangeRates,
    )
    : null;
  if (commissionType === "fixed_amount" && !fixedCommission) {
    throw new Error("Exchange rate unavailable for the commission plan currency");
  }

  return {
    currency: order.currency,
    revenueAmount: roundCommissionAmount(revenueAmount),
    costAmount: roundCommissionAmount(costAmount),
    taxAmount: roundCommissionAmount(taxAmount),
    deliveryChargeAmount: roundCommissionAmount(deliveryChargeAmount),
    basisAmount: roundCommissionAmount(basisAmount),
    ratePercent,
    commissionAmount: commissionType === "fixed_amount"
      ? roundCommissionAmount(fixedCommission!.convertedAmount)
      : roundCommissionAmount(basisAmount * ratePercent / 100),
  };
}

async function appendEntry(
  workspaceId: string,
  input: Omit<AgentCommissionEntry, keyof ReturnType<typeof getSyncMetadata>
    | "id" | "workspaceId" | "createdAt" | "updatedAt" | "version" | "isDeleted">,
  id = generateId(),
) {
  const now = new Date().toISOString();
  const entry: AgentCommissionEntry = {
    ...input,
    id,
    workspaceId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
    ...getSyncMetadata(workspaceId, now),
  };
  await db.agent_commission_entries.put(entry);
  await syncUpsert(ENTRY_TABLE, entry);
  return entry;
}

async function findMembershipAndPlan(agentId: string, at: string) {
  const memberships = await db.agent_commission_memberships
    .where("agentId")
    .equals(agentId)
    .and((row) => !row.isDeleted)
    .toArray();
  const membership = getEffectiveAgentCommissionMembership(memberships, agentId, at);
  if (!membership) return null;
  const plan = await db.agent_commission_plans.get(membership.planId);
  // `isActive` controls new configuration choices. Effective dates determine
  // historical eligibility so a late/offline accrual is not erased when an
  // administrator later deactivates the plan.
  if (!plan || plan.isDeleted) return null;
  if (plan.effectiveFrom > at || (plan.effectiveTo && at >= plan.effectiveTo)) return null;
  return { membership, plan };
}

export async function accrueSalesOrderCommission(
  workspaceId: string,
  orderId: string,
  createdBy?: string | null,
) {
  const order = await db.sales_orders.get(orderId);
  if (!order || order.isDeleted || order.workspaceId !== workspaceId) {
    throw new Error("Sales order not found");
  }
  if (shouldUseCloudData(workspaceId)) {
    await requestServerCommissionReconciliation(workspaceId, orderId);
    return null;
  }
  if (order.status !== "completed" || (!order.isPaid && order.paymentStatus !== "paid")) return null;

  const assignments = await db.sales_order_agent_assignments
    .where("[workspaceId+orderId]")
    .equals([workspaceId, orderId])
    .and((row) => !row.isDeleted)
    .toArray();
  const activeAssignments = getActiveSalesOrderAgentAssignments(assignments, orderId);
  const entries: AgentCommissionEntry[] = [];
  for (const assignment of activeAssignments) {
    const entry = await accrueSalesOrderAssignmentCommission(order, assignment, createdBy);
    if (entry) entries.push(entry);
  }
  return entries[0] ?? null;
}

async function accrueSalesOrderAssignmentCommission(
  order: SalesOrder,
  assignment: SalesOrderAgentAssignment,
  createdBy?: string | null,
) {
  const existing = await db.agent_commission_entries
    .where("assignmentId")
    .equals(assignment.id)
    .and((row) => !row.isDeleted && row.kind === "accrual")
    .first();
  if (existing) return existing;

  // A completed order may be attributed after delivery. In that case the
  // assignment time, not the earlier delivery time, selects the effective
  // membership and plan.
  const orderEventAt = [order.actualDeliveryDate, order.paidAt]
    .filter((value): value is string => !!value)
    .sort((left, right) => right.localeCompare(left))[0];
  const occurredAt = [
    assignment.assignedAt,
    orderEventAt ?? order.updatedAt,
  ].sort((left, right) => right.localeCompare(left))[0];
  const manualCommission = getAssignmentManualSalesAgentCommission(assignment);
  const terms = manualCommission ? null : await findMembershipAndPlan(assignment.agentId, occurredAt);
  if (!terms && !manualCommission) return null;
  const calculation = manualCommission
    ? calculateManualSalesOrderCommission(order, assignment)
    : calculateSalesOrderCommission(order, terms!.plan, assignment);
  if (!calculation) return null;

  return appendEntry(order.workspaceId, {
    orderId: order.id,
    assignmentId: assignment.id,
    agentId: assignment.agentId,
    membershipId: terms?.membership.id ?? null,
    planId: terms?.plan.id ?? null,
    orderReturnId: null,
    relatedEntryId: null,
    kind: "accrual",
    status: "earned",
    currency: calculation.currency,
    calculationBasis: manualCommission ? "net_revenue" : terms!.plan.calculationBasis,
    includeTax: manualCommission ? false : terms!.plan.includeTax,
    includeDeliveryCharge: manualCommission ? false : terms!.plan.includeDeliveryCharge,
    basisAmount: calculation.basisAmount,
    revenueAmount: calculation.revenueAmount,
    costAmount: calculation.costAmount,
    taxAmount: calculation.taxAmount,
    deliveryChargeAmount: calculation.deliveryChargeAmount,
    ratePercent: calculation.ratePercent,
    amount: calculation.commissionAmount,
    occurredAt,
    payoutReference: null,
    notes: manualCommission
      ? `Manual ${manualCommission.type === "percentage" ? "percentage" : "fixed"} commission accrued for sales order ${order.orderNumber}`
      : `Commission accrued for sales order ${order.orderNumber}`,
    createdBy: createdBy ?? null,
  });
}

function isOrderTargetCommissionEntry(entry: AgentCommissionEntry) {
  return entry.kind === "accrual"
    || entry.kind === "reversal"
    || (entry.kind === "adjustment" && Boolean(entry.relatedEntryId));
}

async function reverseRecognizedAssignmentCommission(
  assignment: SalesOrderAgentAssignment,
  order: SalesOrder,
  relatedEntry: AgentCommissionEntry,
  amount: number,
  options: { orderReturnId?: string | null; occurredAt: string; reason: string; createdBy?: string | null },
) {
  if (amount >= 0) return null;
  return appendEntry(order.workspaceId, {
    orderId: order.id,
    assignmentId: assignment.id,
    agentId: assignment.agentId,
    membershipId: relatedEntry.membershipId ?? null,
    planId: relatedEntry.planId ?? null,
    orderReturnId: options.orderReturnId ?? null,
    relatedEntryId: relatedEntry.id,
    kind: "reversal",
    status: "reversed",
    currency: relatedEntry.currency,
    calculationBasis: relatedEntry.calculationBasis,
    includeTax: relatedEntry.includeTax,
    includeDeliveryCharge: relatedEntry.includeDeliveryCharge,
    basisAmount: relatedEntry.basisAmount,
    revenueAmount: relatedEntry.revenueAmount,
    costAmount: relatedEntry.costAmount,
    taxAmount: relatedEntry.taxAmount,
    deliveryChargeAmount: relatedEntry.deliveryChargeAmount,
    ratePercent: relatedEntry.ratePercent,
    amount: roundCommissionAmount(amount),
    occurredAt: options.occurredAt,
    payoutReference: null,
    notes: options.reason,
    createdBy: options.createdBy ?? null,
  });
}

/**
 * Keeps the append-only ledger aligned with the order's current payment
 * eligibility. A payment reversal appends a negative adjustment; paying the
 * order again appends the matching positive delta without mutating the
 * original accrual.
 */
export async function reconcileSalesOrderCommission(
  workspaceId: string,
  orderId: string,
  createdBy?: string | null,
) {
  const order = await db.sales_orders.get(orderId);
  if (!order || order.isDeleted || order.workspaceId !== workspaceId) {
    throw new Error("Sales order not found");
  }
  if (shouldUseCloudData(workspaceId)) {
    await requestServerCommissionReconciliation(workspaceId, orderId);
    return null;
  }
  const assignments = await db.sales_order_agent_assignments
    .where("[workspaceId+orderId]")
    .equals([workspaceId, orderId])
    .and((assignment) => !assignment.isDeleted)
    .toArray();
  const entries: AgentCommissionEntry[] = [];
  for (const assignment of assignments) {
    const entry = await reconcileSalesOrderAssignmentCommission(order, assignment, createdBy);
    if (entry) entries.push(entry);
  }
  return entries[0] ?? null;
}

async function reconcileSalesOrderAssignmentCommission(
  order: SalesOrder,
  assignment: SalesOrderAgentAssignment,
  createdBy?: string | null,
) {

  const entries = await db.agent_commission_entries
    .where("assignmentId")
    .equals(assignment.id)
    .and((entry) => !entry.isDeleted)
    .toArray();
  const accrual = entries.find((entry) => entry.kind === "accrual");
  const isEligible = order.status === "completed"
    && (order.isPaid || order.paymentStatus === "paid");
  if (!accrual) {
    return isEligible && !assignment.unassignedAt
      ? accrueSalesOrderAssignmentCommission(order, assignment, createdBy)
      : null;
  }

  const accrualPlan = accrual.planId
    ? await db.agent_commission_plans.get(accrual.planId)
    : null;
  const calculation = isEligible && !assignment.unassignedAt
    ? accrual.membershipId == null && accrual.planId == null
      ? calculateManualSalesOrderCommission(order, assignment)
      : calculateSalesOrderCommission(order, accrualPlan ?? {
        ratePercent: accrual.ratePercent,
        calculationBasis: accrual.calculationBasis,
        includeTax: accrual.includeTax,
        includeDeliveryCharge: accrual.includeDeliveryCharge,
      }, assignment)
    : {
      currency: accrual.currency,
      revenueAmount: 0,
      costAmount: 0,
      taxAmount: 0,
      deliveryChargeAmount: 0,
      basisAmount: 0,
      ratePercent: accrual.ratePercent,
      commissionAmount: 0,
    };
  if (!calculation) return null;
  const recognized = roundCommissionAmount(entries
    .filter(isOrderTargetCommissionEntry)
    .reduce((sum, entry) => sum + entry.amount, 0));
  const delta = roundCommissionAmount(calculation.commissionAmount - recognized);
  if (Math.abs(delta) <= 0.000001) return null;

  return appendEntry(order.workspaceId, {
    orderId: order.id,
    assignmentId: assignment.id,
    agentId: assignment.agentId,
    membershipId: accrual.membershipId ?? null,
    planId: accrual.planId ?? null,
    orderReturnId: null,
    relatedEntryId: accrual.id,
    kind: "adjustment",
    status: delta < 0 ? "reversed" : "earned",
    currency: accrual.currency,
    calculationBasis: accrual.calculationBasis,
    includeTax: accrual.includeTax,
    includeDeliveryCharge: accrual.includeDeliveryCharge,
    basisAmount: calculation.basisAmount,
    revenueAmount: calculation.revenueAmount,
    costAmount: calculation.costAmount,
    taxAmount: calculation.taxAmount,
    deliveryChargeAmount: calculation.deliveryChargeAmount,
    ratePercent: accrual.ratePercent,
    amount: delta,
    occurredAt: order.updatedAt,
    payoutReference: null,
    notes: delta > 0
      ? `Commission restored after payment for sales order ${order.orderNumber}`
      : isEligible
        ? `Commission reduced after sales order update ${order.orderNumber}`
        : `Commission suspended after payment reversal for sales order ${order.orderNumber}`,
    createdBy: createdBy ?? null,
  });
}

/** Backfills/delta-reconciles every currently assigned completed order. */
export async function reconcileWorkspaceSalesOrderCommissions(
  workspaceId: string,
  createdBy?: string | null,
) {
  const postedReturns = await db.order_returns
    .where("workspaceId")
    .equals(workspaceId)
    .and((orderReturn) => !orderReturn.isDeleted && orderReturn.status === "posted")
    .toArray();
  for (const orderReturn of postedReturns) {
    await reverseCommissionForOrderReturn(workspaceId, orderReturn.id, createdBy);
  }
  const assignments = await db.sales_order_agent_assignments
    .where("workspaceId")
    .equals(workspaceId)
    .and((assignment) => !assignment.isDeleted && !assignment.unassignedAt)
    .toArray();
  const entries: AgentCommissionEntry[] = [];
  for (const orderId of new Set(assignments.map((assignment) => assignment.orderId))) {
    const order = await db.sales_orders.get(orderId);
    if (!order || order.isDeleted || order.status !== "completed") continue;
    const entry = await reconcileSalesOrderCommission(workspaceId, orderId, createdBy);
    if (entry) entries.push(entry);
  }
  return entries;
}

export interface UnassignSalesOrderAgentInput {
  orderId: string;
  agentId: string;
  unassignedAt?: string;
  unassignedBy?: string | null;
  reason?: string | null;
}

async function reverseClosedSalesOrderAssignmentCommission(
  assignment: SalesOrderAgentAssignment,
  order: SalesOrder,
  occurredAt: string,
  reason: string | null,
  createdBy?: string | null,
) {
  if (order.status !== "completed") return;
  const entries = await db.agent_commission_entries
    .where("assignmentId")
    .equals(assignment.id)
    .and((entry) => !entry.isDeleted)
    .toArray();
  const recognized = roundCommissionAmount(entries.filter(isOrderTargetCommissionEntry)
    .reduce((sum, entry) => sum + entry.amount, 0));
  const accrual = entries.find((entry) => entry.kind === "accrual");
  if (recognized > 0 && accrual) {
    await reverseRecognizedAssignmentCommission(assignment, order, accrual, -recognized, {
      occurredAt,
      reason: reason || "Commission reversed after sales order assignment was removed",
      createdBy,
    });
  }
}

export async function unassignSalesOrderAgent(
  workspaceId: string,
  input: UnassignSalesOrderAgentInput,
) {
  const order = await db.sales_orders.get(input.orderId);
  if (!order || order.isDeleted || order.workspaceId !== workspaceId) {
    throw new Error("Sales order not found");
  }
  const activeAssignments = getActiveSalesOrderAgentAssignments(
    await db.sales_order_agent_assignments
      .where("[workspaceId+orderId]")
      .equals([workspaceId, input.orderId])
      .and((row) => !row.isDeleted)
      .toArray(),
    input.orderId,
  );
  const current = activeAssignments.find((assignment) => assignment.agentId === input.agentId);
  if (!current) return null;

  const now = new Date().toISOString();
  const unassignedAt = closeTimestampAfter(current.assignedAt, normalizeTimestamp(input.unassignedAt));
  const closed: SalesOrderAgentAssignment = {
    ...current,
    unassignedAt,
    unassignedBy: input.unassignedBy ?? null,
    reassignmentReason: normalizeText(input.reason),
    updatedAt: now,
    version: current.version + 1,
    ...getSyncMetadata(workspaceId, now),
  };
  await db.sales_order_agent_assignments.put(closed);
  await syncUpsert(ASSIGNMENT_TABLE, closed);

  if (shouldUseCloudData(workspaceId)) {
    await requestServerCommissionReconciliation(workspaceId, order.id, { assignmentId: closed.id });
    return closed;
  }

  await reverseClosedSalesOrderAssignmentCommission(
    current,
    order,
    unassignedAt,
    normalizeText(input.reason),
    input.unassignedBy,
  );
  return closed;
}

export async function assignSalesOrderAgent(
  workspaceId: string,
  input: AssignSalesOrderAgentInput,
) {
  const order = await db.sales_orders.get(input.orderId);
  if (!order || order.isDeleted || order.workspaceId !== workspaceId) {
    throw new Error("Sales order not found");
  }
  if (!input.agentId) {
    const activeAssignments = getActiveSalesOrderAgentAssignments(
      await db.sales_order_agent_assignments
        .where("[workspaceId+orderId]")
        .equals([workspaceId, input.orderId])
        .and((row) => !row.isDeleted)
        .toArray(),
      input.orderId,
    );
    for (const assignment of activeAssignments) {
      await unassignSalesOrderAgent(workspaceId, {
        orderId: input.orderId,
        agentId: assignment.agentId,
        unassignedAt: input.assignedAt,
        unassignedBy: input.assignedBy,
        reason: input.reason,
      });
    }
    return null;
  }
  if (order.status === "cancelled") {
    throw new Error("Cancelled sales orders cannot be assigned");
  }
  const agent = await db.agents.get(input.agentId);
  if (!agent || agent.isDeleted || agent.workspaceId !== workspaceId || agent.agentType !== "field_agent") {
    throw new Error("Select a field agent from this workspace");
  }

  const history = await db.sales_order_agent_assignments
    .where("[workspaceId+orderId]")
    .equals([workspaceId, input.orderId])
    .and((row) => !row.isDeleted)
    .toArray();
  const current = getActiveSalesOrderAgentAssignments(history, input.orderId)
    .find((assignment) => assignment.agentId === input.agentId) ?? null;

  let citySnapshot = input.customerCitySnapshot === undefined
    ? current?.customerCitySnapshot ?? null
    : normalizeText(input.customerCitySnapshot);
  if (input.customerCitySnapshot === undefined && !current) {
    const [partner, customer] = await Promise.all([
      order.businessPartnerId ? db.business_partners.get(order.businessPartnerId) : null,
      order.customerId ? db.customers.get(order.customerId) : null,
    ]);
    citySnapshot = normalizeText(partner?.city || customer?.city || null);
  }
  const deliveryChargeAmount = input.deliveryChargeAmount === undefined
    ? current?.deliveryChargeAmount ?? 0
    : assertMoney(input.deliveryChargeAmount, "Delivery charge");
  const internalDeliveryCostAmount = input.internalDeliveryCostAmount === undefined
    ? current?.internalDeliveryCostAmount ?? 0
    : assertMoney(input.internalDeliveryCostAmount, "Internal delivery cost");
  const requestedAssignedAt = normalizeTimestamp(input.assignedAt);
  const manualCommission = input.manualCommission === undefined && current
    ? getAssignmentManualSalesAgentCommission(current)
    : input.manualCommission
      ? resolveManualSalesAgentCommission(order, input.manualCommission)
      : null;
  if (manualCommission) {
    const existingTerms = await findMembershipAndPlan(input.agentId, requestedAssignedAt);
    if (existingTerms) {
      throw new Error("This sales agent has a commission plan; remove the manual order commission");
    }
  }
  const keepsCurrentSnapshots = current
    && current.customerCitySnapshot === citySnapshot
    && current.deliveryChargeAmount === deliveryChargeAmount
    && current.internalDeliveryCostAmount === internalDeliveryCostAmount
    && hasSameManualSalesAgentCommission(current, manualCommission);
  if (keepsCurrentSnapshots) return current;

  const now = new Date().toISOString();
  const closed = current ? {
    ...current,
    unassignedAt: closeTimestampAfter(current.assignedAt, requestedAssignedAt),
    unassignedBy: input.assignedBy ?? null,
    reassignmentReason: normalizeText(input.reason),
    updatedAt: now,
    version: current.version + 1,
    ...getSyncMetadata(workspaceId, now),
  } satisfies SalesOrderAgentAssignment : null;
  const assignedAt = closed?.unassignedAt ?? requestedAssignedAt;
  const assignment: SalesOrderAgentAssignment = {
    id: generateId(),
    workspaceId,
    orderId: input.orderId,
    agentId: input.agentId,
    assignedAt,
    unassignedAt: null,
    assignedBy: input.assignedBy ?? null,
    unassignedBy: null,
    reassignmentReason: normalizeText(input.reason),
    previousAssignmentId: current?.id ?? null,
    customerCitySnapshot: citySnapshot,
    deliveryChargeAmount,
    internalDeliveryCostAmount,
    manualCommissionType: manualCommission?.type ?? null,
    manualCommissionSourceAmount: manualCommission?.sourceAmount ?? null,
    manualCommissionSourceCurrency: manualCommission?.sourceCurrency ?? null,
    manualCommissionConvertedAmount: manualCommission?.convertedAmount ?? null,
    manualCommissionExchangeRate: manualCommission?.exchangeRate ?? null,
    manualCommissionExchangeRateSource: manualCommission?.exchangeRateSource ?? null,
    manualCommissionExchangeRateTimestamp: manualCommission?.exchangeRateTimestamp ?? null,
    manualCommissionExchangeRates: manualCommission?.exchangeRates ?? null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
    ...getSyncMetadata(workspaceId, now),
  };

  await db.transaction("rw", db.sales_order_agent_assignments, async () => {
    if (closed) await db.sales_order_agent_assignments.put(closed);
    await db.sales_order_agent_assignments.put(assignment);
  });
  if (closed) await syncUpsert(ASSIGNMENT_TABLE, closed);
  await syncUpsert(ASSIGNMENT_TABLE, assignment);

  if (shouldUseCloudData(workspaceId)) {
    await requestServerCommissionReconciliation(workspaceId, order.id, { assignmentId: assignment.id });
    return assignment;
  }

  if (current) {
    await reverseClosedSalesOrderAssignmentCommission(
      current,
      order,
      assignedAt,
      normalizeText(input.reason) || "Commission reversed after sales order assignment changed",
      input.assignedBy,
    );
  }
  if (order.status === "completed") {
    await accrueSalesOrderCommission(workspaceId, order.id, input.assignedBy);
  }
  return assignment;
}

export async function replaceSalesOrderAgentAssignments(
  workspaceId: string,
  input: ReplaceSalesOrderAgentAssignmentsInput,
) {
  const requestedAgentIds = new Set<string>();
  for (const assignment of input.assignments) {
    if (requestedAgentIds.has(assignment.agentId)) {
      throw new Error("A sales agent can only be added once to an order");
    }
    requestedAgentIds.add(assignment.agentId);
  }

  const activeAssignments = getActiveSalesOrderAgentAssignments(
    await db.sales_order_agent_assignments
      .where("[workspaceId+orderId]")
      .equals([workspaceId, input.orderId])
      .and((row) => !row.isDeleted)
      .toArray(),
    input.orderId,
  );
  for (const assignment of activeAssignments) {
    if (requestedAgentIds.has(assignment.agentId)) continue;
    await unassignSalesOrderAgent(workspaceId, {
      orderId: input.orderId,
      agentId: assignment.agentId,
      unassignedBy: input.assignedBy,
      reason: input.reason,
    });
  }
  for (const assignment of input.assignments) {
    await assignSalesOrderAgent(workspaceId, {
      ...assignment,
      orderId: input.orderId,
      assignedBy: input.assignedBy,
      reason: assignment.reason ?? input.reason,
    });
  }

  return getActiveSalesOrderAgentAssignments(
    await db.sales_order_agent_assignments
      .where("[workspaceId+orderId]")
      .equals([workspaceId, input.orderId])
      .and((row) => !row.isDeleted)
      .toArray(),
    input.orderId,
  );
}

export async function reverseCommissionForOrderReturn(
  workspaceId: string,
  orderReturnId: string,
  createdBy?: string | null,
) {
  const orderReturn = await db.order_returns.get(orderReturnId);
  if (!orderReturn || orderReturn.isDeleted || orderReturn.workspaceId !== workspaceId || orderReturn.status !== "posted") {
    return [];
  }
  const order = await db.sales_orders.get(orderReturn.orderId);
  if (!order || order.isDeleted || order.workspaceId !== workspaceId) return [];
  if (shouldUseCloudData(workspaceId)) {
    await requestServerCommissionReconciliation(workspaceId, order.id, {
      orderReturnId,
    });
    return [];
  }

  const existingReturnReversals = await db.agent_commission_entries
    .where("orderReturnId")
    .equals(orderReturnId)
    .and((entry) => !entry.isDeleted && entry.kind === "reversal")
    .toArray();
  const reversedAssignmentIds = new Set(existingReturnReversals
    .map((entry) => entry.assignmentId)
    .filter((assignmentId): assignmentId is string => !!assignmentId));

  const orderEntries = await db.agent_commission_entries
    .where("[workspaceId+orderId]")
    .equals([workspaceId, order.id])
    .and((entry) => !entry.isDeleted)
    .toArray();
  const assignments = await db.sales_order_agent_assignments
    .where("[workspaceId+orderId]")
    .equals([workspaceId, order.id])
    .and((row) => !row.isDeleted)
    .toArray();
  const reversals: AgentCommissionEntry[] = [];

  for (const accrual of orderEntries.filter((entry) => entry.kind === "accrual")) {
    if (accrual.assignmentId && reversedAssignmentIds.has(accrual.assignmentId)) continue;
    const assignment = assignments.find((row) => row.id === accrual.assignmentId);
    if (!assignment) continue;
    const recognized = roundCommissionAmount(orderEntries
      .filter((entry) => entry.assignmentId === assignment.id && isOrderTargetCommissionEntry(entry))
      .reduce((sum, entry) => sum + entry.amount, 0));
    if (recognized <= 0) continue;

    const currentAssignment = !assignment.unassignedAt;
    const snapshotPlan = accrual.planId
      ? await db.agent_commission_plans.get(accrual.planId)
      : null;
    const fallbackPlan = {
      ratePercent: accrual.ratePercent,
      calculationBasis: accrual.calculationBasis,
      includeTax: accrual.includeTax,
      includeDeliveryCharge: accrual.includeDeliveryCharge,
    };
    const targetCalculation = currentAssignment
      ? accrual.membershipId == null && accrual.planId == null
        ? calculateManualSalesOrderCommission(order, assignment)
        : calculateSalesOrderCommission(order, snapshotPlan ?? fallbackPlan, assignment)
      : null;
    const target = targetCalculation?.commissionAmount ?? 0;
    const difference = roundCommissionAmount(target - recognized);
    if (difference >= 0) continue;
    const reversal = await reverseRecognizedAssignmentCommission(assignment, order, accrual, difference, {
      orderReturnId,
      occurredAt: orderReturn.returnedAt,
      reason: `Commission reversed for order return: ${orderReturn.reason}`,
      createdBy: createdBy ?? orderReturn.returnedBy ?? null,
    });
    if (reversal) reversals.push(reversal);
  }
  return [...existingReturnReversals, ...reversals];
}

export async function recordCommissionApproval(
  workspaceId: string,
  input: RecordCommissionApprovalInput,
) {
  const source = await db.agent_commission_entries.get(input.entryId);
  if (!source || source.isDeleted || source.workspaceId !== workspaceId
    || !["accrual", "adjustment"].includes(source.kind)) {
    throw new Error("Earned commission entry not found");
  }
  const existing = await db.agent_commission_entries
    .where("relatedEntryId")
    .equals(source.id)
    .and((entry) => !entry.isDeleted && entry.kind === "approval")
    .first();
  if (existing) return existing;

  return appendEntry(workspaceId, {
    orderId: source.orderId ?? null,
    assignmentId: source.assignmentId ?? null,
    agentId: source.agentId,
    membershipId: source.membershipId ?? null,
    planId: source.planId ?? null,
    orderReturnId: null,
    relatedEntryId: source.id,
    kind: "approval",
    status: "approved",
    currency: source.currency,
    calculationBasis: source.calculationBasis,
    includeTax: source.includeTax,
    includeDeliveryCharge: source.includeDeliveryCharge,
    basisAmount: source.basisAmount,
    revenueAmount: source.revenueAmount,
    costAmount: source.costAmount,
    taxAmount: source.taxAmount,
    deliveryChargeAmount: source.deliveryChargeAmount,
    ratePercent: source.ratePercent,
    amount: 0,
    occurredAt: normalizeTimestamp(input.occurredAt),
    payoutReference: null,
    notes: normalizeText(input.notes),
    createdBy: input.approvedBy ?? null,
  });
}

const COMMISSION_PAYOUT_SOURCE_TYPE = "agent_commission_payout";

function assertCommissionPayoutPaymentMethod(paymentMethod: WorkspacePaymentMethod) {
  if (paymentMethod === "credit" || paymentMethod === "loan" || paymentMethod === "loan_adjustment" || paymentMethod === "unknown") {
    throw new Error("Select a valid commission payout payment method");
  }
}

async function resolveAgentCounterpartyName(agentId: string) {
  const agent = await db.agents.get(agentId);
  if (!agent) return null;
  const partner = await db.business_partners.get(agent.businessPartnerId);
  return partner && !partner.isDeleted ? partner.name : null;
}

/**
 * Commission payouts are real cash movements: every payout entry is mirrored
 * by an outgoing `payment_transaction` so the ledger, payments page, and safe
 * reports stay consistent. Safe to call repeatedly — an existing transaction
 * linked to the payout entry is reused instead of duplicated.
 */
async function ensureCommissionPayoutTransaction(
  workspaceId: string,
  entry: Pick<AgentCommissionEntry, "id" | "agentId" | "amount" | "currency" | "occurredAt" | "payoutReference">,
  options: {
    counterpartyName: string | null;
    paymentMethod: WorkspacePaymentMethod;
    notes: string | null;
    createdBy: string | null;
    accountId: string | null;
    accountNameSnapshot: string | null;
  },
) {
  const existing = await db.payment_transactions
    .where("[workspaceId+sourceType+sourceRecordId]")
    .equals([workspaceId, COMMISSION_PAYOUT_SOURCE_TYPE, entry.agentId])
    .and((transaction) => (
      !transaction.isDeleted
      && transaction.sourceSubrecordId === entry.id
    ))
    .first();
  if (existing) return existing;

  const { appendPaymentTransaction } = await import("./payments");
  return appendPaymentTransaction(workspaceId, {
    sourceModule: "orders",
    sourceType: COMMISSION_PAYOUT_SOURCE_TYPE,
    sourceRecordId: entry.agentId,
    sourceSubrecordId: entry.id,
    direction: "outgoing",
    amount: Math.abs(entry.amount),
    currency: entry.currency,
    paymentMethod: options.paymentMethod,
    paidAt: entry.occurredAt,
    counterpartyName: options.counterpartyName,
    referenceLabel: `Agent commission payout ${entry.payoutReference ?? ""}`.trim(),
    note: options.notes,
    createdBy: options.createdBy,
    accountId: options.accountId,
    accountNameSnapshot: options.accountNameSnapshot,
    metadata: {
      agentCommissionEntryId: entry.id,
      agentId: entry.agentId,
      payoutReference: entry.payoutReference ?? null,
    },
  });
}

export async function recordCommissionPayout(
  workspaceId: string,
  input: RecordCommissionPayoutInput,
) {
  const amount = assertMoney(input.amount, "Payout amount");
  if (amount <= 0) throw new Error("Payout amount must be greater than zero");
  const orderId = normalizeText(input.orderId);
  if (!orderId) throw new Error("Select the sales order whose commission is being paid");
  const paymentMethod = input.paymentMethod ?? "cash";
  assertCommissionPayoutPaymentMethod(paymentMethod);
  const notes = normalizeText(input.notes);
  const createdBy = input.createdBy ?? null;
  const agent = await db.agents.get(input.agentId);
  if (!agent || agent.isDeleted || agent.workspaceId !== workspaceId || agent.agentType !== "field_agent") {
    throw new Error("Field agent not found");
  }
  const order = await db.sales_orders.get(orderId);
  if (!order || order.isDeleted || order.workspaceId !== workspaceId) {
    throw new Error("Sales order not found");
  }
  if (order.currency.toLowerCase() !== input.currency.toLowerCase()) {
    throw new Error("Commission payouts must use the sales order currency");
  }
  const entries = await db.agent_commission_entries
    .where("[workspaceId+agentId]")
    .equals([workspaceId, input.agentId])
    .and((entry) => !entry.isDeleted && entry.currency === input.currency)
    .toArray();
  const orderEntries = entries.filter((entry) => entry.orderId === order.id);
  const assignmentId = orderEntries.find((entry) => entry.assignmentId)?.assignmentId;
  if (!assignmentId) {
    throw new Error("The selected sales order has no commission for this agent");
  }
  const outstanding = roundCommissionAmount(orderEntries
    .filter((entry) => entry.kind !== "estimate" && entry.kind !== "approval")
    .reduce((sum, entry) => sum + entry.amount, 0));
  if (amount - outstanding > 0.000001) {
    throw new Error("Payout amount exceeds the selected order's outstanding commission");
  }

  // Keep the server-derived accrual current before the live ledger insert.
  // When offline this queues the same idempotent reconciliation ahead of the
  // payout; the sync engine also enforces that ordering before it uploads.
  await requestServerCommissionReconciliation(workspaceId, order.id, {
    assignmentId,
  });

  const payoutEntryId = generateId();
  const payoutEntryInput = {
    orderId: order.id,
    assignmentId,
    agentId: input.agentId,
    membershipId: null,
    planId: null,
    orderReturnId: null,
    relatedEntryId: null,
    kind: "payout",
    status: "paid",
    currency: input.currency,
    calculationBasis: "net_profit",
    includeTax: false,
    includeDeliveryCharge: false,
    basisAmount: 0,
    revenueAmount: 0,
    costAmount: 0,
    taxAmount: 0,
    deliveryChargeAmount: 0,
    ratePercent: 0,
    amount: -amount,
    occurredAt: normalizeTimestamp(input.occurredAt),
    payoutReference: order.orderNumber,
    notes: normalizeText(input.notes),
    createdBy: input.createdBy ?? null,
  } satisfies Omit<AgentCommissionEntry, keyof ReturnType<typeof getSyncMetadata>
    | "id" | "workspaceId" | "createdAt" | "updatedAt" | "version" | "isDeleted">;

  const payment = await ensureCommissionPayoutTransaction(workspaceId, {
    id: payoutEntryId,
    agentId: input.agentId,
    amount: -amount,
    currency: input.currency,
    occurredAt: payoutEntryInput.occurredAt,
    payoutReference: payoutEntryInput.payoutReference,
  }, {
    counterpartyName: await resolveAgentCounterpartyName(input.agentId),
    paymentMethod,
    notes,
    createdBy,
    accountId: input.accountId ?? null,
    accountNameSnapshot: input.accountNameSnapshot ?? null,
  });

  try {
    return await appendEntry(workspaceId, payoutEntryInput, payoutEntryId);
  } catch (error) {
    try {
      const { softDeletePaymentTransaction } = await import("./payments");
      await softDeletePaymentTransaction(payment);
    } catch (cleanupError) {
      console.error("[Sales Agent Commissions] Failed to roll back the payout payment after entry creation failed:", cleanupError);
    }
    throw error;
  }
}

export async function recordCommissionAdjustment(
  workspaceId: string,
  input: RecordCommissionAdjustmentInput,
) {
  const amount = roundCommissionAmount(Number(input.amount));
  if (!Number.isFinite(amount) || amount === 0) throw new Error("Adjustment amount cannot be zero");
  if (!normalizeText(input.notes)) throw new Error("Adjustment reason is required");
  const agent = await db.agents.get(input.agentId);
  if (!agent || agent.isDeleted || agent.workspaceId !== workspaceId || agent.agentType !== "field_agent") {
    throw new Error("Field agent not found");
  }
  if (input.relatedEntryId) {
    const related = await db.agent_commission_entries.get(input.relatedEntryId);
    if (!related || related.workspaceId !== workspaceId || related.agentId !== input.agentId) {
      throw new Error("Related commission entry does not belong to this agent");
    }
    throw new Error("Manual adjustments cannot impersonate an automatic order reconciliation event");
  }
  const resolvedOrderId = input.orderId ?? null;
  let assignment: SalesOrderAgentAssignment | null = null;
  if (resolvedOrderId) {
    const order = await db.sales_orders.get(resolvedOrderId);
    if (!order || order.isDeleted || order.workspaceId !== workspaceId) {
      throw new Error("Sales order not found");
    }
    if (order.currency.toLowerCase() !== input.currency.toLowerCase()) {
      throw new Error("An order-linked adjustment must use the sales order currency");
    }
    const matchingAssignments = await db.sales_order_agent_assignments
      .where("[workspaceId+orderId]")
      .equals([workspaceId, resolvedOrderId])
      .and((row) => !row.isDeleted && row.agentId === input.agentId)
      .toArray();
    // Sort active assignments first, then newest within each state.
    assignment = matchingAssignments.sort((left, right) => (
      Number(!!left.unassignedAt) - Number(!!right.unassignedAt)
      || right.assignedAt.localeCompare(left.assignedAt)
    ))[0] ?? null;
    if (!assignment) {
      throw new Error("The sales order is not assigned to this agent");
    }
  }

  return appendEntry(workspaceId, {
    orderId: resolvedOrderId,
    assignmentId: assignment?.id ?? null,
    agentId: input.agentId,
    membershipId: null,
    planId: null,
    orderReturnId: null,
    relatedEntryId: null,
    kind: "adjustment",
    status: amount < 0 ? "reversed" : "earned",
    currency: input.currency,
    calculationBasis: "net_profit",
    includeTax: false,
    includeDeliveryCharge: false,
    basisAmount: 0,
    revenueAmount: 0,
    costAmount: 0,
    taxAmount: 0,
    deliveryChargeAmount: 0,
    ratePercent: 0,
    amount,
    occurredAt: normalizeTimestamp(input.occurredAt),
    payoutReference: null,
    notes: normalizeText(input.notes),
    createdBy: input.createdBy ?? null,
  });
}
