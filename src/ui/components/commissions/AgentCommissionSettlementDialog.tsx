import { useMemo } from 'react'
import { ClipboardList, ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
    useSalesOrders,
    type AgentCommissionEntry,
    type CurrencyCode,
    type IQDDisplayPreference,
} from '@/local-db'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogDescription,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
    Badge,
    Button,
} from '@/ui/components'
import { CommissionCurrencyTotalsView } from './CommissionCurrencyTotals'
import {
    commissionEntryOrderReference,
    commissionStatusClass,
    commissionStatusLabel,
    summarizeCommissionEntries
} from './agentCommissionPresentation'

export function AgentCommissionSettlementDialog({
    open,
    onOpenChange,
    workspaceId,
    agentName,
    entries,
    iqdPreference
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    agentName: string
    entries: AgentCommissionEntry[]
    iqdPreference: IQDDisplayPreference
}) {
    const { t } = useTranslation()
    const salesOrders = useSalesOrders(workspaceId)
    const summary = useMemo(() => summarizeCommissionEntries(entries), [entries])
    const orderNumberById = useMemo(() => new Map(salesOrders.map((order) => [order.id, order.orderNumber])), [salesOrders])
    const ledgerEntries = useMemo(() => entries
        .filter((entry) => !entry.isDeleted)
        .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()), [entries])

    return (
        <AppDialog open={open} onOpenChange={onOpenChange}>
            <AppDialogContent className="max-w-3xl">
                <AppDialogHeader>
                    <AppDialogTitle className="flex items-center gap-2">
                        <ClipboardList className="h-5 w-5 text-violet-600" />
                        {t('salesAgentCommissions.reviewAgentCommission', { name: agentName })}
                    </AppDialogTitle>
                    <AppDialogDescription>
                        {t('salesAgentCommissions.reviewDescription')}
                    </AppDialogDescription>
                </AppDialogHeader>
                <AppDialogBody className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <SummaryTile label={t('salesAgentCommissions.recognized')} totals={summary.earned} iqdPreference={iqdPreference} />
                        <SummaryTile label={t('salesAgentCommissions.paid')} totals={summary.paid} iqdPreference={iqdPreference} />
                        <SummaryTile label={t('salesAgentCommissions.due')} totals={summary.due} iqdPreference={iqdPreference} />
                    </div>

                    <section className="space-y-3" aria-label={t('salesAgentCommissions.commissionHistory')}>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <ReceiptText className="h-4 w-4 text-muted-foreground" />
                            {t('salesAgentCommissions.commissionHistory')}
                        </div>
                        {ledgerEntries.length === 0 ? (
                            <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                {t('salesAgentCommissions.entriesEmpty')}
                            </div>
                        ) : (
                            <div className="divide-y overflow-hidden rounded-2xl border">
                                {ledgerEntries.map((entry) => (
                                    <div key={entry.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-semibold">
                                                    {entry.orderId
                                                        ? commissionEntryOrderReference(entry, orderNumberById)
                                                        : entry.payoutReference || t('salesAgentCommissions.manualAdjustment')}
                                                </span>
                                                <Badge variant="outline" className={commissionStatusClass(entry.status)}>
                                                    {commissionStatusLabel(entry.status, (key) => t(key))}
                                                </Badge>
                                            </div>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {formatDateTime(entry.occurredAt)}
                                                {entry.notes ? ` · ${entry.notes}` : ''}
                                            </p>
                                        </div>
                                        <span className="font-black sm:text-end">
                                            {formatCurrency(entry.amount, entry.currency as CurrencyCode, iqdPreference)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </AppDialogBody>
                <AppDialogFooter>
                    <Button type="button" onClick={() => onOpenChange(false)}>{t('salesAgentCommissions.close')}</Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}

function SummaryTile({
    label,
    totals,
    iqdPreference
}: {
    label: string
    totals: Record<string, number>
    iqdPreference: IQDDisplayPreference
}) {
    return (
        <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
            <div className="mt-2 font-black"><CommissionCurrencyTotalsView totals={totals} iqdPreference={iqdPreference} /></div>
        </div>
    )
}
