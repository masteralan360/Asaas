import { Link } from 'wouter'
import { ArrowRight, Package2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/ui/components'
import { cn } from '@/lib/utils'
import type { MarketplaceStoreSummary } from '../lib/marketplaceApi'
import { getStorefrontTemplateForSlug } from '../templates/registry'
import { StoreAvatar } from './StoreAvatar'
import { StoreQrDialog } from './StoreQrDialog'

type StoreCardProps = {
    store: MarketplaceStoreSummary
    index: number
}

export function StoreCard({ store, index }: StoreCardProps) {
    const { t } = useTranslation()
    const storeHref = `/s/${store.slug}`
    const isBarbados = getStorefrontTemplateForSlug(store.slug).template.id === 'barbados'

    return (
        <Card
            className={cn(
                'group h-full overflow-hidden transition-all duration-300 hover:-translate-y-1',
                isBarbados
                    ? '!border-[#623926] !bg-[#331b10] !shadow-[0_18px_30px_rgba(8,3,1,0.18)] hover:!border-[#bd7c35] hover:!shadow-[0_26px_44px_rgba(8,3,1,0.32)]'
                    : 'border-border/60 bg-card/85 hover:border-primary/40 hover:shadow-[0_24px_60px_rgba(15,23,42,0.12)]'
            )}
            style={{ animationDelay: `${index * 70}ms` }}
        >
            <CardContent className="flex h-full flex-col gap-5 p-5">
                <div className="flex items-start justify-between gap-4">
                    <StoreAvatar
                        logoUrl={store.logo_url}
                        name={store.name}
                        className={cn(
                            'h-16 w-16',
                            isBarbados && 'rounded-full border border-[#f5bc24]/75 bg-[#1b0d07] text-[#f5bc24] ring-[#f5bc24]/30'
                        )}
                    />
                    <div
                        className={cn(
                            'rounded-full border px-3 py-1 text-xs font-semibold',
                            isBarbados
                                ? 'border-[#623926] bg-[#3a2116] text-[#f5bc24]'
                                : 'border-border/60 bg-background/80 text-muted-foreground'
                        )}
                    >
                        {store.product_count} {t('marketplace.products', { defaultValue: 'products' })}
                    </div>
                </div>

                <div className="space-y-2">
                    <h2 className={cn('text-xl font-black tracking-tight', isBarbados && 'text-[#fff4e9]')}>
                        {store.name}
                    </h2>
                    <p
                        className={cn(
                            'line-clamp-3 min-h-[3.75rem] text-sm leading-6',
                            isBarbados ? 'text-[#cdb8a7]' : 'text-muted-foreground'
                        )}
                    >
                        {store.description || t('marketplace.defaultStoreDescription', { defaultValue: 'Browse the public catalog and send an inquiry order directly to this store.' })}
                    </p>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3">
                    <div
                        className={cn(
                            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                            isBarbados
                                ? 'border-[#623926] bg-[#331b10] text-[#cdb8a7]'
                                : 'border-border/60 bg-muted/40 text-muted-foreground'
                        )}
                    >
                        <Package2 className="h-3.5 w-3.5" />
                        {store.category_count} {t('marketplace.categories', { defaultValue: 'categories' })}
                    </div>
                    <div className="flex items-center gap-2">
                        <StoreQrDialog
                            name={store.name}
                            slug={store.slug}
                            logoUrl={store.logo_url}
                            tone={isBarbados ? 'dark' : 'light'}
                            className={cn(
                                isBarbados &&
                                    'border-[#623926] bg-[#3a2116] text-[#f5bc24] hover:bg-[#4a2a1a] hover:text-[#f5bc24]'
                            )}
                        />
                        <Link
                            href={storeHref}
                            className={cn(
                                'inline-flex items-center gap-2 text-sm font-semibold transition-colors',
                                isBarbados ? 'text-[#f5bc24] hover:text-[#fff4e4]' : 'text-primary hover:text-primary/80'
                            )}
                        >
                            <span>{t('marketplace.visitStore', { defaultValue: 'Visit Store' })}</span>
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </Link>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}