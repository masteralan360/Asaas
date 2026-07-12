import type { BusinessPartner, PriceBook, PriceBookItem, Product } from '@/local-db/models'

export function findPartnerProductPriceBookItem(
    enabled: boolean,
    partner: Pick<BusinessPartner, 'priceBookId'> | null | undefined,
    product: Pick<Product, 'id'> | string | null | undefined,
    priceBooks: readonly PriceBook[],
    priceBookItems: readonly PriceBookItem[]
) {
    if (!enabled || !partner?.priceBookId || !product) {
        return undefined
    }

    const productId = typeof product === 'string' ? product : product.id
    const hasActiveBook = priceBooks.some((book) => (
        book.id === partner.priceBookId && !book.isDeleted
    ))
    if (!hasActiveBook) {
        return undefined
    }

    return priceBookItems.find((item) => (
        !item.isDeleted
        && item.priceBookId === partner.priceBookId
        && item.productId === productId
    ))
}
