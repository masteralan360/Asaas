import { useEffect, useMemo, useState } from 'react'
import { Coffee, CupSoda, GlassWater, Milk, Sparkles, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn, formatCurrency } from '@/lib/utils'

import { usePageMeta } from '../../hooks/usePageMeta'
import { useStoreCatalog } from '../../hooks/useStoreCatalog'
import { getMarketplaceAssetUrl } from '../../lib/assets'
import type { MarketplaceCategory, MarketplaceProduct } from '../../lib/marketplaceApi'
import type { StorefrontTemplate, StorefrontTemplatePageProps } from '../types'

function getCatalogIcon(categoryName: string) {
    const name = categoryName.toLowerCase()

    if (name.includes('ice') || name.includes('cold')) return GlassWater
    if (name.includes('hot') || name.includes('coffee')) return Coffee
    if (name.includes('juice') || name.includes('fruit')) return CupSoda
    if (name.includes('frappe') || name.includes('milk')) return Milk

    return Sparkles
}

function getProductPrice(product: MarketplaceProduct) {
    return typeof product.discount_price === 'number' && product.discount_price < product.price
        ? product.discount_price
        : product.price
}

function BarbadosLoadingState() {
    return (
        <div className="min-h-dvh bg-[#fbfaf8]">
            <div className="h-[76px] animate-pulse bg-[#302523]" />
            <main className="mx-auto max-w-[1500px] px-5 py-8 sm:px-8 lg:px-10">
                <div className="mb-8 flex gap-4 overflow-hidden">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="h-10 w-32 shrink-0 animate-pulse rounded-full bg-[#eadfda]" />
                    ))}
                </div>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, index) => (
                        <div key={index} className="overflow-hidden rounded-[1.25rem] bg-[#382621]">
                            <div className="aspect-[1.42] animate-pulse bg-[#574139]" />
                            <div className="space-y-3 p-5">
                                <div className="h-5 w-2/3 animate-pulse rounded bg-[#5b443b]" />
                                <div className="h-4 w-full animate-pulse rounded bg-[#5b443b]" />
                                <div className="h-4 w-20 animate-pulse rounded bg-[#5b443b]" />
                            </div>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    )
}

function BarbadosMenuPage({ slug }: StorefrontTemplatePageProps) {
    const { t, i18n } = useTranslation()
    const { catalog, isLoading, error } = useStoreCatalog(slug)
    const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
    const iqdPreference: 'IQD' | 'د.ع' = i18n.language === 'en' ? 'IQD' : 'د.ع'

    const categories = useMemo<MarketplaceCategory[]>(() => catalog?.categories ?? [], [catalog?.categories])

    useEffect(() => {
        setActiveCategoryId((currentCategoryId) => {
            if (currentCategoryId && categories.some((category) => category.id === currentCategoryId)) {
                return currentCategoryId
            }

            return categories[0]?.id ?? null
        })
    }, [categories])

    const displayedProducts = useMemo(() => {
        const products = catalog?.products ?? []
        if (!activeCategoryId) return products

        return products.filter((product) => product.category_id === activeCategoryId)
    }, [activeCategoryId, catalog?.products])

    const storeName = catalog?.store.name || 'Barbados'
    const storeDescription = catalog?.store.description || t('marketplace.storeSubtitle', {
        defaultValue: 'Explore our menu.'
    })
    const logoUrl = getMarketplaceAssetUrl(catalog?.store.logo_url)

    usePageMeta(storeName, storeDescription)

    if (isLoading) {
        return <BarbadosLoadingState />
    }

    if (error || !catalog) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-[#fbfaf8] px-5 text-center">
                <div className="max-w-md rounded-[1.5rem] bg-[#302523] p-8 text-[#fff8e8] shadow-2xl shadow-[#302523]/20">
                    <Store className="mx-auto h-8 w-8 text-[#f8cf73]" />
                    <h1 className="mt-4 text-2xl font-bold">
                        {t('marketplace.storeNotFound', { defaultValue: 'Store not found' })}
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-[#e4d8d1]">
                        {error || t('marketplace.storeNotFoundHint', { defaultValue: 'This menu is currently unavailable.' })}
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-dvh bg-[#fbfaf8] text-[#fff8e8]" style={{ fontFamily: 'Geist Variable, Inter, sans-serif' }}>
            <header className="sticky top-0 z-20 border-b border-white/5 bg-[#302523] shadow-[0_8px_22px_rgba(32,21,17,0.27)] lg:rounded-b-[1.75rem]">
                <div className="mx-auto flex min-h-[76px] max-w-[1640px] items-center gap-4 px-4 sm:px-7 lg:px-9">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#f5c967]/65 bg-[#1e1715] text-[#f8cf73]">
                        {logoUrl ? (
                            <img src={logoUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                            <span className="text-sm font-black">B</span>
                        )}
                    </div>

                    <nav aria-label={t('marketplace.categories', { defaultValue: 'Menu catalogs' })} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {categories.map((category) => {
                            const Icon = getCatalogIcon(category.name)
                            const isActive = category.id === activeCategoryId

                            return (
                                <button
                                    key={category.id}
                                    type="button"
                                    onClick={() => setActiveCategoryId(category.id)}
                                    aria-pressed={isActive}
                                    className={cn(
                                        'inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[11px] font-bold uppercase tracking-wide transition-colors sm:px-5',
                                        isActive
                                            ? 'bg-[#fee3a6] text-[#47342d]'
                                            : 'text-[#e5d9d1] hover:bg-white/10 hover:text-[#fff8e8]'
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    {category.name}
                                </button>
                            )
                        })}
                    </nav>
                </div>
            </header>

            <main className="mx-auto max-w-[1640px] px-5 py-8 pb-14 sm:px-8 lg:px-10">
                {categories.length === 0 && (
                    <div className="mb-7 flex items-center gap-3 text-[#382621]">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fee3a6] text-[#6f4c2b]">
                            <Coffee className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="text-lg font-black">{storeName}</h1>
                            <p className="text-sm text-[#765f55]">{storeDescription}</p>
                        </div>
                    </div>
                )}

                {displayedProducts.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-dashed border-[#d8c9c1] bg-white px-6 py-16 text-center text-[#5e4740]">
                        <Coffee className="mx-auto h-8 w-8 text-[#b18c61]" />
                        <p className="mt-3 text-sm font-semibold">
                            {t('marketplace.noProducts', { defaultValue: 'No menu items in this catalog yet.' })}
                        </p>
                    </div>
                ) : (
                    <section aria-label={t('marketplace.products', { defaultValue: 'Menu items' })} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {displayedProducts.map((product) => {
                            const imageUrl = getMarketplaceAssetUrl(product.image_url)
                            const price = getProductPrice(product)

                            return (
                                <article key={product.id} className="group overflow-hidden rounded-[1.25rem] bg-[#382621] shadow-[0_8px_18px_rgba(55,38,31,0.15)] transition-transform duration-200 hover:-translate-y-1">
                                    <div className="relative aspect-[1.42] overflow-hidden bg-[#513a31]">
                                        {imageUrl ? (
                                            <img
                                                src={imageUrl}
                                                alt={product.name}
                                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_50%_35%,#8b6652,transparent_25%),linear-gradient(135deg,#4d3329,#1c1513)] text-[#f8cf73]">
                                                <Coffee className="h-12 w-12 opacity-80" />
                                            </div>
                                        )}
                                    </div>

                                    <div className="min-h-[152px] p-5">
                                        <h2 className="truncate text-[17px] font-extrabold tracking-tight text-white">
                                            {product.name}
                                        </h2>
                                        {product.description && (
                                            <p className="mt-1.5 line-clamp-2 min-h-10 text-[13px] font-medium leading-5 text-[#f0dcad]">
                                                {product.description}
                                            </p>
                                        )}
                                        <p className="mt-3 text-[13px] font-black text-[#f8cf73]">
                                            {formatCurrency(price, product.currency, iqdPreference)}
                                        </p>
                                    </div>
                                </article>
                            )
                        })}
                    </section>
                )}
            </main>
        </div>
    )
}

export const barbadosStorefrontTemplate = {
    id: 'barbados',
    label: 'Barbados menu',
    ShopPage: BarbadosMenuPage,
    ContactPage: BarbadosMenuPage
} satisfies StorefrontTemplate
