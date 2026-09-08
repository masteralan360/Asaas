import { describe, expect, it } from 'vitest'
import {
    getMobileCatalogQuantityRepeatDelay,
    MOBILE_CATALOG_QUANTITY_CANCEL_DISTANCE_PX,
    MOBILE_CATALOG_QUANTITY_HOLD_DELAY_MS
} from './mobileCatalogQuantityPress'

describe('mobile POS quantity long press', () => {
    it('waits a deliberate second before quantity repeat can start', () => {
        expect(MOBILE_CATALOG_QUANTITY_HOLD_DELAY_MS).toBe(1_000)
    })

    it('uses enough touch movement to distinguish scrolling from a stationary hold', () => {
        expect(MOBILE_CATALOG_QUANTITY_CANCEL_DISTANCE_PX).toBe(12)
    })

    it('accelerates repeat frequency while keeping it bounded', () => {
        const delays = [0, 1_999, 2_000, 3_999, 4_000, 5_999, 6_000, 20_000]
            .map(getMobileCatalogQuantityRepeatDelay)

        expect(delays).toEqual([280, 280, 210, 210, 150, 150, 100, 100])
        expect(delays.every((delay) => delay >= 100 && delay <= 280)).toBe(true)
    })
})
