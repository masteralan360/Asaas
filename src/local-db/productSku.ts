export class DuplicateProductSkuError extends Error {
    readonly code = 'PRODUCT_SKU_DUPLICATE'

    constructor(message = 'A product with this SKU already exists in this workspace.') {
        super(message)
        this.name = 'DuplicateProductSkuError'
    }
}

/**
 * Produces the canonical key used to compare SKUs. SKU values remain
 * display-preserving; this key only exists for lookup and uniqueness checks.
 */
export function normalizeProductSku(value?: string | null): string {
    return value?.trim().toLowerCase() ?? ''
}

export function trimProductSku(value: string): string {
    return value.trim()
}
