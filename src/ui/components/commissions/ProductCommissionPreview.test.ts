import { beforeAll, describe, expect, it } from 'vitest'

import type { ProductCommissionRule, ProductCommissionRuleAgent } from '@/local-db'

import type { ProductCommissionPreviewItem } from './ProductCommissionPreview'
import {
    findLinkedProductCommissionAgent,
    findOwnedOrderCreatorProductCommissionAgent
} from './productCommissionAgent'

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
            head: { appendChild: () => undefined },
            getElementsByTagName: () => [{ appendChild: () => undefined }],
            createElement: () => ({
                setAttribute: () => undefined,
                appendChild: () => undefined
            }),
            createTextNode: () => ({}),
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }
    })
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: false }
    })
    Object.defineProperty(globalThis, 'DOMMatrix', {
        configurable: true,
        value: class DOMMatrix {}
    })
    Object.defineProperty(globalThis, 'ImageData', {
        configurable: true,
        value: class ImageData {}
    })
    Object.defineProperty(globalThis, 'Path2D', {
        configurable: true,
        value: class Path2D {}
    })
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
        configurable: true,
        value: () => 'blob:vitest'
    })
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: storage,
            sessionStorage: storage,
            URL: globalThis.URL,
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
    it('resolves only the active field agent linked to the order creator', () => {
        const eligible = {
            id: 'agent-eligible', linkedUserId: 'user-1', agentType: 'field_agent', status: 'active', isDeleted: false
        }
        const agents = [
            { id: 'agent-driver', linkedUserId: 'user-1', agentType: 'driver', status: 'active', isDeleted: false },
            { id: 'agent-inactive', linkedUserId: 'user-1', agentType: 'field_agent', status: 'inactive', isDeleted: false },
            eligible
        ]

        expect(findLinkedProductCommissionAgent(agents, 'user-1')).toBe(eligible)
        expect(findLinkedProductCommissionAgent(agents, 'missing-user')).toBeNull()
        expect(findLinkedProductCommissionAgent(agents, null)).toBeNull()
    })

    it('allows a linked agent to preview only an order they created', () => {
        const agent = {
            id: 'agent-1',
            linkedUserId: 'user-1',
            agentType: 'field_agent',
            status: 'active',
            isDeleted: false
        }

        expect(findOwnedOrderCreatorProductCommissionAgent([agent], 'user-1', 'user-1')).toBe(agent)
        expect(findOwnedOrderCreatorProductCommissionAgent([agent], 'user-1', 'user-2')).toBeNull()
        expect(findOwnedOrderCreatorProductCommissionAgent([agent], null, 'user-1')).toBeNull()
    })

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
