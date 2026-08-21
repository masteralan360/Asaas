/**
 * This is a planning-only estimate for the Monthly Usage Calculator. It is not
 * a usage meter and does not write a database counter.
 *
 * Production metering selects the rate at the trusted request boundary: Tauri
 * currently uses 10× and Web Live currently uses 20×. This helper retains the
 * desktop baseline so estimates remain understandable without storing channels.
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

