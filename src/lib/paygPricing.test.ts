import { describe, expect, it } from 'vitest'
import {
    calculatePaygAmountFromBytes,
    calculatePaygAmountFromGb,
    DEFAULT_PAYG_PRICING_CHECKPOINTS,
    validatePaygPricingCheckpoints
} from './paygPricing'

describe('PAYG pricing', () => {
    it('keeps the protected checkpoints exact', () => {
        expect(calculatePaygAmountFromGb(1)).toBe(0)
        expect(calculatePaygAmountFromGb(10)).toBe(15_000)
        expect(calculatePaygAmountFromGb(100)).toBe(40_000)
    })

    it('interpolates exact usage and rounds only the final IQD amount', () => {
        expect(calculatePaygAmountFromGb(3)).toBe(3_333)
        expect(calculatePaygAmountFromBytes(3_000_300_000)).toBe(3_334)
    })

    it('keeps usage through one GB free', () => {
        expect(calculatePaygAmountFromBytes(999_999_999)).toBe(0)
        expect(calculatePaygAmountFromBytes(1_000_000_000)).toBe(0)
    })

    it('uses administrator checkpoints between protected points', () => {
        const schedule = [
            DEFAULT_PAYG_PRICING_CHECKPOINTS[0],
            { gb: 5, amountIqd: 8_000, protected: false },
            DEFAULT_PAYG_PRICING_CHECKPOINTS[1],
            DEFAULT_PAYG_PRICING_CHECKPOINTS[2]
        ]
        expect(validatePaygPricingCheckpoints(schedule)).toBeNull()
        expect(calculatePaygAmountFromGb(3, schedule)).toBe(4_000)
    })

    it('rejects decreasing, duplicate, altered, and above-limit schedules', () => {
        expect(validatePaygPricingCheckpoints([
            ...DEFAULT_PAYG_PRICING_CHECKPOINTS,
            { gb: 20, amountIqd: 10_000, protected: false }
        ])).toBe('amountMustNotDecrease')
        expect(validatePaygPricingCheckpoints([
            ...DEFAULT_PAYG_PRICING_CHECKPOINTS,
            { gb: 10, amountIqd: 16_000, protected: false }
        ])).toBe('duplicateGb')
        expect(validatePaygPricingCheckpoints([
            { gb: 1, amountIqd: 0, protected: true },
            { gb: 10, amountIqd: 14_999, protected: true },
            { gb: 100, amountIqd: 40_000, protected: true }
        ])).toBe('protectedCheckpointsRequired')
        expect(() => calculatePaygAmountFromGb(100.000001)).toThrow(RangeError)
    })
})
