import type { SyncResult } from './syncEngine'
import { fullSync } from './syncEngine'

interface ActiveSync {
    key: string
    isFullPull: boolean
    promise: Promise<SyncResult>
}

let activeSync: ActiveSync | null = null
let queuedFullSync: { key: string; promise: Promise<SyncResult> } | null = null

function startManagedSync(
    userId: string,
    workspaceId: string,
    lastSyncTime: string | null
): Promise<SyncResult> {
    const key = `${userId}:${workspaceId}`
    const promise = fullSync(userId, workspaceId, lastSyncTime).finally(() => {
        if (activeSync?.promise === promise) activeSync = null
    })
    activeSync = { key, isFullPull: lastSyncTime === null, promise }
    return promise
}

export function runManagedFullSync(
    userId: string,
    workspaceId: string,
    lastSyncTime: string | null
): Promise<SyncResult> {
    const key = `${userId}:${workspaceId}`
    const requiresFullPull = lastSyncTime === null

    if (!activeSync) {
        return startManagedSync(userId, workspaceId, lastSyncTime)
    }

    if (activeSync.key === key && (!requiresFullPull || activeSync.isFullPull)) {
        return activeSync.promise
    }

    // Offline preparation must never mistake an in-flight incremental sync for
    // a complete workspace download. Queue one full pull immediately behind it.
    if (requiresFullPull) {
        if (queuedFullSync?.key === key) return queuedFullSync.promise

        const waitForActive = activeSync.promise.catch(() => undefined)
        const promise = waitForActive
            .then(() => startManagedSync(userId, workspaceId, null))
            .finally(() => {
                if (queuedFullSync?.promise === promise) queuedFullSync = null
            })
        queuedFullSync = { key, promise }
        return promise
    }

    // Preserve the existing single-flight behavior for ordinary automatic
    // syncs. A later full pull will queue if it needs stronger guarantees.
    return activeSync.promise
}
