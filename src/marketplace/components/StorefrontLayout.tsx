import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { ArrowLeft, Globe2, ShoppingBag } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/ui/components/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/components/select'
import { cn } from '@/lib/utils'

type StorefrontNavItem = 'shop' | 'new-arrivals' | 'contact'

type StorefrontLayoutProps = {
    storeName: string
    storeSlug: string
    activeItem: StorefrontNavItem
    cartCount?: number
    onCartClick?: () => void
    onShopClick?: () => void
    onNewArrivalsClick?: () => void
    children: ReactNode
}

const navButtonClass = 'relative px-1 py-2 text-sm font-bold tracking-wide text-muted-foreground transition-colors hover:text-[#00756f]'
const activeNavButtonClass = 'text-[#00756f] after:absolute after:bottom-1 after:left-1/2 after:h-0.5 after:w-full after:-translate-x-1/2 after:rounded-full after:bg-[#00756f]'

function setDocumentLanguage(language: string) {
    localStorage.setItem('i18nextLng', language)
    document.dir = language === 'ar' || language === 'ku' ? 'rtl' : 'ltr'
    document.documentElement.lang = language
}

export function StorefrontLayout({
    storeName,
    storeSlug,
    activeItem,
    cartCount = 0,
    onCartClick,
    onShopClick,
    onNewArrivalsClick,
    children
}: StorefrontLayoutProps) {
    const { t, i18n } = useTranslation()
    const isRtl = (document?.dir || 'ltr') === 'rtl'

    const changeLanguage = (language: string) => {
        i18n.changeLanguage(language)
        setDocumentLanguage(language)
    }

    const handleNewArrivalsClick = () => {
        if (onNewArrivalsClick) {
            onNewArrivalsClick()
            return
        }

        window.location.href = `/s/${storeSlug}?sort=new`
    }

    return (
        <div
            className="flex h-dvh flex-col overflow-x-hidden overflow-y-auto bg-[#f7f7fb] text-[#111827] dark:bg-[#101418] dark:text-foreground"
            style={{ fontFamily: 'Geist Variable, Inter, sans-serif' }}
        >
            <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-4 py-4 sm:px-6 lg:px-10">
                <header className="rounded-[2.5rem] border border-[#dde3ea] bg-[#f8f9fc]/95 px-5 py-4 shadow-[0_4px_16px_rgba(15,23,42,0.05)] dark:border-border/60 dark:bg-card/90">
                    <div className="grid min-h-12 items-center gap-4 lg:grid-cols-[1fr_auto_1fr]">
                        <Link
                            href="/"
                            className="inline-flex w-fit items-center gap-2 text-base font-medium text-[#00756f] transition-colors hover:text-[#005f5a]"
                        >
                            <ArrowLeft className={cn('h-5 w-5', isRtl && 'rotate-180')} />
                            {t('marketplace.backToMarketplace', { defaultValue: 'Back to Marketplace' })}
                        </Link>

                        <nav className="flex flex-wrap items-center justify-start gap-5 lg:justify-center lg:gap-8">
                            <Link
                                href={`/s/${storeSlug}`}
                                onClick={onShopClick}
                                className={cn(navButtonClass, activeItem === 'shop' && activeNavButtonClass)}
                            >
                                {t('marketplace.shop', { defaultValue: 'Shop' })}
                            </Link>
                            <button
                                type="button"
                                onClick={handleNewArrivalsClick}
                                className={cn(navButtonClass, activeItem === 'new-arrivals' && activeNavButtonClass)}
                            >
                                {t('marketplace.newArrivals', { defaultValue: 'New Arrivals' })}
                            </button>
                            <Link
                                href={`/s/${storeSlug}/contact`}
                                className={cn(navButtonClass, activeItem === 'contact' && activeNavButtonClass)}
                            >
                                {t('marketplace.contact', { defaultValue: 'Contact' })}
                            </Link>
                        </nav>

                        <div className="flex items-center justify-start gap-3 lg:justify-end">
                            <Select value={i18n.language || 'en'} onValueChange={changeLanguage}>
                                <SelectTrigger
                                    allowViewer
                                    className="h-10 w-[92px] rounded-full border-0 bg-transparent px-2 text-[#3f4a48] shadow-none focus:ring-0 focus:ring-offset-0 dark:text-foreground"
                                    aria-label={t('marketplace.language', { defaultValue: 'Language' })}
                                >
                                    <div className="flex items-center gap-2">
                                        <Globe2 className="h-4 w-4" />
                                        <SelectValue />
                                    </div>
                                </SelectTrigger>
                                <SelectContent className="rounded-xl">
                                    <SelectItem value="en">EN</SelectItem>
                                    <SelectItem value="ar">AR</SelectItem>
                                    <SelectItem value="ku">KU</SelectItem>
                                </SelectContent>
                            </Select>

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={onCartClick}
                                className="relative rounded-full text-[#3f4a48] hover:bg-[#dcebe8] dark:text-foreground"
                                aria-label={t('marketplace.cart.title', { defaultValue: 'Your Order' })}
                            >
                                <ShoppingBag className="h-5 w-5" />
                                {cartCount > 0 && (
                                    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#00756f] px-1 text-[10px] font-black text-white">
                                        {cartCount}
                                    </span>
                                )}
                            </Button>
                        </div>
                    </div>
                </header>

                <main className="flex-1 py-8">
                    {children}
                </main>
            </div>

            <footer className="w-full border-t border-[#dfe4e9] bg-white dark:border-border dark:bg-card">
                <div className="mx-auto max-w-[1480px] space-y-2 px-4 py-8 sm:px-6 lg:px-10">
                    <h2 className="text-2xl font-semibold">{storeName}</h2>
                    <p className="text-sm text-[#4d5856] dark:text-muted-foreground">
                        {t('marketplace.storefrontCopyright', {
                                defaultValue: '© 2026 {{storeName}}. Part of the Atlas ERP System.',
                            storeName
                        })}
                    </p>
                </div>
            </footer>
        </div>
    )
}
