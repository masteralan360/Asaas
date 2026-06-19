import "fake-indexeddb/auto";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  clearWorkspaceModeSnapshot,
  writeWorkspaceModeSnapshot,
} from "@/workspace/workspaceMode";

import { AtlasDatabase } from "./database";
import {
  setLocalModeSqliteConnectionForTests,
  type SqliteConnection,
} from "./localModeSqlite";

const WORKSPACE_ID = "local-authority-workspace";
const testDb = new AtlasDatabase("AtlasDatabaseLocalAuthorityTest");

function installBrowserStorage() {
  const rows = new Map<string, string>();
  const storage = {
    get length() {
      return rows.size;
    },
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
    clear: () => rows.clear(),
    key: (index: number) => Array.from(rows.keys())[index] ?? null,
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for test condition");
}

class RecordingSqliteConnection implements SqliteConnection {
  rows = new Map<string, string>();
  events: string[] = [];
  failEntityType: string | null = null;
  commitGate: Promise<void> | null = null;

  async execute(query: string, bindValues: unknown[] = []) {
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized.startsWith("INSERT INTO LOCAL_ENTITIES")) {
      const entityType = String(bindValues[0]);
      if (entityType === this.failEntityType) {
        throw new Error(`SQLite rejected ${entityType}`);
      }
      this.rows.set(`${entityType}:${String(bindValues[1])}`, String(bindValues[4]));
    } else if (normalized.startsWith("DELETE FROM LOCAL_ENTITIES")) {
      this.rows.delete(`${String(bindValues[0])}:${String(bindValues[1])}`);
    }
    return { rowsAffected: 1 };
  }

  async select<T>(): Promise<T> {
    return [] as T;
  }

  async transaction<T>(task: (connection: SqliteConnection) => Promise<T>) {
    const snapshot = new Map(this.rows);
    this.events.push("begin");
    try {
      const result = await task(this);
      if (this.commitGate) {
        await this.commitGate;
      }
      this.events.push("commit");
      return result;
    } catch (error) {
      this.rows = snapshot;
      this.events.push("rollback");
      throw error;
    }
  }
}

function entity(table: string, id: string) {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name: `${table}-${id}`,
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    version: 1,
    isDeleted: false,
    syncStatus: "synced",
    lastSyncedAt: "2026-06-19T00:00:00.000Z",
  };
}

describe("local-mode SQLite authority", () => {
  let sqlite: RecordingSqliteConnection;

  beforeAll(async () => {
    installBrowserStorage();
    await testDb.open();
  });

  beforeEach(async () => {
    await testDb.delete();
    await testDb.open();
    sqlite = new RecordingSqliteConnection();
    setLocalModeSqliteConnectionForTests(sqlite);
    writeWorkspaceModeSnapshot({
      workspaceId: WORKSPACE_ID,
      dataMode: "local",
    });
  });

  afterEach(() => {
    clearWorkspaceModeSnapshot(WORKSPACE_ID);
    setLocalModeSqliteConnectionForTests();
  });

  afterAll(async () => {
    await testDb.delete();
  });

  it("does not acknowledge a cache write before SQLite commits", async () => {
    const gate = deferred();
    sqlite.commitGate = gate.promise;
    let settled = false;

    const write = testDb.categories.put(entity("category", "category-1") as never)
      .then(() => {
        settled = true;
      });

    await waitFor(() => sqlite.events.length > 0);
    expect(sqlite.events).toEqual(["begin"]);
    expect(settled).toBe(false);

    gate.resolve();
    await write;

    expect(sqlite.events).toEqual(["begin", "commit"]);
    expect(settled).toBe(true);
    expect(sqlite.rows.has("categories:category-1")).toBe(true);
  });

  it("aborts the Dexie cache write when SQLite fails", async () => {
    sqlite.failEntityType = "products";

    await expect(
      testDb.products.put(entity("product", "product-1") as never),
    ).rejects.toThrow("SQLite rejected products");

    expect(await testDb.products.get("product-1")).toBeUndefined();
    expect(sqlite.rows.size).toBe(0);
    expect(sqlite.events).toEqual(["begin", "rollback"]);
  });

  it("commits an explicit multi-table cache transaction as one SQLite transaction", async () => {
    await testDb.transaction("rw", [testDb.categories, testDb.products], async () => {
      await testDb.categories.put(entity("category", "category-2") as never);
      await testDb.products.put(entity("product", "product-2") as never);
    });

    expect(sqlite.events).toEqual(["begin", "commit"]);
    expect(sqlite.rows.has("categories:category-2")).toBe(true);
    expect(sqlite.rows.has("products:product-2")).toBe(true);
  });

  it("rolls back SQLite and Dexie together when a grouped write fails", async () => {
    sqlite.failEntityType = "products";

    await expect(
      testDb.transaction("rw", [testDb.categories, testDb.products], async () => {
        await testDb.categories.put(entity("category", "category-3") as never);
        await testDb.products.put(entity("product", "product-3") as never);
      }),
    ).rejects.toThrow("SQLite rejected products");

    expect(sqlite.events).toEqual(["begin", "rollback"]);
    expect(sqlite.rows.size).toBe(0);
    expect(await testDb.categories.get("category-3")).toBeUndefined();
    expect(await testDb.products.get("product-3")).toBeUndefined();
  });
});
