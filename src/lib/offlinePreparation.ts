import type { AuthUser } from '@/auth/AuthContext'
import { refreshSupabaseSession } from '@/auth/supabase'
import { db } from '@/local-db/database'
import type { WorkspaceDataMode } from '@/local-db/models'
import { ensurePwaDatabase, isOpfsSupported } from '@/local-db/pwaSqlite'
import {
    getPersistentStorageStatus,
    getStorageEstimate,
    requestPersistentStorage
} from '@/local-db/storagePersist'
import { getAppSetting, setAppSetting } from '@/local-db/settings'
import {
    getOfflineLeaseStatus,
    isOfflineLeaseRequired,
    markSupabaseReachableFromAccessToken
} from '@/lib/offlineLease'
import {
    getPwaOfflineShellStatus,
    preparePwaOfflineShell,
    type PwaOfflinePreparationProgress,
    type PwaOfflineShellStatus
} from '@/lib/pwaUpdateControl'
import { areApplicationUpdatesDisabled } from '@/lib/updatePreference'
import { normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import { LAST_SYNC_KEY } from '@/sync/constants'
import { runManagedFullSync } from '@/sync/syncCoordinator'

const READINESS_RECORD_VERSION = 1

export type OfflinePreparationPhase =
    | 'storage'
    | 'session'
    | 'data'
    | 'database'
    | 'shell'
    | 'complete'

export type OfflinePreparationErrorCode =
    | 'offline'
    | 'session-required'
    | 'data-sync-failed'
    | 'database-unavailable'
    | 'shell-unavailable'
    | 'updates-disabled-incomplete'
    | 'unexpected'

export interface OfflinePreparationRecord {
    version: typeof READINESS_RECORD_VERSION
    userId: string
    workspaceId: string
    dataMode: WorkspaceDataMode
    preparedAt: string
    dataSyncedAt: string
    shellBuildId: string
    cachedAssets: number
    storagePersisted: boolean
    storageUsage: number | null
    storageQuota: number | null
    offlineLeaseExpiresAt: number | null
}

export interface OfflineReadinessSnapshot {
    ready: boolean
    storagePersisted: boolean | null
    shell: PwaOfflineShellStatus
    record: OfflinePreparationRecord | null
    leaseBlocked: boolean
    leaseExpiresAt: number | null
}

export interface OfflinePreparationResult {
    outcome: 'ready' | 'ready-unprotected'
    record: OfflinePreparationRecord
    shellUpdated: boolean
}

export class OfflinePreparationError extends Error {
    public readonly cause?: unknown

    constructor(
        public readonly code: OfflinePreparationErrorCode,
        options?: { cause?: unknown }
    ) {
        super(code)
        this.name = 'OfflinePreparationError'
        this.cause = options?.cause
    }
}

function readinessKey(userId: string, workspaceId: string) {
    return `offline_readiness:v${READINESS_RECORD_VERSION}:${workspaceId}:${userId}`
}

function parseRecord(value?: string): OfflinePreparationRecord | null {
    if (!value) return null
    try {
        const record = JSON.parse(value) as Partial<OfflinePreparationRecord>
        if (
            record.version !== READINESS_RECORD_VERSION
            || !record.userId
            || !record.workspaceId
            || !record.preparedAt
            || !record.dataSyncedAt
            || !record.shellBuildId
            || typeof record.cachedAssets !== 'number'
            || typeof record.storagePersisted !== 'boolean'
        ) {
            return null
        }
        return record as OfflinePreparationRecord
    } catch {
        return null
    }
}

export async function readOfflinePreparationRecord(
    userId: string,
    workspaceId: string
): Promise<OfflinePreparationRecord | null> {
    return parseRecord(await getAppSetting(readinessKey(userId, workspaceId)))
}

export async function getOfflineReadinessSnapshot(
    user: AuthUser,
    dataMode: WorkspaceDataMode
): Promise<OfflineReadinessSnapshot> {
    const [shell, storagePersisted, record] = await Promise.all([
        getPwaOfflineShellStatus(),
        getPersistentStorageStatus(),
        readOfflinePreparationRecord(user.id, user.workspaceId)
    ])
    const leaseStatus = getOfflineLeaseStatus(user.id, user.workspaceId, dataMode)
    const leaseBlocked = leaseStatus.required && leaseStatus.blocked
    const recordMatches = Boolean(
        record
        && record.userId === user.id
        && record.workspaceId === user.workspaceId
        && record.dataMode === dataMode
        && record.shellBuildId === shell.buildId
    )

    return {
        ready: shell.ready && recordMatches && !leaseBlocked,
        storagePersisted,
        shell,
        record,
        leaseBlocked,
        leaseExpiresAt: leaseStatus.lease?.expiresAtMs ?? null
    }
}

function report(
    onPhase: ((phase: OfflinePreparationPhase, progress?: PwaOfflinePreparationProgress) => void) | undefined,
    phase: OfflinePreparationPhase,
    progress?: PwaOfflinePreparationProgress
) {
    onPhase?.(phase, progress)
}

async function verifyLocalDatabase(dataMode: WorkspaceDataMode) {
    await db.open()
    await db.app_settings.count()

    if (dataMode !== 'local') return
    if (!isOpfsSupported()) {
        throw new OfflinePreparationError('database-unavailable')
    }
    const sqlite = await ensurePwaDatabase()
    if (!sqlite) throw new OfflinePreparationError('database-unavailable')
    const quickCheck = sqlite.exec('PRAGMA quick_check')
    if (quickCheck[0]?.values[0]?.[0] !== 'ok') {
        throw new OfflinePreparationError('database-unavailable')
    }
}

async function renewVerifiedOfflineLease(user: AuthUser, dataMode: WorkspaceDataMode) {
    if (!isOfflineLeaseRequired(dataMode)) return null

    const { data, error } = await runSupabaseAction(
        'offlinePreparation.refreshSession',
        () => refreshSupabaseSession(),
        { timeoutMs: 8_000, platform: 'all' }
    )
    if (error || !data?.session?.access_token) {
        if (error) console.warn('[OfflinePreparation] Session refresh failed:', normalizeSupabaseActionError(error))
        throw new OfflinePreparationError('session-required', { cause: error })
    }

    const lease = markSupabaseReachableFromAccessToken({
        userId: user.id,
        workspaceId: user.workspaceId,
        dataMode,
        accessToken: data.session.access_token,
        source: 'offline-preparation'
    })
    if (!lease) throw new OfflinePreparationError('session-required')
    return lease
}

export async function prepareForOfflineUse(options: {
    user: AuthUser
    dataMode: WorkspaceDataMode
    onPhase?: (phase: OfflinePreparationPhase, progress?: PwaOfflinePreparationProgress) => void
}): Promise<OfflinePreparationResult> {
    const { user, dataMode, onPhase } = options
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new OfflinePreparationError('offline')
    }

    try {
        report(onPhase, 'storage')
        const storagePersisted = await requestPersistentStorage()

        report(onPhase, 'session')
        const lease = await renewVerifiedOfflineLease(user, dataMode)

        let dataSyncedAt = new Date().toISOString()
        if (isOfflineLeaseRequired(dataMode)) {
            report(onPhase, 'data')
            const syncResult = await runManagedFullSync(user.id, user.workspaceId, null)
            if (!syncResult.success) {
                console.warn('[OfflinePreparation] Full workspace sync failed:', syncResult.errors)
                throw new OfflinePreparationError('data-sync-failed')
            }
            dataSyncedAt = new Date().toISOString()
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(LAST_SYNC_KEY, dataSyncedAt)
            }
        }

        report(onPhase, 'database')
        await verifyLocalDatabase(dataMode)

        report(onPhase, 'shell')
        const shell = await preparePwaOfflineShell({
            allowUpdate: !areApplicationUpdatesDisabled(),
            onProgress: (progress) => report(onPhase, 'shell', progress)
        })
        if (shell.status === 'updates-disabled-incomplete') {
            throw new OfflinePreparationError('updates-disabled-incomplete')
        }
        if (!shell.ready || !shell.buildId) {
            throw new OfflinePreparationError('shell-unavailable')
        }

        const estimate = await getStorageEstimate()
        const record: OfflinePreparationRecord = {
            version: READINESS_RECORD_VERSION,
            userId: user.id,
            workspaceId: user.workspaceId,
            dataMode,
            preparedAt: new Date().toISOString(),
            dataSyncedAt,
            shellBuildId: shell.buildId,
            cachedAssets: shell.cachedAssets ?? 0,
            storagePersisted,
            storageUsage: estimate?.usage ?? null,
            storageQuota: estimate?.quota ?? null,
            offlineLeaseExpiresAt: lease?.expiresAtMs ?? null
        }
        await setAppSetting(readinessKey(user.id, user.workspaceId), JSON.stringify(record))
        report(onPhase, 'complete')

        return {
            outcome: storagePersisted ? 'ready' : 'ready-unprotected',
            record,
            shellUpdated: shell.status === 'updated'
        }
    } catch (error) {
        if (error instanceof OfflinePreparationError) throw error
        console.error('[OfflinePreparation] Unexpected failure:', error)
        throw new OfflinePreparationError('unexpected', { cause: error })
    }
}

export const offlinePreparationInternals = {
    READINESS_RECORD_VERSION,
    parseRecord,
    readinessKey
}
