import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from "sql.js";
import type { SqliteConnection } from "./localModeSqlite";

const DB_FILENAME = "atlas-local-mode.db";

let sqlJsModule: SqlJsStatic | null = null;
let dbInstance: SqlJsDatabase | null = null;
let dbPromise: Promise<SqlJsDatabase | null> | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSave = false;

export function isOpfsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "storage" in navigator &&
    typeof (navigator.storage as { getDirectory?: () => unknown }).getDirectory === "function"
  );
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function loadFromOpfs(): Promise<Uint8Array | null> {
  try {
    const root = await getOpfsRoot();
    if (!root) return null;
    const handle = await root.getFileHandle(DB_FILENAME);
    const file = await handle.getFile();
    if (file.size === 0) return null;
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function saveToOpfs(data: Uint8Array): Promise<void> {
  try {
    const root = await getOpfsRoot();
    if (!root) return;
    const handle = await root.getFileHandle(DB_FILENAME, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  } catch (error) {
    console.error("[PwaSQLite] OPFS write failed:", error);
  }
}

function debouncedSave(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  if (pendingSave) return;
  pendingSave = true;
  saveTimeout = setTimeout(async () => {
    pendingSave = false;
    if (dbInstance) {
      try {
        const data = dbInstance.export();
        await saveToOpfs(data);
      } catch (error) {
        console.error("[PwaSQLite] Export/save failed:", error);
      }
    }
  }, 200);
}

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsModule) {
    sqlJsModule = await initSqlJs({
      locateFile: () => `/sql-wasm.wasm`,
    });
  }
  return sqlJsModule;
}

export function getPwaDbInstance(): SqlJsDatabase | null {
  return dbInstance;
}

export async function ensurePwaDatabase(): Promise<SqlJsDatabase | null> {
  if (dbInstance) return dbInstance;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    try {
      const SQL = await getSqlJs();
      const existingData = await loadFromOpfs();

      if (existingData && existingData.length > 0) {
        dbInstance = new SQL.Database(existingData);
      } else {
        dbInstance = new SQL.Database();
      }

      dbInstance.run(
        `CREATE TABLE IF NOT EXISTS local_entities (
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          workspace_id TEXT,
          payload TEXT NOT NULL,
          updated_at TEXT,
          PRIMARY KEY (entity_type, entity_id)
        )`,
      );
      dbInstance.run(
        `CREATE INDEX IF NOT EXISTS idx_local_entities_workspace
         ON local_entities (workspace_id)`,
      );
      dbInstance.run(
        `CREATE INDEX IF NOT EXISTS idx_local_entities_type_workspace
         ON local_entities (entity_type, workspace_id)`,
      );
      const tableInfo = dbInstance.exec("PRAGMA table_info(local_entities)");
      const nameIndex = tableInfo[0]?.columns.indexOf("name") ?? -1;
      const hasCurrentWorkspace = nameIndex >= 0 && tableInfo[0].values.some(
        (row) => row[nameIndex] === "current_workspace",
      );
      if (!hasCurrentWorkspace) {
        dbInstance.run(
          "ALTER TABLE local_entities ADD COLUMN current_workspace TEXT",
        );
      }
      dbInstance.run(`
        UPDATE local_entities
        SET current_workspace = workspace_id
        WHERE entity_type = 'profiles'
          AND current_workspace IS NULL
      `);
      dbInstance.run(
        `CREATE INDEX IF NOT EXISTS idx_local_entities_current_workspace
         ON local_entities (current_workspace)`,
      );

      const initialData = dbInstance.export();
      await saveToOpfs(initialData);

      return dbInstance;
    } catch (error) {
      dbPromise = null;
      console.error("[PwaSQLite] Failed to initialize:", error);
      return null;
    }
  })();

  return dbPromise;
}

export function createPwaSqliteConnection(): SqliteConnection {
  return {
    async execute(query: string, bindValues?: unknown[]): Promise<unknown> {
      const db = await ensurePwaDatabase();
      if (!db) throw new Error("PWA SQLite not initialized");

      if (bindValues && bindValues.length > 0) {
        db.run(query, bindValues as any[]);
      } else {
        db.run(query);
      }

      debouncedSave();
      return { rowsAffected: 0 };
    },

    async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
      const db = await ensurePwaDatabase();
      if (!db) throw new Error("PWA SQLite not initialized");

      const result = bindValues && bindValues.length > 0
        ? db.exec(query, bindValues as any[])
        : db.exec(query);

      if (!result || result.length === 0) {
        return [] as unknown as T;
      }

      const rows: Record<string, unknown>[] = [];
      for (const stmtResult of result) {
        const { columns, values } = stmtResult;
        for (const row of values) {
          const obj: Record<string, unknown> = {};
          for (let i = 0; i < columns.length; i++) {
            obj[columns[i]] = row[i];
          }
          rows.push(obj);
        }
      }

      return rows as unknown as T;
    },

    async close(): Promise<boolean> {
      try {
        if (saveTimeout) clearTimeout(saveTimeout);
        if (dbInstance) {
          const data = dbInstance.export();
          await saveToOpfs(data);
          dbInstance.close();
          dbInstance = null;
          dbPromise = null;
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}

export async function downloadPwaDatabase(): Promise<void> {
  const db = getPwaDbInstance();
  if (!db) {
    const loaded = await ensurePwaDatabase();
    if (!loaded) return;
  }

  const data = dbInstance!.export();
  const blob = new Blob([data], { type: "application/x-sqlite3" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = DB_FILENAME;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportPwaDatabaseAsBase64(): Promise<string | null> {
  const db = getPwaDbInstance();
  if (!db) return null;
  const data = db.export();
  const binary = String.fromCharCode(...data);
  return btoa(binary);
}

export { DB_FILENAME };
