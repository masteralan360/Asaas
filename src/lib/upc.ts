/**
 * Returns the UPC-A check digit for an 11-digit UPC payload.
 */
export function calculateUpcACheckDigit(payload: string): string {
    if (!/^\d{11}$/.test(payload)) {
        throw new Error('A UPC-A payload must contain exactly 11 digits.')
    }

    const total = Array.from(payload).reduce((sum, digit, index) => {
        const weight = index % 2 === 0 ? 3 : 1
        return sum + Number(digit) * weight
    }, 0)

    return String((10 - (total % 10)) % 10)
}

function getRandomByte(): number {
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        return globalThis.crypto.getRandomValues(new Uint8Array(1))[0]
    }

    return Math.floor(Math.random() * 256)
}

/**
 * Generates a 12-digit UPC-A value, including its valid check digit.
 */
export function generateRandomUpc(randomByte: () => number = getRandomByte): string {
    const payload = Array.from({ length: 11 }, () => String(Math.abs(Math.floor(randomByte())) % 10)).join('')
    return `${payload}${calculateUpcACheckDigit(payload)}`
}
