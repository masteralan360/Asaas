import type { WorkspaceDataMode } from '@/local-db/models'

const WORKSPACE_DATA_FETCH_PREFIX = 'atlas_workspace_data_fetch:'

export const WORKSPACE_DATA_FETCH_EVENT = 'atlas:workspace-data-fetch'

export type WorkspaceDataFetchSource = 'local' | 'supabase'

export interface WorkspaceDataFetchSnapshot {
    workspaceId: string
    source: WorkspaceDataFetchSource
    fetchedAt: string
}

function canUseLocalStorage() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function getWorkspaceDataFetchKey(workspaceId: string, source: WorkspaceDataFetchSource) {
    return `${WORKSPACE_DATA_FETCH_PREFIX}${source}:${workspaceId}`
}

function isValidTimestamp(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function parseSnapshot(
    value: string,
    workspaceId: string,
    source: WorkspaceDataFetchSource
): WorkspaceDataFetchSnapshot | null {
    try {
        const parsed = JSON.parse(value) as Partial<WorkspaceDataFetchSnapshot>
        if (
            parsed?.workspaceId !== workspaceId
            || parsed.source !== source
            || !isValidTimestamp(parsed.fetchedAt)
        ) {
            return null
        }

        return {
            workspaceId,
            source,
            fetchedAt: new Date(parsed.fetchedAt).toISOString()
        }
    } catch {
        return null
    }
}

export function getWorkspaceDataFetchSource(dataMode?: WorkspaceDataMode | null): WorkspaceDataFetchSource {
    return dataMode === 'local' || dataMode === 'demo' ? 'local' : 'supabase'
}

export function readWorkspaceDataFetch(
    workspaceId?: string | null,
    source: WorkspaceDataFetchSource = 'supabase'
): WorkspaceDataFetchSnapshot | null {
    if (!workspaceId || !canUseLocalStorage()) return null

    const key = getWorkspaceDataFetchKey(workspaceId, source)
    const value = localStorage.getItem(key)
    if (!value) return null

    const snapshot = parseSnapshot(value, workspaceId, source)
    if (!snapshot) {
        localStorage.removeItem(key)
    }

    return snapshot
}

export function recordWorkspaceDataFetch(
    workspaceId: string,
    source: WorkspaceDataFetchSource,
    fetchedAt = new Date().toISOString()
): WorkspaceDataFetchSnapshot {
    const snapshot: WorkspaceDataFetchSnapshot = {
        workspaceId,
        source,
        fetchedAt: isValidTimestamp(fetchedAt) ? new Date(fetchedAt).toISOString() : new Date().toISOString()
    }

    if (canUseLocalStorage()) {
        localStorage.setItem(getWorkspaceDataFetchKey(workspaceId, source), JSON.stringify(snapshot))
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent<WorkspaceDataFetchSnapshot>(WORKSPACE_DATA_FETCH_EVENT, {
            detail: snapshot
        }))
    }

    return snapshot
}
