import { useLiveQuery } from "dexie-react-hooks";

import { isPositiveQuantity, roundQuantity } from "@/lib/quantity";
import { generateId } from "@/lib/utils";

import { db } from "./database";
import {
  adjustInventoryQuantity,
  getInventoryQuantityForProductStorage,
} from "./inventory";
import { createInventoryTransaction } from "./inventoryTransactions";
import type {
  InventoryTransaction,
  StockAdjustment,
  StockAdjustmentReason,
  StockAdjustmentType,
} from "./models";

const STOCK_ADJUSTMENT_TRANSACTION_TYPE = "stock_adjustment";
const ALLOWED_TYPES: StockAdjustmentType[] = ["increase", "decrease"];
const ALLOWED_REASONS: StockAdjustmentReason[] = [
  "purchase",
  "return",
  "correction",
  "damage",
  "theft",
  "expired",
  "production",
  "other",
];

export interface StockAdjustmentInput {
  productId: string;
  storageId: string;
  adjustmentType: StockAdjustmentType;
  quantity: number;
  reason: StockAdjustmentReason;
  notes?: string | null;
  createdBy?: string | null;
}

export interface StockAdjustmentFilterOptions {
  productId?: string | null;
  storageId?: string | null;
  adjustmentType?: StockAdjustmentType | null;
  reason?: StockAdjustmentReason | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
}

function normalizeOptionalString(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeAdjustmentInput(input: StockAdjustmentInput) {
  const productId = input.productId.trim();
  const storageId = input.storageId.trim();
  const adjustmentType = input.adjustmentType;
  const quantity = Number(input.quantity);
  const reason = input.reason;

  if (!productId) {
    throw new Error("Product is required");
  }

  if (!storageId) {
    throw new Error("Storage is required");
  }

  if (!ALLOWED_TYPES.includes(adjustmentType)) {
    throw new Error("Adjustment type is invalid");
  }

  if (!isPositiveQuantity(quantity)) {
    throw new Error("Quantity must be greater than zero");
  }

  if (!ALLOWED_REASONS.includes(reason)) {
    throw new Error("Adjustment reason is invalid");
  }

  return {
    productId,
    storageId,
    adjustmentType,
    quantity: roundQuantity(quantity),
    reason,
    notes: normalizeOptionalString(input.notes),
    createdBy: normalizeOptionalString(input.createdBy),
  };
}

function mapTransactionToStockAdjustment(
  transaction: InventoryTransaction,
): StockAdjustment | null {
  if (
    transaction.transactionType !== STOCK_ADJUSTMENT_TRANSACTION_TYPE ||
    transaction.quantityDelta === 0
  ) {
    return null;
  }

  const adjustmentType =
    transaction.quantityDelta > 0 ? "increase" : "decrease";
  const reason =
    transaction.adjustmentReason &&
    ALLOWED_REASONS.includes(transaction.adjustmentReason)
      ? transaction.adjustmentReason
      : "correction";

  return {
    id: transaction.id,
    workspaceId: transaction.workspaceId,
    productId: transaction.productId,
    storageId: transaction.storageId,
    adjustmentType,
    quantity: Math.abs(transaction.quantityDelta),
    previousQuantity: transaction.previousQuantity,
    newQuantity: transaction.newQuantity,
    reason,
    notes: transaction.notes,
    createdBy: transaction.createdBy,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    version: transaction.version,
    isDeleted: transaction.isDeleted,
    syncStatus: transaction.syncStatus,
    lastSyncedAt: transaction.lastSyncedAt,
  };
}

export async function createStockAdjustment(
  workspaceId: string,
  input: StockAdjustmentInput,
  options?: {
    timestamp?: string;
    id?: string;
  },
) {
  const timestamp = options?.timestamp || new Date().toISOString();
  const normalized = normalizeAdjustmentInput(input);
  const quantityDelta = roundQuantity(
    normalized.adjustmentType === "increase"
      ? normalized.quantity
      : -normalized.quantity
  );
  const previousQuantity = await getInventoryQuantityForProductStorage(
    normalized.productId,
    normalized.storageId,
  );
  const newQuantity = roundQuantity(previousQuantity + quantityDelta);
  const transactionId = options?.id || generateId();

  if (newQuantity < 0) {
    throw new Error("Insufficient inventory");
  }

  let inventoryAdjusted = false;
  try {
    await adjustInventoryQuantity({
      workspaceId,
      productId: normalized.productId,
      storageId: normalized.storageId,
      quantityDelta,
      timestamp,
    });
    inventoryAdjusted = true;

    const transaction = await createInventoryTransaction(
      workspaceId,
      {
        productId: normalized.productId,
        storageId: normalized.storageId,
        transactionType: STOCK_ADJUSTMENT_TRANSACTION_TYPE,
        quantityDelta,
        previousQuantity,
        newQuantity,
        adjustmentReason: normalized.reason,
        referenceId: transactionId,
        referenceType: STOCK_ADJUSTMENT_TRANSACTION_TYPE,
        notes: normalized.notes,
        createdBy: normalized.createdBy,
      },
      {
        id: transactionId,
        timestamp,
      },
    );

    return mapTransactionToStockAdjustment(transaction) as StockAdjustment;
  } catch (error) {
    if (inventoryAdjusted) {
      try {
        await adjustInventoryQuantity({
          workspaceId,
          productId: normalized.productId,
          storageId: normalized.storageId,
          quantityDelta: -quantityDelta,
        });
      } catch (rollbackError) {
        console.error(
          "[StockAdjustments] Failed to roll back inventory after adjustment error:",
          rollbackError,
        );
      }
    }

    throw error;
  }
}

export function filterStockAdjustments(
  adjustments: StockAdjustment[],
  filters: StockAdjustmentFilterOptions,
) {
  const startTime = filters.startDate
    ? new Date(filters.startDate).setHours(0, 0, 0, 0)
    : null;
  const endTime = filters.endDate
    ? new Date(filters.endDate).setHours(23, 59, 59, 999)
    : null;

  return adjustments.filter((adjustment) => {
    if (filters.productId && adjustment.productId !== filters.productId) {
      return false;
    }

    if (filters.storageId && adjustment.storageId !== filters.storageId) {
      return false;
    }

    if (
      filters.adjustmentType &&
      adjustment.adjustmentType !== filters.adjustmentType
    ) {
      return false;
    }

    if (filters.reason && adjustment.reason !== filters.reason) {
      return false;
    }

    const createdAt = new Date(adjustment.createdAt).getTime();
    if (startTime !== null && createdAt < startTime) {
      return false;
    }

    if (endTime !== null && createdAt > endTime) {
      return false;
    }

    return true;
  });
}

export function useStockAdjustments(workspaceId: string | undefined) {
  const adjustments = useLiveQuery(async () => {
    if (!workspaceId) {
      return [];
    }

    const rows = await db.inventory_transactions
      .where("workspaceId")
      .equals(workspaceId)
      .and(
        (row) =>
          !row.isDeleted &&
          row.transactionType === STOCK_ADJUSTMENT_TRANSACTION_TYPE,
      )
      .toArray();

    return rows
      .map(mapTransactionToStockAdjustment)
      .filter((row): row is StockAdjustment => !!row)
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      );
  }, [workspaceId]);

  return adjustments ?? [];
}
