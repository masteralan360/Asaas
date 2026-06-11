import { isTauri } from '@/lib/platform'
import { shouldMirrorToSqlite, isLocalWorkspaceMode } from '@/workspace/workspaceMode'
import { r2Service } from '@/services/r2Service'

const DB_FILENAME = 'atlas-local-mode.db'
const BACKUP_DIR = 'db-backup'
const MAX_BACKUP_DAYS = 7
const BACKUP_DONE_KEY = 'atlas_db_backup_date'
const R2_BACKUP_INTERVAL_MS = 5 * 60 * 60 * 1000
const R2_BACKUP_TIME_KEY = 'atlas_db_r2_backup_time'

function getTodayDateString() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function isBackupAlreadyDoneToday() {
    try {
        return localStorage.getItem(BACKUP_DONE_KEY) === getTodayDateString()
    } catch {
        return false
    }
}

function markBackupDone() {
    try {
        localStorage.setItem(BACKUP_DONE_KEY, getTodayDateString())
    } catch {
        // noop
    }
}

async function pruneOldBackups() {
    const { readDir, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')

    let entries: Array<{ name?: string | null; isFile?: boolean }>
    try {
        entries = await readDir(BACKUP_DIR, { baseDir: BaseDirectory.AppData })
    } catch {
        return
    }

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - MAX_BACKUP_DAYS)

    for (const entry of entries) {
        if (!entry.name || !entry.isFile) continue

        // Expected format: atlas-local-mode-YYYY-MM-DD.db
        const match = entry.name.match(/atlas-local-mode-(\d{4}-\d{2}-\d{2})\.db$/)
        if (!match) continue

        const backupDate = new Date(match[1])
        if (isNaN(backupDate.getTime())) continue

        if (backupDate < cutoff) {
            try {
                await remove(`${BACKUP_DIR}/${entry.name}`, { baseDir: BaseDirectory.AppData })
                console.log(`[DBBackup] Pruned old backup: ${entry.name}`)
            } catch (err) {
                console.warn(`[DBBackup] Failed to prune ${entry.name}:`, err)
            }
        }
    }
}

export async function runDailyBackupIfNeeded(workspaceId?: string | null) {
    if (!isTauri()) return
    if (!workspaceId || !shouldMirrorToSqlite(workspaceId)) return
    if (isBackupAlreadyDoneToday()) return

    try {
        const { exists, mkdir, copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')

        // Check if the source .db file exists
        const dbExists = await exists(DB_FILENAME, { baseDir: BaseDirectory.AppData })
        if (!dbExists) {
            console.log('[DBBackup] No SQLite database file found, skipping backup')
            return
        }

        // Ensure backup directory exists
        try {
            await mkdir(BACKUP_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
        } catch {
            // directory may already exist
        }

        const today = getTodayDateString()
        const backupFilename = `${BACKUP_DIR}/atlas-local-mode-${today}.db`

        // Check if today's backup already exists on disk
        const backupExists = await exists(backupFilename, { baseDir: BaseDirectory.AppData })
        if (backupExists) {
            markBackupDone()
            return
        }

        // Copy the database file
        await copyFile(DB_FILENAME, backupFilename, {
            fromPathBaseDir: BaseDirectory.AppData,
            toPathBaseDir: BaseDirectory.AppData
        })

        console.log(`[DBBackup] Daily backup created: ${backupFilename}`)
        markBackupDone()

        // Prune old backups in the background
        void pruneOldBackups()
    } catch (err) {
        console.error('[DBBackup] Failed to create daily backup:', err)
    }
}

function isR2BackupDue(): boolean {
    try {
        const lastTime = localStorage.getItem(R2_BACKUP_TIME_KEY)
        if (!lastTime) return true
        return Date.now() - Number(lastTime) >= R2_BACKUP_INTERVAL_MS
    } catch {
        return true
    }
}

function markR2BackupDone(): void {
    try {
        localStorage.setItem(R2_BACKUP_TIME_KEY, String(Date.now()))
    } catch {
        // noop
    }
}

export async function runR2BackupIfNeeded(workspaceId: string | undefined | null): Promise<void> {
    if (!isTauri()) return
    if (!workspaceId || !isLocalWorkspaceMode(workspaceId)) return
    if (!isR2BackupDue()) return

    try {
        const { exists, readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')

        const dbExists = await exists(DB_FILENAME, { baseDir: BaseDirectory.AppData })
        if (!dbExists) {
            console.log('[R2Backup] No SQLite database file found, skipping backup')
            return
        }

        const fileData = await readFile(DB_FILENAME, { baseDir: BaseDirectory.AppData })
        const blob = new Blob([fileData], { type: 'application/octet-stream' })

        const r2Path = `local-backup/${workspaceId}/${DB_FILENAME}`
        await r2Service.upload(r2Path, blob, 'application/octet-stream', true)

        console.log('[R2Backup] Database uploaded to R2:', r2Path)
        markR2BackupDone()
    } catch (err) {
        console.warn('[R2Backup] Failed to upload database backup to R2:', err)
    }
}

let r2BackupInterval: ReturnType<typeof setInterval> | null = null

export function startR2BackupInterval(workspaceId: string | undefined | null): void {
    if (r2BackupInterval) {
        clearInterval(r2BackupInterval)
        r2BackupInterval = null
    }

    void runR2BackupIfNeeded(workspaceId)

    r2BackupInterval = setInterval(() => {
        void runR2BackupIfNeeded(workspaceId)
    }, R2_BACKUP_INTERVAL_MS)
}

export function stopR2BackupInterval(): void {
    if (r2BackupInterval) {
        clearInterval(r2BackupInterval)
        r2BackupInterval = null
    }
}
