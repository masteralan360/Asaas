import { useMemo, useState } from 'react'
import { BadgePercent, MapPin, Pencil, Truck, UserRoundCheck } from 'lucide-react'

import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
    getActiveSalesOrderAgentAssignment,
    useAgentCommissionEntries,
    useSalesOrderAgentAssignments,
    type CurrencyCode,
    type IQDDisplayPreference
} from '@/local-db'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/ui/components'
import { commissionStatusClass, commissionStatusLabel } from './agentCommissionPresentation'
import { OrderAgentAssignmentDialog } from './OrderAgentAssignmentDialog'
import { useCommissionAgentDirectory } from './useCommissionAgentDirectory'

export function OrderAgentCommissionCard({
    workspaceId,
    orderId,
    iqdPreference,
    orderCurrency,
    defaultCustomerCity,
    canAssign,
    canViewAllCommission,
    canViewOwnCommission,
    userId
}: {
    workspaceId: string
    orderId: string
    iqdPreference: IQDDisplayPreference
    orderCurrency: CurrencyCode
    defaultCustomerCity?: string
    canAssign: boolean
    canViewAllCommission: boolean
    canViewOwnCommission: boolean
    userId?: string | null
}) {
    const assignments = useSalesOrderAgentAssignments(workspaceId)
    const entries = useAgentCommissionEntries(workspaceId)
    const directory = useCommissionAgentDirectory(workspaceId)
    const [dialogOpen, setDialogOpen] = useState(false)
    const assignment = getActiveSalesOrderAgentAssignment(assignments, orderId)
    const assignedAgent = assignment ? directory.agentById.get(assignment.agentId) : undefined
    const canViewCommission = canViewAllCommission
        || (canViewOwnCommission && Boolean(userId) && assignedAgent?.agent.linkedUserId === userId)
    const canViewAssignment = canAssign || canViewAllCommission || canViewCommission
    const orderEntries = useMemo(() => entries
        .filter((entry) => !entry.isDeleted && entry.orderId === orderId)
        .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()),
    [entries, orderId])
    const latestEntry = orderEntries[0]

    if (!canViewAssignment) return null

    return (
        <>
            <Card className="border-violet-500/20 bg-violet-500/[0.02]">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2">
                        <UserRoundCheck className="h-5 w-5 text-violet-600" />
                        Sales Agent
                    </CardTitle>
                    {canAssign ? (
                        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setDialogOpen(true)}>
                            <Pencil className="h-3.5 w-3.5" />
                            {assignment ? 'Change' : 'Assign'}
                        </Button>
                    ) : null}
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    {assignment ? (
                        <>
                            <div className="rounded-2xl border bg-background/80 p-4">
                                <div className="font-semibold">{assignedAgent?.name || 'Assigned field agent'}</div>
                                <div className="mt-1 text-xs text-muted-foreground">Assigned {formatDateTime(assignment.assignedAt)}</div>
                                {assignedAgent?.plan ? (
                                    <Badge variant="outline" className="mt-3 gap-1.5 border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                                        <BadgePercent className="h-3.5 w-3.5" />
                                        {assignedAgent.plan.name} · {assignedAgent.plan.ratePercent}%
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="mt-3 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                        No commission plan
                                    </Badge>
                                )}
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                                <div className="rounded-2xl border bg-background/70 p-3">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        <MapPin className="h-3.5 w-3.5" /> Customer city
                                    </div>
                                    <div className="mt-1 font-medium">{assignment.customerCitySnapshot || '—'}</div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-3">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        <Truck className="h-3.5 w-3.5" /> Delivery snapshot
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Customer charge</span>
                                        <span className="font-semibold">{formatCurrency(assignment.deliveryChargeAmount, (latestEntry?.currency as CurrencyCode | undefined) || orderCurrency, iqdPreference)}</span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Internal cost</span>
                                        <span className="font-semibold">{formatCurrency(assignment.internalDeliveryCostAmount, (latestEntry?.currency as CurrencyCode | undefined) || orderCurrency, iqdPreference)}</span>
                                    </div>
                                </div>
                            </div>
                            {canViewCommission ? (
                                latestEntry ? (
                                    <div className="rounded-2xl border bg-background/80 p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <Badge variant="outline" className={commissionStatusClass(latestEntry.status)}>
                                                {commissionStatusLabel(latestEntry.status)}
                                            </Badge>
                                            <span className="text-xl font-black">{formatCurrency(latestEntry.amount, latestEntry.currency as CurrencyCode, iqdPreference)}</span>
                                        </div>
                                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                                            <div>
                                                <div className="text-muted-foreground">Commission basis</div>
                                                <div className="mt-1 font-semibold">{formatCurrency(latestEntry.basisAmount, latestEntry.currency as CurrencyCode, iqdPreference)}</div>
                                            </div>
                                            <div className="text-end">
                                                <div className="text-muted-foreground">Rate snapshot</div>
                                                <div className="mt-1 font-semibold">{latestEntry.ratePercent}%</div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                                        Commission is calculated and accrued according to the order lifecycle and the agent's effective plan.
                                    </div>
                                )
                            ) : null}
                        </>
                    ) : (
                        <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                            No selling agent is assigned. The order creator remains available only as an audit field.
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">Post Service courier assignment is optional and remains separate.</p>
                </CardContent>
            </Card>

            {dialogOpen ? (
                <OrderAgentAssignmentDialog
                    open={true}
                    onOpenChange={setDialogOpen}
                    workspaceId={workspaceId}
                    orderId={orderId}
                    activeAssignment={assignment}
                    defaultCustomerCity={defaultCustomerCity}
                    assignedBy={userId}
                />
            ) : null}
        </>
    )
}
