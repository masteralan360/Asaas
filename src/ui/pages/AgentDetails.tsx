import { useRoute } from 'wouter'

import { useAuth } from '@/auth'
import { PartnerDetailsView } from '@/ui/components/crm/PartnerDetailsView'

export function AgentDetails() {
    const { user } = useAuth()
    const [match, params] = useRoute('/agents/:agentId')

    if (!match || !params?.agentId || !user?.workspaceId) {
        return null
    }

    return (
        <PartnerDetailsView
            workspaceId={user.workspaceId}
            partnerId={params.agentId}
            kind="agent"
        />
    )
}
