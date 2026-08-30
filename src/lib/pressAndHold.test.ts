import { describe, expect, it } from 'vitest'
import {
    getPressAndHoldProgress,
    isShortPress,
    WORKSPACE_PAYMENT_HOLD_DURATION_MS
} from './pressAndHold'

describe('press-and-hold payment confirmation', () => {
    it('does not complete before the required 1.5 seconds', () => {
        expect(WORKSPACE_PAYMENT_HOLD_DURATION_MS).toBe(1_500)
        expect(getPressAndHoldProgress(1_000, 2_499)).toMatchObject({
            elapsedMs: 1_499,
            complete: false
        })
        expect(getPressAndHoldProgress(1_000, 2_000).complete).toBe(false)
    })

    it('completes at 1.5 seconds and clamps progress', () => {
        expect(getPressAndHoldProgress(1_000, 2_500)).toEqual({
            elapsedMs: 1_500,
            progress: 100,
            complete: true
        })
        expect(getPressAndHoldProgress(1_000, 4_000).progress).toBe(100)
    })

    it('never reports negative elapsed time', () => {
        expect(getPressAndHoldProgress(2_000, 1_000)).toEqual({
            elapsedMs: 0,
            progress: 0,
            complete: false
        })
    })

    it('treats only a quick tap as a single click', () => {
        expect(isShortPress(1_000, 1_299)).toBe(true)
        expect(isShortPress(1_000, 1_300)).toBe(false)
        expect(isShortPress(1_000, 900)).toBe(true)
    })
})
