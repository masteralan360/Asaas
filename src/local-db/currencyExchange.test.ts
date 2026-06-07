import { describe, expect, it, vi } from 'vitest'
import type { ExchangeFeeRule, ExchangePairPrice } from './models'

vi.mock('./database', () => ({
    db: {
        exchange_pair_prices: {},
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
    calculateExchangeTransaction,
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

const basePairPrice = (overrides: Partial<ExchangePairPrice> = {}): ExchangePairPrice => ({
    id: 'price-1',
    workspaceId: 'workspace-1',
    baseCurrency: 'usd',
    quoteCurrency: 'eur',
    buyPrice: 92,
    sellPrice: 93,
    priceBasisAmount: 100,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-06-05T09:00:00.000Z',
    updatedAt: '2026-06-05T09:00:00.000Z',
    version: 1,
    isDeleted: false,
    syncStatus: 'synced',
    lastSyncedAt: '2026-06-05T09:00:00.000Z',
    ...overrides
})

describe('manual exchange pair price calculations', () => {
    it('buys the base currency using the pair buy price', () => {
        const result = calculateExchangeTransaction({
            transactionType: 'buy',
            pairPrice: basePairPrice(),
            customerGivesAmount: 100
        })

        expect(result.baseReceivesAmount).toBe(92)
        expect(result.customerReceivesAmount).toBe(92)
    })

    it('sells the base currency using the pair sell price', () => {
        const result = calculateExchangeTransaction({
            transactionType: 'sell',
            pairPrice: basePairPrice(),
            customerGivesAmount: 93
        })

        expect(result.baseReceivesAmount).toBe(100)
        expect(result.customerReceivesAmount).toBe(100)
    })

    it('does not invert the reversed ordered pair', () => {
        const reversed = basePairPrice({
            id: 'price-2',
            baseCurrency: 'eur',
            quoteCurrency: 'usd',
            buyPrice: 108,
            sellPrice: 109
        })

        const result = calculateExchangeTransaction({
            transactionType: 'buy',
            pairPrice: reversed,
            customerGivesAmount: 100
        })

        expect(result.customerReceivesAmount).toBe(108)
    })

    it('blocks missing or zero side prices', () => {
        expect(() => calculateExchangeTransaction({
            transactionType: 'buy',
            pairPrice: basePairPrice({ buyPrice: 0 }),
            customerGivesAmount: 100
        })).toThrow('Exchange pair price is required')

        expect(() => calculateExchangeTransaction({
            transactionType: 'sell',
            pairPrice: basePairPrice({ sellPrice: 0 }),
            customerGivesAmount: 93
        })).toThrow('Exchange pair price is required')
    })

    it('applies fees against the customer-gives currency and deducts the converted fee from receives', () => {
        const result = calculateExchangeTransaction({
            transactionType: 'buy',
            pairPrice: basePairPrice(),
            customerGivesAmount: 100,
            feeType: 'fixed',
            feeCurrency: 'usd',
            feeValue: 10,
            feeBasisAmount: 100
        })

        expect(result.baseReceivesAmount).toBe(92)
        expect(result.feeAmount).toBe(10)
        expect(result.feeAmountInToCurrency).toBe(9.2)
        expect(result.customerReceivesAmount).toBe(82.8)
    })

    it('rejects fees in a currency other than customer-gives currency', () => {
        expect(() => calculateExchangeTransaction({
            transactionType: 'buy',
            pairPrice: basePairPrice(),
            customerGivesAmount: 100,
            feeType: 'fixed',
            feeCurrency: 'eur',
            feeValue: 10,
            feeBasisAmount: 100
        })).toThrow('Exchange fees must use the customer-gives currency')
    })
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
