import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
    rpc: vi.fn()
}))

vi.mock('@/auth/supabase', () => ({
    supabase: {
        rpc: testState.rpc
    }
}))

vi.mock('@/lib/supabaseRequest', () => ({
    runSupabaseAction: vi.fn((_label: string, action: () => PromiseLike<unknown>) => action()),
    normalizeSupabaseActionError: (error: unknown) => error instanceof Error ? error : new Error(String(error))
}))

import {
    WORKSPACE_PAYMENT_CURRENCY,
    canSubmitWorkspacePayment,
    formatWorkspacePaymentDecimal,
    getWorkspacePaymentAlertKind,
    getWorkspacePaymentQrPath,
    hasWorkspacePaymentAccessStateUpdate,
    hasNewlyApprovedWorkspacePayment,
    hasWorkspacePaymentAccessBeenRestored,
    isWorkspacePaymentProvider,
    normalizeWorkspacePaymentSummary,
    shouldApplyWorkspaceSubscriptionExpiry,
    shouldWorkspacePaymentLockAccess,
    submitWorkspacePayment,
    workspacePaymentTestInternals,
    type WorkspacePaymentSummary
} from './workspacePayments'

const transaction = (overrides: Record<string, unknown> = {}) => ({
    id: 'transaction-1',
    provider: 'fib',
    amount: 25_000,
    currency: 'IQD',
    gb_added: 10,
    payment_type: 'usage',
    status: 'pending',
    expires_at: '2026-07-16T12:00:00.000Z',
    paid_at: null,
    review_note: null,
    created_at: '2026-07-15T12:00:00.000Z',
    ...overrides
})

const summary = (overrides: Record<string, unknown> = {}) => normalizeWorkspacePaymentSummary({
    workspace_id: 'workspace-1',
    billing_workspace_id: 'workspace-1',
    workspace_name: 'Atlas Shop',
    configuration: {
        id: 'configuration-1',
        workspace_id: 'workspace-1',
        subscription_amount: 30_000,
        currency: 'USD',
        is_payment_enabled: true,
        usage_enabled: true,
        gb_per_payment: 15,
        renewal_due_at: '2026-07-15T00:00:00.000Z'
    },
    eligibility: {
        subscription_expired: false,
        usage_exhausted: true,
        usage_renewal_due: false,
        alert_reason: 'usage_exhausted',
        payment_enabled: true
    },
    pending_transaction: transaction(),
    has_workspace_pending_transaction: true,
    transactions: [transaction()],
    ...overrides
})

describe('workspace payments', () => {
    beforeEach(() => {
        testState.rpc.mockReset()
        workspacePaymentTestInternals.resetSubmissionGuard()
    })

    it('normalizes server-owned configuration and transaction snapshots', () => {
        const result = summary({
            configuration: {
                id: 'configuration-1',
                workspace_id: 'workspace-1',
                subscription_amount: 99_000,
                currency: 'USD',
                is_payment_enabled: true,
                usage_enabled: true,
                gb_per_payment: 50
            },
            pending_transaction: transaction({ amount: 25_000, gb_added: 10 }),
            transactions: [transaction({ amount: 25_000, gb_added: 10 })]
        })

        expect(result.configuration).toMatchObject({
            subscriptionAmount: '99000',
            currency: WORKSPACE_PAYMENT_CURRENCY,
            gbPerPayment: '50'
        })
        expect(result.pendingTransaction).toMatchObject({
            amount: '25000',
            currency: 'IQD',
            gbAdded: '10'
        })
    })

    it('preserves and losslessly formats the full supported decimal range', () => {
        const result = summary({
            configuration: {
                id: 'configuration-1',
                workspace_id: 'workspace-1',
                subscription_amount: '99999999999999999.125',
                currency: 'IQD',
                is_payment_enabled: true,
                usage_enabled: true,
                gb_per_payment: '99999999.123456'
            }
        })

        expect(result.configuration?.subscriptionAmount).toBe('99999999999999999.125')
        expect(formatWorkspacePaymentDecimal(
            result.configuration?.subscriptionAmount ?? '0',
            'en',
            3
        )).toBe('99,999,999,999,999,999.125')
        expect(formatWorkspacePaymentDecimal(
            result.configuration?.gbPerPayment ?? '0',
            'en',
            6
        )).toBe('99,999,999.123456')
    })

    it('selects only supported providers and their exact QR assets', () => {
        expect(isWorkspacePaymentProvider('fib')).toBe(true)
        expect(isWorkspacePaymentProvider('qicard')).toBe(true)
        expect(isWorkspacePaymentProvider('other')).toBe(false)
        expect(getWorkspacePaymentQrPath('fib')).toBe('/atlas_fib_qr.svg')
        expect(getWorkspacePaymentQrPath('qicard')).toBe('/atlas_qi_card_qr.svg')
    })

    it('derives the usage and subscription alerts that lock access', () => {
        const exhausted = summary()
        const renewalDue = summary({
            eligibility: {
                subscription_expired: false,
                usage_exhausted: false,
                usage_renewal_due: true,
                alert_reason: 'subscription_expired',
                payment_enabled: true
            }
        })
        const expired = summary({
            eligibility: {
                subscription_expired: true,
                usage_exhausted: false,
                usage_renewal_due: false,
                alert_reason: 'subscription_expired',
                payment_enabled: true
            }
        })

        expect(getWorkspacePaymentAlertKind(exhausted)).toBe('usage_exhausted')
        expect(getWorkspacePaymentAlertKind(renewalDue)).toBe('subscription_expired')
        expect(getWorkspacePaymentAlertKind(expired)).toBe('subscription_expired')
        expect(shouldWorkspacePaymentLockAccess(expired)).toBe(true)
        expect(shouldWorkspacePaymentLockAccess(null)).toBe(false)
    })

    it('does not apply subscription expiry after the server enables usage billing', () => {
        const usageBilling = summary({
            eligibility: {
                subscription_expired: false,
                usage_exhausted: false,
                usage_renewal_due: false,
                alert_reason: null,
                payment_enabled: true
            }
        })
        const subscriptionBilling = summary({
            configuration: {
                id: 'configuration-1',
                workspace_id: 'workspace-1',
                subscription_amount: 30_000,
                currency: 'IQD',
                is_payment_enabled: true,
                usage_enabled: false,
                gb_per_payment: 0,
                renewal_due_at: null
            }
        })

        expect(shouldApplyWorkspaceSubscriptionExpiry({
            hasUsageLimits: false,
            summary: usageBilling
        })).toBe(true)
        expect(shouldApplyWorkspaceSubscriptionExpiry({
            hasUsageLimits: false,
            summary: subscriptionBilling
        })).toBe(true)
        expect(shouldApplyWorkspaceSubscriptionExpiry({
            hasUsageLimits: true,
            summary: null
        })).toBe(true)
        expect(shouldApplyWorkspaceSubscriptionExpiry({
            hasUsageLimits: false,
            summary: null
        })).toBe(true)
    })

    it('detects realtime access-state changes that require an immediate payment refresh', () => {
        const current = {
            lockedWorkspace: false,
            subscriptionExpiresAt: '2026-08-01T00:00:00.000Z'
        }

        expect(hasWorkspacePaymentAccessStateUpdate(current, {
            locked_workspace: true,
            subscription_expires_at: current.subscriptionExpiresAt
        })).toBe(true)
        expect(hasWorkspacePaymentAccessStateUpdate(current, {
            locked_workspace: false,
            subscription_expires_at: '2026-09-01T00:00:00.000Z'
        })).toBe(true)
        expect(hasWorkspacePaymentAccessStateUpdate(current, {
            locked_workspace: false,
            subscription_expires_at: current.subscriptionExpiresAt
        })).toBe(false)
    })

    it('blocks client submission while another payment is pending', () => {
        expect(canSubmitWorkspacePayment({
            provider: 'fib',
            isSubmitting: false,
            hasWorkspacePendingTransaction: true,
            pendingTransaction: summary().pendingTransaction
        })).toBe(false)
        expect(canSubmitWorkspacePayment({
            provider: 'qicard',
            isSubmitting: false,
            hasWorkspacePendingTransaction: false,
            pendingTransaction: null
        })).toBe(true)
    })

    it('detects a pending transaction becoming approved', () => {
        const previous = summary()
        const next = summary({
            pending_transaction: null,
            transactions: [transaction({ status: 'approved', paid_at: '2026-07-15T13:00:00.000Z' })]
        })

        expect(hasNewlyApprovedWorkspacePayment(previous, next)).toBe(true)
        expect(hasNewlyApprovedWorkspacePayment(next, next)).toBe(false)
    })

    it('detects workspace access restoration even when another user paid', () => {
        const blocked = summary({
            pending_transaction: null,
            transactions: [],
            has_workspace_pending_transaction: true
        })
        const restored = summary({
            eligibility: {
                subscription_expired: false,
                usage_exhausted: false,
                usage_renewal_due: false,
                alert_reason: null,
                payment_enabled: true
            },
            pending_transaction: null,
            transactions: [],
            has_workspace_pending_transaction: false
        })

        expect(hasWorkspacePaymentAccessBeenRestored(blocked, restored)).toBe(true)
        expect(hasWorkspacePaymentAccessBeenRestored(restored, restored)).toBe(false)
    })

    it('deduplicates concurrent submission attempts in the client', async () => {
        let resolveRpc!: (value: { data: unknown; error: null }) => void
        testState.rpc.mockReturnValue(new Promise((resolve) => {
            resolveRpc = resolve
        }))

        const first = submitWorkspacePayment('fib')
        const second = submitWorkspacePayment('qicard')

        expect(first).toBe(second)
        expect(testState.rpc).toHaveBeenCalledTimes(1)
        expect(testState.rpc).toHaveBeenCalledWith('submit_workspace_payment', { p_provider: 'fib' })

        resolveRpc({ data: transaction(), error: null })
        await expect(first).resolves.toMatchObject({ id: 'transaction-1', status: 'pending' })
        await expect(second).resolves.toMatchObject({ id: 'transaction-1', provider: 'fib' })
    })

    it('rejects unsupported providers before calling the server', async () => {
        await expect(submitWorkspacePayment('cash' as never)).rejects.toThrow('Unsupported payment provider')
        expect(testState.rpc).not.toHaveBeenCalled()
    })

    it('sorts transaction history newest first and derives pending from history', () => {
        const result: WorkspacePaymentSummary = summary({
            pending_transaction: null,
            transactions: [
                transaction({ id: 'older', created_at: '2026-07-14T10:00:00.000Z' }),
                transaction({ id: 'newer', status: 'rejected', created_at: '2026-07-15T10:00:00.000Z' })
            ]
        })

        expect(result.transactions.map(({ id }) => id)).toEqual(['newer', 'older'])
        expect(result.pendingTransaction?.id).toBe('older')
    })
})
