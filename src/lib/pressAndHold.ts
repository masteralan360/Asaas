export const WORKSPACE_PAYMENT_HOLD_DURATION_MS = 1_500
export const STATUS_ADVANCE_HOLD_DURATION_MS = 600
export const ORDER_STATUS_ADVANCE_HOLD_DURATION_MS = STATUS_ADVANCE_HOLD_DURATION_MS
export const MIN_HOLD_DURATION_MS = 250
export const SHORT_PRESS_MAX_DURATION_MS = 300

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
    const safeDuration = Math.max(MIN_HOLD_DURATION_MS, requestedDuration)
    const elapsedMs = Math.max(0, now - startedAt)
    const progress = Math.min(100, (elapsedMs / safeDuration) * 100)

    return {
        elapsedMs,
        progress,
        complete: elapsedMs >= safeDuration
    }
}

export function isShortPress(
    startedAt: number,
    now: number,
    maxDurationMs = SHORT_PRESS_MAX_DURATION_MS
): boolean {
    return Math.max(0, now - startedAt) < maxDurationMs
}
