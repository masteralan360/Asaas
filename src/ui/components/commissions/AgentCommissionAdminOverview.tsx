import { useMemo, useState } from 'react'
import { BadgeCheck, BadgePercent, CircleDollarSign, ReceiptText, RotateCcw, SlidersHorizontal } from 'lucide-react'

import { useAgentCommissionEntries, useSalesOrderAgentAssignments, useSalesOrders, type CurrencyCode, type IQDDisplayPreference } from '@/local-db'
import {
    Badge,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/components'
import { CommissionCurrencyTotalsView } from './CommissionCurrencyTotals'
import { summarizeCommissionEntries } from './agentCommissionPresentation'
import { useCommissionAgentDirectory } from './useCommissionAgentDirectory'
import { AgentCommissionSettlementDialog } from './AgentCommissionSettlementDialog'

export function AgentCommissionAdminOverview({
    workspaceId,
    iqdPreference,
    defaultCurrency,
    canSettle = false,
    userId
}: {
    workspaceId: string
    iqdPreference: IQDDisplayPreference
    defaultCurrency: CurrencyCode
    canSettle?: boolean
    userId?: string | null
}) {
    const entries = useAgentCommissionEntries(workspaceId)
    const assignments = useSalesOrderAgentAssignments(workspaceId)
    const salesOrders = useSalesOrders(workspaceId)
    const directory = useCommissionAgentDirectory(workspaceId)
    const [settlementAgentId, setSettlementAgentId] = useState<string | null>(null)
    const summary = useMemo(() => summarizeCommissionEntries(entries), [entries])
    const currentAssignments = useMemo(
        () => assignments.filter((assignment) => !assignment.isDeleted && !assignment.unassignedAt),
        [assignments]
    )
    const salesOrderById = useMemo(() => new Map(salesOrders.map((order) => [order.id, order])), [salesOrders])
    const rows = useMemo(() => directory.agents
        .map((entry) => {
            const agentOrders = currentAssignments
                .filter((assignment) => assignment.agentId === entry.agent.id)
                .flatMap((assignment) => {
                    const order = salesOrderById.get(assignment.orderId)
                    return order ? [order] : []
                })
            return {
                entry,
                summary: summarizeCommissionEntries(entries.filter((ledgerEntry) => ledgerEntry.agentId === entry.agent.id)),
                assignedOrders: agentOrders.length,
                openOrders: agentOrders.filter((order) => order.status === 'draft' || order.status === 'pending').length,
                cancelledOrders: agentOrders.filter((order) => order.status === 'cancelled').length,
                returnedOrders: agentOrders.filter((order) => order.returnStatus === 'partial' || order.returnStatus === 'full').length,
                zeroValueOrders: agentOrders.filter((order) => order.total <= 0).length
            }
        })
        .filter((row) => row.entry.membership || row.summary.entryCount > 0 || row.assignedOrders > 0)
        .sort((left, right) => right.assignedOrders - left.assignedOrders || left.entry.name.localeCompare(right.entry.name)),
    [currentAssignments, directory.agents, entries, salesOrderById])

    return (
        <Card className="border-violet-500/20 bg-violet-500/[0.02]">
            <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                    <BadgePercent className="h-5 w-5 text-violet-600" />
                    Sales Agent Commissions
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                    Workspace-wide assignment and commission pipeline. Currency totals remain separate.
                </p>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <OverviewMetric
                        label="Assigned orders"
                        icon={ReceiptText}
                        value={String(currentAssignments.length)}
                    />
                    <OverviewMetric
                        label="Recognized earned"
                        icon={BadgeCheck}
                        value={<CommissionCurrencyTotalsView totals={summary.earned} iqdPreference={iqdPreference} />}
                    />
                    <OverviewMetric
                        label="Approved"
                        icon={BadgePercent}
                        value={<CommissionCurrencyTotalsView totals={summary.approved} iqdPreference={iqdPreference} />}
                    />
                    <OverviewMetric
                        label="Paid / reversed"
                        icon={RotateCcw}
                        value={(
                            <span className="flex flex-col gap-0.5">
                                <CommissionCurrencyTotalsView totals={summary.paid} iqdPreference={iqdPreference} />
                                <span className="text-xs font-medium text-rose-600">
                                    <CommissionCurrencyTotalsView totals={summary.reversed} iqdPreference={iqdPreference} />
                                </span>
                            </span>
                        )}
                    />
                    <OverviewMetric
                        label="Due"
                        icon={CircleDollarSign}
                        value={<CommissionCurrencyTotalsView totals={summary.due} iqdPreference={iqdPreference} />}
                    />
                </div>

                {rows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                        Configure plans and assign sales orders to start the commission dashboard.
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-2xl border bg-background">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Agent</TableHead>
                                    <TableHead>Plan</TableHead>
                                    <TableHead className="text-end">Orders</TableHead>
                                    <TableHead className="text-end">Open</TableHead>
                                    <TableHead className="text-end">Returned</TableHead>
                                    <TableHead className="text-end">Cancelled / zero</TableHead>
                                    <TableHead className="text-end">Recognized</TableHead>
                                    <TableHead className="text-end">Approved</TableHead>
                                    <TableHead className="text-end">Paid</TableHead>
                                    <TableHead className="text-end">Reversed</TableHead>
                                    <TableHead className="text-end">Due</TableHead>
                                    {canSettle ? <TableHead className="text-end">Action</TableHead> : null}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map(({ entry, summary: agentSummary, assignedOrders, openOrders, returnedOrders, cancelledOrders, zeroValueOrders }) => (
                                    <TableRow key={entry.agent.id}>
                                        <TableCell>
                                            <div className="font-semibold">{entry.name}</div>
                                            <div className="text-xs text-muted-foreground">{entry.agent.zone}</div>
                                        </TableCell>
                                        <TableCell>
                                            {entry.plan ? (
                                                <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                                                    {entry.plan.name} · {entry.plan.ratePercent}%
                                                </Badge>
                                            ) : <span className="text-sm text-muted-foreground">No plan</span>}
                                        </TableCell>
                                        <TableCell className="text-end font-semibold">{assignedOrders}</TableCell>
                                        <TableCell className="text-end font-semibold text-amber-600">{openOrders}</TableCell>
                                        <TableCell className="text-end font-semibold text-orange-600">{returnedOrders}</TableCell>
                                        <TableCell className="text-end font-semibold text-rose-600">{cancelledOrders} / {zeroValueOrders}</TableCell>
                                        <TableCell className="text-end font-semibold"><CommissionCurrencyTotalsView totals={agentSummary.earned} iqdPreference={iqdPreference} /></TableCell>
                                        <TableCell className="text-end font-semibold"><CommissionCurrencyTotalsView totals={agentSummary.approved} iqdPreference={iqdPreference} /></TableCell>
                                        <TableCell className="text-end font-semibold text-emerald-600"><CommissionCurrencyTotalsView totals={agentSummary.paid} iqdPreference={iqdPreference} /></TableCell>
                                        <TableCell className="text-end font-semibold text-rose-600"><CommissionCurrencyTotalsView totals={agentSummary.reversed} iqdPreference={iqdPreference} /></TableCell>
                                        <TableCell className="text-end font-black"><CommissionCurrencyTotalsView totals={agentSummary.due} iqdPreference={iqdPreference} /></TableCell>
                                        {canSettle ? (
                                            <TableCell className="text-end">
                                                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettlementAgentId(entry.agent.id)}>
                                                    <SlidersHorizontal className="h-3.5 w-3.5" /> Manage
                                                </Button>
                                            </TableCell>
                                        ) : null}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
            {settlementAgentId ? (
                <AgentCommissionSettlementDialog
                    open={true}
                    onOpenChange={(open) => { if (!open) setSettlementAgentId(null) }}
                    workspaceId={workspaceId}
                    agentId={settlementAgentId}
                    agentName={directory.agentById.get(settlementAgentId)?.name || 'Agent'}
                    entries={entries.filter((entry) => entry.agentId === settlementAgentId && !entry.isDeleted)}
                    iqdPreference={iqdPreference}
                    defaultCurrency={defaultCurrency}
                    userId={userId}
                />
            ) : null}
        </Card>
    )
}

function OverviewMetric({
    label,
    icon: Icon,
    value
}: {
    label: string
    icon: typeof ReceiptText
    value: React.ReactNode
}) {
    return (
        <div className="rounded-2xl border bg-background/80 p-4">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <Icon className="h-4 w-4" />
                {label}
            </div>
            <div className="mt-2 text-lg font-black">{value}</div>
        </div>
    )
}
