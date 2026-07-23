import { TrendingDown, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BusinessPartner } from '@/local-db'
import { cn, formatCurrency } from '@/lib/utils'

type PartnerBalanceSummaryProps = {
    partner: Pick<BusinessPartner, 'defaultCurrency' | 'receivableBalance' | 'payableBalance'>
    iqdPreference: Parameters<typeof formatCurrency>[2]
    className?: string
    compact?: boolean
}

/**
 * The receivable/payable presentation shared by partner details and linked-order forms.
 * Balances are stored in the partner's default currency, matching PartnerDetailsView.
 */
export function PartnerBalanceSummary({ partner, iqdPreference, className, compact = false }: PartnerBalanceSummaryProps) {
    const { t } = useTranslation()

    if (compact) {
        return (
            <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
                <div className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-emerald-200/50 bg-emerald-500/[0.06] px-2 py-1 text-emerald-600 dark:text-emerald-400">
                    <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-[9px] font-bold uppercase tracking-wide">
                        {t('businessPartners.receivable', { defaultValue: 'Receivable' })}
                    </span>
                    <span className="text-xs font-black tabular-nums">
                        {formatCurrency(partner.receivableBalance || 0, partner.defaultCurrency, iqdPreference)}
                    </span>
                </div>
                <div className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-amber-200/50 bg-amber-500/[0.06] px-2 py-1 text-amber-600 dark:text-amber-400">
                    <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-[9px] font-bold uppercase tracking-wide">
                        {t('businessPartners.payable', { defaultValue: 'Payable' })}
                    </span>
                    <span className="text-xs font-black tabular-nums">
                        {formatCurrency(partner.payableBalance || 0, partner.defaultCurrency, iqdPreference)}
                    </span>
                </div>
            </div>
        )
    }

    return (
        <div className={cn('grid gap-4 sm:grid-cols-2', className)}>
            <div className="rounded-3xl border border-emerald-200/50 bg-emerald-500/[0.04] p-6">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
                    <TrendingUp className="h-5 w-5" />
                    {t('businessPartners.receivable', { defaultValue: 'Receivable' })}
                    <span className="ml-auto rounded-full border border-emerald-200/50 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        {t('businessPartners.theyOweUs', { defaultValue: 'They owe us' })}
                    </span>
                </div>
                <div className="mt-3 text-4xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(partner.receivableBalance || 0, partner.defaultCurrency, iqdPreference)}
                </div>
            </div>
            <div className="rounded-3xl border border-amber-200/50 bg-amber-500/[0.04] p-6">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
                    <TrendingDown className="h-5 w-5" />
                    {t('businessPartners.payable', { defaultValue: 'Payable' })}
                    <span className="ml-auto rounded-full border border-amber-200/50 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        {t('businessPartners.weOweThem', { defaultValue: 'We owe them' })}
                    </span>
                </div>
                <div className="mt-3 text-4xl font-black tracking-tight text-amber-600 dark:text-amber-400">
                    {formatCurrency(partner.payableBalance || 0, partner.defaultCurrency, iqdPreference)}
                </div>
            </div>
        </div>
    )
}
