import { Redirect, Route, Switch, useRoute } from 'wouter'

import { MarketplaceGallery } from './pages/MarketplaceGallery'
import { getStorefrontTemplateForSlug } from './templates/registry'

function StorefrontShopRoute() {
    const [, params] = useRoute('/s/:slug')
    const slug = params?.slug || ''
    const { template, options } = getStorefrontTemplateForSlug(slug)
    const Page = template.ShopPage

    return <Page slug={slug} options={options} />
}

function StorefrontContactRoute() {
    const [, params] = useRoute('/s/:slug/contact')
    const slug = params?.slug || ''
    const { template, options } = getStorefrontTemplateForSlug(slug)
    const Page = template.ContactPage

    return <Page slug={slug} options={options} />
}

export function MarketplaceApp() {
    return (
        <Switch>
            <Route path="/s/:slug/contact">
                <StorefrontContactRoute />
            </Route>
            <Route path="/s/:slug">
                <StorefrontShopRoute />
            </Route>
            <Route path="/">
                <MarketplaceGallery />
            </Route>
            <Route>
                <Redirect to="/" />
            </Route>
        </Switch>
    )
}
