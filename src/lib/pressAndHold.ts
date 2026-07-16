export const WORKSPACE_PAYMENT_HOLD_DURATION_MS = 1_500

export interface PressAndHoldProgress {
    elapsedMs: number
    progress: number
    complete: boolean
}

export function getPressAndHoldProgress(
    startedAt: number,
    now: number,
    durationMs = WORKSPACE_PAYMENT_HOLD_DURATION_MS
): PressAndHoldProgress {
    const requestedDuration = Number.isFinite(durationMs) && durationMs > 0
        ? durationMs
        : WORKSPACE_PAYMENT_HOLD_DURATION_MS
    const safeDuration = Math.max(WORKSPACE_PAYMENT_HOLD_DURATION_MS, requestedDuration)
    const elapsedMs = Math.max(0, now - startedAt)
    const progress = Math.min(100, (elapsedMs / safeDuration) * 100)

    return {
        elapsedMs,
        progress,
        complete: elapsedMs >= safeDuration
    }
}
