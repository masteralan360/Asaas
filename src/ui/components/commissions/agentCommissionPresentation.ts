import type {
    AgentCommissionEntry,
    AgentCommissionMembership,
    AgentCommissionPlan,
    CommissionEntryStatus,
    CommissionPlanLevel
} from '@/local-db'

export const COMMISSION_LEVELS: CommissionPlanLevel[] = ['level_1', 'level_2', 'level_3']

export function getCommissionLevelLabel(level: CommissionPlanLevel) {
    switch (level) {
        case 'level_1': return 'Level 1'
        case 'level_2': return 'Level 2'
        case 'level_3': return 'Level 3'
    }
}

export function getActiveAgentCommissionMembership(
    memberships: AgentCommissionMembership[],
    agentId: string,
    at = new Date()
) {
    const atMs = at.getTime()

    return memberships
        .filter((membership) => {
            if (membership.agentId !== agentId || membership.isDeleted) return false
            const startsAt = new Date(membership.effectiveFrom).getTime()
            const endsAt = membership.effectiveTo ? new Date(membership.effectiveTo).getTime() : Number.POSITIVE_INFINITY
            return startsAt <= atMs && endsAt > atMs
        })
        .sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime())[0]
}

export function getCurrentCommissionPlanRevision(
    plans: readonly AgentCommissionPlan[],
    level: CommissionPlanLevel
) {
    const allLevelRevisions = plans
        .filter((plan) => plan.level === level && !plan.isDeleted)
        .sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime()
            || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())

    return allLevelRevisions.find((plan) => plan.isActive || plan.effectiveTo == null)
        || allLevelRevisions[0]
}

export type CommissionCurrencyTotals = Record<string, number>

export interface CommissionEntrySummary {
    estimated: CommissionCurrencyTotals
    earned: CommissionCurrencyTotals
    approved: CommissionCurrencyTotals
    paid: CommissionCurrencyTotals
    reversed: CommissionCurrencyTotals
    due: CommissionCurrencyTotals
    orderCount: number
    entryCount: number
}

function addCurrencyAmount(totals: CommissionCurrencyTotals, currency: string, amount: number) {
    const normalizedCurrency = currency.toLowerCase()
    totals[normalizedCurrency] = (totals[normalizedCurrency] || 0) + amount
}

export function summarizeCommissionEntries(entries: AgentCommissionEntry[]): CommissionEntrySummary {
    const summary: CommissionEntrySummary = {
        estimated: {},
        earned: {},
        approved: {},
        paid: {},
        reversed: {},
        due: {},
        orderCount: 0,
        entryCount: entries.filter((entry) => !entry.isDeleted).length
    }
    const orderIds = new Set<string>()

    const activeEntries = entries.filter((entry) => !entry.isDeleted)
    const entryById = new Map(activeEntries.map((entry) => [entry.id, entry]))
    const approvedSourceIds = new Set(activeEntries
        .filter((entry) => entry.kind === 'approval' && entry.relatedEntryId)
        .map((entry) => entry.relatedEntryId as string))
    const recognizedChildrenBySourceId = new Map<string, AgentCommissionEntry[]>()

    for (const entry of activeEntries) {
        if (!entry.relatedEntryId || (entry.kind !== 'reversal' && entry.kind !== 'adjustment')) continue
        const relatedEntries = recognizedChildrenBySourceId.get(entry.relatedEntryId) || []
        relatedEntries.push(entry)
        recognizedChildrenBySourceId.set(entry.relatedEntryId, relatedEntries)
    }

    for (const entry of activeEntries) {
        if (entry.orderId) orderIds.add(entry.orderId)
        if (entry.kind === 'estimate') {
            addCurrencyAmount(summary.estimated, entry.currency, entry.amount)
        }
        if (entry.kind === 'accrual' || entry.kind === 'reversal' || entry.kind === 'adjustment') {
            addCurrencyAmount(summary.earned, entry.currency, entry.amount)
            addCurrencyAmount(summary.due, entry.currency, entry.amount)
        }
        if (entry.kind === 'reversal') {
            addCurrencyAmount(summary.reversed, entry.currency, entry.amount)
        }
        if (entry.kind === 'payout') {
            addCurrencyAmount(summary.paid, entry.currency, Math.abs(entry.amount))
            addCurrencyAmount(summary.due, entry.currency, entry.amount)
        }
    }

    const approvedEntryIds = new Set<string>()
    const pendingApprovedEntryIds = [...approvedSourceIds]

    while (pendingApprovedEntryIds.length > 0) {
        const approvedEntryId = pendingApprovedEntryIds.pop() as string
        if (approvedEntryIds.has(approvedEntryId)) continue
        approvedEntryIds.add(approvedEntryId)

        const approvedEntry = entryById.get(approvedEntryId)
        if (approvedEntry) addCurrencyAmount(summary.approved, approvedEntry.currency, approvedEntry.amount)

        for (const childEntry of recognizedChildrenBySourceId.get(approvedEntryId) || []) {
            if (!approvedEntryIds.has(childEntry.id)) pendingApprovedEntryIds.push(childEntry.id)
        }
    }

    summary.orderCount = orderIds.size
    return summary
}

export function commissionStatusLabel(status: CommissionEntryStatus) {
    switch (status) {
        case 'estimated': return 'Estimated'
        case 'earned': return 'Earned'
        case 'approved': return 'Approved'
        case 'paid': return 'Paid'
        case 'reversed': return 'Reversed'
    }
}

export function commissionStatusClass(status: CommissionEntryStatus) {
    switch (status) {
        case 'estimated': return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
        case 'earned': return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        case 'approved': return 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
        case 'paid': return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        case 'reversed': return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
    }
}
