import { useLiveQuery } from "dexie-react-hooks";

import {
  QUANTITY_EPSILON,
  isNonNegativeQuantity,
  quantitiesEqual,
  roundQuantity,
} from "@/lib/quantity";
import { generateId } from "@/lib/utils";

import { db } from "./database";
import type {
  InventoryTransaction,
  InventoryTransactionType,
  StockAdjustmentReason,
} from "./models";

// Inventory activity is intentionally device-local in every workspace mode.
export interface InventoryTransactionInput {
  productId: string;
  storageId: string;
  transactionType: InventoryTransactionType;
  quantityDelta: number;
  previousQuantity: number;
  newQuantity: number;
  adjustmentReason?: StockAdjustmentReason | null;
  referenceId?: string | null;
  referenceType?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface InventoryTransactionFilterOptions {
  productId?: string | null;
  storageId?: string | null;
  transactionType?: InventoryTransactionType | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
}

function normalizeOptionalString(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeOptionalAdjustmentReason(
  value?: StockAdjustmentReason | null,
) {
  const normalized = value?.trim();
  return normalized ? (normalized as StockAdjustmentReason) : null;
}

function normalizeTransactionInput(input: InventoryTransactionInput) {
  const productId = input.productId.trim();
  const storageId = input.storageId.trim();
  const quantityDelta = Number(input.quantityDelta);
  const previousQuantity = Number(input.previousQuantity);
  const newQuantity = Number(input.newQuantity);
  const transactionType = input.transactionType;
  const allowedTypes: InventoryTransactionType[] = [
    "stock_adjustment",
    "transfer_in",
    "transfer_out",
    "sale",
    "return",
    "initial_stock",
  ];
  const allowedAdjustmentReasons: StockAdjustmentReason[] = [
    "purchase",
    "return",
    "correction",
    "damage",
    "theft",
    "expired",
    "production",
    "other",
  ];
  const adjustmentReason = normalizeOptionalAdjustmentReason(
    input.adjustmentReason,
  );

  if (!productId) {
    throw new Error("Product is required");
  }

  if (!storageId) {
    throw new Error("Storage is required");
  }

  if (!allowedTypes.includes(transactionType)) {
    throw new Error("Transaction type is invalid");
  }

  if (!Number.isFinite(quantityDelta) || Math.abs(quantityDelta) <= QUANTITY_EPSILON) {
    throw new Error("Quantity delta must be non-zero");
  }

  if (!isNonNegativeQuantity(previousQuantity)) {
    throw new Error("Previous quantity is invalid");
  }

  if (!isNonNegativeQuantity(newQuantity)) {
    throw new Error("New quantity is invalid");
  }

  if (!quantitiesEqual(previousQuantity + quantityDelta, newQuantity)) {
    throw new Error("Transaction quantities are inconsistent");
  }

  if (
    transactionType === "stock_adjustment" &&
    (!adjustmentReason || !allowedAdjustmentReasons.includes(adjustmentReason))
  ) {
    throw new Error("Adjustment reason is invalid");
  }

  return {
    productId,
    storageId,
    transactionType,
    quantityDelta: roundQuantity(quantityDelta),
    previousQuantity: roundQuantity(previousQuantity),
    newQuantity: roundQuantity(newQuantity),
    adjustmentReason:
      transactionType === "stock_adjustment" ? adjustmentReason : null,
    referenceId: normalizeOptionalString(input.referenceId),
    referenceType: normalizeOptionalString(input.referenceType),
    notes: normalizeOptionalString(input.notes),
    createdBy: normalizeOptionalString(input.createdBy),
  };
}

export async function createInventoryTransaction(
  workspaceId: string,
  input: InventoryTransactionInput,
  options?: {
    id?: string;
    timestamp?: string;
  },
) {
  const timestamp = options?.timestamp || new Date().toISOString();
  const normalized = normalizeTransactionInput(input);

  const transaction: InventoryTransaction = {
    id: options?.id || generateId(),
    workspaceId,
    ...normalized,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    isDeleted: false,
    syncStatus: "synced",
    lastSyncedAt: timestamp,
  };

  await db.inventory_transactions.put(transaction);
  return transaction;
}

export function filterInventoryTransactions(
  transactions: InventoryTransaction[],
  filters: InventoryTransactionFilterOptions,
) {
  const startTime = filters.startDate
    ? new Date(filters.startDate).setHours(0, 0, 0, 0)
    : null;
  const endTime = filters.endDate
    ? new Date(filters.endDate).setHours(23, 59, 59, 999)
    : null;

  return transactions.filter((transaction) => {
    if (filters.productId && transaction.productId !== filters.productId) {
      return false;
    }

    if (filters.storageId && transaction.storageId !== filters.storageId) {
      return false;
    }

    if (
      filters.transactionType &&
      transaction.transactionType !== filters.transactionType
    ) {
      return false;
    }

    const createdAt = new Date(transaction.createdAt).getTime();
    if (startTime !== null && createdAt < startTime) {
      return false;
    }

    if (endTime !== null && createdAt > endTime) {
      return false;
    }

    return true;
  });
}

export function getInventoryTransactionsForProduct(
  transactions: InventoryTransaction[],
  productId: string,
) {
  return filterInventoryTransactions(transactions, { productId });
}

export function getInventoryTransactionsForStorage(
  transactions: InventoryTransaction[],
  storageId: string,
) {
  return filterInventoryTransactions(transactions, { storageId });
}

export function getInventoryTransactionsForType(
  transactions: InventoryTransaction[],
  transactionType: InventoryTransactionType,
) {
  return filterInventoryTransactions(transactions, { transactionType });
}

export function getInventoryTransactionsInDateRange(
  transactions: InventoryTransaction[],
  startDate?: Date | string | null,
  endDate?: Date | string | null,
) {
  return filterInventoryTransactions(transactions, { startDate, endDate });
}

export function useInventoryTransactions(workspaceId: string | undefined) {
  const transactions = useLiveQuery(async () => {
    if (!workspaceId) {
      return [];
    }

    const rows = await db.inventory_transactions
      .where("workspaceId")
      .equals(workspaceId)
      .and((row) => !row.isDeleted)
      .toArray();

    return rows.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
  }, [workspaceId]);

  return transactions ?? [];
}
