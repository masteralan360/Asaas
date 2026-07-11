/**
 * Actual transfer is the real request/response or file payload measured in bytes.
 * Charged usage is the plan-consumption value after applying the commercial weight.
 *
 * IMPORTANT: callers must always report ACTUAL bytes to the backend. The database is
 * the source of truth that applies this same factor once and stores both counters.
 */
export const WORKSPACE_USAGE_CHARGE_MULTIPLIER = 10

export function actualTransferToChargedUsage(actualTransferBytes: number): number {
    if (!Number.isFinite(actualTransferBytes) || actualTransferBytes <= 0) return 0
    return Math.trunc(actualTransferBytes) * WORKSPACE_USAGE_CHARGE_MULTIPLIER
}

export function chargedUsageToApproximateActualTransfer(chargedUsageBytes: number): number {
    if (!Number.isFinite(chargedUsageBytes) || chargedUsageBytes <= 0) return 0
    return Math.trunc(chargedUsageBytes / WORKSPACE_USAGE_CHARGE_MULTIPLIER)
}

