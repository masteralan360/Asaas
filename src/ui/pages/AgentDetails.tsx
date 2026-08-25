import { useRoute } from 'wouter'

import { useAuth } from '@/auth'
import { PartnerDetailsView } from '@/ui/components/crm/PartnerDetailsView'
import { CommissionFeatureBoundary } from '@/ui/components/commissions/useCommissionAgentDirectory'
import { useWorkspace } from '@/workspace'
import { hasEffectiveSalesAgentCommissionPermission, useWorkspacePermissions } from '@/permissions'

export function AgentDetails() {
    const { user } = useAuth()
    const { hasFeature } = useWorkspace()
    const { permissionKeys } = useWorkspacePermissions()
    const [match, params] = useRoute('/agents/:agentId')

    if (!match || !params?.agentId || !user?.workspaceId) {
        return null
    }

    const hasCommissionAccess = hasFeature('sales_agent_commissions') && (
        hasEffectiveSalesAgentCommissionPermission(user.role, permissionKeys, 'salesAgentCommissions.viewAll')
        || hasEffectiveSalesAgentCommissionPermission(user.role, permissionKeys, 'salesAgentCommissions.viewOwn')
    )

    return (
        <CommissionFeatureBoundary enabled={hasCommissionAccess} workspaceId={user.workspaceId}>
        <PartnerDetailsView
            workspaceId={user.workspaceId}
            partnerId={params.agentId}
            kind="agent"
        />
        </CommissionFeatureBoundary>
    )
}
