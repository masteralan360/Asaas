import { beforeEach, describe, expect, it } from 'vitest'

import {
    DEFAULT_INSTANT_POS_PRODUCTS_PER_ROW,
    INSTANT_POS_PRODUCTS_PER_ROW_KEY,
    readInstantPosProductsPerRow,
    saveInstantPosProductsPerRow,
} from './instantPosLayout'

function installLocalStorage() {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        },
    })
}

describe('Instant POS layout preferences', () => {
    beforeEach(() => {
        installLocalStorage()
    })

    it('uses the same four-product default as POS when there is no saved setting', () => {
        expect(readInstantPosProductsPerRow()).toBe(DEFAULT_INSTANT_POS_PRODUCTS_PER_ROW)
    })

    it('persists a selected product count locally', () => {
        expect(saveInstantPosProductsPerRow(6)).toBe(6)
        expect(localStorage.getItem(INSTANT_POS_PRODUCTS_PER_ROW_KEY)).toBe('6')
        expect(readInstantPosProductsPerRow()).toBe(6)
    })

    it('falls back to the default for an unsupported saved value', () => {
        localStorage.setItem(INSTANT_POS_PRODUCTS_PER_ROW_KEY, '9')

        expect(readInstantPosProductsPerRow()).toBe(DEFAULT_INSTANT_POS_PRODUCTS_PER_ROW)
    })
})
