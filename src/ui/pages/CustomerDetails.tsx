import { useRoute } from 'wouter'

import { useAuth } from '@/auth'
import { PartnerDetailsView } from '@/ui/components/crm/PartnerDetailsView'

export function CustomerDetails() {
    const { user } = useAuth()
    const [match, params] = useRoute('/customers/:customerId')

    if (!match || !params?.customerId || !user?.workspaceId) {
        return null
    }

    return (
        <PartnerDetailsView
            workspaceId={user.workspaceId}
            partnerId={params.customerId}
            kind="customer"
        />
    )
}
