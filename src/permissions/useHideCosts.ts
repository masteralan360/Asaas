import { useAuth } from '@/auth'

import { useWorkspacePermissions } from './WorkspacePermissionsContext'

/** True only for non-admin members explicitly assigned the Hide Costs restriction. */
export function useHideCosts() {
    const { user } = useAuth()
    const { hasPermission } = useWorkspacePermissions()

    return user?.role !== 'admin' && hasPermission('global.hideCosts')
}
