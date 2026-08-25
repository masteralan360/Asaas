import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Banknote, SlidersHorizontal } from 'lucide-react'

import { formatCurrency, formatDateTime, formatNumericInput, sanitizeNumericInput } from '@/lib/utils'
import {
    recordCommissionAdjustment,
    recordCommissionApproval,
    recordCommissionPayout,
    useSalesOrderAgentAssignments,
    useSalesOrders,
    type AgentCommissionEntry,
    type CurrencyCode,
    type IQDDisplayPreference
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
import { summarizeCommissionEntries } from './agentCommissionPresentation'

type SettlementTab = 'approve' | 'payout' | 'adjustment'

function payoutAmountInputValue(amount?: number) {
    if (!Number.isFinite(amount) || !amount || amount <= 0) return ''
    return String(Math.round((amount + Number.EPSILON) * 1_000_000) / 1_000_000)
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
    const { toast } = useToast()
    const salesOrders = useSalesOrders(workspaceId)
    const assignments = useSalesOrderAgentAssignments(workspaceId)
    const [tab, setTab] = useState<SettlementTab>('approve')
    const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(() => new Set())
    const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency)
    const [amount, setAmount] = useState('')
    const [payoutOrderId, setPayoutOrderId] = useState('')
    const [paymentMethod, setPaymentMethod] = useState('cash')
    const [notes, setNotes] = useState('')
    const [adjustmentOrderId, setAdjustmentOrderId] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const summary = useMemo(() => summarizeCommissionEntries(entries), [entries])
    const approvedRelatedEntryIds = useMemo(() => new Set(entries
        .filter((entry) => entry.kind === 'approval' && entry.relatedEntryId)
        .map((entry) => entry.relatedEntryId as string)), [entries])
    const approvalCandidates = useMemo(() => entries
        .filter((entry) =>
            (entry.kind === 'accrual' || entry.kind === 'adjustment')
            && entry.status === 'earned'
            && entry.amount !== 0
            && !approvedRelatedEntryIds.has(entry.id)
        )
        .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()),
    [approvedRelatedEntryIds, entries])
    const orderNumberById = useMemo(() => new Map(salesOrders.map((order) => [order.id, order.orderNumber])), [salesOrders])
    const assignedOrderIds = useMemo(() => new Set(assignments
        .filter((assignment) => !assignment.isDeleted && assignment.agentId === agentId)
        .map((assignment) => assignment.orderId)), [agentId, assignments])
    const assignedSalesOrders = useMemo(
        () => salesOrders.filter((order) => assignedOrderIds.has(order.id)),
        [assignedOrderIds, salesOrders]
    )
    const payoutOrders = useMemo(() => {
        const dueByOrderId = new Map<string, { currency: CurrencyCode, due: number }>()
        for (const entry of entries) {
            if (!entry.orderId || entry.kind === 'estimate' || entry.kind === 'approval') continue
            const current = dueByOrderId.get(entry.orderId) || { currency: entry.currency as CurrencyCode, due: 0 }
            if (current.currency !== entry.currency) continue
            current.due += entry.amount
            dueByOrderId.set(entry.orderId, current)
        }

        return Array.from(dueByOrderId, ([orderId, value]) => {
            const order = salesOrders.find((candidate) => candidate.id === orderId)
            return order && !order.isDeleted && value.due > 0.000001
                ? { orderId, orderNumber: order.orderNumber, customerName: order.customerName, ...value }
                : null
        })
            .filter((order): order is { orderId: string, orderNumber: string, customerName: string, currency: CurrencyCode, due: number } => Boolean(order))
            .sort((left, right) => left.orderNumber.localeCompare(right.orderNumber))
    }, [entries, salesOrders])
    const selectedPayoutOrder = useMemo(
        () => payoutOrders.find((order) => order.orderId === payoutOrderId) || null,
        [payoutOrderId, payoutOrders]
    )

    useEffect(() => {
        if (!open) return
        setTab(approvalCandidates.length > 0 ? 'approve' : 'payout')
        setSelectedEntryIds(new Set())
        setPayoutOrderId(payoutOrders[0]?.orderId || '')
        setCurrency(payoutOrders[0]?.currency || defaultCurrency)
        setAmount(payoutAmountInputValue(payoutOrders[0]?.due))
        setPaymentMethod('cash')
        setNotes('')
        setAdjustmentOrderId('')
    }, [approvalCandidates.length, defaultCurrency, open, payoutOrders])

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
                if (selectedEntryIds.size === 0) throw new Error('Select at least one earned entry to approve.')
                await Promise.all(Array.from(selectedEntryIds, (entryId) => recordCommissionApproval(workspaceId, {
                    entryId,
                    approvedBy: userId || null,
                    notes: notes.trim() || null
                })))
                toast({ title: `${selectedEntryIds.size} commission ${selectedEntryIds.size === 1 ? 'entry' : 'entries'} approved` })
            } else if (tab === 'payout') {
                const payoutAmount = Number(amount)
                if (!(payoutAmount > 0)) throw new Error('Enter a positive payout amount.')
                if (!selectedPayoutOrder) throw new Error('Select a sales order with commission due.')
                if (payoutAmount - selectedPayoutOrder.due > 0.000001) {
                    throw new Error('Payout amount exceeds the selected order\'s outstanding commission.')
                }
                await recordCommissionPayout(workspaceId, {
                    agentId,
                    orderId: selectedPayoutOrder.orderId,
                    amount: payoutAmount,
                    currency: selectedPayoutOrder.currency,
                    paymentMethod: paymentMethod as any,
                    notes: notes.trim() || null,
                    createdBy: userId || null
                })
                toast({ title: 'Commission payout recorded' })
            } else {
                const adjustmentAmount = Number(amount)
                if (!Number.isFinite(adjustmentAmount) || adjustmentAmount === 0) throw new Error('Enter a non-zero signed adjustment amount.')
                if (!notes.trim()) throw new Error('Enter the adjustment reason.')
                await recordCommissionAdjustment(workspaceId, {
                    agentId,
                    amount: adjustmentAmount,
                    currency,
                    orderId: adjustmentOrderId || null,
                    notes: notes.trim(),
                    createdBy: userId || null
                })
                toast({ title: 'Commission adjustment recorded' })
            }
            onOpenChange(false)
        } catch (error: any) {
            toast({
                title: 'Could not update commission',
                description: error?.message || 'Try again.',
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    const actionLabel = tab === 'approve'
        ? `Approve ${selectedEntryIds.size || ''}`.trim()
        : tab === 'payout'
            ? 'Record payout'
            : 'Record adjustment'

    return (
        <AppDialog open={open} onOpenChange={(nextOpen) => {
            if (isSaving && !nextOpen) return
            onOpenChange(nextOpen)
        }}>
            <AppDialogContent className="max-w-3xl">
                <AppDialogHeader>
                    <AppDialogTitle>Manage {agentName}'s commission</AppDialogTitle>
                    <AppDialogDescription>
                        Approvals, payouts and corrections create auditable ledger entries; existing records are not overwritten.
                    </AppDialogDescription>
                </AppDialogHeader>
                <AppDialogBody className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <SummaryTile label="Recognized" totals={summary.earned} iqdPreference={iqdPreference} />
                        <SummaryTile label="Paid" totals={summary.paid} iqdPreference={iqdPreference} />
                        <SummaryTile label="Due" totals={summary.due} iqdPreference={iqdPreference} />
                    </div>

                    <Tabs value={tab} onValueChange={(value) => setTab(value as SettlementTab)}>
                        <TabsList className="grid h-auto w-full grid-cols-3">
                            <TabsTrigger value="approve" className="gap-1.5"><BadgeCheck className="h-4 w-4" /> Approve</TabsTrigger>
                            <TabsTrigger value="payout" className="gap-1.5"><Banknote className="h-4 w-4" /> Payout</TabsTrigger>
                            <TabsTrigger value="adjustment" className="gap-1.5"><SlidersHorizontal className="h-4 w-4" /> Adjustment</TabsTrigger>
                        </TabsList>

                        <TabsContent value="approve" className="mt-4 space-y-4">
                            {approvalCandidates.length === 0 ? (
                                <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                    No earned accruals or adjustments are waiting for approval.
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
                                                    <span className="font-semibold">{entry.orderId ? orderNumberById.get(entry.orderId) || entry.orderId.slice(0, 8).toUpperCase() : 'Manual adjustment'}</span>
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
                                <Label htmlFor="commission-approval-notes">Approval note</Label>
                                <Textarea id="commission-approval-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} disabled={isSaving} />
                            </div>
                        </TabsContent>

                        <TabsContent value="payout" className="mt-4 space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="commission-payout-order">Sales order</Label>
                                    <Select
                                        value={payoutOrderId || '__none__'}
                                        onValueChange={(value) => {
                                            const orderId = value === '__none__' ? '' : value
                                            const order = payoutOrders.find((candidate) => candidate.orderId === orderId)
                                            setPayoutOrderId(orderId)
                                            setCurrency(order?.currency || defaultCurrency)
                                            setAmount(payoutAmountInputValue(order?.due))
                                        }}
                                        disabled={isSaving || payoutOrders.length === 0}
                                    >
                                        <SelectTrigger id="commission-payout-order"><SelectValue placeholder="Select a payable sales order" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none__" disabled>Select a payable sales order</SelectItem>
                                            {payoutOrders.map((order) => (
                                                <SelectItem key={order.orderId} value={order.orderId}>
                                                    {order.orderNumber} · {order.customerName} · Due {formatCurrency(order.due, order.currency, iqdPreference)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {selectedPayoutOrder ? (
                                        <p className="text-xs text-muted-foreground">
                                            Reference: <span className="font-semibold text-foreground">{selectedPayoutOrder.orderNumber}</span> · set automatically from the sales order.
                                        </p>
                                    ) : <p className="text-xs text-muted-foreground">No order-specific commission is currently due.</p>}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="commission-payout-amount">Payout amount</Label>
                                    <Input
                                        id="commission-payout-amount"
                                        type="text"
                                        inputMode="decimal"
                                        value={formatNumericInput(amount)}
                                        onChange={(event) => setAmount(sanitizeNumericInput(event.target.value, {
                                            allowDecimal: true,
                                            maxFractionDigits: 6
                                        }))}
                                        placeholder="0"
                                        disabled={isSaving || !selectedPayoutOrder}
                                    />
                                    {selectedPayoutOrder ? <p className="text-xs text-muted-foreground">Due: {formatCurrency(selectedPayoutOrder.due, selectedPayoutOrder.currency, iqdPreference)}</p> : null}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Payment method</Label>
                                <Select value={paymentMethod} onValueChange={setPaymentMethod} disabled={isSaving}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {[
                                            ['cash', 'Cash'],
                                            ['bank_transfer', 'Bank transfer'],
                                            ['fib', 'FIB'],
                                            ['qicard', 'QiCard'],
                                            ['zaincash', 'ZainCash'],
                                            ['fastpay', 'FastPay']
                                        ].map(([value, label]) => (
                                            <SelectItem key={value} value={value}>{label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="commission-payout-notes">Notes</Label>
                                <Textarea id="commission-payout-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} disabled={isSaving} />
                            </div>
                        </TabsContent>

                        <TabsContent value="adjustment" className="mt-4 space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Currency</Label>
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
                                    <Label htmlFor="commission-adjustment-amount">Signed amount</Label>
                                    <Input id="commission-adjustment-amount" type="number" step="any" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Use a negative number to reduce commission" disabled={isSaving} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="commission-adjustment-order">Related order (optional)</Label>
                                <Select value={adjustmentOrderId || '__none__'} onValueChange={(value) => setAdjustmentOrderId(value === '__none__' ? '' : value)} disabled={isSaving}>
                                    <SelectTrigger id="commission-adjustment-order"><SelectValue placeholder="No related order" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">No related order</SelectItem>
                                        {assignedSalesOrders.map((order) => <SelectItem key={order.id} value={order.id}>{order.orderNumber} · {order.customerName}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="commission-adjustment-notes">Reason</Label>
                                <Textarea id="commission-adjustment-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} required disabled={isSaving} />
                            </div>
                        </TabsContent>
                    </Tabs>
                </AppDialogBody>
                <AppDialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
                    <Button type="button" onClick={() => void handleSubmit()} disabled={isSaving || (tab === 'approve' && approvalCandidates.length === 0) || (tab === 'payout' && !selectedPayoutOrder)}>
                        {isSaving ? 'Saving…' : actionLabel}
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
