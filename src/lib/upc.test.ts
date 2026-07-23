import { describe, expect, it } from 'vitest'

import { calculateUpcACheckDigit, generateRandomUpc } from './upc'

describe('UPC-A generation', () => {
    it('calculates the standard UPC-A check digit', () => {
        expect(calculateUpcACheckDigit('03600029145')).toBe('2')
    })

    it('generates a 12-digit UPC-A with a valid check digit', () => {
        let value = 0
        const upc = generateRandomUpc(() => value++)

        expect(upc).toBe('012345678905')
        expect(upc).toMatch(/^\d{12}$/)
        expect(calculateUpcACheckDigit(upc.slice(0, 11))).toBe(upc.at(-1))
    })
})
