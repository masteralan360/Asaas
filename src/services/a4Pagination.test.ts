import { describe, expect, it } from 'vitest'

import { getA4PageStarts } from './a4Pagination'

describe('getA4PageStarts', () => {
    it('moves a component that crosses an A4 boundary to the following page', () => {
        expect(getA4PageStarts(560, [{ topMm: 285, bottomMm: 325 }]))
            .toEqual([0, 285])
    })

    it('uses normal A4 boundaries when no component crosses one', () => {
        expect(getA4PageStarts(620, [{ topMm: 20, bottomMm: 80 }]))
            .toEqual([0, 297, 594])
    })

    it('does not create a nearly empty page for a block taller than A4', () => {
        expect(getA4PageStarts(650, [{ topMm: 250, bottomMm: 600 }]))
            .toEqual([0, 297, 594])
    })
})
