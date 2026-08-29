import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatCurrency, formatDateTime, formatNumericInput, sanitizeNumericInput } from '@/lib/utils'
import {
    recordCommissionAdjustment,
    recordCommissionApproval,
    useSalesOrderAgentAssignments,
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
    Button,
    Checkbox,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    Textarea,
    useToast
} from '@/ui/components'
import { CommissionCurrencyTotalsView } from './CommissionCurrencyTotals'
import { commissionEntryOrderReference, summarizeCommissionEntries } from './agentCommissionPresentation'

type SettlementTab = 'approve' | 'adjustment'

function sanitizeSignedNumericInput(value: string) {
    const normalized = value.trim()
    const isNegative = normalized.startsWith('-')
    const magnitude = sanitizeNumericInput(normalized.replace(/-/g, ''), {
        allowDecimal: true,
        maxFractionDigits: 6,
    })
    return magnitude ? `${isNegative ? '-' : ''}${magnitude}` : ''
}

function formatSignedNumericInput(value: string) {
    return value.startsWith('-')
        ? `-${formatNumericInput(value.slice(1))}`
        : formatNumericInput(value)
}

export function AgentCommissionSettlementDialog({
    open,
    onOpenChange,
    workspaceId,
    agentId,
    agentName,
    entries,
    iqdPreference,
    userId,
    defaultCurrency
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    agentId: string
    agentName: string
    entries: AgentCommissionEntry[]
    iqdPreference: IQDDisplayPreference
    userId?: string | null
    defaultCurrency: CurrencyCode
}) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const salesOrders = useSalesOrders(workspaceId)
    const assignments = useSalesOrderAgentAssignments(workspaceId)
    const [tab, setTab] = useState<SettlementTab>('approve')
    const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(() => new Set())
    const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency)
    const [amount, setAmount] = useState('')
    const [notes, setNotes] = useState('')
    const [adjustmentOrderId, setAdjustmentOrderId] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const summary = useMemo(() => summarizeCommissionEntries(entries), [entries])
    const outstandingByAssignmentCurrency = useMemo(() => {
        const totals = new Map<string, number>()
        for (const entry of entries) {
            if (entry.isDeleted || entry.kind === 'estimate' || entry.kind === 'approval') continue
            const key = `${entry.assignmentId || 'unassigned'}:${entry.currency}`
            totals.set(key, (totals.get(key) || 0) + Number(entry.amount || 0))
        }
        return totals
    }, [entries])
    const approvedRelatedEntryIds = useMemo(() => new Set(entries
        .filter((entry) => entry.kind === 'approval' && entry.relatedEntryId)
        .map((entry) => entry.relatedEntryId as string)), [entries])
    const approvalCandidates = useMemo(() => entries
        .filter((entry) =>
            (entry.kind === 'accrual' || entry.kind === 'adjustment')
            && entry.status === 'earned'
            && entry.amount !== 0
            && (outstandingByAssignmentCurrency.get(`${entry.assignmentId || 'unassigned'}:${entry.currency}`) || 0) > 0.000001
            && !approvedRelatedEntryIds.has(entry.id)
        )
        .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()),
    [approvedRelatedEntryIds, entries, outstandingByAssignmentCurrency])
    const orderNumberById = useMemo(() => new Map(salesOrders.map((order) => [order.id, order.orderNumber])), [salesOrders])
    const assignedOrderIds = useMemo(() => new Set(assignments
        .filter((assignment) => !assignment.isDeleted && assignment.agentId === agentId)
        .map((assignment) => assignment.orderId)), [agentId, assignments])
    const assignedSalesOrders = useMemo(
        () => salesOrders.filter((order) => assignedOrderIds.has(order.id)),
        [assignedOrderIds, salesOrders]
    )
    useEffect(() => {
        if (!open) return
        setTab(approvalCandidates.length > 0 ? 'approve' : 'adjustment')
        setSelectedEntryIds(new Set())
        setCurrency(defaultCurrency)
        setAmount('')
        setNotes('')
        setAdjustmentOrderId('')
    }, [approvalCandidates.length, defaultCurrency, open])

    function toggleApproval(entryId: string, checked: boolean) {
        setSelectedEntryIds((current) => {
            const next = new Set(current)
            if (checked) next.add(entryId)
            else next.delete(entryId)
            return next
        })
    }

    async function handleSubmit() {
        setIsSaving(true)
        try {
            if (tab === 'approve') {
                if (selectedEntryIds.size === 0) throw new Error(t('salesAgentCommissions.errors.selectEarnedEntry'))
                await Promise.all(Array.from(selectedEntryIds, (entryId) => recordCommissionApproval(workspaceId, {
                    entryId,
                    approvedBy: userId || null,
                    notes: notes.trim() || null
                })))
                toast({ title: t('salesAgentCommissions.entriesApproved', { count: selectedEntryIds.size }) })
            } else {
                const adjustmentAmount = Number(amount)
                if (!Number.isFinite(adjustmentAmount) || adjustmentAmount === 0) throw new Error(t('salesAgentCommissions.errors.nonZeroAdjustment'))
                if (!notes.trim()) throw new Error(t('salesAgentCommissions.errors.adjustmentReason'))
                await recordCommissionAdjustment(workspaceId, {
                    agentId,
                    amount: adjustmentAmount,
                    currency,
                    orderId: adjustmentOrderId || null,
                    notes: notes.trim(),
                    createdBy: userId || null
                })
                toast({ title: t('salesAgentCommissions.adjustmentRecorded') })
            }
            onOpenChange(false)
        } catch (error: any) {
            toast({
                title: t('salesAgentCommissions.couldNotUpdate'),
                description: error?.message || t('salesAgentCommissions.tryAgain'),
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    const actionLabel = tab === 'approve'
        ? t('salesAgentCommissions.approveCount', { count: selectedEntryIds.size })
        : t('salesAgentCommissions.recordAdjustment')

    return (
        <AppDialog open={open} onOpenChange={(nextOpen) => {
            if (isSaving && !nextOpen) return
            onOpenChange(nextOpen)
        }}>
            <AppDialogContent className="max-w-3xl">
                <AppDialogHeader>
                    <AppDialogTitle>{t('salesAgentCommissions.manageAgentCommission', { name: agentName })}</AppDialogTitle>
                    <AppDialogDescription>
                        {t('salesAgentCommissions.settlementDescription')}
                    </AppDialogDescription>
                </AppDialogHeader>
                <AppDialogBody className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <SummaryTile label={t('salesAgentCommissions.recognized')} totals={summary.earned} iqdPreference={iqdPreference} />
                        <SummaryTile label={t('salesAgentCommissions.paid')} totals={summary.paid} iqdPreference={iqdPreference} />
                        <SummaryTile label={t('salesAgentCommissions.due')} totals={summary.due} iqdPreference={iqdPreference} />
                    </div>

                    <Tabs value={tab} onValueChange={(value) => setTab(value as SettlementTab)}>
                        <TabsList className="grid h-auto w-full grid-cols-2">
                            <TabsTrigger value="approve" className="gap-1.5"><BadgeCheck className="h-4 w-4" /> {t('salesAgentCommissions.approve')}</TabsTrigger>
                            <TabsTrigger value="adjustment" className="gap-1.5"><SlidersHorizontal className="h-4 w-4" /> {t('salesAgentCommissions.adjustment')}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="approve" className="mt-4 space-y-4">
                            {approvalCandidates.length === 0 ? (
                                <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                    {t('salesAgentCommissions.noApprovalCandidates')}
                                </div>
                            ) : (
                                <div className="divide-y overflow-hidden rounded-2xl border">
                                    {approvalCandidates.map((entry) => (
                                        <label key={entry.id} className="flex cursor-pointer items-start gap-3 p-4 hover:bg-muted/30">
                                            <Checkbox
                                                checked={selectedEntryIds.has(entry.id)}
                                                onCheckedChange={(checked) => toggleApproval(entry.id, checked === true)}
                                                disabled={isSaving}
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <span className="font-semibold">{entry.orderId ? commissionEntryOrderReference(entry, orderNumberById) : t('salesAgentCommissions.manualAdjustment')}</span>
                                                    <span className="font-black">{formatCurrency(entry.amount, entry.currency as CurrencyCode, iqdPreference)}</span>
                                                </div>
                                                <div className="mt-1 text-xs text-muted-foreground">
                                                    {formatDateTime(entry.occurredAt)} · {entry.ratePercent}% of {formatCurrency(entry.basisAmount, entry.currency as CurrencyCode, iqdPreference)}
                                                </div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="commission-approval-notes">{t('salesAgentCommissions.approvalNote')}</Label>
                                <Textarea id="commission-approval-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} disabled={isSaving} />
                            </div>
                        </TabsContent>

                        <TabsContent value="adjustment" className="mt-4 space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                <Label>{t('salesAgentCommissions.currency')}</Label>
                                    <Select value={currency} onValueChange={(value) => setCurrency(value as CurrencyCode)} disabled={isSaving}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {Array.from(new Set<CurrencyCode>([
                                                defaultCurrency,
                                                ...(Object.keys(summary.due) as CurrencyCode[])
                                            ])).map((currencyCode) => (
                                                <SelectItem key={currencyCode} value={currencyCode}>{currencyCode.toUpperCase()}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="commission-adjustment-amount">{t('salesAgentCommissions.signedAmount')}</Label>
                                    <Input
                                        id="commission-adjustment-amount"
                                        type="text"
                                        inputMode="decimal"
                                        value={formatSignedNumericInput(amount)}
                                        onChange={(event) => setAmount(sanitizeSignedNumericInput(event.target.value))}
                                        placeholder={t('salesAgentCommissions.signedAmountPlaceholder')}
                                        disabled={isSaving}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="commission-adjustment-order">{t('salesAgentCommissions.relatedOrderOptional')}</Label>
                                <Select value={adjustmentOrderId || '__none__'} onValueChange={(value) => setAdjustmentOrderId(value === '__none__' ? '' : value)} disabled={isSaving}>
                                    <SelectTrigger id="commission-adjustment-order"><SelectValue placeholder={t('salesAgentCommissions.noRelatedOrder')} /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">{t('salesAgentCommissions.noRelatedOrder')}</SelectItem>
                                        {assignedSalesOrders.map((order) => <SelectItem key={order.id} value={order.id}>{order.orderNumber} · {order.customerName}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="commission-adjustment-notes">{t('salesAgentCommissions.reason')}</Label>
                                <Textarea id="commission-adjustment-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} required disabled={isSaving} />
                            </div>
                        </TabsContent>
                    </Tabs>
                </AppDialogBody>
                <AppDialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t('salesAgentCommissions.cancel')}</Button>
                    <Button type="button" onClick={() => void handleSubmit()} disabled={isSaving || (tab === 'approve' && approvalCandidates.length === 0)}>
                        {isSaving ? t('salesAgentCommissions.saving') : actionLabel}
                    </Button>
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
