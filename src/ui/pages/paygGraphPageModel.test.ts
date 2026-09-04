import { describe, expect, it } from 'vitest'
import { DEFAULT_PAYG_PRICING_CHECKPOINTS } from '@/lib/paygPricing'
import {
    calculatePaygPreviewAmount,
    calculatePaygPreviewGb,
    formatPaygCalculatorInput,
    getPaygGraphHoverGb,
    parsePaygCalculatorInput,
    PAYG_GRAPH,
    PAYG_MOBILE_GRAPH,
} from './paygGraphPageModel'

describe('public PAYG graph column hover', () => {
    it.each([
        [0, 0],
        [1, 0],
        [3, 1_429],
        [15, 10_000],
        [55, 24_118],
        [100, 40_000],
    ])('calculates %s GB as %s IQD at every height in its graph column', (gb, amount) => {
        const x = PAYG_GRAPH.left
            + gb / 100 * (PAYG_GRAPH.right - PAYG_GRAPH.left)
        for (const y of [PAYG_GRAPH.top, 128, PAYG_GRAPH.bottom]) {
            const usage = getPaygGraphHoverGb(x, y)
            expect(usage).toBe(gb)
            expect(calculatePaygPreviewAmount(usage!, DEFAULT_PAYG_PRICING_CHECKPOINTS)).toBe(amount)
        }
    })

    it.each([
        [PAYG_GRAPH.left - 1, 100],
        [PAYG_GRAPH.right + 1, 100],
        [100, PAYG_GRAPH.top - 1],
        [100, PAYG_GRAPH.bottom + 1],
        [Number.NaN, 100],
        [100, Number.POSITIVE_INFINITY],
    ])('hides the hover outside the plotting area at %s, %s', (x, y) => {
        expect(getPaygGraphHoverGb(x, y)).toBeNull()
    })
})

describe('mobile PAYG graph column hover', () => {
    it('uses the taller mobile graph bounds without changing the calculated price', () => {
        const gb = 55
        const x = PAYG_MOBILE_GRAPH.left
            + gb / 100 * (PAYG_MOBILE_GRAPH.right - PAYG_MOBILE_GRAPH.left)
        const usage = getPaygGraphHoverGb(x, PAYG_MOBILE_GRAPH.top, PAYG_MOBILE_GRAPH)

        expect(usage).toBe(gb)
        expect(calculatePaygPreviewAmount(usage!, DEFAULT_PAYG_PRICING_CHECKPOINTS)).toBe(24_118)
    })
})

describe('public PAYG calculator', () => {
    it.each([
        [0, 0],
        [1, 0],
        [3, 1_429],
        [3.002, 1_430],
        [15, 10_000],
        [100, 40_000],
    ])('converts %s GB to %s IQD using billing rounding', (gb, amount) => {
        expect(calculatePaygPreviewAmount(gb, DEFAULT_PAYG_PRICING_CHECKPOINTS)).toBe(amount)
    })

    it.each([
        [0, 1],
        [5_000, 8],
        [10_000, 15],
        [15_000, 29.166666666666664],
        [40_000, 100],
    ])('converts %s IQD to %s GB on the continuous curve', (amount, gb) => {
        expect(calculatePaygPreviewGb(amount, DEFAULT_PAYG_PRICING_CHECKPOINTS)).toBeCloseTo(gb, 8)
    })

    it('rejects values outside the PAYG range and fractional IQD', () => {
        expect(calculatePaygPreviewAmount(-0.01, DEFAULT_PAYG_PRICING_CHECKPOINTS)).toBeNull()
        expect(calculatePaygPreviewAmount(100.000001, DEFAULT_PAYG_PRICING_CHECKPOINTS)).toBeNull()
        expect(calculatePaygPreviewGb(40_001, DEFAULT_PAYG_PRICING_CHECKPOINTS)).toBeNull()
        expect(calculatePaygPreviewGb(1.5, DEFAULT_PAYG_PRICING_CHECKPOINTS)).toBeNull()
    })

    it('keeps empty and partial input out of calculations while formatting valid input', () => {
        expect(formatPaygCalculatorInput('')).toBe('')
        expect(parsePaygCalculatorInput('')).toBeNull()
        expect(formatPaygCalculatorInput('15000.')).toBe('15,000.')
        expect(formatPaygCalculatorInput('0003.0500')).toBe('3.0500')
        expect(parsePaygCalculatorInput('15,000')).toBe(15_000)
        expect(parsePaygCalculatorInput('.25')).toBe(0.25)
        expect(formatPaygCalculatorInput('3 GB')).toBeNull()
    })
})
