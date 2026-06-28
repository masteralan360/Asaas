export function findBottomContentRow(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    whiteThreshold = 248
) {
    if (width <= 0 || height <= 0) return -1

    for (let y = height - 1; y >= 0; y -= 1) {
        const rowOffset = y * width * 4

        for (let x = 0; x < width; x += 1) {
            const offset = rowOffset + (x * 4)
            const alpha = pixels[offset + 3]
            if (alpha === 0) continue

            const red = pixels[offset]
            const green = pixels[offset + 1]
            const blue = pixels[offset + 2]

            if (red < whiteThreshold || green < whiteThreshold || blue < whiteThreshold) {
                return y
            }
        }
    }

    return -1
}
