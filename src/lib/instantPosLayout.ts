export const INSTANT_POS_PRODUCTS_PER_ROW_KEY = 'instant_pos_products_per_row'
export const DEFAULT_INSTANT_POS_PRODUCTS_PER_ROW = 4

const MIN_PRODUCTS_PER_ROW = 2
const MAX_PRODUCTS_PER_ROW = 8

export function normalizeInstantPosProductsPerRow(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
    if (!Number.isInteger(parsed) || parsed < MIN_PRODUCTS_PER_ROW || parsed > MAX_PRODUCTS_PER_ROW) {
        return DEFAULT_INSTANT_POS_PRODUCTS_PER_ROW
    }

    return parsed
}

export function readInstantPosProductsPerRow() {
    return normalizeInstantPosProductsPerRow(localStorage.getItem(INSTANT_POS_PRODUCTS_PER_ROW_KEY))
}

export function saveInstantPosProductsPerRow(value: number) {
    const normalized = normalizeInstantPosProductsPerRow(value)
    localStorage.setItem(INSTANT_POS_PRODUCTS_PER_ROW_KEY, String(normalized))
    return normalized
}
