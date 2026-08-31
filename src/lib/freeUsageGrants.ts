const BYTES_PER_GB = 1_000_000_000n

function toNonNegativeBigInt(value: bigint | string | number, label: string) {
    try {
        const normalized = BigInt(value)
        if (normalized < 0n) throw new Error('negative')
        return normalized
    } catch {
        throw new RangeError(`${label} must be a non-negative integer byte value`)
    }
}

/**
 * Mirrors the database clamp used by a free-usage grant. The write itself is
 * performed by the database RPC so concurrent metering cannot lose updates.
 */
export function calculateUsageAfterFreeGrant(
    currentUsageBytes: bigint | string | number,
    grantedBytes: bigint | string | number,
) {
    const current = toNonNegativeBigInt(currentUsageBytes, 'Current usage')
    const grant = toNonNegativeBigInt(grantedBytes, 'Granted usage')
    if (grant === 0n) throw new RangeError('Granted usage must be greater than zero')
    return current > grant ? current - grant : 0n
}

export function formatFreeUsageGigabytes(
    grantedBytes: bigint | string | number,
    locale?: string,
) {
    const bytes = toNonNegativeBigInt(grantedBytes, 'Granted usage')
    const wholeGb = bytes / BYTES_PER_GB
    const fractionalGb = bytes % BYTES_PER_GB
    const whole = Number(wholeGb)
    const fraction = Number(fractionalGb) / Number(BYTES_PER_GB)

    return new Intl.NumberFormat(locale || 'en', {
        maximumFractionDigits: 6,
    }).format(whole + fraction)
}

