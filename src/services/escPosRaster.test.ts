import { describe, expect, it } from 'vitest'

import { appendEscPosFeedAndCut, encodeEscPosRaster } from './escPosRaster'

describe('ESC/POS raster encoding', () => {
    it('packs dark pixels left-to-right into ESC/POS GS v 0 bytes', () => {
        const rgba = new Uint8ClampedArray(8 * 4).fill(255)
        // First and last pixels are black; all other pixels are white.
        rgba[0] = 0
        rgba[1] = 0
        rgba[2] = 0
        rgba[7 * 4] = 0
        rgba[7 * 4 + 1] = 0
        rgba[7 * 4 + 2] = 0

        expect([...encodeEscPosRaster(rgba, 8, 1)]).toEqual([
            0x1d, 0x76, 0x30, 0x00,
            0x01, 0x00, 0x01, 0x00,
            0x81
        ])
    })

    it('adds feed and a full-cut command after a rendered receipt', () => {
        expect([...appendEscPosFeedAndCut(new Uint8Array([1, 2]), 3)]).toEqual([
            1, 2,
            0x1b, 0x64, 0x03,
            0x1d, 0x56, 0x00
        ])
    })
})
