import { describe, expect, it } from 'vitest'
import {
    calculatePaygAmountFromBytes,
    calculatePaygAmountFromGb,
    DEFAULT_PAYG_PRICING_CHECKPOINTS,
    validatePaygPricingCheckpoints
} from './paygPricing'

describe('PAYG pricing', () => {
    it('keeps the Standard PAYG checkpoints exact', () => {
        expect(calculatePaygAmountFromGb(1)).toBe(0)
        expect(calculatePaygAmountFromGb(2)).toBe(1_000)
        expect(calculatePaygAmountFromGb(10)).toBe(9_000)
        expect(calculatePaygAmountFromGb(11)).toBe(10_000)
        expect(calculatePaygAmountFromGb(50)).toBe(49_000)
        expect(calculatePaygAmountFromGb(100)).toBe(99_000)
    })

    it('requires the free one-GB tier and a 100-GB endpoint', () => {
        expect(validatePaygPricingCheckpoints([
            { gb: 1, amountIqd: 1, protected: true },
            { gb: 100, amountIqd: 99_000, protected: true }
        ])).toBe('requiredCheckpointsRequired')
    })

    it('interpolates exact usage and rounds only the final IQD amount', () => {
        expect(calculatePaygAmountFromGb(3)).toBe(2_000)
        expect(calculatePaygAmountFromBytes(3_002_000_000)).toBe(2_002)
        expect(calculatePaygAmountFromGb(10)).toBe(9_000)
        expect(calculatePaygAmountFromGb(28)).toBe(27_000)
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
            ...DEFAULT_PAYG_PRICING_CHECKPOINTS.slice(2)
        ]
        expect(validatePaygPricingCheckpoints(schedule)).toBeNull()
        expect(calculatePaygAmountFromGb(3, schedule)).toBe(3_333)
    })

    it('rejects decreasing and duplicate schedules, while capping usage above 100 GB', () => {
        expect(validatePaygPricingCheckpoints([
            ...DEFAULT_PAYG_PRICING_CHECKPOINTS,
            { gb: 20, amountIqd: 9_000, protected: false }
        ])).toBe('amountMustNotDecrease')
        expect(validatePaygPricingCheckpoints([
            ...DEFAULT_PAYG_PRICING_CHECKPOINTS,
            { gb: 10, amountIqd: 10_000, protected: false }
        ])).toBe('duplicateGb')
        expect(validatePaygPricingCheckpoints([
            { gb: 1, amountIqd: 0, protected: true },
            { gb: 50, amountIqd: 9_999, protected: true }
        ])).toBe('requiredCheckpointsRequired')
        expect(calculatePaygAmountFromGb(100.000001)).toBe(99_000)
        expect(calculatePaygAmountFromBytes(101_000_000_000)).toBe(99_000)
    })
})
