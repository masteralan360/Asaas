import { describe, expect, it } from 'vitest'

import {
    WORKSPACE_PLANS,
    applyWorkspaceOverrides,
    getPlanCapabilities,
    planHasCapability,
    planHasModule,
    planHasWorkspaceFeature
} from './workspacePlans'

describe('Agents workspace module access', () => {
    it('is not included in any workspace subscription plan', () => {
        for (const plan of WORKSPACE_PLANS) {
            expect(planHasModule(plan, 'agents')).toBe(false)
        }
    })

    it('is enabled only by a workspace module grant override', () => {
        const resolved = applyWorkspaceOverrides(getPlanCapabilities('enterprise'), [{
            id: 'override-agents',
            workspace_id: 'workspace-1',
            type: 'module',
            key: 'agents',
            value: 'grant',
            created_by: null,
            created_at: new Date(0).toISOString()
        }])

        expect(resolved.modules).toContain('agents')
    })
})

describe('Instant POS and KDS workspace module access', () => {
    it('is not included in any workspace subscription plan', () => {
        for (const plan of WORKSPACE_PLANS) {
            expect(planHasModule(plan, 'instant_pos')).toBe(false)
            expect(planHasModule(plan, 'kds')).toBe(false)
        }
    })

    it('is enabled only by workspace module grant overrides', () => {
        const resolved = applyWorkspaceOverrides(getPlanCapabilities('enterprise'), [
            {
                id: 'override-instant-pos',
                workspace_id: 'workspace-1',
                type: 'module',
                key: 'instant_pos',
                value: 'grant',
                created_by: null,
                created_at: new Date(0).toISOString()
            },
            {
                id: 'override-kds',
                workspace_id: 'workspace-1',
                type: 'module',
                key: 'kds',
                value: 'grant',
                created_by: null,
                created_at: new Date(0).toISOString()
            }
        ])

        expect(resolved.modules).toEqual(expect.arrayContaining(['instant_pos', 'kds']))
    })
})

describe('Orders workspace module access', () => {
    it('maps the orders feature to the revocable orders module', () => {
        expect(planHasWorkspaceFeature('enterprise', 'orders')).toBe(true)
        expect(planHasWorkspaceFeature('basic', 'orders')).toBe(false)
    })

    it('can be revoked from an enterprise workspace by module override', () => {
        const resolved = applyWorkspaceOverrides(getPlanCapabilities('enterprise'), [{
            id: 'override-orders',
            workspace_id: 'workspace-1',
            type: 'module',
            key: 'orders',
            value: 'revoke',
            created_by: null,
            created_at: new Date(0).toISOString()
        }])

        expect(resolved.modules).not.toContain('orders')
    })
})

describe('Order free bonus capability access', () => {
    it('is not included in any workspace subscription plan', () => {
        for (const plan of WORKSPACE_PLANS) {
            expect(planHasCapability(plan, 'orderFreeBonus')).toBe(false)
        }
    })

    it('is enabled only by a workspace capability grant override', () => {
        const resolved = applyWorkspaceOverrides(getPlanCapabilities('enterprise'), [{
            id: 'override-order-free-bonus',
            workspace_id: 'workspace-1',
            type: 'capability',
            key: 'orderFreeBonus',
            value: 'grant',
            created_by: null,
            created_at: new Date(0).toISOString()
        }])

        expect(resolved.capabilities).toContain('orderFreeBonus')
    })
})

describe('Price Books capability access', () => {
    it('is not included in any workspace subscription plan', () => {
        for (const plan of WORKSPACE_PLANS) {
            expect(planHasCapability(plan, 'priceBooks')).toBe(false)
        }
    })

    it('is enabled only by a workspace capability grant override', () => {
        const resolved = applyWorkspaceOverrides(getPlanCapabilities('enterprise'), [{
            id: 'override-price-books',
            workspace_id: 'workspace-1',
            type: 'capability',
            key: 'priceBooks',
            value: 'grant',
            created_by: null,
            created_at: new Date(0).toISOString()
        }])

        expect(resolved.capabilities).toContain('priceBooks')
    })
})
