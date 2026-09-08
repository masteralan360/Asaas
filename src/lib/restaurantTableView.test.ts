import { describe, expect, it } from 'vitest'

import {
    calculateRestaurantTicketTotal,
    canChangeRestaurantTableConfiguration,
    isRestaurantTicketStatus,
    normalizeRestaurantTableCount,
    normalizeVipTableNumbers,
} from './restaurantTableView'

describe('restaurant table view rules', () => {
    it('calculates discounted line totals without floating point drift', () => {
        expect(calculateRestaurantTicketTotal([
            { quantity: 3, unitPrice: 0.1 },
            { quantity: 2, unitPrice: 7.25 },
        ])).toBe(14.8)
    })

    it('normalizes only in-range VIP table selections', () => {
        expect(normalizeVipTableNumbers([3, 1, 3, 0, 101], 12)).toEqual([1, 3])
        expect(normalizeRestaurantTableCount(1)).toBe(1)
        expect(normalizeRestaurantTableCount(100)).toBe(100)
        expect(normalizeRestaurantTableCount(0)).toBeNull()
        expect(normalizeRestaurantTableCount(101)).toBeNull()
    })

    it('protects active tickets while disabling or reducing configured tables', () => {
        expect(canChangeRestaurantTableConfiguration({
            currentEnabled: true, nextEnabled: false, currentTableCount: 20, nextTableCount: 20, activeTableNumbers: [1]
        })).toBe(false)
        expect(canChangeRestaurantTableConfiguration({
            currentEnabled: true, nextEnabled: true, currentTableCount: 20, nextTableCount: 10, activeTableNumbers: [11]
        })).toBe(false)
        expect(canChangeRestaurantTableConfiguration({
            currentEnabled: true, nextEnabled: true, currentTableCount: 20, nextTableCount: 10, activeTableNumbers: [10]
        })).toBe(true)
    })

    it('excludes Paid/Closed from the restaurant lifecycle', () => {
        expect(isRestaurantTicketStatus('served')).toBe(true)
        expect(isRestaurantTicketStatus('paid')).toBe(false)
        expect(isRestaurantTicketStatus('closed')).toBe(false)
    })
})
