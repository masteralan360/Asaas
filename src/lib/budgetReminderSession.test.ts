import { describe, expect, it, vi } from 'vitest'

import {
    getBudgetReminderSuppressionSnapshot,
    isExpenseReminderSuppressedForSession,
    subscribeToBudgetReminderSuppressions,
    suppressExpenseReminderForSession
} from './budgetReminderSession'

describe('budget reminder session suppression', () => {
    it('suppresses only the newly created expense occurrence and notifies subscribers once', () => {
        const listener = vi.fn()
        const unsubscribe = subscribeToBudgetReminderSuppressions(listener)
        const before = getBudgetReminderSuppressionSnapshot()

        suppressExpenseReminderForSession('workspace-test', 'series-test', '2026-06')
        suppressExpenseReminderForSession('workspace-test', 'series-test', '2026-06')

        const after = getBudgetReminderSuppressionSnapshot()
        expect(after).not.toBe(before)
        expect(isExpenseReminderSuppressedForSession(
            'workspace-test',
            'series-test',
            '2026-06',
            after
        )).toBe(true)
        expect(isExpenseReminderSuppressedForSession(
            'workspace-test',
            'series-test',
            '2026-07',
            after
        )).toBe(false)
        expect(listener).toHaveBeenCalledTimes(1)

        unsubscribe()
    })
})
