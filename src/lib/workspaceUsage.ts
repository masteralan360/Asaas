import { supabase } from '@/auth/supabase'

export interface WorkspaceUsageStatus {
    workspace_id: string
    has_limits: boolean
    storage_units: number
    storage_unit_limit: number | null
    /** Real measured upload/download bytes. This value is never weighted. */
    actual_data_transfer_bytes: number
    /** Charged usage used for quota enforcement after applying the multiplier. */
    data_transfer_bytes: number
    transfer_charge_multiplier: number
    /** Charged-usage allowance, not a raw network-transfer limit. */
    monthly_data_transfer_limit_bytes: number | null
    transfer_period_start: string
}

export interface WorkspaceTransferUsage {
    workspace_id: string
    transfer_period_start: string
    /** Real measured upload/download bytes. This value is never weighted. */
    actual_data_transfer_bytes: number
    /** Charged usage used for quota enforcement after applying the multiplier. */
    data_transfer_bytes: number
    transfer_charge_multiplier: number
    /** Charged-usage allowance, not a raw network-transfer limit. */
    monthly_data_transfer_limit_bytes: number | null
}

export const WORKSPACE_STORAGE_LIMIT_MESSAGE = 'Workspace storage limit exceeded'
// Legacy wire text kept for compatibility. "Data transfer" here means the
// charged-usage allowance; raw actual transfer is never compared to this limit.
export const WORKSPACE_TRANSFER_LIMIT_MESSAGE = 'Workspace monthly data transfer limit exceeded'
const WORKSPACE_USAGE_UPDATED_EVENT = 'workspace-usage-updated'

function notifyWorkspaceUsageUpdated(workspaceId: string) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(WORKSPACE_USAGE_UPDATED_EVENT, {
        detail: { workspaceId }
    }))
}

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
    actualBytes: number,
    source?: string
): Promise<WorkspaceTransferUsage | null> {
    // IMPORTANT: p_bytes is ACTUAL measured transfer. The database applies the
    // commercial multiplier exactly once and stores charged usage separately.
    const normalizedBytes = Math.trunc(actualBytes)
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

    notifyWorkspaceUsageUpdated(workspaceId)
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
