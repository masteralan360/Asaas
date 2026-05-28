import { useMemo, useState } from 'react'
import { Link, useLocation, useRoute } from 'wouter'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Building2, CalendarClock, HandCoins, MapPin, Plus, Search } from 'lucide-react'

import { useAuth } from '@/auth'
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import {
    type RealEstateInstallment,
    type PaymentObligation,
    type PaymentTransaction,
    type RealEstateTransaction,
    recordObligationSettlement,
    useRealEstateInstallments,
    useRealEstatePayments,
    useRealEstateTransaction,
    useRealEstateTransactions,
    usePaymentTransactions
} from '@/local-db'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Input,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    useToast
} from '@/ui/components'
import { CreateRealEstateTransactionModal } from '@/ui/components/real-estate/CreateRealEstateTransactionModal'
import { RecordRealEstatePaymentModal } from '@/ui/components/real-estate/RecordRealEstatePaymentModal'
import { SettlementDialog } from '@/ui/components/payments/SettlementDialog'
import { useWorkspace } from '@/workspace'

type RealEstateFilter = 'all' | 'active' | 'overdue' | 'completed' | 'installments'

function statusClass(status: string) {
    if (status === 'completed' || status === 'paid') {
        return 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
    }
    if (status === 'overdue') {
        return 'bg-red-500/15 text-red-700 dark:text-red-300'
    }
    if (status === 'partial') {
        return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
    }
    return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
}

function currencySummary(
    transactions: RealEstateTransaction[],
    key: 'balanceAmount' | 'profitAmount',
    iqdPreference: string
) {
    const totals = new Map<RealEstateTransaction['currency'], number>()
    for (const transaction of transactions) {
        totals.set(transaction.currency, (totals.get(transaction.currency) || 0) + (transaction[key] || 0))
    }

    const entries = Array.from(totals.entries()).filter(([, amount]) => amount !== 0)
    if (entries.length === 0) {
        return '-'
    }

    return entries
        .map(([currency, amount]) => formatCurrency(amount, currency, iqdPreference as any))
        .join(' / ')
}

function formatWitnessDetails(name?: string | null, address?: string | null, phone?: string | null) {
    const parts = [name, address, phone]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))

    return parts.length > 0 ? parts.join(' / ') : null
}

function sumTransactions(rows: PaymentTransaction[]) {
    return rows.reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0)
}

function filterActiveTransactions(rows: PaymentTransaction[]) {
    const reversedIds = new Set(
        rows
            .filter((row) => !row.isDeleted && !!row.reversalOfTransactionId)
            .map((row) => row.reversalOfTransactionId as string)
    )

    return rows.filter((row) =>
        !row.isDeleted
        && !row.reversalOfTransactionId
        && !reversedIds.has(row.id)
    )
}

export function RealEstate() {
    const { t } = useTranslation()
    const { user } = useAuth()
    const { features } = useWorkspace()
    const [, navigate] = useLocation()
    const [detailMatch, params] = useRoute('/real-estate/:transactionId')
    const workspaceId = user?.workspaceId
    const transactions = useRealEstateTransactions(workspaceId)
    const [createOpen, setCreateOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<RealEstateFilter>('all')
    const [paymentTarget, setPaymentTarget] = useState<{
        transaction: RealEstateTransaction
        installment?: RealEstateInstallment | null
    } | null>(null)

    const filteredTransactions = useMemo(() => {
        const query = search.trim().toLowerCase()
        return transactions.filter((transaction) => {
            if (filter === 'active' && transaction.status !== 'active') return false
            if (filter === 'overdue' && transaction.status !== 'overdue') return false
            if (filter === 'completed' && transaction.status !== 'completed') return false
            if (filter === 'installments' && !transaction.isInstallmentBased) return false
            if (!query) return true

            return [
                transaction.transactionNo,
                transaction.location,
                transaction.buyerName,
                transaction.sellerName,
                transaction.transactionType,
                transaction.propertyType,
                transaction.status
            ].some((value) => value ? value.toLowerCase().includes(query) : false)
        })
    }, [filter, search, transactions])

    const metrics = useMemo(() => {
        const active = transactions.filter((transaction) => transaction.status !== 'completed')
        return {
            totalCount: transactions.length,
            activeCount: active.length,
            installmentCount: transactions.filter((transaction) => transaction.isInstallmentBased).length,
            openBalance: currencySummary(active, 'balanceAmount', features.iqd_display_preference),
            profit: currencySummary(transactions, 'profitAmount', features.iqd_display_preference)
        }
    }, [features.iqd_display_preference, transactions])

    if (!workspaceId) {
        return null
    }

    if (detailMatch && params?.transactionId) {
        return (
            <RealEstateDetails
                transactionId={params.transactionId}
                onOpenPayment={(transaction, installment) => setPaymentTarget({ transaction, installment })}
                paymentTarget={paymentTarget}
                onPaymentTargetChange={setPaymentTarget}
            />
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                        <Building2 className="h-7 w-7" />
                        {t('realEstate.title', { defaultValue: 'Real Estate' })}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {t('realEstate.subtitle', { defaultValue: 'Manual property transactions with partner links, multi-currency totals, and installment schedules.' })}
                    </p>
                </div>
                <Button className="gap-2" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t('realEstate.create', { defaultValue: 'Create Transaction' })}
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard title={t('realEstate.metrics.total', { defaultValue: 'Transactions' })} value={String(metrics.totalCount)} />
                <MetricCard title={t('realEstate.metrics.active', { defaultValue: 'Active Deals' })} value={String(metrics.activeCount)} />
                <MetricCard title={t('realEstate.metrics.openBalance', { defaultValue: 'Open Balance' })} value={metrics.openBalance} />
                <MetricCard title={t('realEstate.metrics.profit', { defaultValue: 'Commission' })} value={metrics.profit} />
                <MetricCard title={t('realEstate.metrics.installments', { defaultValue: 'Installment Deals' })} value={String(metrics.installmentCount)} />
            </div>

            <Card>
                <CardContent className="space-y-4 pt-6">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="relative w-full xl:max-w-md">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder={t('realEstate.searchPlaceholder', { defaultValue: 'Search transactions...' })}
                                className="pl-9"
                            />
                        </div>
                        <Tabs value={filter} onValueChange={(value) => setFilter(value as RealEstateFilter)}>
                            <TabsList className="grid w-full grid-cols-5 xl:w-auto">
                                <TabsTrigger value="all">{t('common.all', { defaultValue: 'All' })}</TabsTrigger>
                                <TabsTrigger value="active">{t('realEstate.statuses.active', { defaultValue: 'Active' })}</TabsTrigger>
                                <TabsTrigger value="overdue">{t('realEstate.statuses.overdue', { defaultValue: 'Overdue' })}</TabsTrigger>
                                <TabsTrigger value="completed">{t('realEstate.statuses.completed', { defaultValue: 'Completed' })}</TabsTrigger>
                                <TabsTrigger value="installments">{t('nav.installments', { defaultValue: 'Installments' })}</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('realEstate.table.transaction', { defaultValue: 'Transaction' })}</TableHead>
                                    <TableHead>{t('realEstate.propertyType', { defaultValue: 'Property' })}</TableHead>
                                    <TableHead>{t('realEstate.location', { defaultValue: 'Location' })}</TableHead>
                                    <TableHead>{t('realEstate.table.parties', { defaultValue: 'Parties' })}</TableHead>
                                    <TableHead className="text-end">{t('realEstate.total', { defaultValue: 'Total' })}</TableHead>
                                    <TableHead className="text-end">{t('loans.balance', { defaultValue: 'Balance' })}</TableHead>
                                    <TableHead>{t('loans.status', { defaultValue: 'Status' })}</TableHead>
                                    <TableHead className="text-end">{t('common.actions', { defaultValue: 'Actions' })}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredTransactions.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                                            {t('realEstate.empty', { defaultValue: 'No real estate transactions found.' })}
                                        </TableCell>
                                    </TableRow>
                                ) : filteredTransactions.map((transaction) => (
                                    <TableRow key={transaction.id}>
                                        <TableCell>
                                            <div className="font-semibold">{transaction.transactionNo}</div>
                                            <div className="text-xs uppercase text-muted-foreground">{t(`realEstate.types.${transaction.transactionType}`, { defaultValue: transaction.transactionType })}</div>
                                        </TableCell>
                                        <TableCell>
                                            {transaction.propertyType ? (
                                                <div className="text-sm">{t(`realEstate.propertyTypes.${transaction.propertyType}`, { defaultValue: transaction.propertyType })}</div>
                                            ) : (
                                                <div className="text-xs text-muted-foreground">-</div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="max-w-[18rem] truncate">{transaction.location}</div>
                                            {transaction.landAreaM2 > 0 ? (
                                                <div className="text-xs text-muted-foreground">{transaction.landAreaM2.toLocaleString()} m2</div>
                                            ) : null}
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-sm">{transaction.buyerName}</div>
                                            <div className="text-xs text-muted-foreground">{transaction.sellerName}</div>
                                        </TableCell>
                                        <TableCell className="text-end font-medium">{formatCurrency(transaction.totalAmount, transaction.currency, features.iqd_display_preference)}</TableCell>
                                        <TableCell className="text-end font-semibold">{formatCurrency(transaction.balanceAmount, transaction.currency, features.iqd_display_preference)}</TableCell>
                                        <TableCell>
                                            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', statusClass(transaction.status))}>
                                                {t(`realEstate.statuses.${transaction.status}`, { defaultValue: transaction.status })}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-end">
                                            <div className="flex justify-end gap-2">
                                                {transaction.balanceAmount > 0 && user?.role !== 'viewer' ? (
                                                    <Button variant="ghost" size="sm" onClick={() => setPaymentTarget({ transaction, installment: null })}>
                                                        {t('realEstate.recordContractPayment', { defaultValue: 'Record Payment' })}
                                                    </Button>
                                                ) : null}
                                                <Button variant="outline" size="sm" onClick={() => navigate(`/real-estate/${transaction.id}`)}>
                                                    {t('common.view', { defaultValue: 'View' })}
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <CreateRealEstateTransactionModal
                isOpen={createOpen}
                onOpenChange={setCreateOpen}
                workspaceId={workspaceId}
                settlementCurrency={features.default_currency}
                onCreated={(transactionId) => navigate(`/real-estate/${transactionId}`)}
            />
            <RecordRealEstatePaymentModal
                isOpen={paymentTarget !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setPaymentTarget(null)
                    }
                }}
                transaction={paymentTarget?.transaction ?? null}
                installment={paymentTarget?.installment ?? null}
            />
        </div>
    )
}

function RealEstateDetails({
    transactionId,
    onOpenPayment,
    paymentTarget,
    onPaymentTargetChange
}: {
    transactionId: string
    onOpenPayment: (transaction: RealEstateTransaction, installment?: RealEstateInstallment | null) => void
    paymentTarget: { transaction: RealEstateTransaction; installment?: RealEstateInstallment | null } | null
    onPaymentTargetChange: (target: { transaction: RealEstateTransaction; installment?: RealEstateInstallment | null } | null) => void
}) {
    const { t } = useTranslation()
    const { features } = useWorkspace()
    const { toast } = useToast()
    const { user } = useAuth()
    const transaction = useRealEstateTransaction(transactionId)
    const installments = useRealEstateInstallments(transactionId, transaction?.workspaceId)
    const payments = useRealEstatePayments(transactionId, transaction?.workspaceId)
    const commissionTransactions = usePaymentTransactions(transaction?.workspaceId, {
        sourceModule: 'real_estate',
        sourceType: 'real_estate_commission',
        includeReversals: true
    })
    const [isCommissionOpen, setIsCommissionOpen] = useState(false)
    const [isSubmittingCommission, setIsSubmittingCommission] = useState(false)

    const transactionCommissionPayments = useMemo(
        () => filterActiveTransactions(commissionTransactions.filter((payment) => payment.sourceRecordId === transactionId)),
        [commissionTransactions, transactionId]
    )
    const commissionPaid = useMemo(
        () => sumTransactions(transactionCommissionPayments),
        [transactionCommissionPayments]
    )
    const commissionBalance = transaction ? Math.max((transaction.profitAmount || 0) - commissionPaid, 0) : 0
    const commissionObligation = useMemo<PaymentObligation | null>(() => {
        if (!transaction || commissionBalance <= 0) {
            return null
        }

        const businessPartnerId = transaction.buyerBusinessPartnerId || transaction.sellerBusinessPartnerId || null
        return {
            id: `real-estate-commission:${transaction.id}`,
            workspaceId: transaction.workspaceId,
            sourceModule: 'real_estate',
            sourceType: 'real_estate_commission',
            sourceRecordId: transaction.id,
            sourceSubrecordId: null,
            direction: 'incoming',
            amount: commissionBalance,
            currency: transaction.currency,
            dueDate: transaction.createdAt.slice(0, 10),
            counterpartyName: transaction.buyerName || transaction.sellerName,
            referenceLabel: `${transaction.transactionNo} / Commission`,
            title: transaction.location,
            subtitle: t('realEstate.mediatorCommission', { defaultValue: 'Mediator commission' }),
            status: 'open',
            routePath: `/real-estate/${transaction.id}`,
            metadata: {
                realEstateTransactionId: transaction.id,
                transactionType: transaction.transactionType,
                propertyLocation: transaction.location,
                businessPartnerId
            }
        }
    }, [commissionBalance, t, transaction])

    const handleCommissionSettle = async (input: {
        paymentMethod: PaymentTransaction['paymentMethod']
        paidAt: string
        note?: string
        counterpartyName?: string
        businessPartnerId?: string | null
    }) => {
        if (!commissionObligation) {
            return
        }

        setIsSubmittingCommission(true)
        try {
            await recordObligationSettlement(commissionObligation.workspaceId, commissionObligation, {
                paymentMethod: input.paymentMethod,
                paidAt: input.paidAt,
                note: input.note,
                counterpartyName: input.counterpartyName,
                businessPartnerId: input.businessPartnerId,
                createdBy: user?.id ?? null
            })
            toast({
                title: t('common.success', { defaultValue: 'Success' }),
                description: t('realEstate.messages.commissionRecorded', { defaultValue: 'Commission payment recorded.' })
            })
            setIsCommissionOpen(false)
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || t('realEstate.messages.commissionFailed', { defaultValue: 'Failed to record commission payment.' }),
                variant: 'destructive'
            })
        } finally {
            setIsSubmittingCommission(false)
        }
    }

    if (!transaction || transaction.isDeleted) {
        return (
            <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                    {t('realEstate.notFound', { defaultValue: 'Real estate transaction not found.' })}
                </CardContent>
            </Card>
        )
    }

    const paidPercent = transaction.totalAmount > 0
        ? Math.min(100, (transaction.paidAmount / transaction.totalAmount) * 100)
        : 0
    const buyerWitnessDetails = formatWitnessDetails(transaction.buyerWitnessName, transaction.buyerWitnessAddress, transaction.buyerWitnessPhone)
    const sellerWitnessDetails = formatWitnessDetails(transaction.sellerWitnessName, transaction.sellerWitnessAddress, transaction.sellerWitnessPhone)

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Link href="/real-estate" className="inline-flex items-center gap-1 hover:text-foreground">
                        <ArrowLeft className="h-4 w-4" />
                        {t('realEstate.title', { defaultValue: 'Real Estate' })}
                    </Link>
                    <span>/</span>
                    <span className="font-semibold text-foreground">{transaction.transactionNo}</span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    {commissionBalance > 0 && user?.role !== 'viewer' ? (
                        <Button className="gap-2" onClick={() => setIsCommissionOpen(true)}>
                            <HandCoins className="h-4 w-4" />
                            {t('realEstate.recordCommission', { defaultValue: 'Record Commission' })}
                        </Button>
                    ) : null}
                    {transaction.balanceAmount > 0 && user?.role !== 'viewer' ? (
                        <Button variant="outline" className="gap-2" onClick={() => onOpenPayment(transaction, null)}>
                            <HandCoins className="h-4 w-4" />
                            {t('realEstate.recordContractPayment', { defaultValue: 'Record Contract Payment' })}
                        </Button>
                    ) : null}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <MapPin className="h-5 w-5" />
                            {transaction.location}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        <InfoRow label={t('realEstate.transactionType', { defaultValue: 'Transaction Type' })} value={t(`realEstate.types.${transaction.transactionType}`, { defaultValue: transaction.transactionType })} />
                        {transaction.propertyType ? (
                            <InfoRow label={t('realEstate.propertyType', { defaultValue: 'Property Type' })} value={t(`realEstate.propertyTypes.${transaction.propertyType}`, { defaultValue: transaction.propertyType })} />
                        ) : null}
                        <InfoRow label={t('realEstate.buyer', { defaultValue: 'Buyer' })} value={transaction.buyerName} />
                        {buyerWitnessDetails ? (
                            <InfoRow
                                label={t('realEstate.buyerWitness', { defaultValue: 'Buyer Witness' })}
                                value={buyerWitnessDetails}
                            />
                        ) : null}
                        <InfoRow label={t('realEstate.seller', { defaultValue: 'Seller' })} value={transaction.sellerName} />
                        {sellerWitnessDetails ? (
                            <InfoRow
                                label={t('realEstate.sellerWitness', { defaultValue: 'Seller Witness' })}
                                value={sellerWitnessDetails}
                            />
                        ) : null}
                        <InfoRow label={t('realEstate.landArea', { defaultValue: 'Land Area (m2)' })} value={transaction.landAreaM2 > 0 ? `${transaction.landAreaM2.toLocaleString()} m2` : '-'} />
                        <InfoRow label={t('realEstate.profitAmount', { defaultValue: 'Commission Amount' })} value={formatCurrency(transaction.profitAmount, transaction.currency, features.iqd_display_preference)} />
                        {transaction.notes ? (
                            <div className="rounded-xl border bg-muted/20 p-3 text-muted-foreground">{transaction.notes}</div>
                        ) : null}
                    </CardContent>
                </Card>

                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>{t('realEstate.summary', { defaultValue: 'Deal Summary' })}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <MetricCard title={t('realEstate.total', { defaultValue: 'Total' })} value={formatCurrency(transaction.totalAmount, transaction.currency, features.iqd_display_preference)} />
                            <MetricCard title={t('realEstate.contractPaid', { defaultValue: 'Contract Paid' })} value={formatCurrency(transaction.paidAmount, transaction.currency, features.iqd_display_preference)} />
                            <MetricCard title={t('loans.balance', { defaultValue: 'Balance' })} value={formatCurrency(transaction.balanceAmount, transaction.currency, features.iqd_display_preference)} />
                            <MetricCard title={t('realEstate.commissionPaid', { defaultValue: 'Commission Paid' })} value={formatCurrency(commissionPaid, transaction.currency, features.iqd_display_preference)} />
                            <MetricCard title={t('realEstate.remainingCommission', { defaultValue: 'Remaining Commission' })} value={formatCurrency(commissionBalance, transaction.currency, features.iqd_display_preference)} />
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${paidPercent}%` }} />
                        </div>
                        <div className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {Math.round(paidPercent)}% {t('loans.completedStep', { defaultValue: 'Completed' })}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="installments" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="installments">{t('realEstate.installments', { defaultValue: 'Installments' })}</TabsTrigger>
                    <TabsTrigger value="payments">{t('realEstate.contractPayments', { defaultValue: 'Contract Payments' })}</TabsTrigger>
                    <TabsTrigger value="commission">{t('realEstate.commission', { defaultValue: 'Commission' })}</TabsTrigger>
                </TabsList>

                <TabsContent value="installments">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <CalendarClock className="h-5 w-5" />
                                {t('loans.installmentSchedule', { defaultValue: 'Installment Schedule' })}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t('loans.installmentCount', { defaultValue: 'Installment' })}</TableHead>
                                            <TableHead>{t('loans.dueDate', { defaultValue: 'Due Date' })}</TableHead>
                                            <TableHead className="text-end">{t('loans.installmentPlannedAmount', { defaultValue: 'Planned' })}</TableHead>
                                            <TableHead className="text-end">{t('realEstate.paid', { defaultValue: 'Paid' })}</TableHead>
                                            <TableHead className="text-end">{t('loans.balance', { defaultValue: 'Balance' })}</TableHead>
                                            <TableHead>{t('loans.status', { defaultValue: 'Status' })}</TableHead>
                                            <TableHead className="text-end">{t('common.actions', { defaultValue: 'Actions' })}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {installments.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                                                    {t('realEstate.noInstallments', { defaultValue: 'This transaction does not have an installment schedule.' })}
                                                </TableCell>
                                            </TableRow>
                                        ) : installments.map((installment) => (
                                            <TableRow key={installment.id}>
                                                <TableCell>#{String(installment.installmentNo).padStart(2, '0')}</TableCell>
                                                <TableCell>{formatDate(installment.dueDate)}</TableCell>
                                                <TableCell className="text-end">{formatCurrency(installment.plannedAmount, transaction.currency, features.iqd_display_preference)}</TableCell>
                                                <TableCell className="text-end text-emerald-600">{formatCurrency(installment.paidAmount, transaction.currency, features.iqd_display_preference)}</TableCell>
                                                <TableCell className="text-end font-semibold">{formatCurrency(installment.balanceAmount, transaction.currency, features.iqd_display_preference)}</TableCell>
                                                <TableCell>
                                                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', statusClass(installment.status))}>
                                                        {t(`loans.installmentStatuses.${installment.status}`, { defaultValue: installment.status })}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-end">
                                                    {installment.balanceAmount > 0 && user?.role !== 'viewer' ? (
                                                        <Button variant="ghost" size="sm" onClick={() => onOpenPayment(transaction, installment)}>
                                                            {t('realEstate.recordContractPayment', { defaultValue: 'Record Payment' })}
                                                        </Button>
                                                    ) : null}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="payments">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t('payments.table.time', { defaultValue: 'Time' })}</TableHead>
                                            <TableHead>{t('payments.table.source', { defaultValue: 'Source' })}</TableHead>
                                            <TableHead className="text-end">{t('payments.table.amount', { defaultValue: 'Amount' })}</TableHead>
                                            <TableHead>{t('payments.table.note', { defaultValue: 'Note' })}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {payments.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                                                    {t('payments.noTransactions', { defaultValue: 'No transactions match the current filters.' })}
                                                </TableCell>
                                            </TableRow>
                                        ) : payments.map((payment) => (
                                            <TableRow key={payment.id}>
                                                <TableCell>{formatDateTime(payment.paidAt)}</TableCell>
                                                <TableCell>{t(`realEstate.paymentKinds.${payment.paymentKind}`, { defaultValue: payment.paymentKind })}</TableCell>
                                                <TableCell className="text-end font-semibold">{formatCurrency(payment.amount, transaction.currency, features.iqd_display_preference)}</TableCell>
                                                <TableCell>{payment.note || '-'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="commission">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between gap-3">
                                <span>{t('realEstate.commission', { defaultValue: 'Commission' })}</span>
                                {commissionBalance > 0 && user?.role !== 'viewer' ? (
                                    <Button size="sm" onClick={() => setIsCommissionOpen(true)}>
                                        {t('realEstate.recordCommission', { defaultValue: 'Record Commission' })}
                                    </Button>
                                ) : null}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                <MetricCard title={t('realEstate.profitAmount', { defaultValue: 'Commission Amount' })} value={formatCurrency(transaction.profitAmount, transaction.currency, features.iqd_display_preference)} />
                                <MetricCard title={t('realEstate.commissionPaid', { defaultValue: 'Commission Paid' })} value={formatCurrency(commissionPaid, transaction.currency, features.iqd_display_preference)} />
                                <MetricCard title={t('realEstate.remainingCommission', { defaultValue: 'Remaining Commission' })} value={formatCurrency(commissionBalance, transaction.currency, features.iqd_display_preference)} />
                            </div>
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t('payments.table.time', { defaultValue: 'Time' })}</TableHead>
                                            <TableHead>{t('payments.table.counterparty', { defaultValue: 'Counterparty' })}</TableHead>
                                            <TableHead className="text-end">{t('payments.table.amount', { defaultValue: 'Amount' })}</TableHead>
                                            <TableHead>{t('payments.table.note', { defaultValue: 'Note' })}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {transactionCommissionPayments.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                                                    {t('payments.noTransactions', { defaultValue: 'No transactions match the current filters.' })}
                                                </TableCell>
                                            </TableRow>
                                        ) : transactionCommissionPayments.map((payment) => (
                                            <TableRow key={payment.id}>
                                                <TableCell>{formatDateTime(payment.paidAt)}</TableCell>
                                                <TableCell>{payment.counterpartyName || '-'}</TableCell>
                                                <TableCell className="text-end font-semibold">{formatCurrency(payment.amount, transaction.currency, features.iqd_display_preference)}</TableCell>
                                                <TableCell>{payment.note || '-'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <RecordRealEstatePaymentModal
                isOpen={paymentTarget !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        onPaymentTargetChange(null)
                    }
                }}
                transaction={paymentTarget?.transaction ?? null}
                installment={paymentTarget?.installment ?? null}
            />
            <SettlementDialog
                open={isCommissionOpen}
                onOpenChange={setIsCommissionOpen}
                obligation={commissionObligation}
                isSubmitting={isSubmittingCommission}
                onSubmit={handleCommissionSettle}
            />
        </div>
    )
}

function MetricCard({ title, value }: { title: string; value: string }) {
    return (
        <Card>
            <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground">{title}</div>
                <div className="mt-1 text-2xl font-bold">{value}</div>
            </CardContent>
        </Card>
    )
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-2 last:border-0 last:pb-0">
            <span className="text-muted-foreground">{label}</span>
            <span className="max-w-[60%] text-right font-medium">{value}</span>
        </div>
    )
}
