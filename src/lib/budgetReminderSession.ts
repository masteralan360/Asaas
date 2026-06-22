let suppressedExpenseReminderKeys = new Set<string>()
const listeners = new Set<() => void>()

function buildExpenseReminderKey(workspaceId: string, seriesId: string, month: string) {
    return `${workspaceId}:${seriesId}:${month}`
}

export function suppressExpenseReminderForSession(workspaceId: string, seriesId: string, month: string) {
    const key = buildExpenseReminderKey(workspaceId, seriesId, month)
    if (suppressedExpenseReminderKeys.has(key)) return

    suppressedExpenseReminderKeys = new Set(suppressedExpenseReminderKeys).add(key)
    listeners.forEach(listener => listener())
}

export function isExpenseReminderSuppressedForSession(
    workspaceId: string,
    seriesId: string,
    month: string,
    suppressedKeys: ReadonlySet<string> = suppressedExpenseReminderKeys
) {
    return suppressedKeys.has(buildExpenseReminderKey(workspaceId, seriesId, month))
}

export function subscribeToBudgetReminderSuppressions(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getBudgetReminderSuppressionSnapshot() {
    return suppressedExpenseReminderKeys
}
