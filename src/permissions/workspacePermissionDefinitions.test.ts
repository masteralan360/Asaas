import { describe, expect, it } from 'vitest'

import {
    getWorkspacePermissionModule,
    isSupportedWorkspacePermissionKey,
    WORKSPACE_PERMISSION_DEFINITIONS,
} from './workspacePermissionDefinitions'

describe('view-own workspace permissions', () => {
    it('defines every supported module key with a matching database module', () => {
        const expected = [
            'orders.view_own',
            'sales.view_own',
            'loans.view_own',
            'installments.view_own',
            'invoice_history.view_own',
        ]

        for (const key of expected) {
            expect(isSupportedWorkspacePermissionKey(key)).toBe(true)
            expect(getWorkspacePermissionModule(key)).toBe(key.split('.')[0])
            expect(WORKSPACE_PERMISSION_DEFINITIONS).toContainEqual(
                expect.objectContaining({ key, module: key.split('.')[0] }),
            )
        }
    })
})
