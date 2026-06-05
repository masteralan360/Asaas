import { describe, expect, it, vi } from 'vitest'
import type { ExchangeFeeRule } from './models'

vi.mock('./database', () => ({
    db: {
        exchange_transactions: {},
        exchange_fee_rules: {},
        fx_safes: {},
        fx_safe_balances: {},
        fx_safe_movements: {}
    }
}))

vi.mock('./hooks', () => ({
    addToOfflineMutations: vi.fn(),
    fetchTableFromSupabase: vi.fn()
}))

vi.mock('@/hooks/useNetworkStatus', () => ({
    useNetworkStatus: vi.fn(() => false)
}))

vi.mock('@/lib/network', () => ({
    isOnline: vi.fn(() => false)
}))

vi.mock('@/lib/supabaseSchema', () => ({
    getSupabaseClientForTable: vi.fn()
}))

vi.mock('@/lib/supabaseRequest', () => ({
    runSupabaseAction: vi.fn()
}))

vi.mock('@/lib/utils', () => ({
    generateId: vi.fn(() => 'generated-id'),
    toSnakeCase: vi.fn((value: string) => value)
}))

vi.mock('@/workspace/workspaceMode', () => ({
    isLocalWorkspaceMode: vi.fn(() => true)
}))

import {
    getExchangeFeeRuleTemporalStatus,
    isExchangeFeeRuleEffectiveForTransaction,
    resolveEffectiveExchangeFeeRule
} from './currencyExchange'

const baseRule = (overrides: Partial<ExchangeFeeRule> = {}): ExchangeFeeRule => ({
    id: 'rule-1',
    workspaceId: 'workspace-1',
    name: 'Rule',
    transactionScope: 'buy',
    feeType: 'fixed',
    currency: 'iqd',
    value: 1000,
    customerGivesBasisAmount: 100000,
    effectiveStartDate: '2026-06-05T10:00:00.000Z',
    effectiveEndDate: null,
    isActive: true,
    isLocked: false,
    notes: null,
    createdBy: null,
    createdAt: '2026-06-05T09:00:00.000Z',
    updatedAt: '2026-06-05T09:00:00.000Z',
    version: 1,
    isDeleted: false,
    syncStatus: 'synced',
    lastSyncedAt: '2026-06-05T09:00:00.000Z',
    ...overrides
})

describe('exchange fee rule effective dates', () => {
    it('does not apply a future-dated active rule before its start time', () => {
        const futureRule = baseRule()

        expect(isExchangeFeeRuleEffectiveForTransaction(
            futureRule,
            'buy',
            '2026-06-05T09:59:59.999Z',
            'iqd'
        )).toBe(false)
        expect(getExchangeFeeRuleTemporalStatus(futureRule, '2026-06-05T09:59:59.999Z')).toBe('pending')
    })

    it('applies a rule at the exact effective start time', () => {
        const rule = baseRule()

        expect(isExchangeFeeRuleEffectiveForTransaction(
            rule,
            'buy',
            '2026-06-05T10:00:00.000Z',
            'iqd'
        )).toBe(true)
        expect(getExchangeFeeRuleTemporalStatus(rule, '2026-06-05T10:00:00.000Z')).toBe('effective')
    })

    it('keeps open-ended rules effective after their start date', () => {
        const openEndedRule = baseRule({
            effectiveStartDate: '2026-06-01T00:00:00.000Z',
            effectiveEndDate: null
        })

        expect(isExchangeFeeRuleEffectiveForTransaction(
            openEndedRule,
            'buy',
            '2026-06-30T12:00:00.000Z',
            'iqd'
        )).toBe(true)
    })

    it('stops applying bounded rules after their effective end time', () => {
        const boundedRule = baseRule({
            effectiveStartDate: '2026-06-01T00:00:00.000Z',
            effectiveEndDate: '2026-06-05T17:00:00.000Z'
        })

        expect(isExchangeFeeRuleEffectiveForTransaction(
            boundedRule,
            'buy',
            '2026-06-05T17:00:00.000Z',
            'iqd'
        )).toBe(true)
        expect(isExchangeFeeRuleEffectiveForTransaction(
            boundedRule,
            'buy',
            '2026-06-05T17:00:00.001Z',
            'iqd'
        )).toBe(false)
        expect(getExchangeFeeRuleTemporalStatus(boundedRule, '2026-06-05T17:00:00.001Z')).toBe('ended')
    })

    it('resolves the newest rule that is effective for the selected transaction date', () => {
        const currentOpenRule = baseRule({
            id: 'current-rule',
            name: 'Current fee',
            effectiveStartDate: '2026-06-01T00:00:00.000Z',
            effectiveEndDate: null,
            updatedAt: '2026-06-01T00:00:00.000Z'
        })
        const tomorrowRule = baseRule({
            id: 'tomorrow-rule',
            name: 'Tomorrow fee',
            effectiveStartDate: '2026-06-06T00:00:00.000Z',
            effectiveEndDate: null,
            updatedAt: '2026-06-05T00:00:00.000Z'
        })

        expect(resolveEffectiveExchangeFeeRule(
            [tomorrowRule, currentOpenRule],
            'buy',
            '2026-06-05T23:59:59.999Z',
            'iqd'
        )?.id).toBe('current-rule')
        expect(resolveEffectiveExchangeFeeRule(
            [tomorrowRule, currentOpenRule],
            'buy',
            '2026-06-06T00:00:00.000Z',
            'iqd'
        )?.id).toBe('tomorrow-rule')
    })
})
