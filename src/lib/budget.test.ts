import { describe, expect, it } from 'vitest'

import { compareMonthKeys, getApplicableStartMonth, getPaymentDateForMonth } from './budget'

describe('month key safety', () => {
    it('orders extended years chronologically instead of lexicographically', () => {
        expect(compareMonthKeys('10125-01', '2026-08')).toBeGreaterThan(0)
    })

    it('bounds malformed historical and future recurring dates', () => {
        const currentMonth = '2026-08'
        const createdAt = '2026-01-15T12:00:00.000Z'

        expect(getApplicableStartMonth('0025-01-01', createdAt, currentMonth)).toBe('2026-01')
        expect(getApplicableStartMonth('10125-01-01', createdAt, currentMonth)).toBeNull()
        expect(getApplicableStartMonth('not-a-date', createdAt, currentMonth)).toBe('2026-01')
    })

    it('uses the selected accounting month for a payment timestamp and clamps its day', () => {
        const now = new Date(2026, 2, 31, 14, 35, 20, 123)

        const paymentDate = getPaymentDateForMonth('2026-02', now)

        expect(paymentDate).toEqual(new Date(2026, 1, 28, 14, 35, 20, 123))
    })

    it('keeps the current timestamp when the selected accounting month is invalid', () => {
        const now = new Date(2026, 7, 15, 9, 30)

        expect(getPaymentDateForMonth('not-a-month', now)).toEqual(now)
    })
})
