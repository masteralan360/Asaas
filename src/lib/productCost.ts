/**
 * A zero cost is legitimate. Only null, missing, non-finite, or negative
 * values mean that a product does not have a usable cost basis.
 */
export function hasValidProductCost(costPrice: unknown): costPrice is number {
    return typeof costPrice === 'number'
        && Number.isFinite(costPrice)
        && costPrice >= 0
}

export function getMissingProductCostMessage(productName?: string | null) {
    return productName
        ? `${productName} cannot be sold until a cost is added.`
        : 'This product cannot be sold until a cost is added.'
}

export function getMissingPriceBookCostMessage(productName?: string | null, priceBookName?: string | null) {
    const product = productName || 'This product'
    const priceBook = priceBookName ? ` in ${priceBookName}` : ''
    return `${product} cannot be sold to this business partner until a Price Book cost is added${priceBook}.`
}
