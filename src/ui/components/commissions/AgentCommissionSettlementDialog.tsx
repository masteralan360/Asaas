import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Banknote, SlidersHorizontal } from 'lucide-react'

import { formatCurrency, formatDateTime } from '@/lib/utils'
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
    const [reference, setReference] = useState('')
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
    const payoutCurrencies = useMemo(() => Object.entries(summary.due)
        .filter(([, due]) => due > 0.000001)
        .map(([currencyCode]) => currencyCode as CurrencyCode), [summary.due])

    useEffect(() => {
        if (!open) return
        setTab(approvalCandidates.length > 0 ? 'approve' : 'payout')
        setSelectedEntryIds(new Set())
        setCurrency(payoutCurrencies[0] || defaultCurrency)
        setAmount('')
        setReference('')
        setPaymentMethod('cash')
        setNotes('')
        setAdjustmentOrderId('')
    }, [approvalCandidates.length, defaultCurrency, open, payoutCurrencies])

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
                if (!reference.trim()) throw new Error('Enter a payout reference.')
                await recordCommissionPayout(workspaceId, {
                    agentId,
                    amount: payoutAmount,
                    currency,
                    payoutReference: reference.trim(),
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
                                    <Label>Currency</Label>
                                    <Select value={currency} onValueChange={(value) => setCurrency(value as CurrencyCode)} disabled={isSaving}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {(payoutCurrencies.length > 0 ? payoutCurrencies : [defaultCurrency]).map((currencyCode) => (
                                                <SelectItem key={currencyCode} value={currencyCode}>{currencyCode.toUpperCase()}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">Due: {formatCurrency(summary.due[currency] || 0, currency, iqdPreference)}</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="commission-payout-amount">Payout amount</Label>
                                    <Input id="commission-payout-amount" type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={isSaving} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="commission-payout-reference">Payout reference</Label>
                                <Input id="commission-payout-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bank transfer, cash voucher, or payroll reference" disabled={isSaving} />
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
                    <Button type="button" onClick={() => void handleSubmit()} disabled={isSaving || (tab === 'approve' && approvalCandidates.length === 0)}>
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
