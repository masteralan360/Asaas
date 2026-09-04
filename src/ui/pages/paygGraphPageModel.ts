import {
    calculatePaygAmountFromGb,
    PAYG_MAX_GB,
    type PaygPricingCheckpoint,
    validatePaygPricingCheckpoints,
} from '@/lib/paygPricing'

export const PAYG_MAX_IQD = 40_000
export interface PaygGraphBounds {
    width: number
    height: number
    left: number
    right: number
    top: number
    bottom: number
}

export const PAYG_GRAPH = {
    width: 800,
    height: 190,
    left: 24,
    right: 776,
    top: 12,
    bottom: 164,
} as const satisfies PaygGraphBounds

export const PAYG_MOBILE_GRAPH = {
    width: 360,
    height: 230,
    left: 42,
    right: 330,
    top: 18,
    bottom: 190,
} as const satisfies PaygGraphBounds

/** Resolve any vertical column inside the plot, regardless of distance from the curve. */
export function getPaygGraphHoverGb(
    x: number,
    y: number,
    graph: PaygGraphBounds = PAYG_GRAPH,
): number | null {
    const { left, right, top, bottom } = graph
    if (
        !Number.isFinite(x)
        || !Number.isFinite(y)
        || x < left
        || x > right
        || y < top
        || y > bottom
    ) return null

    return Number((
        (x - left)
        / (right - left)
        * PAYG_MAX_GB
    ).toFixed(6))
}

/** Match Atlas billing while returning null for UI input that is not calculable. */
export function calculatePaygPreviewAmount(
    gb: number,
    checkpoints: PaygPricingCheckpoint[],
): number | null {
    if (
        !Number.isFinite(gb)
        || gb < 0
        || gb > PAYG_MAX_GB
        || validatePaygPricingCheckpoints(checkpoints)
    ) return null

    return calculatePaygAmountFromGb(gb, checkpoints)
}

/** Invert the continuous curve. Equal-price segments resolve to their highest GB. */
export function calculatePaygPreviewGb(
    amount: number,
    checkpoints: PaygPricingCheckpoint[],
): number | null {
    if (
        !Number.isInteger(amount)
        || amount < 0
        || amount > PAYG_MAX_IQD
        || validatePaygPricingCheckpoints(checkpoints)
    ) return null

    const sorted = [...checkpoints].sort((left, right) => left.gb - right.gb)
    const upperIndex = sorted.findIndex((point) => point.amountIqd > amount)
    if (upperIndex === -1) return PAYG_MAX_GB

    const lower = sorted[upperIndex - 1]
    const upper = sorted[upperIndex]
    return lower.gb
        + (amount - lower.amountIqd)
        * (upper.gb - lower.gb)
        / (upper.amountIqd - lower.amountIqd)
}

/** Keep empty and partially typed decimals while displaying thousands separators. */
export function formatPaygCalculatorInput(value: string): string | null {
    const normalized = value.replace(/,/g, '').trim()
    if (!/^-?\d*(?:\.\d*)?$/.test(normalized)) return null

    const [whole, fraction] = normalized
        .replace(/^(-?)0+(?=\d)/, '$1')
        .split('.')
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        + (fraction === undefined ? '' : `.${fraction}`)
}

export function parsePaygCalculatorInput(value: string): number | null {
    const normalized = value.replace(/,/g, '').trim()
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
}
