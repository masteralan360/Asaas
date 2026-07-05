import type { WorkspaceDataMode } from '@/local-db/models'

export const OFFLINE_LEASE_CHANGED_EVENT = 'atlas-offline-lease-changed'

const OFFLINE_LEASE_VERSION = 1
const OFFLINE_LEASE_PREFIX = 'atlas_offline_lease:v1:'
const DEVICE_ID_KEY = 'atlas_device_id'
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000
const CLOCK_ROLLBACK_GRACE_MS = 5 * 60 * 1000

type OfflineLeaseMode = Extract<WorkspaceDataMode, 'cloud' | 'hybrid'>

export type OfflineLeaseBlockReason = 'missing' | 'expired' | 'clock-rollback'

export interface OfflineLease {
    version: typeof OFFLINE_LEASE_VERSION
    userId: string
    workspaceId: string
    deviceId: string
    dataMode: OfflineLeaseMode
    confirmedAtMs: number
    expiresAtMs: number
    lastSeenLocalAtMs: number
    source: string
}

export interface OfflineLeaseStatus {
    required: boolean
    blocked: boolean
    reason?: OfflineLeaseBlockReason
    lease?: OfflineLease
    remainingMs?: number
}

interface MarkSupabaseReachableOptions {
    userId?: string | null
    workspaceId?: string | null
    dataMode?: WorkspaceDataMode | null
    serverNowMs?: number | null
    source: string
}

interface MarkSupabaseReachableFromAccessTokenOptions extends MarkSupabaseReachableOptions {
    accessToken?: string | null
}

interface MarkSupabaseReachableFromResponseOptions extends MarkSupabaseReachableOptions {
    response: Response
}

const memoryStorage = new Map<string, string>()

function canUseLocalStorage() {
    return typeof globalThis.localStorage !== 'undefined'
}

function readStorage(key: string) {
    try {
        return canUseLocalStorage()
            ? globalThis.localStorage.getItem(key)
            : memoryStorage.get(key) ?? null
    } catch {
        return memoryStorage.get(key) ?? null
    }
}

function writeStorage(key: string, value: string) {
    memoryStorage.set(key, value)

    try {
        if (canUseLocalStorage()) {
            globalThis.localStorage.setItem(key, value)
        }
    } catch {
        // Keep the in-memory copy as a best-effort fallback.
    }
}

function removeStorage(key: string) {
    memoryStorage.delete(key)

    try {
        if (canUseLocalStorage()) {
            globalThis.localStorage.removeItem(key)
        }
    } catch {
        // Nothing else to clear.
    }
}

function emitOfflineLeaseChanged(lease: OfflineLease) {
    if (typeof window === 'undefined') return

    window.dispatchEvent(new CustomEvent(OFFLINE_LEASE_CHANGED_EVENT, {
        detail: {
            userId: lease.userId,
            workspaceId: lease.workspaceId,
            deviceId: lease.deviceId
        }
    }))
}

function createDeviceId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID()
    }

    return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function getOfflineLeaseDeviceId() {
    const existing = readStorage(DEVICE_ID_KEY)
    if (existing) return existing

    const deviceId = createDeviceId()
    writeStorage(DEVICE_ID_KEY, deviceId)
    return deviceId
}

export function isOfflineLeaseRequired(dataMode?: WorkspaceDataMode | null): dataMode is OfflineLeaseMode {
    return dataMode === 'cloud' || dataMode === 'hybrid'
}

function getOfflineLeaseKey(userId: string, workspaceId: string, deviceId = getOfflineLeaseDeviceId()) {
    return `${OFFLINE_LEASE_PREFIX}${deviceId}:${workspaceId}:${userId}`
}

function isFiniteTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function normalizeServerNowMs(value?: number | null) {
    return isFiniteTimestamp(value) ? Math.trunc(value) : Date.now()
}

function parseOfflineLease(raw: string | null, userId: string, workspaceId: string): OfflineLease | null {
    if (!raw) return null

    try {
        const parsed = JSON.parse(raw) as Partial<OfflineLease>
        if (
            parsed.version !== OFFLINE_LEASE_VERSION
            || parsed.userId !== userId
            || parsed.workspaceId !== workspaceId
            || !parsed.deviceId
            || !isOfflineLeaseRequired(parsed.dataMode)
            || !isFiniteTimestamp(parsed.confirmedAtMs)
            || !isFiniteTimestamp(parsed.expiresAtMs)
            || !isFiniteTimestamp(parsed.lastSeenLocalAtMs)
        ) {
            return null
        }

        return {
            version: OFFLINE_LEASE_VERSION,
            userId: parsed.userId,
            workspaceId: parsed.workspaceId,
            deviceId: parsed.deviceId,
            dataMode: parsed.dataMode,
            confirmedAtMs: Math.trunc(parsed.confirmedAtMs),
            expiresAtMs: Math.trunc(parsed.expiresAtMs),
            lastSeenLocalAtMs: Math.trunc(parsed.lastSeenLocalAtMs),
            source: parsed.source || 'unknown'
        }
    } catch {
        return null
    }
}

export function readOfflineLease(userId?: string | null, workspaceId?: string | null): OfflineLease | null {
    if (!userId || !workspaceId) return null

    const key = getOfflineLeaseKey(userId, workspaceId)
    const lease = parseOfflineLease(readStorage(key), userId, workspaceId)
    if (!lease) {
        removeStorage(key)
    }

    return lease
}

export function markSupabaseReachable(options: MarkSupabaseReachableOptions): OfflineLease | null {
    const { userId, workspaceId, dataMode, source } = options
    if (!userId || !workspaceId || !isOfflineLeaseRequired(dataMode)) {
        return null
    }

    const existing = readOfflineLease(userId, workspaceId)
    const confirmedAtMs = Math.max(
        existing?.confirmedAtMs ?? 0,
        normalizeServerNowMs(options.serverNowMs)
    )
    const nowMs = Date.now()
    const lease: OfflineLease = {
        version: OFFLINE_LEASE_VERSION,
        userId,
        workspaceId,
        deviceId: getOfflineLeaseDeviceId(),
        dataMode,
        confirmedAtMs,
        expiresAtMs: confirmedAtMs + TEN_DAYS_MS,
        lastSeenLocalAtMs: Math.max(existing?.lastSeenLocalAtMs ?? 0, nowMs),
        source
    }

    writeStorage(getOfflineLeaseKey(userId, workspaceId, lease.deviceId), JSON.stringify(lease))
    emitOfflineLeaseChanged(lease)
    return lease
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
    try {
        const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
        return JSON.parse(globalThis.atob(padded)) as Record<string, unknown>
    } catch {
        return null
    }
}

export function getJwtIssuedAtMs(accessToken?: string | null) {
    const payloadSegment = accessToken?.split('.')[1]
    if (!payloadSegment) return null

    const payload = decodeBase64UrlJson(payloadSegment)
    const issuedAt = payload?.iat
    return typeof issuedAt === 'number' && Number.isFinite(issuedAt)
        ? Math.trunc(issuedAt * 1000)
        : null
}

function getResponseServerTimeMs(response: Response) {
    const header = response.headers.get('Date')
    if (!header) return null

    const parsed = Date.parse(header)
    return Number.isFinite(parsed) ? parsed : null
}

export function markSupabaseReachableFromAccessToken(options: MarkSupabaseReachableFromAccessTokenOptions) {
    return markSupabaseReachable({
        ...options,
        serverNowMs: options.serverNowMs ?? getJwtIssuedAtMs(options.accessToken)
    })
}

export function markSupabaseReachableFromResponse(options: MarkSupabaseReachableFromResponseOptions) {
    if (!options.response.ok) return null

    return markSupabaseReachable({
        ...options,
        serverNowMs: options.serverNowMs ?? getResponseServerTimeMs(options.response)
    })
}

export function getOfflineLeaseStatus(
    userId?: string | null,
    workspaceId?: string | null,
    dataMode?: WorkspaceDataMode | null
): OfflineLeaseStatus {
    if (!isOfflineLeaseRequired(dataMode)) {
        return { required: false, blocked: false }
    }

    const lease = readOfflineLease(userId, workspaceId)
    if (!lease) {
        return { required: true, blocked: true, reason: 'missing' }
    }

    const nowMs = Date.now()
    if (nowMs + CLOCK_ROLLBACK_GRACE_MS < lease.lastSeenLocalAtMs) {
        return { required: true, blocked: true, reason: 'clock-rollback', lease }
    }

    if (nowMs > lease.expiresAtMs) {
        observeOfflineLeaseCheck(lease)
        return { required: true, blocked: true, reason: 'expired', lease, remainingMs: 0 }
    }

    observeOfflineLeaseCheck(lease)
    return {
        required: true,
        blocked: false,
        lease,
        remainingMs: Math.max(0, lease.expiresAtMs - nowMs)
    }
}

export function observeOfflineLeaseCheck(lease: OfflineLease) {
    const nowMs = Date.now()
    if (nowMs <= lease.lastSeenLocalAtMs) return lease

    const nextLease = {
        ...lease,
        lastSeenLocalAtMs: nowMs
    }
    writeStorage(getOfflineLeaseKey(lease.userId, lease.workspaceId, lease.deviceId), JSON.stringify(nextLease))
    return nextLease
}

export function clearOfflineLease(userId?: string | null, workspaceId?: string | null) {
    if (!userId || !workspaceId) return
    removeStorage(getOfflineLeaseKey(userId, workspaceId))
}

export const offlineLeaseInternals = {
    TEN_DAYS_MS,
    memoryStorage,
    getOfflineLeaseKey
}
