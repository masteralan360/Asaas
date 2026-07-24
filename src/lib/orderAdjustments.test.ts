import { describe, expect, it } from 'vitest'

import {
    calculateOrderTotalWithAdjustments,
    createOrderAdjustment,
    getOrderAdjustmentTotals,
    normalizeOrderAdjustments
} from './orderAdjustments'

describe('order adjustments', () => {
    it('only accepts complete, positive adjustments and preserves legacy same-currency rows', () => {
        const adjustments = normalizeOrderAdjustments([
            { id: 'shipping', type: 'addition', name: ' Shipping ', currency: 'usd', amount: 12.5 },
            { id: 'zero', type: 'deduction', name: 'Zero', currency: 'usd', amount: 0 },
            { id: 'negative', type: 'deduction', name: 'Negative', currency: 'usd', amount: -1 },
            { id: 'other-currency', type: 'addition', name: 'Other', currency: 'iqd', amount: 2 },
            { id: 'no-name', type: 'addition', name: ' ', currency: 'usd', amount: 2 }
        ], 'usd')

        expect(adjustments).toEqual([
            expect.objectContaining({
                id: 'shipping',
                type: 'addition',
                name: 'Shipping',
                currency: 'usd',
                amount: 12.5,
                orderCurrency: 'usd',
                convertedAmount: 12.5,
                exchangeRate: 1,
                exchangeRateSource: 'native',
                exchangeRates: []
            })
        ])
    })

    it('locks the source amount, applied rate, and converted order amount for cross-currency rows', () => {
        const adjustment = createOrderAdjustment({
            id: 'shipping',
            type: 'addition',
            name: ' Shipping ',
            currency: 'usd',
            amount: '12.5'
        }, 'iqd', [{
            pair: 'USD/IQD',
            rate: 130000,
            source: 'manual',
            timestamp: '2026-07-25T12:00:00.000Z'
        }])

        expect(adjustment).toEqual({
            id: 'shipping',
            type: 'addition',
            name: 'Shipping',
            currency: 'usd',
            amount: 12.5,
            orderCurrency: 'iqd',
            convertedAmount: 16250,
            exchangeRate: 1300,
            exchangeRateSource: 'manual',
            exchangeRateTimestamp: '2026-07-25T12:00:00.000Z',
            exchangeRates: [{
                pair: 'USD/IQD',
                rate: 130000,
                source: 'manual',
                timestamp: '2026-07-25T12:00:00.000Z'
            }]
        })
        expect(getOrderAdjustmentTotals([adjustment!])).toEqual({ additions: 16250, deductions: 0 })
        expect(calculateOrderTotalWithAdjustments(100, [adjustment!])).toBe(16350)

        const inverseAdjustment = createOrderAdjustment({
            id: 'damage',
            type: 'deduction',
            name: 'Damage',
            currency: 'iqd',
            amount: '1300'
        }, 'usd', [{
            pair: 'USD/IQD',
            rate: 130000,
            source: 'manual',
            timestamp: '2026-07-25T12:00:00.000Z'
        }])
        expect(inverseAdjustment).toEqual(expect.objectContaining({
            convertedAmount: 1,
            exchangeRate: 0.00076923
        }))
    })

    it('applies confirmed additions and deductions to the existing calculated total', () => {
        const adjustments = normalizeOrderAdjustments([
            { id: 'shipping', type: 'addition', name: 'Shipping', currency: 'usd', amount: 12.5 },
            { id: 'damage', type: 'deduction', name: 'Damage', currency: 'usd', amount: 3.25 }
        ], 'usd')

        expect(getOrderAdjustmentTotals(adjustments)).toEqual({ additions: 12.5, deductions: 3.25 })
        expect(calculateOrderTotalWithAdjustments(100, adjustments)).toBe(109.25)
    })
})
