import { describe, expect, it } from 'vitest'
import { formatCookOrderTicketTimestamp } from './cookOrderTicket'

describe('formatCookOrderTicketTimestamp', () => {
    it('uses day/month order for the printed date', () => {
        expect(formatCookOrderTicketTimestamp('en-US', new Date(2026, 7, 9, 16, 5)))
            .toBe('09/08 4:05 PM')
    })

    it('keeps leading zeroes on single-digit dates', () => {
        expect(formatCookOrderTicketTimestamp('en-US', new Date(2026, 0, 3, 8, 7)))
            .toBe('03/01 8:07 AM')
    })
})
