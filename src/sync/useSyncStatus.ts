import { useState, useEffect, useCallback, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/local-db/database'
import { useOnlineStatus } from './useOnlineStatus'
import { useAuth } from '@/auth/AuthContext'
import { fullSync, type SyncState } from './syncEngine'
import { isSupabaseConfigured } from '@/auth/supabase'

const SYNC_INTERVAL = 30000 // 30 seconds
const LAST_SYNC_KEY = 'erp_last_sync_time'

export interface UseSyncStatusResult {
    syncState: SyncState
    pendingCount: number
    lastSyncTime: string | null
    lastSyncResult: { pushed: number; pulled: number } | null
    isOnline: boolean
    sync: () => Promise<void>
    isSyncing: boolean
}

export function useSyncStatus(): UseSyncStatusResult {
    const [syncState, setSyncState] = useState<SyncState>('idle')
    const [lastSyncTime, setLastSyncTime] = useState<string | null>(
        localStorage.getItem(LAST_SYNC_KEY)
    )
    const [lastSyncResult, setLastSyncResult] = useState<{
        pushed: number
        pulled: number
    } | null>(null)

    const { isOnline } = useOnlineStatus()
    const { user, isAuthenticated } = useAuth()
    const syncInProgress = useRef(false)

    // Get pending sync count
    const pendingCount = useLiveQuery(() => db.syncQueue.count(), []) ?? 0

    // Perform sync
    const sync = useCallback(async () => {
        if (!isSupabaseConfigured || !isAuthenticated || !user || syncInProgress.current) {
            return
        }

        if (!isOnline) {
            setSyncState('offline')
            return
        }

        syncInProgress.current = true
        setSyncState('syncing')

        try {
            console.log('[SyncHook] Starting sync execution...')
            const result = await fullSync(user.id, user.workspaceId, lastSyncTime)
            console.log('[SyncHook] Sync finished with result:', result)

            const now = new Date().toISOString()
            setLastSyncTime(now)
            localStorage.setItem(LAST_SYNC_KEY, now)

            setLastSyncResult({
                pushed: result.pushed,
                pulled: result.pulled
            })

            setSyncState(result.success ? 'idle' : 'error')
        } catch (error) {
            console.error('[SyncHook] UNEXPECTED SYNC ERROR:', error)
            setSyncState('error')
        } finally {
            console.log('[SyncHook] Releasing syncInProgress lock')
            syncInProgress.current = false
        }
    }, [isOnline, isAuthenticated, user, lastSyncTime])

    // Auto sync on interval
    useEffect(() => {
        if (!isSupabaseConfigured || !isAuthenticated || !isOnline) return

        const interval = setInterval(sync, SYNC_INTERVAL)
        return () => clearInterval(interval)
    }, [sync, isAuthenticated, isOnline])

    // Sync when coming back online
    useEffect(() => {
        if (isOnline && isAuthenticated && pendingCount > 0) {
            sync()
        }
    }, [isOnline, isAuthenticated, pendingCount, sync])

    // Initial sync
    useEffect(() => {
        if (isAuthenticated && isOnline) {
            sync()
        }
    }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

    return {
        syncState,
        pendingCount,
        lastSyncTime,
        lastSyncResult,
        isOnline,
        sync,
        isSyncing: syncState === 'syncing'
    }
}
