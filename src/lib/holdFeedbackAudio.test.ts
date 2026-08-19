import { describe, expect, it } from 'vitest'
import {
    getHoldFeedbackFrequency,
    HOLD_FEEDBACK_MAX_FREQUENCY_HZ,
    HOLD_FEEDBACK_MIN_FREQUENCY_HZ
} from './holdFeedbackAudio'

describe('hold feedback audio frequency mapping', () => {
    it('starts at the minimum frequency', () => {
        expect(getHoldFeedbackFrequency(0)).toBeCloseTo(HOLD_FEEDBACK_MIN_FREQUENCY_HZ)
    })

    it('reaches the maximum frequency at full progress', () => {
        expect(getHoldFeedbackFrequency(100)).toBeCloseTo(HOLD_FEEDBACK_MAX_FREQUENCY_HZ)
    })

    it('rises monotonically with progress', () => {
        const samples = [0, 10, 25, 50, 75, 90, 100]
        const frequencies = samples.map((p) => getHoldFeedbackFrequency(p))
        for (let i = 1; i < frequencies.length; i += 1) {
            expect(frequencies[i]).toBeGreaterThan(frequencies[i - 1])
        }
        expect(frequencies[2]).toBeGreaterThan(HOLD_FEEDBACK_MIN_FREQUENCY_HZ)
        expect(frequencies[2]).toBeLessThan(HOLD_FEEDBACK_MAX_FREQUENCY_HZ)
    })

    it('clamps progress outside 0-100', () => {
        expect(getHoldFeedbackFrequency(-10)).toBeCloseTo(HOLD_FEEDBACK_MIN_FREQUENCY_HZ)
        expect(getHoldFeedbackFrequency(150)).toBeCloseTo(HOLD_FEEDBACK_MAX_FREQUENCY_HZ)
    })

    it('falls back to a valid frequency for invalid ranges', () => {
        expect(getHoldFeedbackFrequency(50, 0, 100)).toBe(HOLD_FEEDBACK_MIN_FREQUENCY_HZ)
        expect(getHoldFeedbackFrequency(50, 440, 220)).toBe(HOLD_FEEDBACK_MIN_FREQUENCY_HZ)
    })
})