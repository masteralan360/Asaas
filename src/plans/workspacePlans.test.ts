import { describe, expect, it } from 'vitest'

import {
    WORKSPACE_PLANS,
    applyWorkspaceOverrides,
    getPlanCapabilities,
    planHasModule
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
