import { StoreContactPage } from '../../pages/StoreContactPage'
import { StorePage } from '../../pages/StorePage'
import type { StorefrontTemplate, StorefrontTemplatePageProps } from '../types'

function GenericStorefrontShopPage({ slug }: StorefrontTemplatePageProps) {
    return <StorePage storeSlug={slug} />
}

function GenericStorefrontContactPage({ slug }: StorefrontTemplatePageProps) {
    return <StoreContactPage storeSlug={slug} />
}

/** The existing storefront, exposed as the safe fallback template. */
export const genericStorefrontTemplate = {
    id: 'generic',
    label: 'Generic storefront',
    ShopPage: GenericStorefrontShopPage,
    ContactPage: GenericStorefrontContactPage
} satisfies StorefrontTemplate
