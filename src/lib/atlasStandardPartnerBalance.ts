import type { PartnerAccountStatementClosingBalance } from '@/lib/partnerAccountStatement'
import type { IQDDisplayPreference } from '@/local-db'
import { formatCurrency } from '@/lib/utils'

/** Formats the Partner Account Statement's per-currency balances for Atlas Standard invoices. */
export function formatAtlasStandardPartnerCurrentBalance(
    balances: PartnerAccountStatementClosingBalance[] | undefined,
    iqdPreference: IQDDisplayPreference | undefined
) {
    if (!balances || balances.length === 0) return '-'

    return balances
        .map(({ currency, closingBalance }) => formatCurrency(closingBalance, currency, iqdPreference))
        .join(' • ')
}
