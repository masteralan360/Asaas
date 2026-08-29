import { beforeAll, describe, expect, it } from 'vitest'

import type { ProductCommissionRule, ProductCommissionRuleAgent } from '@/local-db'

import type { ProductCommissionPreviewItem } from './ProductCommissionPreview'

const AT = '2026-08-29T12:00:00.000Z'
let hasEligibleProductCommission: typeof import('./ProductCommissionPreview').hasEligibleProductCommission

beforeAll(async () => {
    const values = new Map<string, string>()
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear()
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            visibilityState: 'visible',
            documentElement: { lang: 'en', dir: 'ltr' },
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }
    })
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: false }
    })
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: storage,
            sessionStorage: storage,
            location: { hash: '', origin: 'http://localhost', pathname: '/' },
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }
    })
    ;({ hasEligibleProductCommission } = await import('./ProductCommissionPreview'))
})

function rule(scope: ProductCommissionRule['recipientScope']): ProductCommissionRule {
    return {
        id: 'rule-1',
        workspaceId: 'workspace-1',
        productId: 'product-1',
        commissionType: 'fixed_amount',
        ratePercent: 0,
        fixedAmount: 5000,
        fixedCurrency: 'iqd',
        recipientScope: scope,
        effectiveFrom: '2026-08-01T00:00:00.000Z',
        effectiveTo: null,
        isActive: true,
        notes: null,
        createdBy: null,
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        isDeleted: false,
        syncStatus: 'synced',
        lastSyncedAt: AT
    }
}

const items: ProductCommissionPreviewItem[] = [{
    id: 'line-1', productId: 'product-1', productName: 'Commissioned product', quantity: 2, convertedUnitPrice: 15000
}]

describe('hasEligibleProductCommission', () => {
    it('automatically qualifies an assigned agent for all-assigned product rules', () => {
        expect(hasEligibleProductCommission({
            items,
            agentIds: ['agent-1'],
            rules: [rule('all_assigned')],
            recipients: [],
            at: AT
        })).toBe(true)
    })

    it('only qualifies an explicitly selected recipient for selected-agent rules', () => {
        const recipients: ProductCommissionRuleAgent[] = [{
            id: 'recipient-1',
            workspaceId: 'workspace-1',
            ruleId: 'rule-1',
            agentId: 'agent-allowed',
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            isDeleted: false,
            syncStatus: 'synced',
            lastSyncedAt: AT
        }]
        expect(hasEligibleProductCommission({
            items,
            agentIds: ['agent-other'],
            rules: [rule('selected_assigned')],
            recipients,
            at: AT
        })).toBe(false)
        expect(hasEligibleProductCommission({
            items,
            agentIds: ['agent-allowed'],
            rules: [rule('selected_assigned')],
            recipients,
            at: AT
        })).toBe(true)
    })
})
