/**
 * Converts an RGBA bitmap to the ESC/POS GS v 0 raster command. Rendering the
 * receipt first keeps custom layouts, RTL text, QR codes, and logos identical
 * across every thermal transport.
 */
export function encodeEscPosRaster(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    threshold = 176
): Uint8Array {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error('Receipt image dimensions must be positive integers.')
    }

    if (rgba.length < width * height * 4) {
        throw new Error('Receipt image data is incomplete.')
    }

    const bytesPerRow = Math.ceil(width / 8)
    const payload = new Uint8Array(8 + bytesPerRow * height)
    payload.set([
        0x1d, 0x76, 0x30, 0x00,
        bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
        height & 0xff, (height >> 8) & 0xff
    ])

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const sourceOffset = (y * width + x) * 4
            const red = rgba[sourceOffset]
            const green = rgba[sourceOffset + 1]
            const blue = rgba[sourceOffset + 2]
            const alpha = rgba[sourceOffset + 3]
            const luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722)

            // Transparent pixels are paper-white. The alpha blend prevents
            // semi-transparent anti-aliasing from becoming heavy black text.
            const blendedLuminance = 255 - ((255 - luminance) * alpha) / 255
            if (blendedLuminance < threshold) {
                const targetOffset = 8 + y * bytesPerRow + Math.floor(x / 8)
                payload[targetOffset] |= 0x80 >> (x % 8)
            }
        }
    }

    return payload
}

export function appendEscPosFeedAndCut(payload: Uint8Array, feedLines = 3): Uint8Array {
    const lines = Math.max(0, Math.min(255, Math.trunc(feedLines)))
    const completed = new Uint8Array(payload.length + 6)
    completed.set(payload)
    completed.set([0x1b, 0x64, lines, 0x1d, 0x56, 0x00], payload.length)
    return completed
}
