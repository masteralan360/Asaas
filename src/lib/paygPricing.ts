export const PAYG_BYTES_PER_GB = 1_000_000_000
export const PAYG_MAX_GB = 100

export interface PaygPricingCheckpoint {
    gb: number
    amountIqd: number
    protected: boolean
}

export const DEFAULT_PAYG_PRICING_CHECKPOINTS: PaygPricingCheckpoint[] = [
    { gb: 1, amountIqd: 0, protected: true },
    { gb: 10, amountIqd: 15_000, protected: true },
    { gb: 100, amountIqd: 40_000, protected: true }
]

export function validatePaygPricingCheckpoints(
    checkpoints: PaygPricingCheckpoint[]
): string | null {
    if (checkpoints.length < 3) return 'atLeastThreeCheckpoints'

    const sorted = [...checkpoints].sort((left, right) => left.gb - right.gb)
    if (sorted.some(({ gb, amountIqd }) => (
        !Number.isFinite(gb)
        || gb < 1
        || gb > PAYG_MAX_GB
        || !Number.isInteger(amountIqd)
        || amountIqd < 0
    ))) return 'invalidCheckpoint'
    if (new Set(sorted.map(({ gb }) => gb)).size !== sorted.length) return 'duplicateGb'
    if (sorted.some((checkpoint, index) => (
        index > 0 && checkpoint.amountIqd < sorted[index - 1].amountIqd
    ))) return 'amountMustNotDecrease'

    const protectedValues = new Map(sorted.map(({ gb, amountIqd }) => [gb, amountIqd]))
    if (
        protectedValues.get(1) !== 0
        || protectedValues.get(10) !== 15_000
        || protectedValues.get(100) !== 40_000
    ) return 'protectedCheckpointsRequired'

    return null
}

export function calculatePaygAmountFromGb(
    usageGb: number,
    checkpoints: PaygPricingCheckpoint[] = DEFAULT_PAYG_PRICING_CHECKPOINTS
): number {
    if (!Number.isFinite(usageGb) || usageGb < 0 || usageGb > PAYG_MAX_GB) {
        throw new RangeError('PAYG usage must be between 0 GB and 100 GB')
    }
    if (validatePaygPricingCheckpoints(checkpoints)) {
        throw new RangeError('PAYG pricing schedule is invalid')
    }
    if (usageGb <= 1) return 0

    const sorted = [...checkpoints].sort((left, right) => left.gb - right.gb)
    const upperIndex = sorted.findIndex(({ gb }) => gb >= usageGb)
    const upper = sorted[upperIndex]
    const lower = sorted[Math.max(0, upperIndex - 1)]
    if (lower.gb === upper.gb) return Math.round(lower.amountIqd)

    const interpolated = lower.amountIqd
        + ((usageGb - lower.gb) * (upper.amountIqd - lower.amountIqd))
        / (upper.gb - lower.gb)
    return Math.round(interpolated)
}

export function calculatePaygAmountFromBytes(
    chargedUsageBytes: number,
    checkpoints: PaygPricingCheckpoint[] = DEFAULT_PAYG_PRICING_CHECKPOINTS
): number {
    if (!Number.isSafeInteger(chargedUsageBytes) || chargedUsageBytes < 0) {
        throw new RangeError('PAYG charged usage must be a non-negative safe integer')
    }
    return calculatePaygAmountFromGb(chargedUsageBytes / PAYG_BYTES_PER_GB, checkpoints)
}

export function getPaygInterpolationSegment(
    usageGb: number,
    checkpoints: PaygPricingCheckpoint[]
): { lower: PaygPricingCheckpoint; upper: PaygPricingCheckpoint } {
    const sorted = [...checkpoints].sort((left, right) => left.gb - right.gb)
    const normalizedUsage = Math.min(PAYG_MAX_GB, Math.max(1, usageGb))
    const upperIndex = Math.max(0, sorted.findIndex(({ gb }) => gb >= normalizedUsage))
    return {
        lower: sorted[Math.max(0, upperIndex - 1)],
        upper: sorted[upperIndex]
    }
}
