import { supabase } from '@/auth/supabase'
import { runSupabaseAction } from '@/lib/supabaseRequest'

const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000

type SessionLike = {
    access_token?: string | null
    expires_at?: number | null
}

type WorkspaceAccessInvokeOptions<TBody extends Record<string, unknown>> = {
    label: string
    body: TBody
    timeoutMs?: number
    fallbackAccessToken?: string | null
}

export type WorkspaceAccessInvokeResult<TData> = {
    data: TData | null
    error?: unknown
}

let refreshSessionPromise: Promise<SessionLike | null> | null = null

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
        return (error as { message: string }).message
    }
    return String(error)
}

function getFunctionErrorStatus(error: unknown) {
    if (!error || typeof error !== 'object') {
        return undefined
    }

    const directStatus = (error as { status?: unknown }).status
    if (typeof directStatus === 'number') {
        return directStatus
    }

    const contextStatus = (error as { context?: { status?: unknown } }).context?.status
    if (typeof contextStatus === 'number') {
        return contextStatus
    }

    return undefined
}

export function isUnauthorizedFunctionError(error: unknown) {
    if (getFunctionErrorStatus(error) === 401) {
        return true
    }

    const message = getErrorMessage(error).toLowerCase()
    return message.includes('401') || message.includes('unauthorized')
}

function getTokenExpiresAtMs(accessToken?: string | null) {
    if (!accessToken || typeof globalThis.atob !== 'function') {
        return null
    }

    try {
        const payload = accessToken.split('.')[1]
        if (!payload) {
            return null
        }

        const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/')
        const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=')
        const decodedPayload = JSON.parse(globalThis.atob(paddedPayload)) as { exp?: unknown }
        return typeof decodedPayload.exp === 'number'
            ? decodedPayload.exp * 1000
            : null
    } catch {
        return null
    }
}

function shouldRefreshSession(session: SessionLike | null | undefined) {
    if (!session?.access_token) {
        return false
    }

    const expiresAtMs = typeof session.expires_at === 'number'
        ? session.expires_at * 1000
        : getTokenExpiresAtMs(session.access_token)

    return Boolean(expiresAtMs && expiresAtMs - Date.now() <= ACCESS_TOKEN_REFRESH_MARGIN_MS)
}

async function refreshCurrentSession() {
    if (!refreshSessionPromise) {
        refreshSessionPromise = (async () => {
            const { data, error } = await supabase.auth.refreshSession()
            if (!error && data.session?.access_token) {
                return data.session
            }

            if (error) {
                console.warn('[workspaceAccess] Failed to refresh session before authenticated function call:', error)
            }

            const { data: latestSessionData } = await supabase.auth.getSession()
            return latestSessionData.session
        })().finally(() => {
            refreshSessionPromise = null
        })
    }

    return refreshSessionPromise
}

async function getWorkspaceAccessToken(forceRefresh: boolean, fallbackAccessToken?: string | null) {
    const { data } = await supabase.auth.getSession()
    let session = data.session

    if (forceRefresh || shouldRefreshSession(session)) {
        const refreshedSession = await refreshCurrentSession()
        if (refreshedSession?.access_token) {
            session = refreshedSession
        }
    }

    return session?.access_token ?? fallbackAccessToken ?? ''
}

export async function invokeWorkspaceAccess<
    TData = unknown,
    TBody extends Record<string, unknown> = Record<string, unknown>
>({
    label,
    body,
    timeoutMs,
    fallbackAccessToken
}: WorkspaceAccessInvokeOptions<TBody>): Promise<WorkspaceAccessInvokeResult<TData>> {
    const accessToken = await getWorkspaceAccessToken(false, fallbackAccessToken)
    if (!accessToken) {
        throw new Error('Authentication required')
    }

    const invoke = (token: string) => runSupabaseAction(
        label,
        () => supabase.functions.invoke('workspace-access', {
            headers: {
                Authorization: `Bearer ${token}`
            },
            body
        }),
        { timeoutMs, platform: 'all' }
    ) as Promise<WorkspaceAccessInvokeResult<TData>>

    const firstResult = await invoke(accessToken)
    if (!firstResult.error || !isUnauthorizedFunctionError(firstResult.error)) {
        return firstResult
    }

    const refreshedAccessToken = await getWorkspaceAccessToken(true, fallbackAccessToken)
    if (!refreshedAccessToken || refreshedAccessToken === accessToken) {
        return firstResult
    }

    return invoke(refreshedAccessToken)
}
