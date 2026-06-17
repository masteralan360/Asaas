import { getPwaDbInstance, ensurePwaDatabase, DB_FILENAME } from "./pwaSqlite";

const BACKUP_DIR = "db-backup";
const MAX_BACKUP_DAYS = 7;
const BACKUP_DONE_KEY = "atlas_db_backup_date";

function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isBackupAlreadyDoneToday() {
  try {
    return localStorage.getItem(BACKUP_DONE_KEY) === getTodayDateString();
  } catch {
    return false;
  }
}

function markBackupDone() {
  try {
    localStorage.setItem(BACKUP_DONE_KEY, getTodayDateString());
  } catch {
    // noop
  }
}

async function getOrCreateBackupDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(BACKUP_DIR, { create: true });
  } catch {
    return null;
  }
}

async function pruneOldBackups(): Promise<void> {
  try {
    const dir = await getOrCreateBackupDir();
    if (!dir) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_BACKUP_DAYS);

    for await (const [name] of (dir as any).entries()) {
      const match = name.match(/^atlas-local-mode-(\d{4}-\d{2}-\d{2})\.db$/);
      if (!match) continue;

      const backupDate = new Date(match[1]);
      if (isNaN(backupDate.getTime())) continue;

      if (backupDate < cutoff) {
        await dir.removeEntry(name);
      }
    }
  } catch (error) {
    console.warn("[PwaBackup] Failed to prune old backups:", error);
  }
}

export async function runPwaDailyBackupIfNeeded(): Promise<void> {
  if (isBackupAlreadyDoneToday()) return;
  if (!("storage" in navigator && typeof (navigator.storage as any).getDirectory === "function")) return;

  try {
    const db = getPwaDbInstance();
    if (!db) return;

    const dir = await getOrCreateBackupDir();
    if (!dir) return;

    const today = getTodayDateString();
    const backupName = `atlas-local-mode-${today}.db`;

    try {
      await dir.getFileHandle(backupName);
      markBackupDone();
      return;
    } catch {
      // File doesn't exist yet, continue
    }

    const data = db.export();
    const handle = await dir.getFileHandle(backupName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();

    markBackupDone();
    void pruneOldBackups();
  } catch (error) {
    console.error("[PwaBackup] Daily backup failed:", error);
  }
}

export async function downloadPwaBackup(): Promise<void> {
  let db = getPwaDbInstance();
  if (!db) {
    const loaded = await ensurePwaDatabase();
    if (!loaded) return;
    db = getPwaDbInstance();
  }
  if (!db) return;

  const today = getTodayDateString();
  const backupName = `atlas-local-mode-${today}.db`;
  const data = db.export();
  const blob = new Blob([data], { type: "application/x-sqlite3" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportPwaStoreFile(): Promise<void> {
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
  a.download = DB_FILENAME;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function restorePwaBackup(file: File): Promise<boolean> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const { default: initSqlJs } = await import("sql.js");
    const SQL = await initSqlJs({
      locateFile: (f: string) => `/sql-wasm.wasm`,
    });

    const testDb = new SQL.Database(data);
    testDb.exec("SELECT COUNT(*) FROM local_entities");
    testDb.close();

    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(DB_FILENAME, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();

    return true;
  } catch (error) {
    console.error("[PwaBackup] Restore failed:", error);
    return false;
  }
}
