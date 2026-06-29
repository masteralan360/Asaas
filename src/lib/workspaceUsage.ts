import { supabase } from '@/auth/supabase'

export interface WorkspaceUsageStatus {
    workspace_id: string
    has_limits: boolean
    storage_units: number
    storage_unit_limit: number | null
    data_transfer_bytes: number
    monthly_data_transfer_limit_bytes: number | null
    transfer_period_start: string
}

export interface WorkspaceTransferUsage {
    workspace_id: string
    transfer_period_start: string
    data_transfer_bytes: number
    monthly_data_transfer_limit_bytes: number | null
}

export const WORKSPACE_STORAGE_LIMIT_MESSAGE = 'Workspace storage limit exceeded'
export const WORKSPACE_TRANSFER_LIMIT_MESSAGE = 'Workspace monthly data transfer limit exceeded'

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
        return (error as { message: string }).message
    }
    return String(error)
}

export function isWorkspaceUsageLimitError(error: unknown): boolean {
    const message = getErrorMessage(error)
    return message.includes(WORKSPACE_STORAGE_LIMIT_MESSAGE)
        || message.includes(WORKSPACE_TRANSFER_LIMIT_MESSAGE)
}

export function getWorkspaceUsageLimitMessage(error: unknown): string {
    const message = getErrorMessage(error)

    if (message.includes(WORKSPACE_STORAGE_LIMIT_MESSAGE)) {
        return WORKSPACE_STORAGE_LIMIT_MESSAGE
    }

    if (message.includes(WORKSPACE_TRANSFER_LIMIT_MESSAGE)) {
        return WORKSPACE_TRANSFER_LIMIT_MESSAGE
    }

    return message
}

export function getTransferBodySize(data: Blob | ArrayBuffer | ArrayBufferView | string): number {
    if (typeof data === 'string') {
        return new TextEncoder().encode(data).byteLength
    }

    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return data.size
    }

    if (data instanceof ArrayBuffer) {
        return data.byteLength
    }

    if (ArrayBuffer.isView(data)) {
        return data.byteLength
    }

    return 0
}

export function parseContentLength(value: string | null): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null
}

export async function recordWorkspaceDataTransfer(
    workspaceId: string,
    bytes: number,
    source?: string
): Promise<WorkspaceTransferUsage | null> {
    const normalizedBytes = Math.trunc(bytes)
    if (!workspaceId || normalizedBytes <= 0) return null

    const { data, error } = await supabase
        .rpc('record_workspace_data_transfer', {
            p_workspace_id: workspaceId,
            p_bytes: normalizedBytes,
            p_source: source ?? null
        })
        .maybeSingle()

    if (error) {
        throw error
    }

    return data as WorkspaceTransferUsage | null
}

export async function getWorkspaceUsageStatus(workspaceId?: string): Promise<WorkspaceUsageStatus | null> {
    const { data, error } = await supabase
        .rpc('get_workspace_usage_status', {
            p_workspace_id: workspaceId ?? null
        })
        .maybeSingle()

    if (error) {
        throw error
    }

    return data as WorkspaceUsageStatus | null
}
