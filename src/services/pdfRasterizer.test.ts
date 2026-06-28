import { describe, expect, it } from 'vitest'
import { findBottomContentRow } from './pdfRasterizerUtils'

function createWhitePixels(width: number, height: number) {
    const pixels = new Uint8ClampedArray(width * height * 4)

    for (let offset = 0; offset < pixels.length; offset += 4) {
        pixels[offset] = 255
        pixels[offset + 1] = 255
        pixels[offset + 2] = 255
        pixels[offset + 3] = 255
    }

    return pixels
}

describe('PDF receipt rasterization', () => {
    it('finds the last non-white row before a blank receipt tail', () => {
        const width = 3
        const height = 8
        const pixels = createWhitePixels(width, height)
        const contentRow = 4
        const contentOffset = ((contentRow * width) + 1) * 4

        pixels[contentOffset] = 20
        pixels[contentOffset + 1] = 20
        pixels[contentOffset + 2] = 20

        expect(findBottomContentRow(pixels, width, height)).toBe(contentRow)
    })

    it('returns -1 for an all-white page', () => {
        expect(findBottomContentRow(createWhitePixels(3, 4), 3, 4)).toBe(-1)
    })
})
