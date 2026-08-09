export class DuplicateProductSkuError extends Error {
    readonly code = 'PRODUCT_SKU_DUPLICATE'

    constructor(message = 'This SKU is already used by another product group. It may only be shared by a parent product and its direct variants.') {
        super(message)
        this.name = 'DuplicateProductSkuError'
    }
}

/**
 * Produces the canonical key used to compare SKUs. SKU values remain
 * display-preserving; this key only exists for catalog lookups.
 */
export function normalizeProductSku(value?: string | null): string {
    return value?.trim().toLowerCase() ?? ''
}

export function trimProductSku(value: string): string {
    return value.trim()
}
