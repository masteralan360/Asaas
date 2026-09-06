import { getActiveBusinessUserId } from '@/lib/network'

import { db } from './database'
import type { BusinessPartner, BusinessPartnerStaffVisibility } from './models'

export type BusinessPartnerPrivacyActor = {
    id: string | null
    isAdmin: boolean
}

export type BusinessPartnerPrivacyContext = {
    privateStaffCustomers: boolean
    privateStaffSuppliers: boolean
    suppliersAdminOnly: boolean
    actor: BusinessPartnerPrivacyActor
}

export type BusinessPartnerPrivacyScope = 'customer' | 'supplier'

export async function getBusinessPartnerPrivacyContext(
    workspaceId: string
): Promise<BusinessPartnerPrivacyContext> {
    const [workspace, userId] = await Promise.all([
        db.workspaces.get(workspaceId),
        Promise.resolve(getActiveBusinessUserId())
    ])
    const localUser = userId
        ? await db.users.get(userId) ?? await db.profiles.get(userId)
        : undefined

    return {
        privateStaffCustomers: workspace?.private_staff_customers === true,
        privateStaffSuppliers: workspace?.private_staff_suppliers === true,
        suppliersAdminOnly: workspace?.suppliers_admin_only === true,
        actor: {
            id: userId,
            isAdmin: localUser?.role === 'admin'
        }
    }
}

export function getBusinessPartnerStaffVisibility(
    partner: BusinessPartner
): BusinessPartnerStaffVisibility {
    return partner.staffVisibility ?? 'shared'
}

export function canAccessBusinessPartner(
    partner: BusinessPartner,
    context: BusinessPartnerPrivacyContext,
    scope: BusinessPartnerPrivacyScope = 'customer'
): boolean {
    if (context.actor.isAdmin) {
        return true
    }

    if (scope === 'supplier' && context.suppliersAdminOnly) {
        return false
    }

    const visibility = getBusinessPartnerStaffVisibility(partner)
    if (visibility === 'admin_only') {
        return false
    }
    if (visibility === 'owner_private' && partner.ownerUserId !== context.actor.id) {
        return false
    }

    return !(scope === 'supplier' && partner.role === 'customer')
}

export async function canAccessBusinessPartnerInLocalCache(
    workspaceId: string,
    businessPartnerId: string | null | undefined,
    scope: BusinessPartnerPrivacyScope = 'customer'
): Promise<boolean> {
    if (!businessPartnerId) {
        return true
    }

    const [partner, context] = await Promise.all([
        db.business_partners.get(businessPartnerId),
        getBusinessPartnerPrivacyContext(workspaceId)
    ])
    return Boolean(
        partner
        && !partner.isDeleted
        && partner.workspaceId === workspaceId
        && canAccessBusinessPartner(partner, context, scope)
    )
}

export async function canAccessBusinessPartnerFacetInLocalCache(
    workspaceId: string,
    facetId: string | null | undefined,
    scope: BusinessPartnerPrivacyScope
): Promise<boolean> {
    if (!facetId) {
        return true
    }

    const facet = scope === 'supplier'
        ? await db.suppliers.get(facetId)
        : await db.customers.get(facetId)
    if (!facet || facet.isDeleted || facet.workspaceId !== workspaceId) {
        return false
    }

    return canAccessBusinessPartnerInLocalCache(
        workspaceId,
        facet.businessPartnerId,
        scope
    )
}
