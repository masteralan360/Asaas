import { describe, expect, it } from 'vitest'

import { isWorkspaceResolutionPending } from './workspaceLoading'

describe('workspace loading state', () => {
    it('stays pending during the first render after login', () => {
        expect(isWorkspaceResolutionPending({
            isLoading: false,
            isAuthenticated: true,
            workspaceId: 'workspace-1',
            resolvingWorkspaceId: null
        })).toBe(true)
    })

    it('stays pending while switching to another workspace', () => {
        expect(isWorkspaceResolutionPending({
            isLoading: false,
            isAuthenticated: true,
            workspaceId: 'workspace-2',
            resolvingWorkspaceId: 'workspace-1'
        })).toBe(true)
    })

    it('becomes ready only when loading finished for the authenticated workspace', () => {
        expect(isWorkspaceResolutionPending({
            isLoading: false,
            isAuthenticated: true,
            workspaceId: 'workspace-1',
            resolvingWorkspaceId: 'workspace-1'
        })).toBe(false)
    })

    it('does not invent workspace loading for a signed-out user', () => {
        expect(isWorkspaceResolutionPending({
            isLoading: false,
            isAuthenticated: false,
            workspaceId: null,
            resolvingWorkspaceId: null
        })).toBe(false)
    })
})
