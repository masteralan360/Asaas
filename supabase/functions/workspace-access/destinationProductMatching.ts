export type DestinationProductMatch = {
    id: string
    sku: string
    is_deleted?: boolean | null
    updated_at?: string | null
    created_at?: string | null
}

export type DestinationProductMatchIndex<T extends DestinationProductMatch> = {
    productBySku: Map<string, T>
    duplicateActiveSkus: Set<string>
}

function normalizeSkuKey(value?: string | null) {
    return value?.trim().toLowerCase() ?? ''
}

function productRecencyKey(product: DestinationProductMatch) {
    return `${product.updated_at ?? product.created_at ?? ''}::${product.id}`
}

export function buildDestinationProductMatchIndex<T extends DestinationProductMatch>(
    products: T[]
): DestinationProductMatchIndex<T> {
    const productBySku = new Map<string, T>()
    const duplicateActiveSkus = new Set<string>()

    for (const product of products) {
        const normalizedSku = normalizeSkuKey(product.sku)
        if (!normalizedSku) {
            continue
        }

        const existingProduct = productBySku.get(normalizedSku)
        if (!existingProduct) {
            productBySku.set(normalizedSku, product)
            continue
        }

        const existingIsDeleted = existingProduct.is_deleted === true
        const candidateIsDeleted = product.is_deleted === true

        if (!existingIsDeleted && !candidateIsDeleted) {
            duplicateActiveSkus.add(normalizedSku)
            continue
        }

        if (existingIsDeleted && !candidateIsDeleted) {
            productBySku.set(normalizedSku, product)
            continue
        }

        if (
            existingIsDeleted
            && candidateIsDeleted
            && productRecencyKey(product) > productRecencyKey(existingProduct)
        ) {
            productBySku.set(normalizedSku, product)
        }
    }

    return { productBySku, duplicateActiveSkus }
}
