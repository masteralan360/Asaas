import { useEffect, useState } from 'react'

import type { AuthUser } from '@/auth/AuthContext'
import { connectionManager } from '@/lib/connectionManager'
import {
    getOfflineLeaseStatus,
    OFFLINE_LEASE_CHANGED_EVENT,
    type OfflineLeaseStatus
} from '@/lib/offlineLease'

function readStatus(
    userId?: string | null,
    workspaceId?: string | null,
    workspaceMode?: AuthUser['workspaceMode'] | null
): OfflineLeaseStatus {
    return getOfflineLeaseStatus(userId, workspaceId, workspaceMode)
}

export function useOfflineLeaseStatus(user?: AuthUser | null) {
    const userId = user?.id
    const workspaceId = user?.workspaceId
    const workspaceMode = user?.workspaceMode
    const [status, setStatus] = useState(() => readStatus(userId, workspaceId, workspaceMode))

    useEffect(() => {
        const refresh = () => setStatus(readStatus(userId, workspaceId, workspaceMode))
        refresh()

        const intervalId = window.setInterval(refresh, 60_000)
        window.addEventListener(OFFLINE_LEASE_CHANGED_EVENT, refresh)
        const unsubscribeConnection = connectionManager.subscribe((event) => {
            if (event === 'online' || event === 'wake' || event === 'heartbeat' || event === 'offline') {
                refresh()
            }
        })

        return () => {
            window.clearInterval(intervalId)
            window.removeEventListener(OFFLINE_LEASE_CHANGED_EVENT, refresh)
            unsubscribeConnection()
        }
    }, [userId, workspaceId, workspaceMode])

    return status
}
