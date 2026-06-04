import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useRoute } from 'wouter'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRightLeft, ClipboardList, Lock, Plus, Search, Trash2, Unlock } from 'lucide-react'

import { useAuth } from '@/auth'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { buildOrderExchangeRatesSnapshot } from '@/lib/orderCurrency'
import { cn, formatCurrency, formatDateTime, formatNumberWithCommas, formatNumericInput, parseFormattedNumber, parseLocalDateTimeValue, sanitizeNumericInput } from '@/lib/utils'
import {
    buildExchangeFeeRuleSnapshot,
    calculateExchangeTransaction,
    createExchangeFeeRule,
    createExchangeTransaction,
    deleteExchangeFeeRule,
    deleteExchangeTransaction,
    getDefaultExchangeFeeBasisAmount,
    getEffectiveExchangeRateUsed,
    getExchangeFeeBasisAmount,
    isExchangeFeeRuleEffectiveForTransaction,
    resolveEffectiveExchangeFeeRule,
    updateExchangeFeeRule,
    useExchangeFeeRules,
    useExchangeTransactions,
    type CurrencyCode,
    type ExchangeFeeRule,
    type ExchangeFeeRuleTransactionScope,
    type ExchangeFeeType,
    type ExchangePaymentMethod,
    type ExchangeRateMap,
    type ExchangeRateSnapshot,
    type ExchangeTransactionType,
    type IQDDisplayPreference
} from '@/local-db'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CurrencySelector,
    DateTimePicker,
    DeleteConfirmationModal,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Textarea,
    useToast
} from '@/ui/components'
import { useWorkspace } from '@/workspace'
import { useWorkspacePermissions } from '@/permissions'

type FeeRuleFormState = {
    name: string
    transactionScope: ExchangeFeeRuleTransactionScope
    feeType: ExchangeFeeType
    currency: CurrencyCode
    value: string
    customerGivesBasisAmount: string
    effectiveStartDate: string
    effectiveEndDate: string
    isActive: boolean
    isLocked: boolean
    notes: string
}

type MarketRateCurrency = Exclude<CurrencyCode, 'iqd'>

const paymentMethods: ExchangePaymentMethod[] = ['cash', 'fib', 'qicard', 'zaincash', 'fastpay']

function currentTimestamp() {
    return new Date().toISOString()
}

function toTimestampValue(value: Date | undefined) {
    return value ? value.toISOString() : ''
}

function calculateRulePreviewFeeAmount(feeType: ExchangeFeeType, customerGivesAmount: number, feeValue: number) {
    if (feeType === 'percentage') {
        return customerGivesAmount * feeValue / 100
    }

    return feeValue
}

function buildRateMap(
    usdRate: number,
    eurRate?: number | null,
    tryRate?: number | null
): ExchangeRateMap {
    return {
        usd: usdRate,
        eur: eurRate || undefined,
        try: tryRate || undefined
    }
}

function isMarketRateCurrency(currency: CurrencyCode): currency is MarketRateCurrency {
    return currency === 'usd' || currency === 'eur' || currency === 'try'
}

function getRateToIqd(currency: CurrencyCode, rates: ExchangeRateMap) {
    if (currency === 'iqd') return 1
    return Number(rates[currency] || 0)
}

function getPairLabel(fromCurrency: CurrencyCode, toCurrency: CurrencyCode) {
    const anchor = fromCurrency === 'iqd' ? toCurrency : fromCurrency
    if (anchor === 'iqd') return 'IQD/IQD'
    return `${anchor.toUpperCase()}/IQD`
}

function getSnapshotSource(source: string) {
    return source === 'manual' ? 'manual' : source || 'live'
}

function filterMarketSnapshotForCurrencies(snapshot: ExchangeRateSnapshot[], fromCurrency: CurrencyCode, toCurrency: CurrencyCode) {
    const needed = new Set([fromCurrency, toCurrency].filter((currency) => currency !== 'iqd').map((currency) => `${currency.toUpperCase()}/IQD`))
    return snapshot.filter((entry) => needed.has(entry.pair))
}

function makeDefaultRuleForm(currency: CurrencyCode): FeeRuleFormState {
    return {
        name: '',
        transactionScope: 'both',
        feeType: 'fixed',
        currency,
        value: '',
        customerGivesBasisAmount: String(getDefaultExchangeFeeBasisAmount(currency)),
        effectiveStartDate: currentTimestamp(),
        effectiveEndDate: '',
        isActive: true,
        isLocked: false,
        notes: ''
    }
}

function transactionTypeLabel(type: ExchangeTransactionType) {
    return type === 'buy' ? 'Buy Currency' : 'Sell Currency'
}

function feeScopeLabel(scope: ExchangeFeeRuleTransactionScope) {
    if (scope === 'buy') return 'Buy Currency'
    if (scope === 'sell') return 'Sell Currency'
    return 'Buy and Sell'
}

export function CurrencyExchange() {
    const { user } = useAuth()
    const { features } = useWorkspace()
    const { hasPermission } = useWorkspacePermissions()
    const [, navigate] = useLocation()
    const [createMatch] = useRoute('/currency-exchange/new')
    const [rulesMatch] = useRoute('/currency-exchange/rules')
    const workspaceId = user?.workspaceId
    const canAccessRules = user?.role === 'admin' || hasPermission('currencyExchangeFeeRules.access')

    if (!workspaceId) {
        return null
    }

    if (createMatch) {
        return (
            <CreateCurrencyExchangeTransactionPage
                workspaceId={workspaceId}
                onCancel={() => navigate('/currency-exchange')}
                onCreated={() => navigate('/currency-exchange')}
            />
        )
    }

    if (rulesMatch) {
        return (
            <ExchangeFeeRulesPage
                workspaceId={workspaceId}
                onBack={() => navigate('/currency-exchange')}
            />
        )
    }

    return (
        <ExchangeTransactionsPage
            workspaceId={workspaceId}
            iqdDisplayPreference={features.iqd_display_preference}
            canAccessRules={canAccessRules}
            onCreate={() => navigate('/currency-exchange/new')}
            onRules={() => navigate('/currency-exchange/rules')}
        />
    )
}

function ExchangeTransactionsPage({
    workspaceId,
    iqdDisplayPreference,
    canAccessRules,
    onCreate,
    onRules
}: {
    workspaceId: string
    iqdDisplayPreference: IQDDisplayPreference
    canAccessRules: boolean
    onCreate: () => void
    onRules: () => void
}) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const transactions = useExchangeTransactions(workspaceId)
    const [search, setSearch] = useState('')
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    const filteredTransactions = useMemo(() => {
        const query = search.trim().toLowerCase()
        if (!query) return transactions
        return transactions.filter((transaction) => [
            transaction.transactionNo,
            transaction.transactionType,
            transaction.fromCurrency,
            transaction.toCurrency,
            transaction.paymentMethod,
            transaction.employeeName,
            transaction.notes
        ].some((value) => value ? String(value).toLowerCase().includes(query) : false))
    }, [search, transactions])

    const metrics = useMemo(() => ({
        totalCount: transactions.length,
        manualRates: transactions.filter((transaction) => transaction.exchangeRateManuallyEdited).length,
        editedFees: transactions.filter((transaction) => transaction.feeEdited).length,
        totalFees: transactions.reduce((sum, transaction) => sum + Number(transaction.feeAmount || 0), 0)
    }), [transactions])

    const handleDelete = async () => {
        if (!deleteTargetId) return
        setIsDeleting(true)
        try {
            await deleteExchangeTransaction(deleteTargetId)
            toast({ title: t('common.success', { defaultValue: 'Success' }), description: 'Exchange transaction deleted.' })
            setDeleteTargetId(null)
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || 'Failed to delete exchange transaction.',
                variant: 'destructive'
            })
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                        <ArrowRightLeft className="h-7 w-7" />
                        Currency Exchange Service
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Walk-in buy and sell currency transactions with immutable rate and fee snapshots.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    {canAccessRules ? (
                        <Button type="button" variant="outline" onClick={onRules} className="gap-2">
                            <ClipboardList className="h-4 w-4" />
                            Fee/Commission Rules
                        </Button>
                    ) : null}
                    <Button type="button" onClick={onCreate} className="gap-2">
                        <Plus className="h-4 w-4" />
                        Create Transaction
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <MetricCard title="Transactions" value={String(metrics.totalCount)} />
                <MetricCard title="Manual Rates" value={String(metrics.manualRates)} />
                <MetricCard title="Edited Fees" value={String(metrics.editedFees)} />
                <MetricCard title="Fee Snapshots" value={String(metrics.totalFees.toLocaleString())} />
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <CardTitle>Exchange Transactions</CardTitle>
                        <div className="relative w-full md:w-80">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                className="pl-9"
                                placeholder="Search transactions..."
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Transaction</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Customer Gives</TableHead>
                                <TableHead>Customer Receives</TableHead>
                                <TableHead>Rate</TableHead>
                                <TableHead>Fee</TableHead>
                                <TableHead>Payment</TableHead>
                                <TableHead className="text-end">{t('common.actions', { defaultValue: 'Actions' })}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredTransactions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                                        No exchange transactions found.
                                    </TableCell>
                                </TableRow>
                            ) : filteredTransactions.map((transaction) => (
                                <TableRow key={transaction.id}>
                                    <TableCell>
                                        <div className="font-medium">{transaction.transactionNo}</div>
                                        <div className="text-xs text-muted-foreground">{formatDateTime(transaction.transactionDate)}</div>
                                        {transaction.employeeName ? (
                                            <div className="text-xs text-muted-foreground">{transaction.employeeName}</div>
                                        ) : null}
                                    </TableCell>
                                    <TableCell>{transactionTypeLabel(transaction.transactionType)}</TableCell>
                                    <TableCell>{formatCurrency(transaction.customerGivesAmount, transaction.fromCurrency, iqdDisplayPreference as any)}</TableCell>
                                    <TableCell>{formatCurrency(transaction.customerReceivesAmount, transaction.toCurrency, iqdDisplayPreference as any)}</TableCell>
                                    <TableCell>
                                        <div>{formatNumberWithCommas(transaction.exchangeRateUsed)}</div>
                                        <div className={cn(
                                            'mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                                            transaction.exchangeRateManuallyEdited ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                        )}>
                                            {transaction.exchangeRateManuallyEdited ? 'Manual' : 'Live'}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div>{transaction.feeType ? `${transaction.feeType} / ${formatCurrency(transaction.feeAmount, transaction.feeCurrency || transaction.fromCurrency, iqdDisplayPreference as any)}` : '-'}</div>
                                        {transaction.feeEdited ? (
                                            <div className="text-xs text-amber-700 dark:text-amber-300">Edited from rule</div>
                                        ) : null}
                                    </TableCell>
                                    <TableCell className="capitalize">{transaction.paymentMethod}</TableCell>
                                    <TableCell className="text-end">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => setDeleteTargetId(transaction.id)}
                                            aria-label="Delete exchange transaction"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <DeleteConfirmationModal
                isOpen={!!deleteTargetId}
                onClose={() => setDeleteTargetId(null)}
                onConfirm={handleDelete}
                itemName={transactions.find((transaction) => transaction.id === deleteTargetId)?.transactionNo}
                isLoading={isDeleting}
                title="Delete Exchange Transaction"
                description="This will remove the exchange transaction from active records while preserving sync history."
            />
        </div>
    )
}

function CreateCurrencyExchangeTransactionPage({
    workspaceId,
    onCancel,
    onCreated
}: {
    workspaceId: string
    onCancel: () => void
    onCreated: () => void
}) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { features } = useWorkspace()
    const { exchangeData, eurRates, tryRates } = useExchangeRate()
    const rules = useExchangeFeeRules(workspaceId)
    const [isSaving, setIsSaving] = useState(false)
    const [transactionType, setTransactionType] = useState<ExchangeTransactionType>('buy')
    const [fromCurrency, setFromCurrency] = useState<CurrencyCode>('iqd')
    const [toCurrency, setToCurrency] = useState<CurrencyCode>('usd')
    const [customerGivesAmount, setCustomerGivesAmount] = useState('')
    const [transactionDate, setTransactionDate] = useState(currentTimestamp())
    const [paymentMethod, setPaymentMethod] = useState<ExchangePaymentMethod>('cash')
    const [notes, setNotes] = useState('')
    const [exchangeRateValue, setExchangeRateValue] = useState('')
    const [exchangeRateSource, setExchangeRateSource] = useState('live')
    const [selectedRuleId, setSelectedRuleId] = useState<string>('none')
    const [feeValue, setFeeValue] = useState('')
    const prevPairRef = useRef(`${fromCurrency}:${toCurrency}`)

    const availableCurrencies = useMemo(() => {
        const values = new Set<CurrencyCode>([...features.allowed_currencies, features.default_currency, 'iqd', 'usd'])
        return Array.from(values)
    }, [features.allowed_currencies, features.default_currency])

    const rawUsdRate = Number(exchangeData?.rate || 0)
    const rawEurRate = Number(eurRates.eur_iqd?.rate || 0)
    const rawTryRate = Number(tryRates.try_iqd?.rate || 0)
    const parsedRate = parseFormattedNumber(exchangeRateValue || '0')
    const editedAnchorCurrency = fromCurrency === 'iqd' ? toCurrency : fromCurrency
    const ratesToIqd = useMemo(() => {
        const base = buildRateMap(rawUsdRate, rawEurRate || null, rawTryRate || null)
        if (isMarketRateCurrency(editedAnchorCurrency) && parsedRate > 0) {
            base[editedAnchorCurrency] = parsedRate
        }
        return base
    }, [editedAnchorCurrency, parsedRate, rawEurRate, rawTryRate, rawUsdRate])

    const anchorRate = useMemo(() => {
        if (fromCurrency === toCurrency) return 1
        if (fromCurrency === 'iqd') return getRateToIqd(toCurrency, ratesToIqd)
        return getRateToIqd(fromCurrency, ratesToIqd)
    }, [fromCurrency, ratesToIqd, toCurrency])

    useEffect(() => {
        const pairKey = `${fromCurrency}:${toCurrency}`
        if (prevPairRef.current !== pairKey || !exchangeRateValue) {
            prevPairRef.current = pairKey
            setExchangeRateValue(anchorRate > 0 ? formatNumberWithCommas(anchorRate) : '')
            setExchangeRateSource('live')
        }
    }, [anchorRate, exchangeRateValue, fromCurrency, toCurrency])

    const activeRule = useMemo(() => (
        resolveEffectiveExchangeFeeRule(rules, transactionType, transactionDate, fromCurrency)
    ), [fromCurrency, rules, transactionDate, transactionType])

    useEffect(() => {
        if (!activeRule) {
            setSelectedRuleId('none')
            setFeeValue('')
            return
        }

        setSelectedRuleId(activeRule.id)
        setFeeValue(String(activeRule.value))
    }, [activeRule?.id])

    const selectedRule = selectedRuleId === 'none'
        ? null
        : rules.find((rule) => rule.id === selectedRuleId) || null
    const feeType = selectedRule?.feeType ?? null
    const feeCurrency = selectedRule?.currency ?? fromCurrency
    const feeBasisAmount = selectedRule ? getExchangeFeeBasisAmount(selectedRule, feeCurrency) : getDefaultExchangeFeeBasisAmount(feeCurrency)
    const parsedFeeValue = parseFormattedNumber(feeValue || '0')
    const parsedCustomerGives = parseFormattedNumber(customerGivesAmount || '0')
    const canEditFee = !selectedRule || !selectedRule.isLocked

    const calculation = useMemo(() => {
        if (!parsedCustomerGives || fromCurrency === toCurrency || !parsedRate) {
            return null
        }

        try {
            return calculateExchangeTransaction({
                fromCurrency,
                toCurrency,
                customerGivesAmount: parsedCustomerGives,
                ratesToIqd,
                feeType,
                feeCurrency,
                feeValue: parsedFeeValue,
                feeBasisAmount
            })
        } catch {
            return null
        }
    }, [feeBasisAmount, feeCurrency, feeType, fromCurrency, parsedCustomerGives, parsedFeeValue, parsedRate, ratesToIqd, toCurrency])

    const fullMarketSnapshot = useMemo(() => buildOrderExchangeRatesSnapshot({
        exchangeData,
        eurRates,
        tryRates
    }), [exchangeData, eurRates, tryRates])

    const marketRateSnapshot = useMemo<ExchangeRateSnapshot[]>(() => {
        if (!parsedRate) return []
        if (exchangeRateSource === 'manual') {
            return [{
                pair: getPairLabel(fromCurrency, toCurrency),
                rate: parsedRate,
                source: 'manual',
                timestamp: new Date().toISOString()
            }]
        }

        const filtered = filterMarketSnapshotForCurrencies(fullMarketSnapshot, fromCurrency, toCurrency)
        return filtered.length > 0 ? filtered : [{
            pair: getPairLabel(fromCurrency, toCurrency),
            rate: parsedRate,
            source: getSnapshotSource(exchangeRateSource),
            timestamp: new Date().toISOString()
        }]
    }, [exchangeRateSource, fromCurrency, fullMarketSnapshot, parsedRate, toCurrency])

    const canSubmit = fromCurrency !== toCurrency &&
        parsedCustomerGives > 0 &&
        parsedRate > 0 &&
        Boolean(calculation) &&
        marketRateSnapshot.length > 0

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!canSubmit || isSaving || !calculation) return

        setIsSaving(true)
        try {
            await createExchangeTransaction(workspaceId, {
                transactionType,
                transactionDate,
                fromCurrency,
                toCurrency,
                customerGivesAmount: parsedCustomerGives,
                ratesToIqd,
                exchangeRateUsed: getEffectiveExchangeRateUsed(fromCurrency, toCurrency, ratesToIqd),
                exchangeRateSource,
                exchangeRateManuallyEdited: exchangeRateSource === 'manual',
                marketRateSnapshot,
                feeRuleId: selectedRule?.id ?? null,
                feeRuleSnapshot: selectedRule ? buildExchangeFeeRuleSnapshot(selectedRule) : null,
                feeType,
                feeCurrency,
                originalFeeValue: selectedRule?.value ?? null,
                finalFeeValue: parsedFeeValue,
                feeBasisAmount,
                paymentMethod,
                employeeUserId: user?.id ?? null,
                employeeName: user?.name ?? null,
                notes,
                createdBy: user?.id ?? null
            })

            toast({
                title: t('common.success', { defaultValue: 'Success' }),
                description: 'Exchange transaction created.'
            })
            onCreated()
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || 'Failed to create exchange transaction.',
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    const switchCurrencies = () => {
        setFromCurrency(toCurrency)
        setToCurrency(fromCurrency)
        setCustomerGivesAmount('')
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background">
            <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar">
                    <div className="grid gap-5 pb-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
                        <div className="space-y-5">
                        <div className="space-y-1">
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto gap-2 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                                onClick={onCancel}
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Currency Exchange Service
                            </Button>
                            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                                <ArrowRightLeft className="h-7 w-7" />
                                Create Exchange Transaction
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Record customer-gives and customer-receives values with a saved rate and fee snapshot.
                            </p>
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle>Transaction Details</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-4">
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                                        <div className="grid gap-2">
                                            <Label>Transaction Type</Label>
                                            <Select value={transactionType} onValueChange={(value: ExchangeTransactionType) => setTransactionType(value)}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="buy">Buy Currency</SelectItem>
                                                    <SelectItem value="sell">Sell Currency</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>Transaction Date</Label>
                                            <DateTimePicker
                                                id="currency-exchange-transaction-date"
                                                mode="date-time"
                                                date={parseLocalDateTimeValue(transactionDate)}
                                                setDate={(value) => setTransactionDate(toTimestampValue(value))}
                                                placeholder="Transaction Date"
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>Employee</Label>
                                            <Input value={user?.name || ''} readOnly className="bg-muted/40" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
                                        <CurrencySelector
                                            value={fromCurrency}
                                            onChange={(value) => setFromCurrency(value)}
                                            label="From Currency"
                                            iqdDisplayPreference={features.iqd_display_preference}
                                            allowedCurrencies={availableCurrencies}
                                        />
                                        <Button type="button" variant="outline" size="icon" className="mb-0.5" onClick={switchCurrencies} aria-label="Swap currencies">
                                            <ArrowRightLeft className="h-4 w-4" />
                                        </Button>
                                        <CurrencySelector
                                            value={toCurrency}
                                            onChange={(value) => setToCurrency(value)}
                                            label="To Currency"
                                            iqdDisplayPreference={features.iqd_display_preference}
                                            allowedCurrencies={availableCurrencies}
                                        />
                                    </div>

                                    {fromCurrency === toCurrency ? (
                                        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                            From currency and To currency must be different.
                                        </div>
                                    ) : null}

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <div className="grid gap-2">
                                            <Label>Customer Gives</Label>
                                            <Input
                                                type="text"
                                                inputMode={fromCurrency === 'iqd' ? 'numeric' : 'decimal'}
                                                placeholder="0"
                                                value={formatNumericInput(customerGivesAmount)}
                                                onChange={(event) => setCustomerGivesAmount(sanitizeNumericInput(event.target.value, { allowDecimal: fromCurrency !== 'iqd' }))}
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>Payment Method</Label>
                                            <Select value={paymentMethod} onValueChange={(value: ExchangePaymentMethod) => setPaymentMethod(value)}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {paymentMethods.map((method) => (
                                                        <SelectItem key={method} value={method}>{method}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>Customer Receives</Label>
                                            <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-semibold">
                                                {calculation
                                                    ? formatCurrency(calculation.customerReceivesAmount, toCurrency, features.iqd_display_preference)
                                                    : formatCurrency(0, toCurrency, features.iqd_display_preference)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Market Rate Snapshot</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-semibold">Exchange Rate</div>
                                        <span className={cn(
                                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                                            exchangeRateSource === 'manual' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                                        )}>
                                            {exchangeRateSource === 'manual' ? 'Manual' : 'Live'}
                                        </span>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="grid gap-2">
                                            <Label>Currency Pair</Label>
                                            <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm">
                                                {getPairLabel(fromCurrency, toCurrency)}
                                            </div>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>Rate</Label>
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                value={formatNumericInput(exchangeRateValue)}
                                                onChange={(event) => {
                                                    setExchangeRateValue(sanitizeNumericInput(event.target.value, { allowDecimal: true, maxFractionDigits: 6 }))
                                                    setExchangeRateSource('manual')
                                                }}
                                                placeholder="0"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Fee / Commission</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-4">
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <div className="grid gap-2">
                                            <Label>Rule</Label>
                                            <Select value={selectedRuleId} onValueChange={(value) => {
                                                setSelectedRuleId(value)
                                                const rule = rules.find((item) => item.id === value)
                                                setFeeValue(rule ? String(rule.value) : '')
                                            }}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">No fee</SelectItem>
                                                    {rules
                                                        .filter((rule) =>
                                                            isExchangeFeeRuleEffectiveForTransaction(rule, transactionType, transactionDate, fromCurrency)
                                                        )
                                                        .map((rule) => (
                                                            <SelectItem key={rule.id} value={rule.id}>{rule.name}</SelectItem>
                                                        ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>Fee Type</Label>
                                            <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm capitalize">
                                                {selectedRule?.feeType || '-'}
                                            </div>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>{selectedRule?.feeType === 'percentage' ? 'Percentage Rate' : 'Fixed Fee'}</Label>
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                value={formatNumericInput(feeValue)}
                                                onChange={(event) => setFeeValue(sanitizeNumericInput(event.target.value, { allowDecimal: selectedRule?.feeType !== 'fixed' || feeCurrency !== 'iqd' }))}
                                                placeholder="0"
                                                readOnly={!canEditFee}
                                                className={!canEditFee ? 'bg-muted/40' : undefined}
                                            />
                                            {selectedRule ? (
                                                <p className="text-xs text-muted-foreground">
                                                    Original rule value: {selectedRule.value.toLocaleString()} {selectedRule.feeType === 'percentage' ? '%' : selectedRule.currency.toUpperCase()}
                                                    {selectedRule.isLocked ? ' / locked' : ''}
                                                </p>
                                            ) : null}
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>Customer Gives Basis</Label>
                                            <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-semibold">
                                                {selectedRule
                                                    ? formatCurrency(feeBasisAmount, feeCurrency, features.iqd_display_preference)
                                                    : '-'}
                                            </div>
                                            {selectedRule ? (
                                                <p className="text-xs text-muted-foreground">
                                                    {selectedRule.feeType === 'fixed'
                                                        ? 'Fixed fee is scaled by this amount.'
                                                        : 'Percentage uses the actual customer gives amount.'}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>

                                    {calculation ? (
                                        <div className="grid gap-3 rounded-2xl border bg-muted/20 p-4 sm:grid-cols-4">
                                            <InfoBlock label="Before Fee" value={formatCurrency(calculation.baseReceivesAmount, toCurrency, features.iqd_display_preference)} />
                                            <InfoBlock label="Rule Basis" value={selectedRule ? formatCurrency(feeBasisAmount, feeCurrency, features.iqd_display_preference) : '-'} />
                                            <InfoBlock label="Fee Applied" value={formatCurrency(calculation.feeAmount, feeCurrency, features.iqd_display_preference)} />
                                            <InfoBlock label="Final Receives" value={formatCurrency(calculation.customerReceivesAmount, toCurrency, features.iqd_display_preference)} />
                                        </div>
                                    ) : null}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Notes</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    rows={4}
                                    value={notes}
                                    onChange={(event) => setNotes(event.target.value)}
                                    placeholder="Optional transaction notes"
                                />
                            </CardContent>
                        </Card>
                        </div>

                        <ExchangeTransactionSummary
                            transactionType={transactionType}
                            transactionDate={transactionDate}
                            fromCurrency={fromCurrency}
                            toCurrency={toCurrency}
                            customerGivesAmount={parsedCustomerGives}
                            paymentMethod={paymentMethod}
                            employeeName={user?.name || '-'}
                            exchangeRate={parsedRate}
                            exchangeRateSource={exchangeRateSource}
                            feeRuleName={selectedRule?.name || 'No fee'}
                            feeType={feeType}
                            feeCurrency={feeCurrency}
                            originalFeeValue={selectedRule?.value ?? null}
                            finalFeeValue={parsedFeeValue}
                            feeBasisAmount={selectedRule ? feeBasisAmount : null}
                            feeEdited={Boolean(selectedRule && parsedFeeValue !== Number(selectedRule.value || 0))}
                            calculation={calculation}
                            iqdDisplayPreference={features.iqd_display_preference}
                            marketRateSnapshot={marketRateSnapshot}
                        />
                    </div>
                </div>
                <div className="flex-shrink-0 border-t bg-background/95 px-4 py-2 backdrop-blur lg:px-6">
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onCancel} disabled={isSaving}>
                            {t('common.cancel', { defaultValue: 'Cancel' })}
                        </Button>
                        <Button type="submit" className="w-full sm:w-auto" disabled={!canSubmit || isSaving}>
                            {t('common.create', { defaultValue: 'Create' })}
                        </Button>
                    </div>
                </div>
            </form>
        </div>
    )
}

function ExchangeTransactionSummary({
    transactionType,
    transactionDate,
    fromCurrency,
    toCurrency,
    customerGivesAmount,
    paymentMethod,
    employeeName,
    exchangeRate,
    exchangeRateSource,
    feeRuleName,
    feeType,
    feeCurrency,
    originalFeeValue,
    finalFeeValue,
    feeBasisAmount,
    feeEdited,
    calculation,
    iqdDisplayPreference,
    marketRateSnapshot
}: {
    transactionType: ExchangeTransactionType
    transactionDate: string
    fromCurrency: CurrencyCode
    toCurrency: CurrencyCode
    customerGivesAmount: number
    paymentMethod: ExchangePaymentMethod
    employeeName: string
    exchangeRate: number
    exchangeRateSource: string
    feeRuleName: string
    feeType: ExchangeFeeType | null
    feeCurrency: CurrencyCode
    originalFeeValue: number | null
    finalFeeValue: number
    feeBasisAmount: number | null
    feeEdited: boolean
    calculation: ReturnType<typeof calculateExchangeTransaction> | null
    iqdDisplayPreference: IQDDisplayPreference
    marketRateSnapshot: ExchangeRateSnapshot[]
}) {
    const customerGivesLabel = formatCurrency(customerGivesAmount || 0, fromCurrency, iqdDisplayPreference)
    const beforeFeeLabel = calculation
        ? formatCurrency(calculation.baseReceivesAmount, toCurrency, iqdDisplayPreference)
        : formatCurrency(0, toCurrency, iqdDisplayPreference)
    const feeAppliedLabel = calculation
        ? formatCurrency(calculation.feeAmount, feeCurrency, iqdDisplayPreference)
        : formatCurrency(0, feeCurrency, iqdDisplayPreference)
    const finalReceivesLabel = calculation
        ? formatCurrency(calculation.customerReceivesAmount, toCurrency, iqdDisplayPreference)
        : formatCurrency(0, toCurrency, iqdDisplayPreference)
    const finalFeeValueLabel = feeType === 'percentage'
        ? `${formatNumberWithCommas(finalFeeValue || 0)}%`
        : formatCurrency(finalFeeValue || 0, feeCurrency, iqdDisplayPreference)
    const originalFeeValueLabel = originalFeeValue === null
        ? '-'
        : feeType === 'percentage'
            ? `${formatNumberWithCommas(originalFeeValue)}%`
            : formatCurrency(originalFeeValue, feeCurrency, iqdDisplayPreference)
    const feeBasisAmountLabel = feeBasisAmount === null
        ? '-'
        : formatCurrency(feeBasisAmount, feeCurrency, iqdDisplayPreference)

    return (
        <aside className="xl:sticky xl:top-4">
            <Card className="border-primary/20">
                <CardHeader className="space-y-2">
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <ClipboardList className="h-5 w-5" />
                        Transaction Summary
                    </CardTitle>
                    <div className="rounded-xl border bg-muted/20 px-3 py-3">
                        <div className="text-xs font-medium uppercase text-muted-foreground">Draft Exchange</div>
                        <div className="mt-1 text-lg font-bold tracking-tight">{fromCurrency.toUpperCase()} to {toCurrency.toUpperCase()}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{transactionTypeLabel(transactionType)}</div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="grid gap-2">
                        <SummaryRow label="Transaction Date" value={formatDateTime(transactionDate)} />
                        <SummaryRow label="Type" value={transactionTypeLabel(transactionType)} />
                        <SummaryRow label="Customer Gives" value={customerGivesLabel} />
                        <SummaryRow label="Before Fee" value={beforeFeeLabel} />
                        <SummaryRow label="Payment Method" value={paymentMethod} valueClassName="capitalize" />
                        <SummaryRow label="Employee" value={employeeName || '-'} />
                    </div>

                    <div className="h-px bg-border" />

                    <div className="grid gap-2">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">Rate Snapshot</div>
                        <SummaryRow label="Pair" value={getPairLabel(fromCurrency, toCurrency)} />
                        <SummaryRow label="Rate Used" value={exchangeRate > 0 ? formatNumberWithCommas(exchangeRate) : '-'} />
                        <SummaryRow
                            label="Source"
                            value={exchangeRateSource === 'manual' ? 'Manual' : 'Live'}
                            valueClassName={exchangeRateSource === 'manual' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}
                        />
                        <div className="rounded-lg border bg-muted/20 p-3">
                            {marketRateSnapshot.length > 0 ? (
                                <div className="grid gap-2">
                                    {marketRateSnapshot.map((snapshot) => (
                                        <div key={`${snapshot.pair}:${snapshot.timestamp}`} className="flex items-center justify-between gap-3 text-xs">
                                            <span className="text-muted-foreground">{snapshot.pair}</span>
                                            <span className="font-medium">{formatNumberWithCommas(Number(snapshot.rate || 0))}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-xs text-muted-foreground">No rate snapshot yet.</div>
                            )}
                        </div>
                    </div>

                    <div className="h-px bg-border" />

                    <div className="grid gap-2">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">Fee / Commission</div>
                        <SummaryRow label="Rule" value={feeRuleName} />
                        <SummaryRow label="Fee Type" value={feeType || '-'} valueClassName="capitalize" />
                        <SummaryRow label="Original Value" value={originalFeeValueLabel} />
                        <SummaryRow label="Final Value" value={finalFeeValueLabel} />
                        <SummaryRow label="Customer Gives Basis" value={feeBasisAmountLabel} />
                        <SummaryRow label="Fee Applied" value={feeAppliedLabel} />
                        {feeEdited ? (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                                Fee value differs from the selected rule snapshot.
                            </div>
                        ) : null}
                    </div>

                    <div className="h-px bg-border" />

                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">Final Summary</div>
                        <div className="mt-3 rounded-lg border border-primary/20 bg-background/70 p-3">
                            <div className="text-xs font-medium uppercase text-muted-foreground">Customer Receives</div>
                            <div className="mt-1 text-2xl font-bold tracking-tight">{finalReceivesLabel}</div>
                        </div>
                        <div className="mt-3 grid gap-2">
                            <SummaryRow label="Customer Gives" value={customerGivesLabel} />
                            <SummaryRow label="Before Fee" value={beforeFeeLabel} />
                            <SummaryRow label="Fee Deducted" value={feeAppliedLabel} />
                            <SummaryRow label="Rate Used" value={exchangeRate > 0 ? formatNumberWithCommas(exchangeRate) : '-'} />
                            <SummaryRow label="Payment Method" value={paymentMethod} valueClassName="capitalize" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </aside>
    )
}

function SummaryRow({
    label,
    value,
    valueClassName
}: {
    label: string
    value: string
    valueClassName?: string
}) {
    return (
        <div className="flex items-start justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className={cn('max-w-[190px] text-right font-medium', valueClassName)}>{value}</span>
        </div>
    )
}

function ExchangeFeeRulesPage({
    workspaceId,
    onBack
}: {
    workspaceId: string
    onBack: () => void
}) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { features } = useWorkspace()
    const rules = useExchangeFeeRules(workspaceId)
    const [form, setForm] = useState<FeeRuleFormState>(() => makeDefaultRuleForm(features.default_currency))
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const isAdmin = user?.role === 'admin'

    const availableCurrencies = useMemo(() => {
        const values = new Set<CurrencyCode>([...features.allowed_currencies, features.default_currency, 'iqd', 'usd'])
        return Array.from(values)
    }, [features.allowed_currencies, features.default_currency])

    const resetForm = () => {
        setEditingRuleId(null)
        setForm(makeDefaultRuleForm(features.default_currency))
    }

    const startEditing = (rule: ExchangeFeeRule) => {
        setEditingRuleId(rule.id)
        setForm({
            name: rule.name,
            transactionScope: rule.transactionScope,
            feeType: rule.feeType,
            currency: rule.currency,
            value: String(rule.value),
            customerGivesBasisAmount: String(getExchangeFeeBasisAmount(rule)),
            effectiveStartDate: rule.effectiveStartDate,
            effectiveEndDate: rule.effectiveEndDate || '',
            isActive: rule.isActive,
            isLocked: rule.isLocked,
            notes: rule.notes || ''
        })
    }

    const parsedFeeRuleValue = parseFormattedNumber(form.value || '0')
    const parsedCustomerGivesBasisAmount = parseFormattedNumber(form.customerGivesBasisAmount || '0')
    const previewFeeAmount = calculateRulePreviewFeeAmount(form.feeType, parsedCustomerGivesBasisAmount, parsedFeeRuleValue)
    const formattedCustomerGivesBasisAmount = formatCurrency(parsedCustomerGivesBasisAmount, form.currency, features.iqd_display_preference)
    const formattedPreviewFeeAmount = formatCurrency(previewFeeAmount, form.currency, features.iqd_display_preference)
    const feeRuleFormula = form.feeType === 'percentage'
        ? `${formattedCustomerGivesBasisAmount} x ${formatNumberWithCommas(parsedFeeRuleValue || 0)}% = ${formattedPreviewFeeAmount}`
        : `${formattedPreviewFeeAmount} fixed fee per ${formattedCustomerGivesBasisAmount}`

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setIsSaving(true)
        try {
            const payload = {
                name: form.name,
                transactionScope: form.transactionScope,
                feeType: form.feeType,
                currency: form.currency,
                value: parseFormattedNumber(form.value || '0'),
                customerGivesBasisAmount: parseFormattedNumber(form.customerGivesBasisAmount || '0'),
                effectiveStartDate: form.effectiveStartDate,
                effectiveEndDate: form.effectiveEndDate || null,
                isActive: form.isActive,
                isLocked: form.isLocked,
                notes: form.notes,
                createdBy: user?.id ?? null
            }

            if (editingRuleId) {
                await updateExchangeFeeRule(editingRuleId, payload)
            } else {
                await createExchangeFeeRule(workspaceId, payload)
            }

            toast({
                title: t('common.success', { defaultValue: 'Success' }),
                description: editingRuleId ? 'Fee rule updated.' : 'Fee rule created.'
            })
            resetForm()
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || 'Failed to save fee rule.',
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    const handleToggleLock = async (rule: ExchangeFeeRule) => {
        if (!isAdmin) return
        try {
            await updateExchangeFeeRule(rule.id, { isLocked: !rule.isLocked })
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || 'Failed to update lock status.',
                variant: 'destructive'
            })
        }
    }

    const handleDelete = async () => {
        if (!deleteTargetId) return
        setIsDeleting(true)
        try {
            await deleteExchangeFeeRule(deleteTargetId)
            toast({ title: t('common.success', { defaultValue: 'Success' }), description: 'Fee rule deleted.' })
            setDeleteTargetId(null)
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || 'Failed to delete fee rule.',
                variant: 'destructive'
            })
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <Button
                    type="button"
                    variant="ghost"
                    className="h-auto gap-2 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={onBack}
                >
                    <ArrowLeft className="h-4 w-4" />
                    Currency Exchange Service
                </Button>
                <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                    <ClipboardList className="h-7 w-7" />
                    Fee/Commission Rules
                </h1>
                <p className="text-sm text-muted-foreground">
                    Configure reusable fixed or percentage fees with active dates and lock control.
                </p>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
                <Card>
                    <CardHeader>
                        <CardTitle>{editingRuleId ? 'Edit Rule' : 'Create Rule'}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="grid gap-4">
                            <div className="grid gap-2">
                                <Label>Name</Label>
                                <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                            </div>
                            <div className="grid gap-2">
                                <Label>Valid For</Label>
                                <Select value={form.transactionScope} onValueChange={(value: ExchangeFeeRuleTransactionScope) => setForm((current) => ({ ...current, transactionScope: value }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="both">Buy and Sell</SelectItem>
                                        <SelectItem value="buy">Buy Currency</SelectItem>
                                        <SelectItem value="sell">Sell Currency</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="grid gap-2">
                                    <Label>Fee Type</Label>
                                    <Select value={form.feeType} onValueChange={(value: ExchangeFeeType) => setForm((current) => ({
                                        ...current,
                                        feeType: value,
                                        value: sanitizeNumericInput(current.value, { allowDecimal: value === 'percentage' || current.currency !== 'iqd' })
                                    }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="fixed">Fixed Fee</SelectItem>
                                            <SelectItem value="percentage">Percentage Fee</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <CurrencySelector
                                    value={form.currency}
                                    onChange={(value) => setForm((current) => ({
                                        ...current,
                                        currency: value,
                                        value: sanitizeNumericInput(current.value, { allowDecimal: current.feeType === 'percentage' || value !== 'iqd' }),
                                        customerGivesBasisAmount: sanitizeNumericInput(current.customerGivesBasisAmount, { allowDecimal: value !== 'iqd' })
                                    }))}
                                    label="Currency"
                                    iqdDisplayPreference={features.iqd_display_preference}
                                    allowedCurrencies={availableCurrencies}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>{form.feeType === 'percentage' ? 'Percentage Rate' : 'Fixed Fee Amount'}</Label>
                                <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={formatNumericInput(form.value)}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        value: sanitizeNumericInput(event.target.value, { allowDecimal: form.feeType === 'percentage' || form.currency !== 'iqd' })
                                    }))}
                                    placeholder="0"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Customer Gives Basis</Label>
                                <Input
                                    type="text"
                                    inputMode={form.currency === 'iqd' ? 'numeric' : 'decimal'}
                                    value={formatNumericInput(form.customerGivesBasisAmount)}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        customerGivesBasisAmount: sanitizeNumericInput(event.target.value, { allowDecimal: form.currency !== 'iqd' })
                                    }))}
                                    placeholder="0"
                                />
                            </div>
                            <div className="grid gap-3 rounded-xl border bg-muted/20 p-3">
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <InfoBlock label="Customer Gives Basis" value={formattedCustomerGivesBasisAmount} />
                                    <InfoBlock
                                        label={form.feeType === 'percentage' ? 'Percentage Rate' : 'Fixed Fee'}
                                        value={form.feeType === 'percentage'
                                            ? `${formatNumberWithCommas(parsedFeeRuleValue || 0)}%`
                                            : formatCurrency(parsedFeeRuleValue || 0, form.currency, features.iqd_display_preference)}
                                    />
                                    <InfoBlock label="Calculated Fee" value={formattedPreviewFeeAmount} />
                                </div>
                                <div className="rounded-lg border bg-background/60 px-3 py-2 text-xs font-medium text-muted-foreground">
                                    {feeRuleFormula}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="grid gap-2">
                                    <Label>Effective Start</Label>
                                    <DateTimePicker
                                        id="currency-exchange-fee-effective-start"
                                        mode="date-time"
                                        date={parseLocalDateTimeValue(form.effectiveStartDate)}
                                        setDate={(value) => setForm((current) => ({ ...current, effectiveStartDate: toTimestampValue(value) }))}
                                        placeholder="Effective Start"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Effective End</Label>
                                    <DateTimePicker
                                        id="currency-exchange-fee-effective-end"
                                        mode="date-time"
                                        date={parseLocalDateTimeValue(form.effectiveEndDate)}
                                        setDate={(value) => setForm((current) => ({ ...current, effectiveEndDate: toTimestampValue(value) }))}
                                        placeholder="Effective End"
                                    />
                                </div>
                            </div>
                            <div className="grid gap-3 rounded-xl border bg-muted/20 p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium">Active</div>
                                        <div className="text-xs text-muted-foreground">Only active rules are applied to new transactions.</div>
                                    </div>
                                    <Switch checked={form.isActive} onCheckedChange={(value) => setForm((current) => ({ ...current, isActive: value }))} />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium">Locked</div>
                                        <div className="text-xs text-muted-foreground">Only admins can lock or unlock rules.</div>
                                    </div>
                                    <Switch
                                        checked={form.isLocked}
                                        disabled={!isAdmin}
                                        onCheckedChange={(value) => setForm((current) => ({ ...current, isLocked: value }))}
                                    />
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label>Notes</Label>
                                <Textarea rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
                            </div>
                            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                                <Button type="button" variant="outline" onClick={resetForm}>Clear</Button>
                                <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : editingRuleId ? 'Save Rule' : 'Create Rule'}</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Configured Rules</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rule</TableHead>
                                    <TableHead>Scope</TableHead>
                                    <TableHead>Fee</TableHead>
                                    <TableHead>Effective Period</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-end">{t('common.actions', { defaultValue: 'Actions' })}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rules.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                                            No fee rules configured.
                                        </TableCell>
                                    </TableRow>
                                ) : rules.map((rule) => {
                                    const basisAmount = getExchangeFeeBasisAmount(rule)
                                    return (
                                    <TableRow key={rule.id}>
                                        <TableCell>
                                            <div className="font-medium">{rule.name}</div>
                                            {rule.notes ? <div className="text-xs text-muted-foreground">{rule.notes}</div> : null}
                                        </TableCell>
                                        <TableCell>{feeScopeLabel(rule.transactionScope)}</TableCell>
                                        <TableCell>
                                            <div>
                                                {rule.feeType === 'percentage'
                                                    ? `${rule.value.toLocaleString()}%`
                                                    : formatCurrency(rule.value, rule.currency, features.iqd_display_preference)}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {rule.feeType === 'fixed'
                                                    ? `per ${formatCurrency(basisAmount, rule.currency, features.iqd_display_preference)}`
                                                    : `example basis ${formatCurrency(basisAmount, rule.currency, features.iqd_display_preference)}`}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {formatDateTime(rule.effectiveStartDate)}
                                            {rule.effectiveEndDate ? ` - ${formatDateTime(rule.effectiveEndDate)}` : ' - Open'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1.5">
                                                <span className={cn(
                                                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                                    rule.isActive ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
                                                )}>
                                                    {rule.isActive ? 'Active' : 'Inactive'}
                                                </span>
                                                <span className={cn(
                                                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                                    rule.isLocked ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                                                )}>
                                                    {rule.isLocked ? 'Locked' : 'Unlocked'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-end">
                                            <div className="flex justify-end gap-1">
                                                {isAdmin ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleToggleLock(rule)}
                                                        aria-label={rule.isLocked ? 'Unlock fee rule' : 'Lock fee rule'}
                                                    >
                                                        {rule.isLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                                                    </Button>
                                                ) : null}
                                                <Button type="button" variant="ghost" onClick={() => startEditing(rule)}>Edit</Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-destructive hover:text-destructive"
                                                    onClick={() => setDeleteTargetId(rule.id)}
                                                    aria-label="Delete fee rule"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            <DeleteConfirmationModal
                isOpen={!!deleteTargetId}
                onClose={() => setDeleteTargetId(null)}
                onConfirm={handleDelete}
                itemName={rules.find((rule) => rule.id === deleteTargetId)?.name}
                isLoading={isDeleting}
                title="Delete Fee Rule"
                description="Existing transactions keep their fee snapshots. New transactions will no longer use this rule."
            />
        </div>
    )
}

function MetricCard({ title, value }: { title: string; value: string }) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">{title}</div>
                <div className="mt-1 text-2xl font-bold">{value}</div>
            </CardContent>
        </Card>
    )
}

function InfoBlock({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-xs uppercase text-muted-foreground">{label}</div>
            <div className="mt-1 text-sm font-semibold">{value}</div>
        </div>
    )
}
