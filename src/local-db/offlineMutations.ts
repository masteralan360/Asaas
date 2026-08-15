import { generateId } from '@/lib/utils'
import { isSchemaMismatchError, isSyncIntegrityError } from '@/sync/syncErrors'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

import { db } from './database'
import type { BusinessPartner, DeliveryMerchantProfile, OfflineMutation } from './models'

const LOCAL_ONLY_ENTITY_TYPES = new Set<OfflineMutation['entityType']>([
    'inventory_transfer_transactions'
])

function isCloudInventoryTransactionMutation(
    entityType: OfflineMutation['entityType'],
    payload: Record<string, unknown>
) {
    if (entityType !== 'inventory_transactions') {
        return true
    }

    const transactionType = payload.transactionType || payload.transaction_type
    return transactionType === 'stock_adjustment'
}

function payloadId(payload: Record<string, unknown>, camelCase: string, snakeCase: string) {
    const value = payload[camelCase] ?? payload[snakeCase]
    return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * A merchant profile may have been created while a workspace was local, then
 * later be used to create a cloud shipment. When that shipment is explicitly
 * retried, requeue its local prerequisites so the server can receive the
 * profile, shipment, and event in dependency order.
 */
async function requeueDeliveryShipmentParents(
    workspaceId: string,
    mutations: OfflineMutation[]
) {
    const shipmentMutations = mutations.filter(
        (mutation) => mutation.entityType === 'delivery_shipments'
    )
    if (shipmentMutations.length === 0) return

    const profileIds = new Set<string>()
    const partnerIds = new Set<string>()
    for (const mutation of shipmentMutations) {
        const profileId = payloadId(mutation.payload, 'merchantProfileId', 'merchant_profile_id')
        const partnerId = payloadId(mutation.payload, 'merchantBusinessPartnerId', 'merchant_business_partner_id')
        if (profileId) profileIds.add(profileId)
        if (partnerId) partnerIds.add(partnerId)
    }

    const profiles = (await Promise.all(
        [...profileIds].map((profileId) => db.delivery_merchant_profiles.get(profileId))
    )).filter((profile): profile is DeliveryMerchantProfile => (
        !!profile
        && !profile.isDeleted
        && profile.workspaceId === workspaceId
    ))
    for (const profile of profiles) {
        partnerIds.add(profile.businessPartnerId)
    }

    const partners = (await Promise.all(
        [...partnerIds].map((partnerId) => db.business_partners.get(partnerId))
    )).filter((partner): partner is BusinessPartner => (
        !!partner
        && !partner.isDeleted
        && partner.workspaceId === workspaceId
    ))

    await Promise.all([
        ...partners.map((partner) => addToOfflineMutations(
            'business_partners',
            partner.id,
            partner.version > 1 ? 'update' : 'create',
            partner as unknown as Record<string, unknown>,
            workspaceId
        )),
        ...profiles.map((profile) => addToOfflineMutations(
            'delivery_merchant_profiles',
            profile.id,
            profile.version > 1 ? 'update' : 'create',
            profile as unknown as Record<string, unknown>,
            workspaceId
        ))
    ])
}

export async function addToOfflineMutations(
    entityType: OfflineMutation['entityType'],
    entityId: string,
    operation: OfflineMutation['operation'],
    payload: Record<string, unknown>,
    workspaceId: string
): Promise<void> {
    if (
        isLocalWorkspaceMode(workspaceId)
        || LOCAL_ONLY_ENTITY_TYPES.has(entityType)
        || !isCloudInventoryTransactionMutation(entityType, payload)
    ) {
        return
    }

    const existing = await db.offline_mutations
        .where('[entityType+entityId+status]')
        .equals([entityType, entityId, 'pending'])
        .first()

    if (existing) {
        if (operation === 'delete') {
            if (existing.operation === 'create') {
                await db.offline_mutations.delete(existing.id)
                return
            }

            await db.offline_mutations.update(existing.id, {
                operation: 'delete',
                payload: { ...payload, id: entityId },
                createdAt: new Date().toISOString()
            })
            return
        }

        if (operation === 'update' || operation === 'create') {
            await db.offline_mutations.update(existing.id, {
                operation: existing.operation === 'delete' ? 'update' : existing.operation,
                payload: { ...existing.payload, ...payload },
                createdAt: new Date().toISOString()
            })
            return
        }
    }

    await db.offline_mutations.add({
        id: generateId(),
        workspaceId,
        entityType,
        entityId,
        operation,
        payload,
        createdAt: new Date().toISOString(),
        status: 'pending'
    })
}

/**
 * Schema mismatches are intentionally excluded from automatic retries. A user
 * can explicitly retry them after the database migration has been deployed.
 */
export async function retrySchemaMismatchMutations(workspaceId: string): Promise<number> {
    const rows = await db.offline_mutations
        .where('status')
        .equals('failed')
        .filter((mutation) => mutation.workspaceId === workspaceId && isSchemaMismatchError(mutation.error))
        .toArray()

    if (rows.length === 0) return 0

    await db.offline_mutations.bulkUpdate(rows.map((mutation) => ({
        key: mutation.id,
        changes: {
            status: 'pending' as const,
            error: undefined
        }
    })))

    return rows.length
}

/**
 * Requeue deterministic server rejections only after a user explicitly asks
 * to retry. They must never be picked up by background retry loops.
 */
export async function retrySyncIntegrityMutations(workspaceId: string): Promise<number> {
    const rows = await db.offline_mutations
        .where('status')
        .equals('failed')
        .filter((mutation) => mutation.workspaceId === workspaceId && isSyncIntegrityError(mutation.error))
        .toArray()

    if (rows.length === 0) return 0

    await requeueDeliveryShipmentParents(workspaceId, rows)

    await db.offline_mutations.bulkUpdate(rows.map((mutation) => ({
        key: mutation.id,
        changes: {
            status: 'pending' as const,
            error: undefined
        }
    })))

    return rows.length
}
