import { formatCurrency } from '@/lib/utils'
import type { CurrencyCode, IQDDisplayPreference } from '@/local-db'
import type { CommissionCurrencyTotals } from './agentCommissionPresentation'

export function CommissionCurrencyTotalsView({
    totals,
    iqdPreference,
    emptyLabel = '—',
    valueClassName
}: {
    totals: CommissionCurrencyTotals
    iqdPreference: IQDDisplayPreference
    emptyLabel?: string
    valueClassName?: string
}) {
    const rows = Object.entries(totals).filter(([, amount]) => Math.abs(amount) > 0.000001)
    if (rows.length === 0) return <span className={valueClassName}>{emptyLabel}</span>

    return (
        <span className={valueClassName}>
            {rows.map(([currency, amount], index) => (
                <span key={currency} className="whitespace-nowrap">
                    {index > 0 ? <span className="mx-1 text-muted-foreground">+</span> : null}
                    {formatCurrency(amount, currency as CurrencyCode, iqdPreference)}
                </span>
            ))}
        </span>
    )
}
