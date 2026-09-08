import { useSyncExternalStore } from 'react'

export type SyncProgressPhase = 'idle' | 'pushing' | 'pulling'

export interface SyncProgressDetail {
    table: string
    completed: number
    total: number
}

export interface SyncProgress {
    isSyncing: boolean
    phase: SyncProgressPhase
    completed: number
    total: number
    detail?: SyncProgressDetail
}

const idleProgress: SyncProgress = {
    isSyncing: false,
    phase: 'idle',
    completed: 0,
    total: 0
}

let currentProgress = idleProgress
const listeners = new Set<() => void>()

function publish(progress: SyncProgress) {
    currentProgress = progress

    if (import.meta.env.DEV) {
        if (!progress.isSyncing) {
            console.debug('[SyncProgress] Finished')
        } else if (progress.total > 0) {
            const phase = progress.phase === 'pushing' ? 'Uploading changes' : 'Checking updates'
            const detail = progress.detail
                ? ` (${progress.detail.table}: ${progress.detail.completed}/${progress.detail.total})`
                : ''
            console.debug(`[SyncProgress] ${phase}: ${progress.completed}/${progress.total}${detail}`)
        } else {
            console.debug('[SyncProgress] Started')
        }
    }

    listeners.forEach((listener) => listener())
}

export function startSyncProgress() {
    publish({
        isSyncing: true,
        phase: 'pushing',
        completed: 0,
        total: 0
    })
}

export function updateSyncProgress(
    phase: Exclude<SyncProgressPhase, 'idle'>,
    completed: number,
    total: number,
    detail?: SyncProgressDetail
) {
    publish({
        isSyncing: true,
        phase,
        completed: Math.max(0, completed),
        total: Math.max(0, total),
        detail
    })
}

export function finishSyncProgress() {
    publish(idleProgress)
}

export function getSyncProgress() {
    return currentProgress
}

export function subscribeToSyncProgress(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function useSyncProgress() {
    return useSyncExternalStore(subscribeToSyncProgress, getSyncProgress, getSyncProgress)
}
