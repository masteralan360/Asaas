import { describe, expect, it } from 'vitest'

import {
    WORKSPACE_PLANS,
    applyWorkspaceOverrides,
    getPlanCapabilities,
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
