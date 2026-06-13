import { db } from '@/local-db/database'
import { clearCachedPermissionsForWorkspace } from '@/permissions/workspacePermissionCache'
import { clearWorkspaceCache } from '@/workspace/workspaceCache'
import { clearWorkspaceModeSnapshot } from '@/workspace/workspaceMode'
import { isTauri } from '@/lib/platform'

const DEMO_SESSION_STORAGE_KEYS = [
  'pos_held_sales',
  'instant_pos_tickets',
  'instant_pos_ticket_counter',
  'sales_selected_cashier',
  'inventory-transfer.pending-tab',
]
const DEMO_BROWSER_STATE_BACKUP_PREFIX = 'demo_browser_state_backup'

type DemoBrowserStateBackup = Record<
  string,
  { local: string | null; session: string | null }
>

function getDemoBrowserStateBackupKey(workspaceId: string) {
  return `${DEMO_BROWSER_STATE_BACKUP_PREFIX}:${workspaceId}`
}

function isSupabaseAuthStorageKey(key: string) {
  return key.startsWith('sb-') && key.includes('-auth-token')
}

function shouldExcludeFromDemoBrowserState(key: string) {
  return isSupabaseAuthStorageKey(key) || key === 'atlas_session_recovery'
}

function readStorageSnapshot(storage: Storage | undefined) {
  const snapshot = new Map<string, string>()
  if (!storage) return snapshot

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key || shouldExcludeFromDemoBrowserState(key)) continue
    const value = storage.getItem(key)
    if (value !== null) {
      snapshot.set(key, value)
    }
  }

  return snapshot
}

function restoreStorageSnapshot(
  storage: Storage | undefined,
  workspaceId: string,
  backup: DemoBrowserStateBackup | null,
  side: 'local' | 'session',
) {
  if (!storage) return

  const keysToRemove: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    const value = key ? storage.getItem(key) : null
    if (!key || isSupabaseAuthStorageKey(key)) continue

    if (
      backup
      || key === 'atlas_session_recovery'
      || key.includes(workspaceId)
      || value?.includes(workspaceId)
      || DEMO_SESSION_STORAGE_KEYS.includes(key)
    ) {
      keysToRemove.push(key)
    }
  }

  keysToRemove.forEach((key) => storage.removeItem(key))

  if (!backup) return

  for (const [key, values] of Object.entries(backup)) {
    const value = values[side]
    if (value !== null) {
      storage.setItem(key, value)
    }
  }
}

function clearWorkspaceBrowserState(
  workspaceId: string,
  backup: DemoBrowserStateBackup | null,
) {
  clearWorkspaceCache(workspaceId)
  clearWorkspaceModeSnapshot(workspaceId)
  clearCachedPermissionsForWorkspace(workspaceId)

  restoreStorageSnapshot(
    typeof localStorage === 'undefined' ? undefined : localStorage,
    workspaceId,
    backup,
    'local',
  )
  restoreStorageSnapshot(
    typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
    workspaceId,
    backup,
    'session',
  )
}

export async function captureDemoBrowserState(workspaceId: string): Promise<void> {
  if (!workspaceId) return

  const localSnapshot = readStorageSnapshot(
    typeof localStorage === 'undefined' ? undefined : localStorage,
  )
  const sessionSnapshot = readStorageSnapshot(
    typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
  )
  const keys = new Set([...localSnapshot.keys(), ...sessionSnapshot.keys()])
  const backup = Object.fromEntries(
    Array.from(keys, (key) => [
      key,
      {
        local: localSnapshot.get(key) ?? null,
        session: sessionSnapshot.get(key) ?? null,
      },
    ]),
  ) satisfies DemoBrowserStateBackup

  await db.app_settings.put({
    key: getDemoBrowserStateBackupKey(workspaceId),
    value: JSON.stringify(backup),
  })
}

async function clearLegacyDemoFiles(workspaceId: string) {
  if (!isTauri()) return

  const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const workspaceDirectories = [
    `printed-invoices/${workspaceId}`,
    `product-images/${workspaceId}`,
    `profile-images/${workspaceId}`,
    `agents-images/${workspaceId}`,
    `workspace-logos/${workspaceId}`,
    `clinic-attachments/${workspaceId}`,
  ]

  await Promise.allSettled(
    workspaceDirectories.map((path) =>
      remove(path, { baseDir: BaseDirectory.AppData, recursive: true }),
    ),
  )
}

export async function clearLocalDemoWorkspaceData(workspaceId: string): Promise<void> {
  if (!workspaceId) return

  const browserStateSetting = await db.app_settings.get(
    getDemoBrowserStateBackupKey(workspaceId),
  )
  let browserStateBackup: DemoBrowserStateBackup | null = null
  if (browserStateSetting?.value) {
    try {
      browserStateBackup = JSON.parse(browserStateSetting.value) as DemoBrowserStateBackup
    } catch {
      browserStateBackup = null
    }
  }

  const saleIds = await db.sales.where('workspaceId').equals(workspaceId).primaryKeys()
  const entityIds = new Set<string>([workspaceId, ...saleIds.map(String)])

  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      if (table.name === 'workspaces') {
        await table.delete(workspaceId)
        continue
      }

      if (table.name === 'sale_items') {
        if (saleIds.length > 0) {
          const saleItems = await table.where('saleId').anyOf(saleIds).toArray()
          saleItems.forEach((row) => entityIds.add(String(row.id)))
          await table.where('saleId').anyOf(saleIds).delete()
        }
        continue
      }

      if (table.name === 'syncQueue') {
        continue
      }

      if (table.name === 'app_settings') {
        await table
          .filter((row) => typeof row.key === 'string' && row.key.includes(workspaceId))
          .delete()
        continue
      }

      const hasWorkspaceIndex = table.schema.indexes.some((index) => index.name === 'workspaceId')
      if (!hasWorkspaceIndex) {
        continue
      }

      const rows = await table.where('workspaceId').equals(workspaceId).toArray()
      rows.forEach((row) => {
        if (row && typeof row.id === 'string') {
          entityIds.add(row.id)
        }
      })
      await table.where('workspaceId').equals(workspaceId).delete()
    }

    await db.syncQueue
      .filter((item) => entityIds.has(item.entityId))
      .delete()
  })

  await clearLegacyDemoFiles(workspaceId)
  clearWorkspaceBrowserState(workspaceId, browserStateBackup)
}

export async function clearStoredDemoWorkspaces(): Promise<void> {
  const demoWorkspaces = await db.workspaces
    .filter((workspace) => workspace.data_mode === 'demo' || workspace.code?.startsWith('demo.'))
    .primaryKeys()

  for (const workspaceId of demoWorkspaces.map(String)) {
    await clearLocalDemoWorkspaceData(workspaceId)
  }
}
