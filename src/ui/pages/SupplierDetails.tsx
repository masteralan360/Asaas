import { useRoute } from 'wouter'

import { useAuth } from '@/auth'
import { PartnerDetailsView } from '@/ui/components/crm/PartnerDetailsView'

export function SupplierDetails() {
    const { user } = useAuth()
    const [match, params] = useRoute('/suppliers/:supplierId')

    if (!match || !params?.supplierId || !user?.workspaceId) {
        return null
    }

    return (
        <PartnerDetailsView
            workspaceId={user.workspaceId}
            partnerId={params.supplierId}
            kind="supplier"
        />
    )
}
