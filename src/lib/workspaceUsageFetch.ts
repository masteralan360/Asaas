import { getActiveBusinessUserId, getActiveBusinessWorkspaceId } from '@/lib/network'
import { isOfflineLeaseRequired, markSupabaseReachableFromResponse } from '@/lib/offlineLease'
import { getWorkspaceDataMode, isLocalWorkspaceMode } from '@/workspace/workspaceMode'

const WORKSPACE_TRANSFER_LIMIT_MESSAGE = 'Workspace monthly data transfer limit exceeded'
const WORKSPACE_USAGE_UPDATED_EVENT = 'workspace-usage-updated'
const SKIP_USAGE_HEADER = 'X-Workspace-Usage-Skip'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WORKSPACE_FILTER_KEYS = [
    'workspace_id',
    'current_workspace',
    'branch_workspace_id',
    'source_workspace_id',
    'destination_workspace_id',
    'target_workspace_id'
]

type WorkspaceUsageFetchOptions = {
    supabaseUrl: string
    supabaseAnonKey: string
    fetchImpl?: typeof fetch
}

type UsageRecordResult = {
    ok: boolean
    limitExceeded?: boolean
    message?: string
}

function isUuid(value?: string | null): value is string {
    return UUID_PATTERN.test(value ?? '')
}

function notifyWorkspaceUsageUpdated(workspaceId: string) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(WORKSPACE_USAGE_UPDATED_EVENT, {
        detail: { workspaceId }
    }))
}

function getRequestUrl(input: RequestInfo | URL): URL | null {
    try {
        if (input instanceof Request) {
            return new URL(input.url)
        }

        return new URL(String(input))
    } catch {
        return null
    }
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit) {
    return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function getRequestHeaders(input: RequestInfo | URL, init?: RequestInit) {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    if (init?.headers) {
        new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    }
    return headers
}

function getRestTableName(url: URL, supabaseUrl: string): string | null {
    let baseUrl: URL
    try {
        baseUrl = new URL(supabaseUrl)
    } catch {
        return null
    }

    if (url.origin !== baseUrl.origin) {
        return null
    }

    const basePath = baseUrl.pathname.replace(/\/+$/, '')
    const restPrefix = `${basePath}/rest/v1/`.replace(/\/{2,}/g, '/')
    if (!url.pathname.startsWith(restPrefix)) {
        return null
    }

    const tableName = decodeURIComponent(url.pathname.slice(restPrefix.length).split('/')[0] ?? '')
    if (!tableName || tableName === 'rpc') {
        return null
    }

    return tableName
}

function extractUuidFromPostgrestFilter(value: string): string[] {
    const matches = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi)
    return matches?.filter(isUuid) ?? []
}

function extractWorkspaceIdsFromUrl(url: URL, tableName: string) {
    const ids = new Set<string>()

    for (const key of WORKSPACE_FILTER_KEYS) {
        for (const value of url.searchParams.getAll(key)) {
            extractUuidFromPostgrestFilter(value).forEach((workspaceId) => ids.add(workspaceId))
        }
    }

    if (tableName === 'workspaces') {
        for (const value of url.searchParams.getAll('id')) {
            extractUuidFromPostgrestFilter(value).forEach((workspaceId) => ids.add(workspaceId))
        }
    }

    return Array.from(ids)
}

function decodeBase64Url(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')

    if (typeof atob === 'function') {
        return atob(padded)
    }

    return Buffer.from(padded, 'base64').toString('utf8')
}

function readPath(source: unknown, path: string[]): unknown {
    let current = source
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined
        current = (current as Record<string, unknown>)[segment]
    }
    return current
}

function getWorkspaceIdFromJwt(authHeader: string | null) {
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
    const payloadSegment = token.split('.')[1]
    if (!payloadSegment) return null

    try {
        const payload = JSON.parse(decodeBase64Url(payloadSegment))
        const candidates = [
            readPath(payload, ['current_workspace']),
            readPath(payload, ['workspace_id']),
            readPath(payload, ['user_metadata', 'current_workspace']),
            readPath(payload, ['user_metadata', 'workspace_id']),
            readPath(payload, ['app_metadata', 'current_workspace']),
            readPath(payload, ['app_metadata', 'workspace_id'])
        ]

        const workspaceId = candidates.find((value): value is string => typeof value === 'string' && isUuid(value))
        return workspaceId ?? null
    } catch {
        return null
    }
}

function getUserIdFromJwt(authHeader: string | null) {
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
    const payloadSegment = token.split('.')[1]
    if (!payloadSegment) return null

    try {
        const payload = JSON.parse(decodeBase64Url(payloadSegment))
        const userId = readPath(payload, ['sub'])
        return typeof userId === 'string' && isUuid(userId) ? userId : null
    } catch {
        return null
    }
}

function resolveWorkspaceId(url: URL, tableName: string, authHeader: string | null) {
    const activeWorkspaceId = getActiveBusinessWorkspaceId()
    const authenticatedWorkspaceId = isUuid(activeWorkspaceId)
        ? activeWorkspaceId
        : getWorkspaceIdFromJwt(authHeader)
    const urlWorkspaceIds = extractWorkspaceIdsFromUrl(url, tableName)

    if (authenticatedWorkspaceId) {
        return authenticatedWorkspaceId
    }

    return urlWorkspaceIds.length === 1 ? urlWorkspaceIds[0] : null
}

function isSupabaseUrl(url: URL, supabaseUrl: string) {
    try {
        const baseUrl = new URL(supabaseUrl)
        const basePath = baseUrl.pathname.replace(/\/+$/, '')
        return url.origin === baseUrl.origin && url.pathname.startsWith(basePath || '/')
    } catch {
        return false
    }
}

function refreshOfflineLeaseFromFetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    response: Response,
    supabaseUrl: string
) {
    if (!response.ok) return

    const url = getRequestUrl(input)
    if (!url || !isSupabaseUrl(url, supabaseUrl)) return

    const headers = getRequestHeaders(input, init)
    const authHeader = headers.get('Authorization')
    const activeUserId = getActiveBusinessUserId()
    const activeWorkspaceId = getActiveBusinessWorkspaceId()
    const userId = isUuid(activeUserId) ? activeUserId : getUserIdFromJwt(authHeader)
    const workspaceId = isUuid(activeWorkspaceId) ? activeWorkspaceId : getWorkspaceIdFromJwt(authHeader)
    if (!userId || !workspaceId) return

    const dataMode = getWorkspaceDataMode(workspaceId)
    if (!isOfflineLeaseRequired(dataMode)) return

    markSupabaseReachableFromResponse({
        response,
        userId,
        workspaceId,
        dataMode,
        source: `supabase-fetch:${getRequestMethod(input, init)}`
    })
}

function shouldCountTableFetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    response: Response,
    supabaseUrl: string
) {
    const method = getRequestMethod(input, init)
    if (method !== 'GET') return null
    if (!response.ok) return null

    const url = getRequestUrl(input)
    if (!url) return null

    const headers = getRequestHeaders(input, init)
    if (headers.get(SKIP_USAGE_HEADER) === '1') return null

    const tableName = getRestTableName(url, supabaseUrl)
    if (!tableName) return null

    const authHeader = headers.get('Authorization')
    const workspaceId = resolveWorkspaceId(url, tableName, authHeader)
    if (!workspaceId || isLocalWorkspaceMode(workspaceId)) return null

    return { url, tableName, workspaceId, authHeader }
}

async function getResponseTransferBytes(response: Response): Promise<number> {
    const contentLength = response.headers.get('Content-Length')
    const parsedLength = contentLength ? Number(contentLength) : NaN
    if (Number.isFinite(parsedLength) && parsedLength > 0) {
        return Math.trunc(parsedLength)
    }

    const body = await response.clone().arrayBuffer()
    return body.byteLength
}

async function recordTableDataTransfer(
    options: Required<WorkspaceUsageFetchOptions>,
    workspaceId: string,
    bytes: number,
    authHeader: string | null,
    source: string
): Promise<UsageRecordResult> {
    if (!isUuid(workspaceId) || bytes <= 0 || !authHeader) {
        return { ok: true }
    }

    const response = await options.fetchImpl(`${options.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/record_workspace_data_transfer`, {
        method: 'POST',
        headers: {
            apikey: options.supabaseAnonKey,
            Authorization: authHeader,
            'Content-Type': 'application/json',
            [SKIP_USAGE_HEADER]: '1'
        },
        body: JSON.stringify({
            p_workspace_id: workspaceId,
            p_bytes: bytes,
            p_source: source
        })
    })

    if (response.ok) {
        notifyWorkspaceUsageUpdated(workspaceId)
        return { ok: true }
    }

    const message = await response.text().catch(() => '')
    return {
        ok: false,
        limitExceeded: message.includes(WORKSPACE_TRANSFER_LIMIT_MESSAGE),
        message
    }
}

function usageErrorResponse(result: UsageRecordResult) {
    const limitExceeded = Boolean(result.limitExceeded)
    return new Response(
        JSON.stringify({
            error: limitExceeded
                ? WORKSPACE_TRANSFER_LIMIT_MESSAGE
                : 'Workspace usage could not be recorded'
        }),
        {
            status: limitExceeded ? 429 : 502,
            headers: {
                'Content-Type': 'application/json'
            }
        }
    )
}

export function createWorkspaceUsageFetch(options: WorkspaceUsageFetchOptions): typeof fetch {
    const normalizedOptions: Required<WorkspaceUsageFetchOptions> = {
        ...options,
        fetchImpl: options.fetchImpl ?? fetch.bind(globalThis)
    }

    return async (input, init) => {
        const response = await normalizedOptions.fetchImpl(input, init)
        refreshOfflineLeaseFromFetch(input, init, response, normalizedOptions.supabaseUrl)

        const countContext = shouldCountTableFetch(input, init, response, normalizedOptions.supabaseUrl)
        if (!countContext) {
            return response
        }

        const bytes = await getResponseTransferBytes(response)
        const result = await recordTableDataTransfer(
            normalizedOptions,
            countContext.workspaceId,
            bytes,
            countContext.authHeader,
            `table_fetch:${countContext.tableName}`
        )

        return result.ok || !result.limitExceeded ? response : usageErrorResponse(result)
    }
}

export const workspaceUsageFetchInternals = {
    extractWorkspaceIdsFromUrl,
    getWorkspaceIdFromJwt,
    getRestTableName,
    resolveWorkspaceId
}
