/**
 * Monetary precision used by purchase and sales orders.
 *
 * Keep this separate from general currency formatting: orders may be priced
 * per fractional unit, so their stored values need three decimal places.
 */
export const ORDER_DECIMAL_PLACES = 3
export const ORDER_DECIMAL_STEP = '0.001'
export const ORDER_AMOUNT_EPSILON = 0.0005

export function roundOrderValue(value: number) {
    const multiplier = 10 ** ORDER_DECIMAL_PLACES
    return Math.round((Number(value) || 0) * multiplier) / multiplier
}
