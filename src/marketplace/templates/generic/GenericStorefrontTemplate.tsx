import { StoreContactPage } from '../../pages/StoreContactPage'
import { StorePage } from '../../pages/StorePage'
import type { StorefrontTemplate, StorefrontTemplatePageProps } from '../types'

function GenericStorefrontShopPage({ slug, rules }: StorefrontTemplatePageProps) {
    return <StorePage storeSlug={slug} rules={rules} />
}

function GenericStorefrontContactPage({ slug, rules }: StorefrontTemplatePageProps) {
    return <StoreContactPage storeSlug={slug} rules={rules} />
}

/** The existing storefront, exposed as the safe fallback template. */
export const genericStorefrontTemplate = {
    id: 'generic',
    label: 'Generic storefront',
    ShopPage: GenericStorefrontShopPage,
    ContactPage: GenericStorefrontContactPage
} satisfies StorefrontTemplate
