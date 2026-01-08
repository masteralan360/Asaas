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
    const lastSyncTimeRef = useRef(lastSyncTime)

    // Update ref when state changes
    useEffect(() => {
        lastSyncTimeRef.current = lastSyncTime
    }, [lastSyncTime])

    // Get pending sync count
    const pendingCount = useLiveQuery(() => db.syncQueue.count(), []) ?? 0
    // Track previous pending count to detect new additions
    const prevPendingCount = useRef(pendingCount)

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
            const result = await fullSync(user.id, user.workspaceId, lastSyncTimeRef.current)
            console.log('[SyncHook] Sync finished with result:', result)

            const now = new Date().toISOString()
            setLastSyncTime(now)
            localStorage.setItem(LAST_SYNC_KEY, now)

            setLastSyncResult({
                pushed: result.pushed,
                pulled: result.pulled
            })

            // If we have failed items, we are effectively still in "error" state regarding those items,
            // but the sync process itself finished. 
            // We set 'idle' if successful, 'error' if any errors occurred.
            setSyncState(result.success ? 'idle' : 'error')
        } catch (error) {
            console.error('[SyncHook] UNEXPECTED SYNC ERROR:', error)
            setSyncState('error')
        } finally {
            console.log('[SyncHook] Releasing syncInProgress lock')
            syncInProgress.current = false
        }
    }, [isOnline, isAuthenticated, user]) // Removed lastSyncTime from deps

    // Auto sync on interval
    useEffect(() => {
        if (!isSupabaseConfigured || !isAuthenticated || !isOnline) return

        const interval = setInterval(sync, SYNC_INTERVAL)
        return () => clearInterval(interval)
    }, [sync, isAuthenticated, isOnline])

    // Sync when coming back online
    useEffect(() => {
        if (isOnline && isAuthenticated) {
            // Only sync if we haven't synced in a while or have pending items? 
            // Ideally just one sync check on connection restore is good.
            console.log('[SyncHook] Online status restored, triggering sync...')
            sync()
        }
    }, [isOnline, isAuthenticated]) // Removed pendingCount and sync from here to prevent loops

    // Trigger sync when new items are added to queue (pendingCount increases)
    useEffect(() => {
        if (pendingCount > prevPendingCount.current && isOnline && isAuthenticated) {
            console.log('[SyncHook] New items added to queue, triggering sync...')
            sync()
        }
        prevPendingCount.current = pendingCount
    }, [pendingCount, isOnline, isAuthenticated])

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
