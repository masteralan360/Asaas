import type Dexie from "dexie";

import { isTauri } from "@/lib/platform";
import { shouldMirrorToSqlite, isStrictLocalWorkspaceMode } from "@/workspace/workspaceMode";
import { runUsbBackupIfNeeded } from "./usbBackup";
import { createPwaSqliteConnection, isOpfsSupported, getPwaDbInstance, ensurePwaDatabase, DB_FILENAME as PWA_DB_FILENAME } from "./pwaSqlite";

const LOCAL_MODE_SQLITE_PATH = "sqlite:atlas-local-mode.db";

export const LOCAL_MODE_SQLITE_TABLES = [
  "products",
  "product_barcodes",
  "price_books",
  "price_book_items",
  "categories",
  "invoices",
  "invoice_versions",
  "users",
  "sales",
  "sales_exchange",
  "sale_items",
  "sale_returns",
  "sale_return_items",
  "order_returns",
  "order_return_items",
  "workspaces",
  "storages",
  "inventory",
  "inventory_transactions",
  "stock_batches",
  "product_discounts",
  "category_discounts",
  "inventory_transfer_transactions",
  "reorder_transfer_rules",
  "suppliers",
  "customers",
  "agents",
  "fleet_vehicles",
  "fleet_vehicle_assignments",
  "business_partners",
  "business_partner_merge_candidates",
  "employees",
  "budget_settings",
  "budget_allocations",
  "expense_series",
  "expense_items",
  "payroll_statuses",
  "dividend_statuses",
  "workspace_contacts",
  "loans",
  "loan_installments",
  "loan_payments",
  "payment_transactions",
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
  "profiles",
  "local_account_credentials",
  "workspace_permissions",
  "manual_entry_templates",
  "manual_entries",
  "clinical_appointments",
  "clinical_patients",
  "clinical_attachments",
  "clinical_presets",
] as const;

export type LocalModeSqliteTableName =
  (typeof LOCAL_MODE_SQLITE_TABLES)[number];

export interface SqliteConnection {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  transaction?<T>(
    task: (connection: SqliteConnection) => Promise<T>,
  ): Promise<T>;
  close?(database?: string): Promise<boolean>;
}

export type LocalModeSqliteMutation =
  | {
      type: "upsert";
      tableName: LocalModeSqliteTableName;
      row: Record<string, unknown>;
      workspaceId?: string | null;
    }
  | {
      type: "delete";
      tableName: LocalModeSqliteTableName;
      row: Record<string, unknown>;
      workspaceId?: string | null;
    };

interface StoredEntityRow {
  entity_type: string;
  entity_id: string;
  workspace_id: string | null;
  current_workspace: string | null;
  payload: string;
  updated_at: string | null;
}

const hydratedWorkspaces = new Set<string>();
const hydrationTasks = new Map<string, Promise<void>>();

let sqlitePromise: Promise<SqliteConnection | null> | null = null;
let sqliteWriteQueue: Promise<void> = Promise.resolve();
let mirroringPauseDepth = 0;
let testConnectionOverride: SqliteConnection | undefined;

async function ensureCurrentWorkspaceColumn(connection: SqliteConnection) {
  const columns = await connection.select<Array<{ name: string }>>(
    "PRAGMA table_info(local_entities)",
  );
  if (!columns.some((column) => column.name === "current_workspace")) {
    await connection.execute(
      "ALTER TABLE local_entities ADD COLUMN current_workspace TEXT",
    );
  }
  await connection.execute(`
    UPDATE local_entities
    SET current_workspace = workspace_id
    WHERE entity_type = 'profiles'
      AND current_workspace IS NULL
  `);
  await connection.execute(`
    CREATE INDEX IF NOT EXISTS idx_local_entities_current_workspace
    ON local_entities (current_workspace)
  `);
}

function isSupported() {
  return (
    testConnectionOverride !== undefined ||
    typeof window !== "undefined" &&
    (isTauri() || isOpfsSupported())
  );
}

export function setLocalModeSqliteConnectionForTests(
  connection?: SqliteConnection,
) {
  if (import.meta.env.MODE !== "test") {
    throw new Error("The SQLite test connection can only be set in tests.");
  }
  testConnectionOverride = connection;
  sqlitePromise = connection ? Promise.resolve(connection) : null;
  sqliteWriteQueue = Promise.resolve();
}

function isSqliteMirrorEnabled(workspaceId?: string | null) {
  if (isTauri()) {
    return shouldMirrorToSqlite(workspaceId);
  }
  return isStrictLocalWorkspaceMode(workspaceId);
}

function isMirroredTableName(
  tableName: string,
): tableName is LocalModeSqliteTableName {
  return (LOCAL_MODE_SQLITE_TABLES as readonly string[]).includes(tableName);
}

function isBlobMarker(
  value: unknown,
): value is { __atlasType: "blob"; mimeType: string; data: string } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { __atlasType?: string }).__atlasType === "blob" &&
    typeof (value as { data?: unknown }).data === "string"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

async function serializeValue(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    return {
      __atlasType: "blob" as const,
      mimeType: value.type,
      data: arrayBufferToBase64(await value.arrayBuffer()),
    };
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => serializeValue(item)));
  }

  if (isPlainObject(value)) {
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([key, nested]) => [key, await serializeValue(nested)] as const,
      ),
    );

    return Object.fromEntries(entries);
  }

  return value;
}

function deserializeValue(value: unknown): unknown {
  if (isBlobMarker(value)) {
    return base64ToBlob(value.data, value.mimeType);
  }

  if (Array.isArray(value)) {
    return value.map((item) => deserializeValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        deserializeValue(nested),
      ]),
    );
  }

  return value;
}

async function ensureConnection() {
  if (testConnectionOverride) {
    return testConnectionOverride;
  }
  if (!isSupported()) {
    return null;
  }

  if (!sqlitePromise) {
    sqlitePromise = (async () => {
      if (isTauri()) {
        const { default: Database } = await import("@tauri-apps/plugin-sql");
        const connection = await Database.load(LOCAL_MODE_SQLITE_PATH);

        await connection.execute("PRAGMA busy_timeout = 5000");
        await connection.execute("PRAGMA journal_mode = WAL");
        await connection.execute(`
                CREATE TABLE IF NOT EXISTS local_entities (
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    workspace_id TEXT,
                    payload TEXT NOT NULL,
                    updated_at TEXT,
                    PRIMARY KEY (entity_type, entity_id)
                )
            `);
        await connection.execute(`
                CREATE INDEX IF NOT EXISTS idx_local_entities_workspace
                ON local_entities (workspace_id)
            `);
        await connection.execute(`
                CREATE INDEX IF NOT EXISTS idx_local_entities_type_workspace
                ON local_entities (entity_type, workspace_id)
            `);
        await ensureCurrentWorkspaceColumn(connection as SqliteConnection);

        return connection as SqliteConnection;
      }

      return createPwaSqliteConnection();
    })().catch((error) => {
      sqlitePromise = null;
      console.error(
        "[LocalModeSQLite] Failed to initialize SQLite connection:",
        error,
      );
      if (isSqliteLockedError(error)) {
        throw error;
      }
      return null;
    });
  }

  return sqlitePromise;
}

export async function getLocalModeSqliteConnection() {
  return ensureConnection();
}

function isSqliteLockedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|code:\s*5/i.test(message);
}

async function resetSqliteConnection() {
  const currentConnection = sqlitePromise;
  sqlitePromise = null;

  try {
    const connection = currentConnection ? await currentConnection : null;
    if (connection?.close) {
      await connection.close();
      return;
    }
  } catch {
    // Fall through.
  }

  if (isTauri()) {
    try {
      const { default: Database } = await import("@tauri-apps/plugin-sql");
      await Database.get(LOCAL_MODE_SQLITE_PATH).close();
    } catch {
      // Reopening on the next attempt is enough.
    }
  }
}

async function retrySqliteWrite<T>(task: () => Promise<T>) {
  const retryDelays = [75, 200, 500];

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      const delay = retryDelays[attempt];
      if (!isSqliteLockedError(error) || delay === undefined) {
        throw error;
      }
      await resetSqliteConnection();
      await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
    }
  }
}

export function runLocalModeSqliteWrite<T>(task: () => Promise<T>): Promise<T> {
  const queued = sqliteWriteQueue
    .catch(() => undefined)
    .then(() => retrySqliteWrite(task));

  sqliteWriteQueue = queued.then(
    () => undefined,
    () => undefined,
  );

  void queued.then(
    () => {
      runUsbBackupIfNeeded();
    },
    () => undefined,
  );

  return queued;
}

async function runConnectionTransaction<T>(
  connection: SqliteConnection,
  task: (connection: SqliteConnection) => Promise<T>,
) {
  if (connection.transaction) {
    return connection.transaction(task);
  }

  await connection.execute("BEGIN IMMEDIATE");
  try {
    const result = await task(connection);
    await connection.execute("COMMIT");
    return result;
  } catch (error) {
    try {
      await connection.execute("ROLLBACK");
    } catch (rollbackError) {
      console.error("[LocalModeSQLite] Rollback failed:", rollbackError);
    }
    throw error;
  }
}

export function runLocalModeSqliteTransaction<T>(
  task: (connection: SqliteConnection) => Promise<T>,
): Promise<T> {
  return runLocalModeSqliteWrite(async () => {
    const connection = await ensureConnection();
    if (!connection) {
      throw new Error(
        "Local-mode SQLite is unavailable; the mutation was not committed.",
      );
    }

    return runConnectionTransaction(connection, task);
  });
}

function enqueueWrite(task: () => Promise<void>) {
  return runLocalModeSqliteWrite(task).catch((error) => {
      console.error("[LocalModeSQLite] Write failed:", error);
    });
}

async function withMirroringPaused<T>(work: () => Promise<T>) {
  mirroringPauseDepth += 1;

  try {
    return await work();
  } finally {
    mirroringPauseDepth = Math.max(0, mirroringPauseDepth - 1);
  }
}

function getEntityId(
  tableName: LocalModeSqliteTableName,
  row: Record<string, unknown>,
) {
  if (tableName === "workspaces") {
    return typeof row.id === "string"
      ? row.id
      : typeof row.workspaceId === "string"
        ? row.workspaceId
        : null;
  }

  return typeof row.id === "string" ? row.id : null;
}

async function resolveWorkspaceId(
  cacheDb: Dexie,
  tableName: LocalModeSqliteTableName,
  row: Record<string, unknown>,
) {
  if (tableName === "workspaces") {
    return typeof row.id === "string"
      ? row.id
      : typeof row.workspaceId === "string"
        ? row.workspaceId
        : null;
  }

  if (typeof row.workspaceId === "string") {
    return row.workspaceId;
  }

  if (tableName === "sale_items" && typeof row.saleId === "string") {
    const sale = await cacheDb.table("sales").get(row.saleId);
    return typeof sale?.workspaceId === "string" ? sale.workspaceId : null;
  }

  return null;
}

async function clearCacheRowsForWorkspace(cacheDb: Dexie, workspaceId: string) {
  const currentSales = await cacheDb
    .table("sales")
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  const currentSaleIds = currentSales
    .map((sale: Record<string, unknown>) => sale.id)
    .filter((saleId): saleId is string => typeof saleId === "string");

  for (const tableName of LOCAL_MODE_SQLITE_TABLES) {
    if (tableName === "workspaces") {
      await cacheDb.table(tableName).delete(workspaceId);
      continue;
    }

    if (tableName === "sale_items") {
      if (currentSaleIds.length > 0) {
        await cacheDb
          .table(tableName)
          .where("saleId")
          .anyOf(currentSaleIds)
          .delete();
      }
      continue;
    }

    await cacheDb
      .table(tableName)
      .where("workspaceId")
      .equals(workspaceId)
      .delete();
  }
}

async function readCacheRowsForWorkspace(
  cacheDb: Dexie,
  tableName: LocalModeSqliteTableName,
  workspaceId: string,
) {
  if (tableName === "workspaces") {
    const workspace = await cacheDb.table(tableName).get(workspaceId);
    return workspace ? [workspace] : [];
  }

  if (tableName === "sale_items") {
    const sales = await cacheDb
      .table("sales")
      .where("workspaceId")
      .equals(workspaceId)
      .toArray();
    const saleIds = sales
      .map((sale: Record<string, unknown>) => sale.id)
      .filter((saleId): saleId is string => typeof saleId === "string");

    if (saleIds.length === 0) {
      return [];
    }

    return cacheDb.table(tableName).where("saleId").anyOf(saleIds).toArray();
  }

  return cacheDb
    .table(tableName)
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
}

export async function seedWorkspaceFromDexie(cacheDb: Dexie, workspaceId: string) {
  for (const tableName of LOCAL_MODE_SQLITE_TABLES) {
    const rows = await readCacheRowsForWorkspace(
      cacheDb,
      tableName,
      workspaceId,
    );

    for (const row of rows) {
      await persistEntity(cacheDb, tableName, row as Record<string, unknown>);
    }
  }
}

async function getStoredWorkspaceRowCount(
  connection: SqliteConnection,
  workspaceId: string,
) {
  const rows = await connection.select<Array<{ count: number | string }>>(
    `
            SELECT COUNT(*) AS count
            FROM local_entities
            WHERE workspace_id = $1
               OR (entity_type = 'profiles' AND current_workspace = $1)
               OR (entity_type = 'workspaces' AND entity_id = $1)
        `,
    [workspaceId],
  );

  const count = rows[0]?.count;
  return typeof count === "string"
    ? Number.parseInt(count, 10)
    : Number(count ?? 0);
}

async function persistEntity(
  cacheDb: Dexie,
  tableName: LocalModeSqliteTableName,
  row: Record<string, unknown>,
  options: {
    connection?: SqliteConnection;
    authority?: boolean;
    workspaceId?: string | null;
  } = {},
) {
  const entityId = getEntityId(tableName, row);
  if (!entityId) {
    return;
  }

  const workspaceId = options.workspaceId ??
    await resolveWorkspaceId(cacheDb, tableName, row);
  const mirrorWorkspaceId = tableName === "profiles"
    && typeof row.currentWorkspaceId === "string"
    ? row.currentWorkspaceId
    : workspaceId;
  const shouldPersist =
    tableName === "workspaces"
      ? row.data_mode === "local" ||
        row.data_mode === "hybrid" ||
        (workspaceId ? isSqliteMirrorEnabled(workspaceId) : false)
      : mirrorWorkspaceId
        ? isSqliteMirrorEnabled(mirrorWorkspaceId)
        : false;

  if (!shouldPersist) {
    return;
  }

  const connection = options.connection ?? await ensureConnection();
  if (!connection) {
    if (options.authority) {
      throw new Error(
        "Local-mode SQLite is unavailable; the mutation was not committed.",
      );
    }
    return;
  }

  const payload = JSON.stringify(await serializeValue(row));
  const currentWorkspaceId = tableName === "profiles"
    ? typeof row.currentWorkspaceId === "string"
      ? row.currentWorkspaceId
      : workspaceId
    : null;
  const updatedAt =
    typeof row.updatedAt === "string"
      ? row.updatedAt
      : new Date().toISOString();

  await connection.execute(
    `
            INSERT INTO local_entities (entity_type, entity_id, workspace_id, current_workspace, payload, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                workspace_id = excluded.workspace_id,
                current_workspace = excluded.current_workspace,
                payload = excluded.payload,
                updated_at = excluded.updated_at
        `,
    [tableName, entityId, workspaceId, currentWorkspaceId, payload, updatedAt],
  );
}

async function deleteEntity(
  cacheDb: Dexie,
  tableName: LocalModeSqliteTableName,
  row: Record<string, unknown>,
  options: {
    connection?: SqliteConnection;
    authority?: boolean;
    workspaceId?: string | null;
  } = {},
) {
  const entityId = getEntityId(tableName, row);
  if (!entityId) {
    return;
  }

  const workspaceId = options.workspaceId ??
    await resolveWorkspaceId(cacheDb, tableName, row);
  const mirrorWorkspaceId = tableName === "profiles"
    && typeof row.currentWorkspaceId === "string"
    ? row.currentWorkspaceId
    : workspaceId;
  const shouldDelete =
    tableName === "workspaces"
      ? row.data_mode === "local" ||
        row.data_mode === "hybrid" ||
        (workspaceId ? isSqliteMirrorEnabled(workspaceId) : false)
      : mirrorWorkspaceId
        ? isSqliteMirrorEnabled(mirrorWorkspaceId)
        : false;

  if (!shouldDelete) {
    return;
  }

  const connection = options.connection ?? await ensureConnection();
  if (!connection) {
    if (options.authority) {
      throw new Error(
        "Local-mode SQLite is unavailable; the mutation was not committed.",
      );
    }
    return;
  }

  await connection.execute(
    `
            DELETE FROM local_entities
            WHERE entity_type = $1 AND entity_id = $2
        `,
    [tableName, entityId],
  );
}

function isAuthoritativeLocalMutation(
  mutation: LocalModeSqliteMutation,
) {
  const { tableName, row } = mutation;
  if (tableName === "workspaces") {
    const workspaceId = getEntityId(tableName, row);
    return row.data_mode === "local" ||
      (workspaceId ? isStrictLocalWorkspaceMode(workspaceId) : false);
  }

  const workspaceId = tableName === "profiles" &&
      typeof row.currentWorkspaceId === "string"
    ? row.currentWorkspaceId
    : mutation.workspaceId;
  return !!workspaceId && isStrictLocalWorkspaceMode(workspaceId);
}

export async function commitLocalModeSqliteMutations(
  cacheDb: Dexie,
  mutations: readonly LocalModeSqliteMutation[],
) {
  if (mutations.length === 0 || mirroringPauseDepth > 0) {
    return;
  }

  const authoritativeMutations: LocalModeSqliteMutation[] = [];
  for (const mutation of mutations) {
    if (isAuthoritativeLocalMutation(mutation)) {
      authoritativeMutations.push(mutation);
    }
  }

  if (authoritativeMutations.length === 0) {
    return;
  }

  if (!isSupported()) {
    if (import.meta.env.MODE === "test") {
      return;
    }
    throw new Error(
      "Local-mode SQLite is unavailable; the mutation was not committed.",
    );
  }

  await runLocalModeSqliteTransaction(async (connection) => {
    for (const mutation of authoritativeMutations) {
      if (mutation.type === "upsert") {
        await persistEntity(cacheDb, mutation.tableName, mutation.row, {
          connection,
          authority: true,
          workspaceId: mutation.workspaceId,
        });
      } else {
        await deleteEntity(cacheDb, mutation.tableName, mutation.row, {
          connection,
          authority: true,
          workspaceId: mutation.workspaceId,
        });
      }
    }
  });
}

export async function hydrateLocalModeCacheFromSqlite(
  cacheDb: Dexie,
  workspaceId?: string | null,
) {
  if (!workspaceId || !isSqliteMirrorEnabled(workspaceId) || !isSupported()) {
    return;
  }

  const existingTask = hydrationTasks.get(workspaceId);
  if (existingTask) {
    return existingTask;
  }

  if (hydratedWorkspaces.has(workspaceId)) {
    return;
  }

  const task = (async () => {
    const connection = await ensureConnection();
    if (!connection) {
      return;
    }

    const storedRowCount = await getStoredWorkspaceRowCount(
      connection,
      workspaceId,
    );
    if (storedRowCount === 0) {
      console.log(`[LocalModeSQLite] SQLite is empty for workspace ${workspaceId}.`);
      await withMirroringPaused(() =>
        clearCacheRowsForWorkspace(cacheDb, workspaceId)
      );
      hydratedWorkspaces.add(workspaceId);
      return;
    }

    const rows = await connection.select<StoredEntityRow[]>(
      `
                SELECT entity_type, entity_id, workspace_id, current_workspace, payload, updated_at
                FROM local_entities
                WHERE workspace_id = $1
                   OR (entity_type = 'profiles' AND current_workspace = $1)
                   OR (entity_type = 'workspaces' AND entity_id = $1)
                ORDER BY entity_type, updated_at
            `,
      [workspaceId],
    );

    await withMirroringPaused(async () => {
      await clearCacheRowsForWorkspace(cacheDb, workspaceId);

      const groupedRows = new Map<
        LocalModeSqliteTableName,
        Record<string, unknown>[]
      >();
      for (const row of rows) {
        if (!isMirroredTableName(row.entity_type)) {
          continue;
        }

        const payload = JSON.parse(row.payload) as unknown;
        const revived = deserializeValue(payload) as Record<string, unknown>;
        if (row.entity_type === "profiles") {
          if (row.workspace_id) {
            revived.workspaceId = row.workspace_id;
          }
          revived.currentWorkspaceId = row.current_workspace
            || (typeof revived.currentWorkspaceId === "string"
              ? revived.currentWorkspaceId
              : row.workspace_id);
        }
        const existingGroup = groupedRows.get(row.entity_type) ?? [];
        existingGroup.push(revived);
        groupedRows.set(row.entity_type, existingGroup);
      }

      for (const tableName of LOCAL_MODE_SQLITE_TABLES) {
        const records = groupedRows.get(tableName);
        if (!records?.length) {
          continue;
        }

        await cacheDb.table(tableName).bulkPut(records);
      }
    });

    hydratedWorkspaces.add(workspaceId);
  })().finally(() => {
    hydrationTasks.delete(workspaceId);
  });

  hydrationTasks.set(workspaceId, task);
  return task;
}

export async function readLocalProfileWorkspaceState(userId: string) {
  if (!userId || !isSupported()) {
    return null;
  }

  const connection = await ensureConnection();
  if (!connection) {
    return null;
  }

  const rows = await connection.select<StoredEntityRow[]>(
    `
      SELECT entity_type, entity_id, workspace_id, current_workspace, payload, updated_at
      FROM local_entities
      WHERE entity_type = 'profiles' AND entity_id = $1
      LIMIT 1
    `,
    [userId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  const payload = deserializeValue(JSON.parse(row.payload)) as Record<string, unknown>;
  const sourceWorkspaceId = row.workspace_id
    || (typeof payload.workspaceId === "string" ? payload.workspaceId : null);
  const currentWorkspaceId = row.current_workspace
    || (typeof payload.currentWorkspaceId === "string" ? payload.currentWorkspaceId : null)
    || sourceWorkspaceId;

  if (!sourceWorkspaceId || !currentWorkspaceId) {
    return null;
  }

  return { sourceWorkspaceId, currentWorkspaceId };
}

export function queueLocalModeSqliteUpsert(
  cacheDb: Dexie,
  tableName: string,
  row: Record<string, unknown>,
) {
  if (
    !isSupported() ||
    mirroringPauseDepth > 0 ||
    !isMirroredTableName(tableName)
  ) {
    return;
  }

  void enqueueWrite(async () => {
    const workspaceId = tableName === "profiles" &&
        typeof row.currentWorkspaceId === "string"
      ? row.currentWorkspaceId
      : await resolveWorkspaceId(cacheDb, tableName, row);
    const mutation: LocalModeSqliteMutation = {
      type: "upsert",
      tableName,
      row,
      workspaceId,
    };
    if (isAuthoritativeLocalMutation(mutation)) {
      return;
    }
    await persistEntity(cacheDb, tableName, row);
  });
}

export function queueLocalModeSqliteDelete(
  cacheDb: Dexie,
  tableName: string,
  row: Record<string, unknown>,
) {
  if (
    !isSupported() ||
    mirroringPauseDepth > 0 ||
    !isMirroredTableName(tableName)
  ) {
    return;
  }

  void enqueueWrite(async () => {
    const workspaceId = tableName === "profiles" &&
        typeof row.currentWorkspaceId === "string"
      ? row.currentWorkspaceId
      : await resolveWorkspaceId(cacheDb, tableName, row);
    const mutation: LocalModeSqliteMutation = {
      type: "delete",
      tableName,
      row,
      workspaceId,
    };
    if (isAuthoritativeLocalMutation(mutation)) {
      return;
    }
    await deleteEntity(cacheDb, tableName, row);
  });
}

export async function clearWorkspaceSqliteData(workspaceId: string) {
  if (!isSupported()) {
    return;
  }

  const connection = await ensureConnection();
  if (!connection) {
    return;
  }

  await connection.execute(
    `
            DELETE FROM local_entities
            WHERE workspace_id = $1
               OR (entity_type = 'workspaces' AND entity_id = $1)
        `,
    [workspaceId],
  );

  hydratedWorkspaces.delete(workspaceId);
  console.log(
    `[LocalModeSQLite] Cleared all SQLite data for workspace ${workspaceId}`,
  );
}

export async function downloadDatabaseFile(): Promise<void> {
  if (isTauri()) {
    try {
      const { readFile, writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      const { save } = await import("@tauri-apps/plugin-dialog");

      const filePath = await save({
        defaultPath: "atlas-local-mode.db",
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      });

      if (!filePath) return;

      const fileData = await readFile("atlas-local-mode.db", { baseDir: BaseDirectory.AppData });
      await writeFile(filePath, fileData);
    } catch (error) {
      console.error("[LocalModeSQLite] Failed to download database in Tauri:", error);
    }
    return;
  }

  let db = getPwaDbInstance();
  if (!db) {
    const loaded = await ensurePwaDatabase();
    if (!loaded) return;
    db = getPwaDbInstance();
  }
  if (!db) return;

  const data = db.export();
  const blob = new Blob([data], { type: "application/x-sqlite3" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = PWA_DB_FILENAME;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
