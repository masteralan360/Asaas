import { describe, expect, it } from 'vitest'

import { getOrderPrintReturnState } from './orderPrintReturnState'

describe('order print return state', () => {
    it('keeps active order lines unchanged', () => {
        expect(getOrderPrintReturnState({ quantity: 3, lineTotal: 75 })).toEqual({
            status: 'active',
            originalQuantity: 3,
            remainingQuantity: 3,
            originalLineTotal: 75,
            remainingLineTotal: 75
        })
    })

    it('shows the original and remaining values for a partial return', () => {
        expect(getOrderPrintReturnState({ quantity: 3, returnedQuantity: 1, lineTotal: 75 })).toEqual({
            status: 'partially-returned',
            originalQuantity: 3,
            remainingQuantity: 2,
            originalLineTotal: 75,
            remainingLineTotal: 50
        })
    })

    it('marks a fully returned line and reduces its displayed values to zero', () => {
        expect(getOrderPrintReturnState({ quantity: 3, returnedQuantity: 3, lineTotal: 75 })).toEqual({
            status: 'fully-returned',
            originalQuantity: 3,
            remainingQuantity: 0,
            originalLineTotal: 75,
            remainingLineTotal: 0
        })
    })

    it('uses the posted refund amount when one is available', () => {
        expect(getOrderPrintReturnState(
            { quantity: 3, lineTotal: 80_000 },
            { returnedQuantity: 1, returnedAmount: 20_000 }
        )).toMatchObject({
            status: 'partially-returned',
            remainingQuantity: 2,
            remainingLineTotal: 60_000
        })
    })

    it('only marks a bonus-bearing line fully returned after all inventory is returned', () => {
        expect(getOrderPrintReturnState({ quantity: 3, freeBonusQuantity: 1, returnedQuantity: 3, lineTotal: 75 }).status)
            .toBe('partially-returned')
    })
})
