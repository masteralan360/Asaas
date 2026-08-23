import { describe, expect, it } from 'vitest'

import { compareMonthKeys, getApplicableStartMonth } from './budget'

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
})
