import { supabase, isSupabaseConfigured } from "@/auth/supabase";
import { db } from "@/local-db";
import { syncProductStockSnapshot } from "@/local-db/inventory";
import type { Inventory } from "@/local-db/models";
import { syncProductBarcodeCachesForWorkspace } from "@/local-db/productBarcodes";
import { rekeyPriceBookItemReferences } from "@/local-db/priceBookReferences";
import { runSupabaseAction } from "@/lib/supabaseRequest";
import { getSupabaseClientForTable } from "@/lib/supabaseSchema";
import { isLocalWorkspaceMode } from "@/workspace/workspaceMode";
// import { getPendingItems, removeFromQueue, incrementRetry } from './syncQueue'

export type SyncState = "idle" | "syncing" | "error" | "offline";

export interface SyncResult {
  success: boolean;
  pushed: number;
  pulled: number;
  errors: string[];
}

const PULL_PAGE_SIZE = 1000;
const SALE_ITEM_PARENT_BATCH_SIZE = 250;

const SYNC_PULL_TABLES = [
  "products",
  "product_barcodes",
  "price_books",
  "price_book_items",
  "inventory",
  "inventory_transactions",
  "stock_batches",
  "storages",
  "product_discounts",
  "category_discounts",
  "inventory_transfer_transactions",
  "reorder_transfer_rules",
  "categories",
  "customers",
  "suppliers",
  "agents",
  "fleet_vehicles",
  "fleet_vehicle_assignments",
  "business_partners",
  "business_partner_merge_candidates",
  "invoices",
  "invoice_versions",
  "workspaces",
  "employees",
  "workspace_contacts",
  "sales",
  "sale_items",
  "sale_returns",
  "sale_return_items",
  "order_returns",
  "order_return_items",
  "sales_orders",
  "purchase_orders",
  "order_installments",
  "travel_agency_sales",
  "real_estate_transactions",
  "real_estate_installments",
  "real_estate_payments",
  "exchange_pair_prices",
  "exchange_transactions",
  "exchange_fee_rules",
  "fx_safes",
  "fx_safe_balances",
  "fx_safe_movements",
  "budget_settings",
  "budget_allocations",
  "expense_series",
  "expense_items",
  "payroll_statuses",
  "dividend_statuses",
  "loans",
  "loan_installments",
  "loan_payments",
  "payment_transactions",
  "clinical_presets",
] as const;

const TABLES_WITHOUT_VERSION = new Set<string>([
  "sales",
  "sale_items",
  "sale_returns",
  "sale_return_items",
  "invoice_versions",
]);
const PROCESSABLE_MUTATION_STATUSES = ["pending", "syncing"] as const;
const SALE_CREATE_RESULT_SELECT =
  "id, sequence_id, system_verified, system_review_status, system_review_reason";

function isSaleCreateMutation(mutation: {
  entityType: string;
  operation: string;
}) {
  return mutation.entityType === "sales" && mutation.operation === "create";
}

function isRetriableSaleReturnMutation(mutation: {
  entityType: string;
  operation: string;
  payload?: Record<string, unknown>;
  error?: string;
}) {
  return (
    mutation.entityType === "sales" &&
    mutation.operation === "update" &&
    mutation.payload?.__rpc_action === "process_sale_return" &&
    /network|fetch|timeout|timed out|connection|abort/i.test(
      mutation.error ?? "",
    )
  );
}

function isPriceBookMutation(mutation: { entityType: string }) {
  return mutation.entityType === "price_books" || mutation.entityType === "price_book_items";
}

export function isRecoverablePriceBookMutation(mutation: {
  entityType: string;
  error?: string;
}) {
  return isPriceBookMutation(mutation) &&
    /network|fetch|timeout|timed out|connection|abort|permission|row-level|capability|42501|duplicate|unique|23505|23503|23514|foreign key|same workspace|must reference/i.test(
      mutation.error ?? "",
    );
}

// Convert camelCase to snake_case
function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    if (obj[key] === undefined) {
      continue;
    }
    const snakeKey = key.replace(
      /[A-Z]/g,
      (letter) => `_${letter.toLowerCase()}`,
    );
    result[snakeKey] = obj[key];
  }
  return result;
}

// Convert snake_case to camelCase
function toCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
      letter.toUpperCase(),
    );
    result[camelKey] = obj[key];
  }
  return result;
}

// Get table name for entity type
function getTableName(entityType: string): string {
  return entityType;
}

// Timeout helper
async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number = 15000,
): Promise<T> {
  return runSupabaseAction("sync.request", () => promise, {
    timeoutMs: ms,
    platform: "all",
  });
}

function getSaleSequenceId(result: unknown): number | null {
  const raw =
    (result as { sequence_id?: unknown; sequenceId?: unknown } | null)
      ?.sequence_id ??
    (result as { sequenceId?: unknown } | null)?.sequenceId;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getSaleReviewUpdate(result: unknown): Record<string, unknown> {
  const source = result as
    | {
        system_verified?: unknown;
        system_review_status?: unknown;
        system_review_reason?: unknown;
        systemVerified?: unknown;
        systemReviewStatus?: unknown;
        systemReviewReason?: unknown;
      }
    | null;
  const update: Record<string, unknown> = {};

  const systemVerified = source?.system_verified ?? source?.systemVerified;
  const systemReviewStatus =
    source?.system_review_status ?? source?.systemReviewStatus;
  const systemReviewReason =
    source?.system_review_reason ?? source?.systemReviewReason;

  if (systemVerified !== undefined) {
    update.systemVerified = systemVerified;
  }
  if (systemReviewStatus !== undefined) {
    update.systemReviewStatus = systemReviewStatus;
  }
  if (systemReviewReason !== undefined) {
    update.systemReviewReason = systemReviewReason;
  }

  return update;
}

async function fetchSaleCreateResult(
  entityId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = (await withTimeout(
    supabase
      .from("sales")
      .select(SALE_CREATE_RESULT_SELECT)
      .eq("id", entityId)
      .maybeSingle(),
    30000,
  )) as any;

  if (error) {
    throw error;
  }

  return (data ?? null) as Record<string, unknown> | null;
}

async function fetchPullRows(
  table: (typeof SYNC_PULL_TABLES)[number],
  workspaceId: string,
  since: string,
): Promise<Array<Record<string, unknown>>> {
  const client = getSupabaseClientForTable(table);

  if (table === "workspaces") {
    const { data, error } = (await withTimeout(
      client.from(table).select("*").eq("id", workspaceId),
      30000,
    )) as any;

    if (error) {
      throw error;
    }

    return (data ?? []) as Array<Record<string, unknown>>;
  }

  if (table === "sale_items") {
    return fetchSaleItemsForWorkspace(workspaceId, since);
  }

  const rows: Array<Record<string, unknown>> = [];
  let from = 0;

  while (true) {
    const to = from + PULL_PAGE_SIZE - 1;
    const { data, error } = (await withTimeout(
      (client
        .from(table)
        .select("*")
        .eq("workspace_id", workspaceId)
        .gt("updated_at", since)
        .order("updated_at", { ascending: true })
        .range(from, to) as any),
      30000,
    )) as any;

    if (error) {
      throw error;
    }

    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);

    if (page.length < PULL_PAGE_SIZE) {
      break;
    }

    from += PULL_PAGE_SIZE;
  }

  return rows;
}

async function fetchSaleIdsForWorkspace(
  workspaceId: string,
  since: string,
): Promise<string[]> {
  const saleIds: string[] = [];
  let from = 0;

  while (true) {
    const to = from + PULL_PAGE_SIZE - 1;
    const { data, error } = (await withTimeout(
      supabase
        .from("sales")
        .select("id")
        .eq("workspace_id", workspaceId)
        .gt("updated_at", since)
        .order("updated_at", { ascending: true })
        .range(from, to),
      30000,
    )) as any;

    if (error) {
      throw error;
    }

    const page = (data ?? []) as Array<{ id?: unknown }>;
    saleIds.push(
      ...page
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string"),
    );

    if (page.length < PULL_PAGE_SIZE) {
      break;
    }

    from += PULL_PAGE_SIZE;
  }

  return saleIds;
}

async function fetchSaleItemsForWorkspace(
  workspaceId: string,
  since: string,
): Promise<Array<Record<string, unknown>>> {
  const saleIds = await fetchSaleIdsForWorkspace(workspaceId, since);
  const rows: Array<Record<string, unknown>> = [];

  for (
    let index = 0;
    index < saleIds.length;
    index += SALE_ITEM_PARENT_BATCH_SIZE
  ) {
    const saleIdBatch = saleIds.slice(index, index + SALE_ITEM_PARENT_BATCH_SIZE);
    let from = 0;

    while (true) {
      const to = from + PULL_PAGE_SIZE - 1;
      const { data, error } = (await withTimeout(
        supabase
          .from("sale_items")
          .select("*")
          .in("sale_id", saleIdBatch)
          .order("id", { ascending: true })
          .range(from, to),
        30000,
      )) as any;

      if (error) {
        throw error;
      }

      const page = (data ?? []) as Array<Record<string, unknown>>;
      rows.push(...page);

      if (page.length < PULL_PAGE_SIZE) {
        break;
      }

      from += PULL_PAGE_SIZE;
    }
  }

  return rows;
}

export function shouldApplyRemoteItem(
  table: (typeof SYNC_PULL_TABLES)[number],
  localItem: unknown,
  remoteData: Record<string, unknown>,
) {
  if (!localItem) {
    return true;
  }

  if (
    (table === "price_books" || table === "price_book_items") &&
    (localItem as { syncStatus?: unknown }).syncStatus === "pending"
  ) {
    return false;
  }

  if (TABLES_WITHOUT_VERSION.has(table)) {
    return true;
  }

  const localVersion = Number((localItem as any).version ?? 0);
  const remoteVersion = Number((remoteData as any).version ?? 0);
  if (localVersion !== remoteVersion) {
    return localVersion < remoteVersion;
  }

  const localUpdatedAt = Date.parse(String((localItem as any).updatedAt ?? ""));
  const remoteUpdatedAt = Date.parse(String((remoteData as any).updatedAt ?? ""));
  return Number.isFinite(remoteUpdatedAt) &&
    (!Number.isFinite(localUpdatedAt) || remoteUpdatedAt > localUpdatedAt);
}

// Process offline mutation queue
export async function processMutationQueue(
  _userId: string,
): Promise<{ success: number; failed: number; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: 0, failed: 1, error: "Supabase not configured" };
  }

  const mutationGroups = await Promise.all(
    PROCESSABLE_MUTATION_STATUSES.map((status) =>
      db.offline_mutations.where("status").equals(status).sortBy("createdAt"),
    ),
  );
  const failedRetriableMutations = await db.offline_mutations
    .where("status")
    .equals("failed")
    .filter(
      (mutation) =>
        isSaleCreateMutation(mutation) ||
        isRetriableSaleReturnMutation(mutation) ||
        isRecoverablePriceBookMutation(mutation),
    )
    .sortBy("createdAt");
  const mutations = mutationGroups
    .flat()
    .concat(failedRetriableMutations)
    .sort((left, right) =>
      String(left.createdAt).localeCompare(String(right.createdAt)),
    );

  console.log(
    `[Sync] processMutationQueue: Found ${mutations.length} pending mutations`,
  );

  let successCount = 0;
  let failedCount = 0;
  let lastError: string | undefined;
  const failedPriceBookIds = new Set<string>();

  for (const mutation of mutations) {
    if (mutation.entityType === "price_book_items") {
      const referencedPriceBookId = mutation.payload.priceBookId ?? mutation.payload.price_book_id;
      if (typeof referencedPriceBookId === "string" && failedPriceBookIds.has(referencedPriceBookId)) {
        continue;
      }
    }

    // Mark active attempts, and retry rows that were interrupted while syncing.
    await db.offline_mutations.update(mutation.id, {
      status: "syncing",
      error: undefined,
    });

    try {
      const { entityType, operation, payload, entityId, workspaceId, id } =
        mutation;
      const tableName = getTableName(entityType);
      const client = getSupabaseClientForTable(tableName);
      let syncedEntityId = entityId;
      let entityHandledInline = false;
      const shouldHardDelete =
        operation === "delete" &&
        (entityType === "loans" || payload.hardDelete === true);

      // Prepare payload
      const dbPayload = toSnakeCase(payload) as Record<string, unknown>;
      // Ensure workspace scope is present for workspace-bound rows.
      if (
        entityType !== "workspaces" &&
        entityType !== "workspace_branches" &&
        dbPayload.workspace_id === undefined
      ) {
        dbPayload.workspace_id = workspaceId;
      }

      // Remove local metadata
      delete dbPayload.sync_status;
      delete dbPayload.last_synced_at;

      if (entityType === "products") {
        delete dbPayload.storage_name;
        delete dbPayload.barcode;
        delete dbPayload.barcodes;
      }

      if (entityType === "agents") {
        delete dbPayload.image_url;
      }

      if (operation === "create" || operation === "update") {
        if (entityType === "sales") {
          const rpcAction =
            typeof dbPayload.__rpc_action === "string"
              ? String(dbPayload.__rpc_action)
              : null;
          delete dbPayload.__rpc_action;

          if (operation === "create") {
            const { data: serverResult, error } = await supabase.rpc(
              "complete_sale",
              { payload: dbPayload },
            );

            let result = serverResult as Record<string, unknown> | null;
            if (error) {
              const recoveredResult = await fetchSaleCreateResult(entityId).catch(
                () => null,
              );
              if (!recoveredResult) {
                throw error;
              }
              result = recoveredResult;
            }

            if (!getSaleSequenceId(result)) {
              const fetchedResult = await fetchSaleCreateResult(entityId);
              if (fetchedResult) {
                result = {
                  ...(result ?? {}),
                  ...fetchedResult,
                };
              }
            }

            const sequenceId = getSaleSequenceId(result);
            if (!sequenceId) {
              throw new Error(
                "Sale synced but Supabase did not return a sequence ID.",
              );
            }

            const syncedAt = new Date().toISOString();
            const formattedInvoiceId = `#${String(sequenceId).padStart(5, "0")}`;
            const saleReviewUpdate = getSaleReviewUpdate(result);

            await db.sales.update(entityId, {
              sequenceId,
              ...saleReviewUpdate,
              syncStatus: "synced",
              lastSyncedAt: syncedAt,
            });
            await db.invoices.update(entityId, {
              sequenceId,
              invoiceid: formattedInvoiceId,
              syncStatus: "synced",
              lastSyncedAt: syncedAt,
            });
            entityHandledInline = true;
          } else if (rpcAction === "process_sale_return") {
            const { error } = await supabase.rpc("process_sale_return", {
              p_return_id: dbPayload.p_return_id,
              p_sale_id: dbPayload.p_sale_id,
              p_items: dbPayload.p_items,
              p_return_reason: dbPayload.p_return_reason,
              p_refund_method: dbPayload.p_refund_method,
            });
            if (error) throw error;

            const returnId =
              typeof dbPayload.p_return_id === "string"
                ? dbPayload.p_return_id
                : null;
            if (returnId) {
              const syncedAt = new Date().toISOString();
              await db.sale_returns.update(returnId, {
                syncStatus: "synced",
                lastSyncedAt: syncedAt,
              });
              await db.sale_return_items
                .where("returnId")
                .equals(returnId)
                .modify({
                  syncStatus: "synced",
                  lastSyncedAt: syncedAt,
                });
            }
          } else if (rpcAction === "return_sale_items") {
            const { error } = await supabase.rpc("return_sale_items", {
              p_sale_item_ids: dbPayload.p_sale_item_ids,
              p_return_quantities: dbPayload.p_return_quantities,
              p_return_reason: dbPayload.p_return_reason,
            });
            if (error) throw error;
          } else if (rpcAction === "return_whole_sale") {
            const { error } = await supabase.rpc("return_whole_sale", {
              p_sale_id: dbPayload.p_sale_id,
              p_return_reason: dbPayload.p_return_reason,
            });
            if (error) throw error;
          } else {
            const { error } = await client
              .from(tableName)
              .update(dbPayload)
              .eq("id", entityId);
            if (error) throw error;
          }
        } else if (
          entityType === "workspaces" ||
          entityType === "workspace_branches"
        ) {
          // Remove workspace_id from payload for workspace table update itself
          delete dbPayload.workspace_id;
          delete dbPayload.user_id;
          const { error } = await client
            .from(tableName)
            .update(dbPayload)
            .eq("id", entityId);
          if (error) throw error;
        } else if (entityType === "inventory") {
          const { data: remoteInventoryRow, error } = await client
            .from(tableName)
            .upsert(dbPayload, {
              onConflict: "workspace_id,product_id,storage_id",
            })
            .select("*")
            .single();

          if (error) throw error;

          const syncedAt = new Date().toISOString();
          const localInventoryRow = toCamelCase(
            remoteInventoryRow as Record<string, unknown>,
          ) as unknown as Inventory;
          localInventoryRow.syncStatus = "synced";
          localInventoryRow.lastSyncedAt = syncedAt;
          syncedEntityId = localInventoryRow.id;

          if (syncedEntityId !== entityId) {
            await db.inventory.delete(entityId);
          }

          await db.inventory.put(localInventoryRow);
          entityHandledInline = true;
        } else if (entityType === "business_partner_merge_candidates") {
          const { data: remoteMergeCandidateRow, error } = await client
            .from(tableName)
            .upsert(dbPayload, {
              onConflict: "primary_partner_id,secondary_partner_id,merge_type",
            })
            .select("*")
            .single();

          if (error) throw error;

          const syncedAt = new Date().toISOString();
          const localMergeCandidateRow = toCamelCase(
            remoteMergeCandidateRow as Record<string, unknown>,
          ) as Record<string, unknown>;
          localMergeCandidateRow.syncStatus = "synced";
          localMergeCandidateRow.lastSyncedAt = syncedAt;
          syncedEntityId = String(localMergeCandidateRow.id);

          if (syncedEntityId !== entityId) {
            await db.business_partner_merge_candidates.delete(entityId);
          }

          await db.business_partner_merge_candidates.put(
            localMergeCandidateRow as never,
          );
          entityHandledInline = true;
        } else if (entityType === "price_book_items") {
          const priceBookId = dbPayload.price_book_id;
          const productId = dbPayload.product_id;
          if (typeof priceBookId !== "string" || typeof productId !== "string") {
            throw new Error("Price Book item is missing its Price Book or product reference");
          }

          const { data: remoteExistingPriceBookItem, error: lookupError } = await client
            .from(tableName)
            .select("*")
            .eq("price_book_id", priceBookId)
            .eq("product_id", productId)
            .maybeSingle();
          if (lookupError) throw lookupError;

          if (remoteExistingPriceBookItem) {
            const remoteExisting = remoteExistingPriceBookItem as Record<string, unknown>;
            dbPayload.id = remoteExisting.id;
            dbPayload.created_at = remoteExisting.created_at;
            dbPayload.created_by = remoteExisting.created_by;
            const remoteVersion = Number(remoteExisting.version ?? 0);
            const localVersion = Number(dbPayload.version ?? 0);
            dbPayload.version = Math.max(localVersion, remoteVersion + 1);
          }

          const { data: remotePriceBookItem, error } = await client
            .from(tableName)
            .upsert(dbPayload, {
              onConflict: "price_book_id,product_id",
            })
            .select("*")
            .single();

          if (error) throw error;

          const syncedAt = new Date().toISOString();
          const localPriceBookItem = toCamelCase(
            remotePriceBookItem as Record<string, unknown>,
          ) as Record<string, unknown>;
          localPriceBookItem.syncStatus = "synced";
          localPriceBookItem.lastSyncedAt = syncedAt;
          syncedEntityId = String(localPriceBookItem.id);

          if (syncedEntityId !== entityId) {
            await rekeyPriceBookItemReferences(entityId, syncedEntityId);
            await db.price_book_items.delete(entityId);
          }

          await db.price_book_items.put(localPriceBookItem as never);
          entityHandledInline = true;
        } else {
          // Special handling for invoices to remove legacy fields
          if (tableName === "invoices") {
            delete dbPayload.items;
            delete dbPayload.currency;
            delete dbPayload.subtotal;
            delete dbPayload.discount;
            delete dbPayload.print_metadata;
            delete dbPayload.is_snapshot;
            delete dbPayload.customer_id;
            delete dbPayload.status;
            delete dbPayload.local_path_a4;
            delete dbPayload.local_path_receipt;
            delete dbPayload.pdf_blob_a4;
            delete dbPayload.pdf_blob_receipt;
          }

          const { error } = await client.from(tableName).upsert(dbPayload);
          if (error) throw error;
        }
      } else if (operation === "delete") {
        if (shouldHardDelete) {
          const { error } = await client
            .from(tableName)
            .delete()
            .eq("id", entityId);
          if (error) throw error;
        } else {
          const { error } = await client
            .from(tableName)
            .update({ is_deleted: true, updated_at: new Date().toISOString() })
            .eq("id", entityId);
          if (error) throw error;
        }
      }

      // Success: Mark as synced
      await db.offline_mutations.update(id, { status: "synced" }); // Or delete if preferred, but synced is good for history
      if (isPriceBookMutation(mutation)) {
        failedPriceBookIds.delete(entityId);
        const supersededFailures = await db.offline_mutations
          .where("status")
          .equals("failed")
          .filter((candidate) =>
            candidate.id !== id &&
            candidate.entityType === entityType &&
            candidate.entityId === entityId &&
            (
              candidate.createdAt < mutation.createdAt ||
              (candidate.createdAt === mutation.createdAt && candidate.id < id)
            ),
          )
          .primaryKeys();
        if (supersededFailures.length > 0) {
          await db.offline_mutations.bulkUpdate(
            supersededFailures.map((failureId) => ({
              key: failureId,
              changes: { status: "synced" as const, error: undefined },
            })),
          );
        }
      }

      // Also update the actual entity sync status to 'synced'
      const table = (db as any)[entityType];
      if (table) {
        if (shouldHardDelete && entityType === "loans") {
          await db.transaction(
            "rw",
            [db.loans, db.loan_installments, db.loan_payments],
            async () => {
              await db.loans.delete(entityId);
              await db.loan_installments
                .where("loanId")
                .equals(entityId)
                .delete();
              await db.loan_payments.where("loanId").equals(entityId).delete();
            },
          );
        } else if (shouldHardDelete) {
          await table.delete(syncedEntityId);
        } else if (!entityHandledInline) {
          await table.update(syncedEntityId, {
            syncStatus: "synced",
            lastSyncedAt: new Date().toISOString(),
          });
        }
      }

      if (entityType === "product_barcodes" && workspaceId) {
        await syncProductBarcodeCachesForWorkspace(workspaceId);
      }

      successCount++;
    } catch (err: any) {
      console.error(`[Sync] Failed mutation ${mutation.id}:`, err);
      const errorMessage = err.message || "Unknown error";
      await db.offline_mutations.update(mutation.id, {
        status: "failed",
        error: errorMessage,
      });
      if (isPriceBookMutation(mutation)) {
        if (mutation.entityType === "price_books") {
          failedPriceBookIds.add(mutation.entityId);
        }
        failedCount++;
        lastError = errorMessage;
        continue;
      }
      // Stop processing on first error to maintain order integrity
      return { success: successCount, failed: failedCount + 1, error: errorMessage };
    }
  }

  return {
    success: successCount,
    failed: failedCount,
    ...(lastError ? { error: lastError } : {}),
  };
}

// Deprecated: Old pushChanges (kept for reference or fallback if needed during transition)
export async function pushChanges(
  _userId: string,
  _workspaceId: string,
): Promise<{ success: number; failed: number }> {
  // Redirect to new logic? Or just leave as legacy.
  // For now, let's leave it but maybe logs warning.
  console.warn("[Sync] pushChanges is deprecated. Use processMutationQueue.");
  return { success: 0, failed: 0 };
}

// Pull changes from Supabase
export async function pullChanges(
  workspaceId: string,
  lastSyncTime: string | null,
): Promise<{ pulled: number }> {
  if (isLocalWorkspaceMode(workspaceId)) {
    return { pulled: 0 };
  }

  if (!isSupabaseConfigured) {
    console.log("[Sync] pullChanges: Supabase not configured");
    return { pulled: 0 };
  }

  const since = lastSyncTime || "1970-01-01T00:00:00Z";
  console.log(
    `[Sync] pullChanges START: Workspace ${workspaceId}, since ${since}`,
  );

  let totalPulled = 0;

  for (const table of SYNC_PULL_TABLES) {
    try {
      const affectedInventoryProducts = new Set<string>();
      // console.log(`[Sync] pullChanges: Fetching ${table}...`)
      const data = await fetchPullRows(table, workspaceId, since);

      if (data && data.length > 0) {
        console.log(
          `[Sync] pullChanges: Processing ${data.length} items for ${table}`,
        );
        const dbTable = (db as any)[table];

        for (const remoteItem of data) {
          const localItem = await dbTable.get(remoteItem.id);
          const remoteData = toCamelCase(remoteItem);

          if (table === "price_book_items") {
            const priceBookId = (remoteData as { priceBookId?: unknown }).priceBookId;
            const productId = (remoteData as { productId?: unknown }).productId;
            if (typeof priceBookId === "string" && typeof productId === "string") {
              const naturalKeyConflict = await db.price_book_items
                .where("[priceBookId+productId]")
                .equals([priceBookId, productId])
                .first();
              if (naturalKeyConflict && naturalKeyConflict.id !== remoteItem.id) {
                if (naturalKeyConflict.syncStatus === "pending") {
                  continue;
                }
                await db.price_book_items.delete(naturalKeyConflict.id);
              }
            }
          }

          // Version control: Last Write Wins based on updated_at
          // If local has newer version/updatedAt pending sync, don't overwrite?
          // But we are manual sync. If pulling, we assume server is truth.
          // However, if we have pending local changes, we should probably NOT overwrite them until we push?
          // Strategy: "Prioritize Supabase as single source of truth".
          // If we have pending local changes for this ID, we might have a conflict.
          // For V1, "Last Write Wins". If server is newer, taking server.
          // But if local is pending, it might be newer than server (but not pushed).
          // If we overwrite local pending with server (which matches old local state), we lose the mutation.
          // BUT our mutation is stored in `offline_mutations`!
          // So even if we overwrite the Entity table, the Mutation Queue still has the pending operation.
          // When we push, we will re-apply the mutation to server and then server will send back the final state.
          // So it is SAFE to overwrite Entity table because `offline_mutations` is the intent source of truth for "My Pending Changes".

          if (shouldApplyRemoteItem(table, localItem, remoteData)) {
            const localThermalPrinting =
              table === "workspaces"
                ? (localItem as any)?.thermal_printing
                : undefined;
            const workspaceOverrides =
              table === "workspaces" &&
              typeof localThermalPrinting === "boolean"
                ? { thermal_printing: localThermalPrinting }
                : {};

            await dbTable.put({
              ...remoteData,
              ...workspaceOverrides,
              syncStatus: "synced",
              lastSyncedAt: new Date().toISOString(),
            });
            if (
              table === "inventory" &&
              typeof (remoteData as any).productId === "string"
            ) {
              affectedInventoryProducts.add((remoteData as any).productId);
            }
            totalPulled++;
          }
        }

        if (table === "inventory" && affectedInventoryProducts.size > 0) {
          const { evaluateReorderTransferRulesForProduct } =
            await import("@/local-db/reorderTransferRules");
          await Promise.all(
            Array.from(affectedInventoryProducts).map((productId) =>
              syncProductStockSnapshot(
                productId,
                new Date().toISOString(),
                "remote",
              ).then(() =>
                evaluateReorderTransferRulesForProduct(workspaceId, productId),
              ),
            ),
          );
        }

        if (table === "products" || table === "product_barcodes") {
          await syncProductBarcodeCachesForWorkspace(workspaceId);
        }
      }
    } catch (err: any) {
      console.error(
        `[Sync] pullChanges: Critical error fetching ${table}:`,
        err.message || err,
      );
    }
  }

  console.log(
    `[Sync] pullChanges COMPLETE: Total items pulled: ${totalPulled}`,
  );
  return { pulled: totalPulled };
}

// Full sync - Process queue then pull
export async function fullSync(
  userId: string,
  workspaceId: string,
  lastSyncTime: string | null,
): Promise<SyncResult> {
  if (isLocalWorkspaceMode(workspaceId)) {
    return {
      success: true,
      pushed: 0,
      pulled: 0,
      errors: [],
    };
  }

  console.log(
    `[Sync] fullSync START for User ${userId}, Workspace ${workspaceId}`,
  );

  // 1. Process Offline Mutations
  const { success, failed, error } = await processMutationQueue(userId);

  // 2. Pull Changes (Force pull to ensure consistency)
  const { pulled } = await pullChanges(workspaceId, lastSyncTime);

  return {
    success: failed === 0,
    pushed: success,
    pulled,
    errors: error ? [error] : [],
  };
}
