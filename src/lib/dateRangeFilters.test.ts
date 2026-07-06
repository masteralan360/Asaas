import { describe, expect, it } from 'vitest'

import { isDateInDateRange } from './dateRangeFilters'

const now = new Date(2026, 6, 6, 12)
const emptyCustomDates = { start: '', end: '' }

describe('isDateInDateRange', () => {
    it('matches all records for all time, including undated records', () => {
        expect(isDateInDateRange(null, 'allTime', emptyCustomDates, now)).toBe(true)
    })

    it('treats an empty custom range as unscoped', () => {
        expect(isDateInDateRange(null, 'custom', emptyCustomDates, now)).toBe(true)
    })

    it('excludes undated records from scoped ranges', () => {
        expect(isDateInDateRange(null, 'today', emptyCustomDates, now)).toBe(false)
        expect(isDateInDateRange(undefined, 'month', emptyCustomDates, now)).toBe(false)
    })

    it('matches records from the start of the selected month', () => {
        expect(isDateInDateRange(new Date(2026, 6, 1), 'month', emptyCustomDates, now)).toBe(true)
        expect(isDateInDateRange(new Date(2026, 5, 30, 23, 59, 59, 999), 'month', emptyCustomDates, now)).toBe(false)
    })

    it('treats date-only strings as local calendar dates', () => {
        expect(isDateInDateRange('2026-07-06', 'today', emptyCustomDates, now)).toBe(true)
        expect(isDateInDateRange('2026-07-05', 'today', emptyCustomDates, now)).toBe(false)
    })

    it('supports open-ended custom ranges', () => {
        expect(isDateInDateRange('2026-07-10', 'custom', { start: '2026-07-05', end: '' }, now)).toBe(true)
        expect(isDateInDateRange('2026-07-04', 'custom', { start: '2026-07-05', end: '' }, now)).toBe(false)
        expect(isDateInDateRange('2026-07-10', 'custom', { start: '', end: '2026-07-09' }, now)).toBe(false)
    })
})
