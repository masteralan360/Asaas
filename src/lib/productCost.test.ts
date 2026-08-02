import { describe, expect, it } from 'vitest'

import { getMissingPriceBookCostMessage, hasValidProductCost } from './productCost'

describe('hasValidProductCost', () => {
    it('accepts zero as a legitimate cost', () => {
        expect(hasValidProductCost(0)).toBe(true)
    })

    it('treats a missing or invalid cost as unsellable', () => {
        expect(hasValidProductCost(null)).toBe(false)
        expect(hasValidProductCost(undefined)).toBe(false)
        expect(hasValidProductCost(-1)).toBe(false)
        expect(hasValidProductCost(Number.NaN)).toBe(false)
    })

    it('explains when a Price Book-specific cost is missing', () => {
        expect(getMissingPriceBookCostMessage('Widget', 'Wholesale')).toBe(
            'Widget cannot be sold to this business partner until a Price Book cost is added in Wholesale.'
        )
    })
})
