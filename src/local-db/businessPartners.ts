import { useCallback, useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { convertCurrencyAmountWithAvailableSnapshot, convertCurrencyAmountWithSnapshot } from '@/lib/orderCurrency'
import { isOnline } from '@/lib/network'
import { getSupabaseClientForTable } from '@/lib/supabaseSchema'
import { runSupabaseAction } from '@/lib/supabaseRequest'
import { getTravelSaleCost } from '@/lib/travelAgency'
import {
    canSelectProductForExcludedCategories,
    filterSelectableProducts,
    getAgentExcludedCategoryIds
} from '@/lib/agentProductSelection'
import { roundOrderValue } from '@/lib/orderPrecision'
import { generateId, toCamelCase } from '@/lib/utils'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

import { db } from './database'
import { fetchTableFromSupabase } from './hooks'
import { addToOfflineMutations } from './offlineMutations'
import { getOrderBalanceAmount } from './orderInstallments'
import { isDirectTransactionPartnerAccountEffect } from './payments'
import {
    endActiveFleetAssignmentsForAgent,
    ensureDriverFleetAssignment
} from './fleet'
import type {
    Agent,
    AgentExcludedCategory,
    AgentFacetInput,
    BusinessPartner,
    BusinessPartnerMergeCandidate,
    BusinessPartnerRole,
    CurrencyCode,
    Customer,
    Loan,
    PurchaseOrder,
    SalesOrder,
    Supplier,
    TravelAgencySale
} from './models'
import { isRealEstateBusinessPartnerRole } from './models'

type PartnerTableName = 'business_partners' | 'business_partner_merge_candidates' | 'customers' | 'suppliers' | 'agents' | 'agent_excluded_categories'
type PartnerFacetType = 'customer' | 'supplier'
type SyncEntity = { id: string; version: number } & Record<string, unknown>
type PartnerFilterOptions = {
    roles?: BusinessPartnerRole[]
    includeMerged?: boolean
    includeRealEstateRoles?: boolean
    includeAgentRoles?: boolean
}
type BusinessPartnerRoleAccessOptions = {
    allowRealEstateRoles?: boolean
    allowAgentRole?: boolean
}
export type BusinessPartnerCreateInput = Omit<
    BusinessPartner,
    'id'
    | 'workspaceId'
    | 'createdAt'
    | 'updatedAt'
    | 'syncStatus'
    | 'lastSyncedAt'
    | 'version'
    | 'isDeleted'
    | 'customerFacetId'
    | 'supplierFacetId'
    | 'agentFacetId'
    | 'totalSalesOrders'
    | 'totalSalesValue'
    | 'receivableBalance'
    | 'totalPurchaseOrders'
    | 'totalPurchaseValue'
    | 'payableBalance'
    | 'totalLoanCount'
    | 'loanOutstandingBalance'
    | 'netExposure'
    | 'mergedIntoBusinessPartnerId'
    | 'receivableCreditLimit'
    | 'payableCreditLimit'
> & {
    agent?: AgentFacetInput
    receivableCreditLimit?: number | null
    payableCreditLimit?: number | null
}
export type BusinessPartnerUpdateInput = Partial<BusinessPartner> & {
    agent?: Partial<AgentFacetInput>
}

type BaseEntityPayload = {
    id: string
    workspaceId: string
    createdAt: string
    updatedAt: string
    syncStatus: 'pending' | 'synced' | 'conflict'
    lastSyncedAt: string | null
    version: number
    isDeleted: boolean
}

function shouldUseCloudBusinessData(workspaceId?: string | null) {
    return !!workspaceId && !isLocalWorkspaceMode(workspaceId)
}

async function runMutation<T>(label: string, promiseFactory: () => PromiseLike<T>): Promise<T> {
    return runSupabaseAction(label, promiseFactory)
}

function getSyncMetadata(workspaceId: string, timestamp: string) {
    if (!shouldUseCloudBusinessData(workspaceId)) {
        return {
            syncStatus: 'synced' as const,
            lastSyncedAt: timestamp
        }
    }

    return {
        syncStatus: 'pending' as const,
        lastSyncedAt: null
    }
}

function normalizeRequiredPartnerName(value: unknown) {
    const partnerName = typeof value === 'string' ? value.trim() : ''
    if (!partnerName) {
        throw new Error('Partner name is required')
    }
    return partnerName
}

/**
 * A partially migrated cache row must never make the directory unusable.
 * Do not revive the retired `name` or `contactName` fields here: migrations
 * own that one-time conversion. This is only a safe display fallback while a
 * stale local or remote cache catches up.
 */
function normalizeRuntimePartnerName(partner: BusinessPartner): BusinessPartner {
    const { email: _email, country: _country, ...activePartner } = partner as BusinessPartner & {
        email?: unknown
        country?: unknown
    }
    const partnerName = typeof partner.partnerName === 'string' ? partner.partnerName.trim() : ''
    if (partnerName) {
        return partnerName === partner.partnerName
            ? activePartner
            : { ...activePartner, partnerName }
    }
    return { ...activePartner, partnerName: 'Unnamed partner' }
}

function roundAmount(amount: number, _currency: CurrencyCode) {
    return roundOrderValue(amount)
}

function getMergeCandidateKey(
    primaryPartnerId: string,
    secondaryPartnerId: string,
    mergeType: BusinessPartnerMergeCandidate['mergeType'] = 'customer_supplier'
) {
    return `${primaryPartnerId}:${secondaryPartnerId}:${mergeType}`
}

function getMergeCandidateKeyFromEntity(
    entity: Pick<BusinessPartnerMergeCandidate, 'primaryPartnerId' | 'secondaryPartnerId' | 'mergeType'>
) {
    return getMergeCandidateKey(entity.primaryPartnerId, entity.secondaryPartnerId, entity.mergeType)
}

function getMergeCandidateSyncPriority(candidate: Pick<BusinessPartnerMergeCandidate, 'syncStatus' | 'version' | 'updatedAt' | 'isDeleted'>) {
    const syncRank = candidate.syncStatus === 'synced'
        ? 2
        : candidate.syncStatus === 'pending'
            ? 1
            : 0
    const updatedRank = Date.parse(candidate.updatedAt || '') || 0

    return [
        candidate.isDeleted ? 0 : 1,
        syncRank,
        candidate.version,
        updatedRank
    ]
}

function preferMergeCandidate(
    left: BusinessPartnerMergeCandidate,
    right: BusinessPartnerMergeCandidate
) {
    const leftPriority = getMergeCandidateSyncPriority(left)
    const rightPriority = getMergeCandidateSyncPriority(right)

    for (let index = 0; index < leftPriority.length; index += 1) {
        if (leftPriority[index] === rightPriority[index]) {
            continue
        }

        return leftPriority[index] > rightPriority[index] ? left : right
    }

    return left
}

async function removeOfflineMutationsForEntityIds(tableName: PartnerTableName, entityIds: string[]) {
    if (entityIds.length === 0) {
        return
    }

    const rows = await db.offline_mutations
        .where('entityId')
        .anyOf(entityIds)
        .and((item) => item.entityType === tableName)
        .toArray()

    if (rows.length > 0) {
        await db.offline_mutations.bulkDelete(rows.map((row) => row.id))
    }
}

function sanitizeSyncPayload(tableName: PartnerTableName, entity: Record<string, unknown>) {
    const payload = { ...entity }
    delete payload.syncStatus
    delete payload.lastSyncedAt

    // These fields are retained in local storage solely for historical
    // recovery. The active business-partner contract is `partnerName`.
    if (tableName === 'business_partners' || tableName === 'customers' || tableName === 'suppliers') {
        delete payload.name
        delete payload.contactName
        delete payload.email
        delete payload.country
    }

    // Agent images are owned by the linked user profile, not by crm.agents.
    // Strip this legacy field so an older local cache cannot reintroduce it.
    if (tableName === 'agents') {
        delete payload.imageUrl
    }

    return Object.fromEntries(
        Object.entries(payload).map(([key, value]) => [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            value
        ])
    )
}

async function markEntitiesSynced(tableName: PartnerTableName, ids: string[]) {
    const syncedAt = new Date().toISOString()
    const table = (db as unknown as Record<string, { update: (id: string, changes: Record<string, unknown>) => Promise<number> }>)[tableName]
    await Promise.all(ids.map((id) => table.update(id, { syncStatus: 'synced', lastSyncedAt: syncedAt })))
}

async function queueOfflineUpserts(tableName: PartnerTableName, entities: SyncEntity[], workspaceId: string) {
    await Promise.all(entities.map((entity) =>
        addToOfflineMutations(
            tableName,
            entity.id,
            entity.version > 1 ? 'update' : 'create',
            entity,
            workspaceId
        )
    ))
}

async function syncUpsertEntities(tableName: PartnerTableName, entities: SyncEntity[], workspaceId: string) {
    if (!entities.length || !shouldUseCloudBusinessData(workspaceId)) {
        return
    }

    if (!isOnline(workspaceId)) {
        await queueOfflineUpserts(tableName, entities, workspaceId)
        return
    }

    try {
        const client = getSupabaseClientForTable(tableName)
        const payload = entities.map((entity) => sanitizeSyncPayload(tableName, entity))

        if (tableName === 'business_partner_merge_candidates') {
            const mergeEntities = entities as unknown as BusinessPartnerMergeCandidate[]
            const dedupedEntities = Array.from(
                new Map(
                    mergeEntities.map((entity) => [getMergeCandidateKeyFromEntity(entity), entity])
                ).values()
            )
            const dedupedPayload = dedupedEntities.map((entity) => sanitizeSyncPayload(tableName, entity as unknown as SyncEntity))
            const { data, error } = await runMutation(`${tableName}.sync`, () =>
                client
                    .from(tableName)
                    .upsert(dedupedPayload, { onConflict: 'primary_partner_id,secondary_partner_id,merge_type' })
                    .select('*')
            )
            if (error) {
                throw error
            }

            const syncedAt = new Date().toISOString()
            const remoteRows = ((data || []) as Record<string, unknown>[])
                .map((row) => ({
                    ...(toCamelCase(row) as unknown as BusinessPartnerMergeCandidate),
                    syncStatus: 'synced' as const,
                    lastSyncedAt: syncedAt
                }))
            const remoteByKey = new Map(remoteRows.map((row) => [getMergeCandidateKeyFromEntity(row), row]))
            const replacedLocalIds: string[] = []

            await db.transaction('rw', [db.business_partner_merge_candidates, db.offline_mutations], async () => {
                for (const entity of dedupedEntities) {
                    const remote = remoteByKey.get(getMergeCandidateKeyFromEntity(entity))

                    if (!remote) {
                        await db.business_partner_merge_candidates.update(entity.id, {
                            syncStatus: 'synced',
                            lastSyncedAt: syncedAt
                        })
                        continue
                    }

                    await db.business_partner_merge_candidates.put(remote)

                    if (remote.id !== entity.id) {
                        replacedLocalIds.push(entity.id)
                    }
                }

                if (replacedLocalIds.length > 0) {
                    await db.business_partner_merge_candidates.bulkDelete(replacedLocalIds)
                    await removeOfflineMutationsForEntityIds(tableName, replacedLocalIds)
                }
            })

            return
        }

        const { error } = await runMutation(`${tableName}.sync`, () => client.from(tableName).upsert(payload))
        if (error) {
            throw error
        }

        await markEntitiesSynced(tableName, entities.map((entity) => entity.id))
    } catch (error) {
        console.error(`[BusinessPartners] Failed to sync ${tableName}:`, error)
        await queueOfflineUpserts(tableName, entities, workspaceId)
    }
}

async function syncSoftDelete(
    tableName: PartnerTableName,
    entityId: string,
    workspaceId: string,
    payload: Record<string, unknown> = {}
) {
    if (!shouldUseCloudBusinessData(workspaceId)) {
        return
    }

    if (!isOnline(workspaceId)) {
        await addToOfflineMutations(tableName, entityId, 'delete', { ...payload, id: entityId }, workspaceId)
        return
    }

    try {
        const client = getSupabaseClientForTable(tableName)
        const { error } = await runMutation(`${tableName}.delete`, () =>
            client
                .from(tableName)
                .update({ is_deleted: true, updated_at: new Date().toISOString() })
                .eq('id', entityId)
        )
        if (error) {
            throw error
        }

        await markEntitiesSynced(tableName, [entityId])
    } catch (error) {
        console.error(`[BusinessPartners] Failed to delete ${tableName}:`, error)
        await addToOfflineMutations(tableName, entityId, 'delete', { ...payload, id: entityId }, workspaceId)
    }
}

async function syncHardDelete(tableName: PartnerTableName, entityId: string, workspaceId: string) {
    if (!shouldUseCloudBusinessData(workspaceId)) {
        return
    }

    if (!isOnline(workspaceId)) {
        await addToOfflineMutations(tableName, entityId, 'delete', { id: entityId, hardDelete: true }, workspaceId)
        return
    }

    try {
        const client = getSupabaseClientForTable(tableName)
        const { error } = await runMutation(`${tableName}.hardDelete`, () =>
            client
                .from(tableName)
                .delete()
                .eq('id', entityId)
        )
        if (error) {
            throw error
        }

        // A prior offline edit could otherwise replay after this successful
        // deletion and recreate the exclusion remotely.
        await removeOfflineMutationsForEntityIds(tableName, [entityId])
    } catch (error) {
        console.error(`[BusinessPartners] Failed to hard delete ${tableName}:`, error)
        await addToOfflineMutations(tableName, entityId, 'delete', { id: entityId, hardDelete: true }, workspaceId)
    }
}

function buildBaseEntity<T extends Record<string, unknown>>(workspaceId: string, data: T): T & BaseEntityPayload {
    const now = new Date().toISOString()

    return {
        ...data,
        id: generateId(),
        workspaceId,
        createdAt: now,
        updatedAt: now,
        version: 1,
        isDeleted: false,
        ...getSyncMetadata(workspaceId, now)
    }
}

function normalizeMatchValue(value?: string | null) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function roleIncludesCustomer(role: BusinessPartnerRole) {
    return role === 'customer' || role === 'both'
}

function roleIncludesSupplier(role: BusinessPartnerRole) {
    return role === 'supplier' || role === 'both'
}

function roleIncludesAgent(role: BusinessPartnerRole) {
    return role === 'agent'
}

function nextRoleWithFacet(role: BusinessPartnerRole, facetType: PartnerFacetType): BusinessPartnerRole {
    if (facetType === 'customer') {
        return role === 'supplier' ? 'both' : role
    }

    return role === 'customer' ? 'both' : role
}

function partnerToCustomer(partner: BusinessPartner): Customer {
    return {
        id: partner.id,
        workspaceId: partner.workspaceId,
        businessPartnerId: partner.id,
        partnerName: partner.partnerName,
        phone: partner.phone,
        address: partner.address,
        city: partner.city,
        defaultCurrency: partner.defaultCurrency,
        notes: partner.notes,
        totalOrders: partner.totalSalesOrders,
        totalSpent: partner.totalSalesValue,
        outstandingBalance: partner.receivableBalance,
        creditLimit: partner.receivableCreditLimit ?? partner.creditLimit ?? 0,
        isEcommerce: partner.isEcommerce ?? false,
        createdAt: partner.createdAt,
        updatedAt: partner.updatedAt,
        syncStatus: partner.syncStatus,
        lastSyncedAt: partner.lastSyncedAt,
        version: partner.version,
        isDeleted: partner.isDeleted
    }
}

function partnerToSupplier(partner: BusinessPartner): Supplier {
    return {
        id: partner.id,
        workspaceId: partner.workspaceId,
        businessPartnerId: partner.id,
        partnerName: partner.partnerName,
        phone: partner.phone,
        address: partner.address,
        city: partner.city,
        defaultCurrency: partner.defaultCurrency,
        notes: partner.notes,
        totalPurchases: partner.totalPurchaseOrders,
        totalSpent: partner.totalPurchaseValue,
        creditLimit: partner.payableCreditLimit ?? partner.creditLimit ?? 0,
        isEcommerce: partner.isEcommerce ?? false,
        createdAt: partner.createdAt,
        updatedAt: partner.updatedAt,
        syncStatus: partner.syncStatus,
        lastSyncedAt: partner.lastSyncedAt,
        version: partner.version,
        isDeleted: partner.isDeleted
    }
}

async function getPartnerByAnyId(id: string) {
    const direct = await db.business_partners.get(id)
    if (direct && !direct.isDeleted) {
        return normalizeRuntimePartnerName(direct)
    }

    const customerFacet = await db.customers.get(id)
    if (customerFacet?.businessPartnerId) {
        const customerPartner = await db.business_partners.get(customerFacet.businessPartnerId)
        if (customerPartner && !customerPartner.isDeleted) {
            return normalizeRuntimePartnerName(customerPartner)
        }
    }

    const supplierFacet = await db.suppliers.get(id)
    if (supplierFacet?.businessPartnerId) {
        const supplierPartner = await db.business_partners.get(supplierFacet.businessPartnerId)
        if (supplierPartner && !supplierPartner.isDeleted) {
            return normalizeRuntimePartnerName(supplierPartner)
        }
    }

    const agentFacet = await db.agents.get(id)
    if (agentFacet?.businessPartnerId) {
        const agentPartner = await db.business_partners.get(agentFacet.businessPartnerId)
        if (agentPartner && !agentPartner.isDeleted) {
            return normalizeRuntimePartnerName(agentPartner)
        }
    }

    return undefined
}

export async function getBusinessPartnerByAnyId(id: string) {
    return getPartnerByAnyId(id)
}

async function syncCustomerFacet(customer: Customer) {
    await db.customers.put(customer)
    await syncUpsertEntities('customers', [customer as unknown as SyncEntity], customer.workspaceId)
}

async function syncSupplierFacet(supplier: Supplier) {
    await db.suppliers.put(supplier)
    await syncUpsertEntities('suppliers', [supplier as unknown as SyncEntity], supplier.workspaceId)
}

async function mirrorPartnerToFacets(partner: BusinessPartner) {
    const updates: Promise<void>[] = []

    if (partner.customerFacetId) {
        const customer = await db.customers.get(partner.customerFacetId)
        if (customer && !customer.isDeleted) {
            const mirroredCustomer: Customer = {
                ...customer,
                businessPartnerId: partner.id,
                partnerName: partner.partnerName,
                phone: partner.phone,
                address: partner.address,
                city: partner.city,
                defaultCurrency: partner.defaultCurrency,
                notes: partner.notes,
                creditLimit: partner.receivableCreditLimit ?? partner.creditLimit ?? 0,
                isEcommerce: partner.isEcommerce ?? customer.isEcommerce ?? false,
                updatedAt: partner.updatedAt,
                version: Math.max(customer.version + 1, partner.version),
                ...getSyncMetadata(partner.workspaceId, partner.updatedAt)
            }
            updates.push(syncCustomerFacet(mirroredCustomer))
        }
    }

    if (partner.supplierFacetId) {
        const supplier = await db.suppliers.get(partner.supplierFacetId)
        if (supplier && !supplier.isDeleted) {
            const mirroredSupplier: Supplier = {
                ...supplier,
                businessPartnerId: partner.id,
                partnerName: partner.partnerName,
                phone: partner.phone,
                address: partner.address,
                city: partner.city,
                defaultCurrency: partner.defaultCurrency,
                notes: partner.notes,
                creditLimit: partner.payableCreditLimit ?? partner.creditLimit ?? 0,
                isEcommerce: partner.isEcommerce ?? supplier.isEcommerce ?? false,
                updatedAt: partner.updatedAt,
                version: Math.max(supplier.version + 1, partner.version),
                ...getSyncMetadata(partner.workspaceId, partner.updatedAt)
            }
            updates.push(syncSupplierFacet(mirroredSupplier))
        }
    }

    await Promise.all(updates)
}
async function getPartnerSalesOrders(partner: BusinessPartner) {
    const rows = await db.sales_orders.where('workspaceId').equals(partner.workspaceId).and((item) => {
        if (item.isDeleted) {
            return false
        }

        if (item.businessPartnerId && item.businessPartnerId === partner.id) {
            return true
        }

        return Boolean(partner.customerFacetId && item.customerId === partner.customerFacetId)
    }).toArray()

    return rows as SalesOrder[]
}

async function getPartnerPurchaseOrders(partner: BusinessPartner) {
    const rows = await db.purchase_orders.where('workspaceId').equals(partner.workspaceId).and((item) => {
        if (item.isDeleted) {
            return false
        }

        if (item.businessPartnerId && item.businessPartnerId === partner.id) {
            return true
        }

        return Boolean(partner.supplierFacetId && item.supplierId === partner.supplierFacetId)
    }).toArray()

    return rows as PurchaseOrder[]
}

async function getPartnerTravelSales(partner: BusinessPartner) {
    const rows = await db.travel_agency_sales.where('workspaceId').equals(partner.workspaceId).and((item) => {
        if (item.isDeleted) {
            return false
        }

        if (item.businessPartnerId && item.businessPartnerId === partner.id) {
            return true
        }

        return Boolean(partner.supplierFacetId && item.supplierId === partner.supplierFacetId)
    }).toArray()

    return rows as TravelAgencySale[]
}

async function getPartnerLoans(partner: BusinessPartner) {
    const rows = await db.loans.where('workspaceId').equals(partner.workspaceId).and((item) => {
        if (item.isDeleted) {
            return false
        }

        return item.linkedPartyType === 'business_partner' && item.linkedPartyId === partner.id
    }).toArray()

    return rows as Loan[]
}

async function syncAgentFacet(agent: Agent) {
    await db.agents.put(agent)
    await syncUpsertEntities('agents', [agent as unknown as SyncEntity], agent.workspaceId)
}

export function useAgentExcludedCategories(workspaceId: string | undefined, agentId?: string | null) {
    const online = useNetworkStatus()
    const exclusions = useLiveQuery(
        () => workspaceId
            ? db.agent_excluded_categories
                .where('workspaceId')
                .equals(workspaceId)
                .and((row) => !row.isDeleted && (!agentId || row.agentId === agentId))
                .toArray()
            : [],
        [agentId, workspaceId]
    ) ?? []

    useEffect(() => {
        if (!online || !workspaceId || !shouldUseCloudBusinessData(workspaceId)) {
            return
        }

        void fetchTableFromSupabase('agent_excluded_categories', db.agent_excluded_categories, workspaceId)
            .catch((error) => {
                console.error('[Agents] Failed to hydrate excluded categories:', error)
            })
    }, [online, workspaceId])

    return exclusions
}

export function useProductSelectionAccess(workspaceId: string | undefined, userId: string | null | undefined) {
    const online = useNetworkStatus()
    const agents = useLiveQuery(
        () => workspaceId
            ? db.agents.where('workspaceId').equals(workspaceId).and((agent) => !agent.isDeleted).toArray()
            : [],
        [workspaceId]
    )
    const exclusions = useAgentExcludedCategories(workspaceId)

    useEffect(() => {
        if (!online || !workspaceId || !shouldUseCloudBusinessData(workspaceId)) {
            return
        }

        void fetchTableFromSupabase('agents', db.agents, workspaceId)
            .catch((error) => {
                console.error('[Agents] Failed to hydrate product selection access:', error)
            })
    }, [online, workspaceId])

    const excludedCategoryIds = useMemo(
        () => getAgentExcludedCategoryIds(agents ?? [], exclusions, userId),
        [agents, exclusions, userId]
    )
    const canSelectProduct = useCallback(
        (product: { categoryId?: string | null }) => canSelectProductForExcludedCategories(product, excludedCategoryIds),
        [excludedCategoryIds]
    )
    const filterProducts = useCallback(
        <T extends { categoryId?: string | null }>(products: readonly T[]) => filterSelectableProducts(products, excludedCategoryIds),
        [excludedCategoryIds]
    )

    return {
        excludedCategoryIds,
        canSelectProduct,
        filterProducts
    }
}

export async function replaceAgentExcludedCategories(
    workspaceId: string,
    agentId: string,
    categoryIds: readonly string[]
) {
    const agent = await db.agents.get(agentId)
    if (!agent || agent.isDeleted || agent.workspaceId !== workspaceId) {
        throw new Error('Agent not found in this workspace')
    }

    const requestedCategoryIds = [...new Set(categoryIds.filter(Boolean))]
    const categories = await db.categories.where('workspaceId').equals(workspaceId).toArray()
    const validCategoryIds = new Set(categories.filter((category) => !category.isDeleted).map((category) => category.id))
    const invalidCategoryId = requestedCategoryIds.find((categoryId) => !validCategoryIds.has(categoryId))
    if (invalidCategoryId) {
        throw new Error('Excluded categories must belong to the agent workspace')
    }

    const current = await db.agent_excluded_categories.where('agentId').equals(agentId).toArray()
    const currentByCategoryId = new Map(current.map((row) => [row.categoryId, row]))
    const requestedIds = new Set(requestedCategoryIds)
    const now = new Date().toISOString()
    const updates: AgentExcludedCategory[] = []

    for (const categoryId of requestedCategoryIds) {
        const existing = currentByCategoryId.get(categoryId)
        if (existing && !existing.isDeleted) {
            continue
        }

        updates.push(existing
            ? {
                ...existing,
                isDeleted: false,
                updatedAt: now,
                version: existing.version + 1,
                ...getSyncMetadata(workspaceId, now)
            }
            : buildBaseEntity(workspaceId, { agentId, categoryId }) as AgentExcludedCategory
        )
    }

    // Deleting an exclusion must remove it instead of leaving a tombstone.
    // Include old tombstones here so the next save also cleans up rows created
    // by earlier app versions.
    const removed = current.filter((existing) => !requestedIds.has(existing.categoryId))

    if (updates.length === 0 && removed.length === 0) {
        return
    }

    await db.transaction('rw', db.agent_excluded_categories, async () => {
        if (removed.length > 0) {
            await db.agent_excluded_categories.bulkDelete(removed.map((existing) => existing.id))
        }
        if (updates.length > 0) {
            await db.agent_excluded_categories.bulkPut(updates)
        }
    })

    await Promise.all([
        ...(updates.length > 0
            ? [syncUpsertEntities('agent_excluded_categories', updates as unknown as SyncEntity[], workspaceId)]
            : []),
        ...removed.map((existing) => syncHardDelete('agent_excluded_categories', existing.id, workspaceId))
    ])
}

function normalizeAgentFacetInput(input: Partial<AgentFacetInput> | undefined, existing?: Agent): AgentFacetInput {
    const agentType = input?.agentType ?? existing?.agentType
    const status = input?.status ?? existing?.status ?? 'active'
    const zone = String(input?.zone ?? existing?.zone ?? '').trim()
    const carModel = String(input?.carModel ?? existing?.carModel ?? '').trim() || null
    const plateNumber = String(input?.plateNumber ?? existing?.plateNumber ?? '').trim() || null
    const linkedUserId = String(
        input?.linkedUserId === undefined ? existing?.linkedUserId ?? '' : input.linkedUserId ?? ''
    ).trim() || null
    const salesAccountRequested = input?.salesAccountEnabled === undefined
        ? existing?.salesAccountEnabled ?? false
        : Boolean(input.salesAccountEnabled)
    const courierDeliveryFee = Number(
        input?.courierDeliveryFee === undefined
            ? existing?.courierDeliveryFee ?? 0
            : input.courierDeliveryFee ?? 0
    )

    if (agentType !== 'driver' && agentType !== 'field_agent' && agentType !== 'courier') {
        throw new Error('Agent type is required')
    }
    // Sales accounts automatically credit the agent's commission. Commission
    // plans and Supabase integrity rules apply to field agents, so changing an
    // agent to another operational type turns the optional account off.
    const salesAccountEnabled = agentType === 'field_agent' && salesAccountRequested
    if (!zone) {
        throw new Error('Agent operational territory is required')
    }
    if (agentType === 'driver' && (!carModel || !plateNumber)) {
        throw new Error('Car model and plate number are required for drivers')
    }
    if (status !== 'active' && status !== 'inactive' && status !== 'blocked') {
        throw new Error('Agent status is invalid')
    }
    if (!Number.isFinite(courierDeliveryFee) || courierDeliveryFee < 0) {
        throw new Error('Courier delivery fee must be zero or greater')
    }

    return {
        zone,
        agentType,
        carModel: agentType === 'driver' ? carModel : null,
        plateNumber: agentType === 'driver' ? plateNumber : null,
        linkedUserId,
        salesAccountEnabled,
        status,
        // Keep non-courier agent records compatible with the database rule
        // and avoid retaining an old fee after the role changes.
        courierDeliveryFee: agentType === 'courier' ? courierDeliveryFee : 0
    }
}

async function assertAgentLinkedUserAvailable(
    workspaceId: string,
    linkedUserId: string | null | undefined,
    currentAgentId?: string
) {
    if (!linkedUserId) {
        return
    }

    const linkedAgent = await db.agents
        .where('linkedUserId')
        .equals(linkedUserId)
        .and((item) =>
            item.workspaceId === workspaceId
            && !item.isDeleted
            && item.id !== currentAgentId
        )
        .first()

    if (linkedAgent) {
        throw new Error('Workspace user is already linked to another agent')
    }
}

async function createOrUpdateAgentFacet(partner: BusinessPartner, input?: Partial<AgentFacetInput>) {
    const existing = partner.agentFacetId
        ? await db.agents.get(partner.agentFacetId)
        : await db.agents.where('businessPartnerId').equals(partner.id).first()
    const agentData = normalizeAgentFacetInput(input, existing)
    await assertAgentLinkedUserAvailable(partner.workspaceId, agentData.linkedUserId, existing?.id)

    if (existing) {
        const now = new Date().toISOString()
        const updated: Agent = {
            ...existing,
            ...agentData,
            businessPartnerId: partner.id,
            isDeleted: false,
            updatedAt: now,
            version: existing.version + 1,
            ...getSyncMetadata(partner.workspaceId, now)
        }
        await syncAgentFacet(updated)
        await ensureDriverFleetAssignment(updated)
        return updated
    }

    const agent = buildBaseEntity(partner.workspaceId, {
        businessPartnerId: partner.id,
        ...agentData
    }) as Agent
    await syncAgentFacet(agent)
    await ensureDriverFleetAssignment(agent)
    return agent
}

async function setAgentFacetInactive(partner: BusinessPartner) {
    if (!partner.agentFacetId) {
        return
    }

    const agent = await db.agents.get(partner.agentFacetId)
    if (!agent || agent.isDeleted || agent.status === 'inactive') {
        return
    }

    const now = new Date().toISOString()
    await syncAgentFacet({
        ...agent,
        status: 'inactive',
        updatedAt: now,
        version: agent.version + 1,
        ...getSyncMetadata(agent.workspaceId, now)
    })
    await endActiveFleetAssignmentsForAgent(agent.id)
}

function assertBusinessPartnerRoleAllowed(role: BusinessPartnerRole, options?: BusinessPartnerRoleAccessOptions) {
    if (isRemovedBusinessPartnerRole(role)) {
        throw new Error('Witness is not a supported business partner role')
    }

    if (isRealEstateBusinessPartnerRole(role) && !options?.allowRealEstateRoles) {
        throw new Error('Real Estate partner roles require workspace Real Estate access')
    }

    if (roleIncludesAgent(role) && !options?.allowAgentRole) {
        throw new Error('Agent roles require workspace Agents module access')
    }
}

function isRemovedBusinessPartnerRole(role: unknown) {
    return role === 'witness'
}

function convertLoanAmountForPartner(loan: Pick<Loan, 'balanceAmount' | 'settlementCurrency' | 'exchangeRateSnapshot'>, currency: CurrencyCode) {
    const converted = convertCurrencyAmountWithAvailableSnapshot(
        loan.balanceAmount,
        loan.settlementCurrency,
        currency,
        loan.exchangeRateSnapshot
    )

    return converted ?? 0
}

async function getDeliveryOutstandingBalances(workspaceId: string, partner: BusinessPartner) {
    const payable = new Map<CurrencyCode, number>()
    const receivable = new Map<CurrencyCode, number>()

    const [profiles, entries] = await Promise.all([
        db.delivery_merchant_profiles
            .where('workspaceId').equals(workspaceId)
            .and((profile) => !profile.isDeleted && profile.businessPartnerId === partner.id)
            .toArray(),
        db.delivery_ledger_entries
            .where('workspaceId').equals(workspaceId)
            .and((entry) => !entry.isDeleted)
            .toArray()
    ])
    const profileIds = new Set(profiles.map((profile) => profile.id))

    if (profileIds.size > 0) {
        for (const entry of entries) {
            if (entry.merchantProfileId && profileIds.has(entry.merchantProfileId)) {
                payable.set(entry.currency, (payable.get(entry.currency) ?? 0) + Number(entry.amount || 0))
            }
        }
    }

    if (partner.agentFacetId) {
        const agent = await db.agents.get(partner.agentFacetId)
        if (agent && !agent.isDeleted) {
            for (const entry of entries) {
                if (entry.agentId === agent.id) {
                    receivable.set(entry.currency, (receivable.get(entry.currency) ?? 0) + Number(entry.amount || 0))
                }
            }
        }
    }

    for (const currency of new Set<CurrencyCode>([...payable.keys(), ...receivable.keys()])) {
        const payableAmount = payable.get(currency) ?? 0
        const receivableAmount = receivable.get(currency) ?? 0
        // A negative merchant delivery payable is a real receivable: for
        // example, an electronic prepaid delivery fee or money the courier
        // paid to the recipient on the merchant's behalf.
        if (payableAmount < 0) {
            payable.set(currency, 0)
            receivable.set(currency, receivableAmount + Math.abs(payableAmount))
        }
        // A negative courier account is not a receivable from the courier. It
        // is a genuine payable: the courier advanced cash to the recipient or
        // earned a fee that could not be retained from COD cash.
        if (receivableAmount < 0) {
            receivable.set(currency, 0)
            payable.set(currency, (payable.get(currency) ?? 0) + Math.abs(receivableAmount))
        }
    }

    return { payable, receivable }
}

/**
 * Cash-only direct transactions never alter a partner balance. Explicit
 * partner-account movements are included here so the profile and statement
 * use the same treatment.
 */
async function getPartnerDirectAccountEffects(workspaceId: string, partner: BusinessPartner) {
    const transactions = await db.payment_transactions
        .where('workspaceId')
        .equals(workspaceId)
        .and((transaction) => (
            !transaction.isDeleted
            && transaction.sourceType === 'direct_transaction'
            && transaction.metadata?.businessPartnerId === partner.id
            && isDirectTransactionPartnerAccountEffect(transaction.metadata?.partnerAccountEffect)
        ))
        .toArray()

    let receivable = 0
    let payable = 0

    for (const transaction of transactions) {
        const effect = transaction.metadata?.partnerAccountEffect
        if (!isDirectTransactionPartnerAccountEffect(effect)) continue

        // Reversal rows retain their effect and have a negative amount, so this
        // exact same calculation reverses the partner balance as well.
        const amount = convertCurrencyAmountWithSnapshot(
            Number(transaction.amount || 0),
            transaction.currency,
            partner.defaultCurrency,
            undefined
        )
        switch (effect) {
            case 'increase_receivable':
                receivable += amount
                break
            case 'decrease_receivable':
                receivable -= amount
                break
            case 'increase_payable':
                payable += amount
                break
            case 'decrease_payable':
                payable -= amount
                break
        }
    }

    return { receivable, payable }
}

export async function recalculateBusinessPartnerSummary(workspaceId: string, partnerId: string) {
    const partner = await db.business_partners.get(partnerId)
    if (!partner || partner.isDeleted) {
        return partner
    }

    const [salesOrders, purchaseOrders, travelSales, loans, deliveryBalances, directAccountEffects] = await Promise.all([
        getPartnerSalesOrders(partner),
        getPartnerPurchaseOrders(partner),
        getPartnerTravelSales(partner),
        getPartnerLoans(partner),
        getDeliveryOutstandingBalances(workspaceId, partner),
        getPartnerDirectAccountEffects(workspaceId, partner)
    ])

    const activeSalesOrders = salesOrders.filter((order) => order.status !== 'cancelled')
    const activePurchaseOrders = purchaseOrders.filter((order) => order.status !== 'cancelled')
    const activeTravelSales = travelSales.filter((sale) => sale.status === 'completed')
    const activeLentLoans = loans.filter((loan) =>
        loan.balanceAmount > 0
        && loan.status !== 'completed'
        && (loan.direction ?? 'lent') !== 'borrowed'
    )
    const activeBorrowedLoans = loans.filter((loan) =>
        loan.balanceAmount > 0
        && loan.status !== 'completed'
        && loan.direction === 'borrowed'
    )

    const totalSalesOrders = activeSalesOrders.length
    const totalSalesValue = roundAmount(
        activeSalesOrders
            .filter((order) => order.status === 'completed')
            .reduce(
                (sum, order) => sum + convertCurrencyAmountWithSnapshot(order.total, order.currency, partner.defaultCurrency, order.exchangeRates),
                0
            ),
        partner.defaultCurrency
    )
    const baseReceivableBalance = roundAmount(
        activeSalesOrders
            .filter((order) =>
                (order.status === 'pending' || order.status === 'completed')
                && getOrderBalanceAmount(order) > 0
                && !order.linkedLoanId
            )
            .reduce(
                (sum, order) => sum + convertCurrencyAmountWithSnapshot(
                    getOrderBalanceAmount(order),
                    order.currency,
                    partner.defaultCurrency,
                    order.exchangeRates
                ),
                0
            )
            + activeLentLoans.reduce((sum, loan) => sum + convertLoanAmountForPartner(loan, partner.defaultCurrency), 0)
            + Array.from(deliveryBalances.receivable.entries()).reduce(
                (sum, [currency, amount]) => sum + convertCurrencyAmountWithSnapshot(amount, currency, partner.defaultCurrency, undefined),
                0
            ),
        partner.defaultCurrency
    )

    const purchaseOrderValue = activePurchaseOrders
        .filter((order) => order.status === 'received' || order.status === 'completed')
        .reduce(
            (sum, order) => sum + convertCurrencyAmountWithSnapshot(order.total, order.currency, partner.defaultCurrency, order.exchangeRates),
            0
        )
    const travelSaleValue = activeTravelSales.reduce(
        (sum, sale) => sum + convertCurrencyAmountWithSnapshot(
            getTravelSaleCost(sale),
            sale.currency,
            partner.defaultCurrency,
            sale.exchangeRateSnapshot ? [sale.exchangeRateSnapshot] as any : undefined
        ),
        0
    )
    const totalPurchaseOrders = activePurchaseOrders.length + activeTravelSales.length
    const totalPurchaseValue = roundAmount(purchaseOrderValue + travelSaleValue, partner.defaultCurrency)
    const basePayableBalance = roundAmount(
        activePurchaseOrders
            .filter((order) =>
                (order.status === 'ordered' || order.status === 'received' || order.status === 'completed')
                && getOrderBalanceAmount(order) > 0
                && !order.linkedLoanId
            )
            .reduce(
                (sum, order) => sum + convertCurrencyAmountWithSnapshot(
                    getOrderBalanceAmount(order),
                    order.currency,
                    partner.defaultCurrency,
                    order.exchangeRates
                ),
                0
            )
            + activeTravelSales
                .filter((sale) => !sale.isPaid)
                .reduce(
                    (sum, sale) => sum + convertCurrencyAmountWithSnapshot(
                        getTravelSaleCost(sale),
                        sale.currency,
                        partner.defaultCurrency,
                        sale.exchangeRateSnapshot ? [sale.exchangeRateSnapshot] as any : undefined
                    ),
                    0
                )
            + activeBorrowedLoans.reduce(
                (sum, loan) => sum + convertLoanAmountForPartner(loan, partner.defaultCurrency),
                0
            )
            + Array.from(deliveryBalances.payable.entries()).reduce(
                (sum, [currency, amount]) => sum + convertCurrencyAmountWithSnapshot(amount, currency, partner.defaultCurrency, undefined),
                0
            ),
        partner.defaultCurrency
    )

    const receivableBalance = roundAmount(
        Math.max(0, baseReceivableBalance + directAccountEffects.receivable),
        partner.defaultCurrency
    )
    const payableBalance = roundAmount(
        Math.max(0, basePayableBalance + directAccountEffects.payable),
        partner.defaultCurrency
    )

    const totalLoanCount = loans.length
    const loanOutstandingBalance = roundAmount(
        activeLentLoans.reduce((sum, loan) => sum + convertLoanAmountForPartner(loan, partner.defaultCurrency), 0),
        partner.defaultCurrency
    )
    const netExposure = roundAmount(receivableBalance - payableBalance, partner.defaultCurrency)

    if (
        partner.totalSalesOrders === totalSalesOrders
        && partner.totalSalesValue === totalSalesValue
        && partner.receivableBalance === receivableBalance
        && partner.totalPurchaseOrders === totalPurchaseOrders
        && partner.totalPurchaseValue === totalPurchaseValue
        && partner.payableBalance === payableBalance
        && partner.totalLoanCount === totalLoanCount
        && partner.loanOutstandingBalance === loanOutstandingBalance
        && partner.netExposure === netExposure
    ) {
        return partner
    }

    const now = new Date().toISOString()
    const updated: BusinessPartner = {
        ...partner,
        totalSalesOrders,
        totalSalesValue,
        receivableBalance,
        totalPurchaseOrders,
        totalPurchaseValue,
        payableBalance,
        totalLoanCount,
        loanOutstandingBalance,
        netExposure,
        updatedAt: now,
        version: partner.version + 1,
        ...getSyncMetadata(workspaceId, now)
    }

    await db.business_partners.put(updated)
    await syncUpsertEntities('business_partners', [updated as unknown as SyncEntity], workspaceId)
    return updated
}

export async function recalculateAllBusinessPartnerSummaries(workspaceId: string) {
    const partners = await db.business_partners.where('workspaceId').equals(workspaceId).and((item) => !item.isDeleted && !item.mergedIntoBusinessPartnerId).toArray()
    await Promise.all(partners.map((partner) => recalculateBusinessPartnerSummary(workspaceId, partner.id)))
}

async function countSupplierHistory(partner: BusinessPartner) {
    const [purchaseOrders, travelSales] = await Promise.all([
        getPartnerPurchaseOrders(partner),
        getPartnerTravelSales(partner)
    ])

    return purchaseOrders.length + travelSales.length
}

async function countCustomerHistory(partner: BusinessPartner) {
    const [salesOrders, loans] = await Promise.all([
        getPartnerSalesOrders(partner),
        getPartnerLoans(partner)
    ])

    return salesOrders.length + loans.length
}

async function assertRoleRemovalAllowed(partner: BusinessPartner, nextRole: BusinessPartnerRole) {
    if (roleIncludesCustomer(partner.role) && !roleIncludesCustomer(nextRole)) {
        const customerHistory = await countCustomerHistory(partner)
        if (customerHistory > 0) {
            throw new Error('Cannot remove customer role while sales orders or loans exist')
        }
    }

    if (roleIncludesSupplier(partner.role) && !roleIncludesSupplier(nextRole)) {
        const supplierHistory = await countSupplierHistory(partner)
        if (supplierHistory > 0) {
            throw new Error('Cannot remove supplier role while purchase or travel transactions exist')
        }
    }
}

async function createFacetFromPartner(partner: BusinessPartner, facetType: PartnerFacetType) {
    const base = buildBaseEntity(partner.workspaceId, {
        businessPartnerId: partner.id,
        partnerName: partner.partnerName,
        phone: partner.phone,
        address: partner.address,
        city: partner.city,
        defaultCurrency: partner.defaultCurrency,
        notes: partner.notes,
        creditLimit: facetType === 'customer'
            ? partner.receivableCreditLimit ?? partner.creditLimit ?? 0
            : partner.payableCreditLimit ?? partner.creditLimit ?? 0,
        isEcommerce: partner.isEcommerce ?? false
    })

    if (facetType === 'customer') {
        const customer: Customer = {
            ...base,
            totalOrders: 0,
            totalSpent: 0,
            outstandingBalance: 0
        }
        await syncCustomerFacet(customer)
        return customer
    }

    const supplier: Supplier = {
        ...base,
        totalPurchases: 0,
        totalSpent: 0
    }
    await syncSupplierFacet(supplier)
    return supplier
}
export async function ensurePartnerFacet(partnerId: string, facetType: PartnerFacetType) {
    const partner = await db.business_partners.get(partnerId)
    if (!partner || partner.isDeleted || partner.mergedIntoBusinessPartnerId) {
        throw new Error('Business partner not found')
    }

    if (facetType === 'customer' && partner.customerFacetId) {
        const existing = await db.customers.get(partner.customerFacetId)
        if (existing && !existing.isDeleted) {
            return existing
        }
    }

    if (facetType === 'supplier' && partner.supplierFacetId) {
        const existing = await db.suppliers.get(partner.supplierFacetId)
        if (existing && !existing.isDeleted) {
            return existing
        }
    }

    const facet = await createFacetFromPartner(partner, facetType)
    const now = new Date().toISOString()
    const updatedPartner: BusinessPartner = {
        ...partner,
        role: nextRoleWithFacet(partner.role, facetType),
        customerFacetId: facetType === 'customer' ? facet.id : partner.customerFacetId,
        supplierFacetId: facetType === 'supplier' ? facet.id : partner.supplierFacetId,
        updatedAt: now,
        version: partner.version + 1,
        ...getSyncMetadata(partner.workspaceId, now)
    }

    await db.business_partners.put(updatedPartner)
    await syncUpsertEntities('business_partners', [updatedPartner as unknown as SyncEntity], partner.workspaceId)
    return facet
}

async function refreshBusinessPartnerMergeCandidates(workspaceId: string) {
    const partners = await db.business_partners.where('workspaceId').equals(workspaceId).and((item) => !item.isDeleted && !item.mergedIntoBusinessPartnerId).toArray()
    const currentCandidates = await db.business_partner_merge_candidates.where('workspaceId').equals(workspaceId).and((item) => !item.isDeleted).toArray()
    const currentByKey = new Map<string, BusinessPartnerMergeCandidate>()
    const duplicateCandidateIds: string[] = []
    const nextRows: BusinessPartnerMergeCandidate[] = []

    for (const candidate of currentCandidates) {
        const key = getMergeCandidateKeyFromEntity(candidate)
        const existing = currentByKey.get(key)
        if (!existing) {
            currentByKey.set(key, candidate)
            continue
        }

        const preferred = preferMergeCandidate(existing, candidate)
        currentByKey.set(key, preferred)
        duplicateCandidateIds.push(preferred.id === existing.id ? candidate.id : existing.id)
    }

    if (duplicateCandidateIds.length > 0) {
        await db.transaction('rw', [db.business_partner_merge_candidates, db.offline_mutations], async () => {
            await db.business_partner_merge_candidates.bulkDelete(duplicateCandidateIds)
            await removeOfflineMutationsForEntityIds('business_partner_merge_candidates', duplicateCandidateIds)
        })
    }

    const customerPartners = partners.filter((partner) => roleIncludesCustomer(partner.role))
    const supplierPartners = partners.filter((partner) => roleIncludesSupplier(partner.role))

    for (const customerPartner of customerPartners) {
        const customerName = normalizeMatchValue(customerPartner.partnerName)
        const customerPhone = normalizeMatchValue(customerPartner.phone)

        for (const supplierPartner of supplierPartners) {
            if (customerPartner.id === supplierPartner.id) {
                continue
            }

            const supplierName = normalizeMatchValue(supplierPartner.partnerName)
            const supplierPhone = normalizeMatchValue(supplierPartner.phone)
            const exactName = customerName && customerName === supplierName
            const phoneMatch = customerPhone && customerPhone === supplierPhone

            if (!exactName && !phoneMatch) {
                continue
            }

            const existing = currentByKey.get(getMergeCandidateKey(customerPartner.id, supplierPartner.id))
            const reasons = [
                exactName ? 'matching name' : '',
                phoneMatch ? 'matching phone' : ''
            ].filter(Boolean)
            const confidence = exactName && phoneMatch
                ? 0.98
                : exactName
                    ? 0.86
                    : 0.78
            const timestamp = new Date().toISOString()

            nextRows.push({
                ...(existing || buildBaseEntity(workspaceId, {
                    primaryPartnerId: customerPartner.id,
                    secondaryPartnerId: supplierPartner.id,
                    mergeType: 'customer_supplier',
                    reason: reasons.join(', '),
                    confidence,
                    status: 'pending'
                })),
                workspaceId,
                primaryPartnerId: customerPartner.id,
                secondaryPartnerId: supplierPartner.id,
                mergeType: 'customer_supplier',
                reason: reasons.join(', '),
                confidence,
                status: existing?.status || 'pending',
                updatedAt: timestamp,
                version: (existing?.version || 0) + 1,
                ...getSyncMetadata(workspaceId, timestamp)
            } as BusinessPartnerMergeCandidate)
        }
    }

    if (nextRows.length > 0) {
        await db.business_partner_merge_candidates.bulkPut(nextRows)
        await syncUpsertEntities('business_partner_merge_candidates', nextRows as unknown as SyncEntity[], workspaceId)
    }
}

export function useBusinessPartners(workspaceId: string | undefined, filters?: PartnerFilterOptions) {
    const online = useNetworkStatus()

    const partners = useLiveQuery(
        async () => {
            if (!workspaceId) return []
            const rows = await db.business_partners.where('workspaceId').equals(workspaceId).and((item) => {
                if (item.isDeleted) {
                    return false
                }

                if (!filters?.includeMerged && item.mergedIntoBusinessPartnerId) {
                    return false
                }

                if (isRemovedBusinessPartnerRole(item.role)) {
                    return false
                }

                if (!filters?.includeRealEstateRoles && isRealEstateBusinessPartnerRole(item.role)) {
                    return false
                }

                if (!filters?.includeAgentRoles && roleIncludesAgent(item.role)) {
                    return false
                }

                if (filters?.roles?.length) {
                    return filters.roles.some((role) => item.role === role || (item.role === 'both' && (role === 'customer' || role === 'supplier')))
                }

                return true
            }).toArray()
            return rows
                .map(normalizeRuntimePartnerName)
                .sort((a, b) => a.partnerName.localeCompare(b.partnerName))
        },
        [workspaceId, JSON.stringify(filters || {})]
    )

    useEffect(() => {
        if (!workspaceId) {
            return
        }

        const hydrate = async () => {
            if (online && shouldUseCloudBusinessData(workspaceId)) {
                await Promise.all([
                    fetchTableFromSupabase('business_partners', db.business_partners, workspaceId),
                    fetchTableFromSupabase('business_partner_merge_candidates', db.business_partner_merge_candidates, workspaceId),
                    fetchTableFromSupabase('customers', db.customers, workspaceId),
                    fetchTableFromSupabase('suppliers', db.suppliers, workspaceId),
                    fetchTableFromSupabase('agents', db.agents, workspaceId),
                    fetchTableFromSupabase('agent_excluded_categories', db.agent_excluded_categories, workspaceId),
                    fetchTableFromSupabase('sales_orders', db.sales_orders, workspaceId),
                    fetchTableFromSupabase('purchase_orders', db.purchase_orders, workspaceId),
                    fetchTableFromSupabase('travel_agency_sales', db.travel_agency_sales, workspaceId),
                    fetchTableFromSupabase('loans', db.loans, workspaceId),
                    fetchTableFromSupabase('payment_transactions', db.payment_transactions, workspaceId)
                ])
            }

            await recalculateAllBusinessPartnerSummaries(workspaceId)
            await refreshBusinessPartnerMergeCandidates(workspaceId)
        }

        void hydrate().catch((error) => {
            console.error('[BusinessPartners] Failed to hydrate partners:', error)
        })
    }, [online, workspaceId])

    return partners ?? []
}

export function useBusinessPartner(partnerId: string | undefined) {
    return useLiveQuery(() => partnerId ? getPartnerByAnyId(partnerId) : undefined, [partnerId])
}

export function useAgents(workspaceId: string | undefined) {
    return useLiveQuery(
        () => workspaceId
            ? db.agents.where('workspaceId').equals(workspaceId).and((item) => !item.isDeleted).toArray()
            : [],
        [workspaceId]
    ) ?? []
}

export function useAgent(agentId: string | null | undefined) {
    return useLiveQuery(
        async () => {
            if (!agentId) {
                return undefined
            }
            const agent = await db.agents.get(agentId)
            return agent && !agent.isDeleted ? agent : undefined
        },
        [agentId]
    )
}

export function useBusinessPartnerMergeCandidates(workspaceId: string | undefined) {
    const online = useNetworkStatus()

    const candidates = useLiveQuery(
        async () => {
            if (!workspaceId) return []
            const rows = await db.business_partner_merge_candidates.where('workspaceId').equals(workspaceId).and((item) => !item.isDeleted).toArray()
            return rows.sort((a, b) => b.confidence - a.confidence)
        },
        [workspaceId]
    )

    useEffect(() => {
        if (!workspaceId) {
            return
        }

        const hydrate = async () => {
            if (online && shouldUseCloudBusinessData(workspaceId)) {
                await fetchTableFromSupabase('business_partner_merge_candidates', db.business_partner_merge_candidates, workspaceId)
            }
            await refreshBusinessPartnerMergeCandidates(workspaceId)
        }

        void hydrate().catch((error) => {
            console.error('[BusinessPartners] Failed to hydrate merge candidates:', error)
        })
    }, [online, workspaceId])

    return candidates ?? []
}

export async function createBusinessPartner(
    workspaceId: string,
    data: BusinessPartnerCreateInput,
    options?: BusinessPartnerRoleAccessOptions
) {
    assertBusinessPartnerRoleAllowed(data.role, options)
    const { agent: agentInput, email: _email, country: _country, ...partnerData } = data as BusinessPartnerCreateInput & {
        email?: unknown
        country?: unknown
    }
    const partnerName = normalizeRequiredPartnerName(partnerData.partnerName)
    const normalizedAgentInput = roleIncludesAgent(data.role)
        ? normalizeAgentFacetInput(agentInput)
        : undefined
    await assertAgentLinkedUserAvailable(workspaceId, normalizedAgentInput?.linkedUserId)

    const legacyLimit = partnerData.creditLimit && partnerData.creditLimit > 0
        ? partnerData.creditLimit
        : null
    const partner = buildBaseEntity(workspaceId, {
        ...partnerData,
        partnerName,
        receivableCreditLimit: partnerData.receivableCreditLimit !== undefined
            ? partnerData.receivableCreditLimit
            : roleIncludesCustomer(partnerData.role) ? legacyLimit : null,
        payableCreditLimit: partnerData.payableCreditLimit !== undefined
            ? partnerData.payableCreditLimit
            : roleIncludesSupplier(partnerData.role) ? legacyLimit : null,
        isEcommerce: partnerData.isEcommerce ?? false,
        customerFacetId: null,
        supplierFacetId: null,
        agentFacetId: null,
        totalSalesOrders: 0,
        totalSalesValue: 0,
        receivableBalance: 0,
        totalPurchaseOrders: 0,
        totalPurchaseValue: 0,
        payableBalance: 0,
        totalLoanCount: 0,
        loanOutstandingBalance: 0,
        netExposure: 0,
        mergedIntoBusinessPartnerId: null,
        latitude: partnerData.latitude ?? null,
        longitude: partnerData.longitude ?? null
    }) as BusinessPartner

    await db.business_partners.put(partner)
    await syncUpsertEntities('business_partners', [partner as unknown as SyncEntity], workspaceId)

    let workingPartner = partner
    if (roleIncludesCustomer(partner.role)) {
        const customer = await createFacetFromPartner(workingPartner, 'customer')
        workingPartner = {
            ...workingPartner,
            customerFacetId: customer.id
        }
    }
    if (roleIncludesSupplier(partner.role)) {
        const supplier = await createFacetFromPartner(workingPartner, 'supplier')
        workingPartner = {
            ...workingPartner,
            supplierFacetId: supplier.id
        }
    }
    if (roleIncludesAgent(partner.role)) {
        const agent = await createOrUpdateAgentFacet(workingPartner, normalizedAgentInput)
        workingPartner = {
            ...workingPartner,
            agentFacetId: agent.id
        }
    }

    if (
        workingPartner.customerFacetId !== partner.customerFacetId
        || workingPartner.supplierFacetId !== partner.supplierFacetId
        || workingPartner.agentFacetId !== partner.agentFacetId
    ) {
        const now = new Date().toISOString()
        workingPartner = {
            ...workingPartner,
            updatedAt: now,
            version: workingPartner.version + 1,
            ...getSyncMetadata(workspaceId, now)
        }
        await db.business_partners.put(workingPartner)
        await syncUpsertEntities('business_partners', [workingPartner as unknown as SyncEntity], workspaceId)
    }

    await refreshBusinessPartnerMergeCandidates(workspaceId)
    return workingPartner
}

export async function updateBusinessPartner(id: string, data: BusinessPartnerUpdateInput, options?: BusinessPartnerRoleAccessOptions) {
    const existing = await getPartnerByAnyId(id)
    if (!existing || existing.isDeleted) {
        throw new Error('Business partner not found')
    }

    const { agent: agentInput, email: _email, country: _country, ...partnerChanges } = data as BusinessPartnerUpdateInput & {
        email?: unknown
        country?: unknown
    }
    if (partnerChanges.partnerName !== undefined) {
        partnerChanges.partnerName = normalizeRequiredPartnerName(partnerChanges.partnerName)
    }
    const nextRole = (partnerChanges.role || existing.role) as BusinessPartnerRole
    if (partnerChanges.creditLimit !== undefined) {
        if (partnerChanges.receivableCreditLimit === undefined && roleIncludesCustomer(nextRole)) {
            partnerChanges.receivableCreditLimit = partnerChanges.creditLimit
        }
        if (partnerChanges.payableCreditLimit === undefined && roleIncludesSupplier(nextRole)) {
            partnerChanges.payableCreditLimit = partnerChanges.creditLimit
        }
    }
    assertBusinessPartnerRoleAllowed(nextRole, options)
    await assertRoleRemovalAllowed(existing, nextRole)
    const existingAgent = existing.agentFacetId
        ? await db.agents.get(existing.agentFacetId)
        : await db.agents.where('businessPartnerId').equals(existing.id).first()
    const normalizedAgentInput = roleIncludesAgent(nextRole)
        ? normalizeAgentFacetInput(agentInput, existingAgent)
        : undefined
    await assertAgentLinkedUserAvailable(
        existing.workspaceId,
        normalizedAgentInput?.linkedUserId,
        existingAgent?.id
    )

    const now = new Date().toISOString()
    const { email: _existingEmail, country: _existingCountry, ...activeExisting } = existing as BusinessPartner & {
        email?: unknown
        country?: unknown
    }
    let updated: BusinessPartner = {
        ...activeExisting,
        ...partnerChanges,
        role: nextRole,
        receivableCreditLimit: partnerChanges.receivableCreditLimit !== undefined
            ? partnerChanges.receivableCreditLimit
            : existing.receivableCreditLimit ?? (roleIncludesCustomer(nextRole) && existing.creditLimit ? existing.creditLimit : null),
        payableCreditLimit: partnerChanges.payableCreditLimit !== undefined
            ? partnerChanges.payableCreditLimit
            : existing.payableCreditLimit ?? (roleIncludesSupplier(nextRole) && existing.creditLimit ? existing.creditLimit : null),
        updatedAt: now,
        version: existing.version + 1,
        ...getSyncMetadata(existing.workspaceId, now)
    }

    await db.business_partners.put(updated)
    await syncUpsertEntities('business_partners', [updated as unknown as SyncEntity], existing.workspaceId)

    if (roleIncludesCustomer(nextRole) && !updated.customerFacetId) {
        const customer = await createFacetFromPartner(updated, 'customer')
        updated = {
            ...updated,
            customerFacetId: customer.id,
            role: nextRoleWithFacet(updated.role, 'customer')
        }
    }

    if (roleIncludesSupplier(nextRole) && !updated.supplierFacetId) {
        const supplier = await createFacetFromPartner(updated, 'supplier')
        updated = {
            ...updated,
            supplierFacetId: supplier.id,
            role: nextRoleWithFacet(updated.role, 'supplier')
        }
    }
    if (roleIncludesAgent(nextRole)) {
        const agent = await createOrUpdateAgentFacet(updated, normalizedAgentInput)
        updated = {
            ...updated,
            agentFacetId: agent.id
        }
    } else if (roleIncludesAgent(existing.role)) {
        await setAgentFacetInactive(existing)
    }

    if (
        updated.customerFacetId !== existing.customerFacetId
        || updated.supplierFacetId !== existing.supplierFacetId
        || updated.agentFacetId !== existing.agentFacetId
    ) {
        const timestamp = new Date().toISOString()
        updated = {
            ...updated,
            updatedAt: timestamp,
            version: updated.version + 1,
            ...getSyncMetadata(existing.workspaceId, timestamp)
        }
        await db.business_partners.put(updated)
        await syncUpsertEntities('business_partners', [updated as unknown as SyncEntity], existing.workspaceId)
    }

    await mirrorPartnerToFacets(updated)
    await recalculateBusinessPartnerSummary(existing.workspaceId, updated.id)
    await refreshBusinessPartnerMergeCandidates(existing.workspaceId)
    return updated
}

export async function deleteBusinessPartner(id: string) {
    const partner = await getPartnerByAnyId(id)
    if (!partner || partner.isDeleted) {
        return
    }

    const [salesOrders, purchaseOrders, travelSales, loans] = await Promise.all([
        getPartnerSalesOrders(partner),
        getPartnerPurchaseOrders(partner),
        getPartnerTravelSales(partner),
        getPartnerLoans(partner)
    ])

    if (salesOrders.length > 0 || purchaseOrders.length > 0 || travelSales.length > 0 || loans.length > 0) {
        throw new Error('Business partner with transaction history cannot be deleted')
    }

    const now = new Date().toISOString()
    const deletedPartner: BusinessPartner = {
        ...partner,
        isDeleted: true,
        updatedAt: now,
        version: partner.version + 1,
        ...getSyncMetadata(partner.workspaceId, now)
    }
    await db.business_partners.put(deletedPartner)

    if (partner.customerFacetId) {
        const customer = await db.customers.get(partner.customerFacetId)
        if (customer && !customer.isDeleted) {
            await db.customers.put({
                ...customer,
                isDeleted: true,
                updatedAt: now,
                version: customer.version + 1,
                ...getSyncMetadata(customer.workspaceId, now)
            })
            await syncSoftDelete('customers', customer.id, customer.workspaceId)
        }
    }

    if (partner.supplierFacetId) {
        const supplier = await db.suppliers.get(partner.supplierFacetId)
        if (supplier && !supplier.isDeleted) {
            await db.suppliers.put({
                ...supplier,
                isDeleted: true,
                updatedAt: now,
                version: supplier.version + 1,
                ...getSyncMetadata(supplier.workspaceId, now)
            })
            await syncSoftDelete('suppliers', supplier.id, supplier.workspaceId)
        }
    }

    if (partner.agentFacetId) {
        const agent = await db.agents.get(partner.agentFacetId)
        if (agent && !agent.isDeleted) {
            await db.agents.put({
                ...agent,
                isDeleted: true,
                updatedAt: now,
                version: agent.version + 1,
                ...getSyncMetadata(agent.workspaceId, now)
            })
            await syncSoftDelete('agents', agent.id, agent.workspaceId, {
                businessPartnerId: deletedPartner.id
            })
        }
    }

    // Retire dependent facets before their business partner. This preserves
    // the database relationship while both deletes are queued or uploaded.
    await syncSoftDelete('business_partners', deletedPartner.id, deletedPartner.workspaceId)
}

export async function mergeBusinessPartners(primaryPartnerId: string, secondaryPartnerId: string) {
    const primary = await db.business_partners.get(primaryPartnerId)
    const secondary = await db.business_partners.get(secondaryPartnerId)
    if (!primary || !secondary || primary.isDeleted || secondary.isDeleted) {
        throw new Error('Business partner not found')
    }
    if (primary.workspaceId !== secondary.workspaceId) {
        throw new Error('Partners must belong to the same workspace')
    }
    if (roleIncludesAgent(primary.role) !== roleIncludesAgent(secondary.role)) {
        throw new Error('Agents can only be merged with other agents')
    }
    if (primary.defaultCurrency !== secondary.defaultCurrency) {
        throw new Error('Cannot merge business partners with different default currencies. Align the currencies first.')
    }

    const now = new Date().toISOString()
    const mergedRole: BusinessPartnerRole = primary.role === secondary.role
        ? primary.role
        : 'both'
    const mergedPrimary: BusinessPartner = {
        ...primary,
        partnerName: primary.partnerName || secondary.partnerName,
        phone: primary.phone || secondary.phone,
        address: primary.address || secondary.address,
        city: primary.city || secondary.city,
        notes: primary.notes || secondary.notes,
        role: mergedRole,
        creditLimit: Math.max(primary.creditLimit || 0, secondary.creditLimit || 0),
        receivableCreditLimit: Math.max(primary.receivableCreditLimit || 0, secondary.receivableCreditLimit || 0) || null,
        payableCreditLimit: Math.max(primary.payableCreditLimit || 0, secondary.payableCreditLimit || 0) || null,
        customerFacetId: primary.customerFacetId || secondary.customerFacetId || null,
        supplierFacetId: primary.supplierFacetId || secondary.supplierFacetId || null,
        agentFacetId: primary.agentFacetId || secondary.agentFacetId || null,
        isEcommerce: Boolean(primary.isEcommerce || secondary.isEcommerce),
        updatedAt: now,
        version: primary.version + 1,
        ...getSyncMetadata(primary.workspaceId, now)
    }
    const mergedSecondary: BusinessPartner = {
        ...secondary,
        mergedIntoBusinessPartnerId: primary.id,
        updatedAt: now,
        version: secondary.version + 1,
        ...getSyncMetadata(secondary.workspaceId, now)
    }

    await db.business_partners.bulkPut([mergedPrimary, mergedSecondary])
    await syncUpsertEntities('business_partners', [mergedPrimary as unknown as SyncEntity, mergedSecondary as unknown as SyncEntity], primary.workspaceId)

    if (secondary.customerFacetId) {
        const customer = await db.customers.get(secondary.customerFacetId)
        if (customer) {
            await syncCustomerFacet({
                ...customer,
                businessPartnerId: primary.id,
                updatedAt: now,
                version: customer.version + 1,
                ...getSyncMetadata(primary.workspaceId, now)
            })
        }
    }

    if (secondary.supplierFacetId) {
        const supplier = await db.suppliers.get(secondary.supplierFacetId)
        if (supplier) {
            await syncSupplierFacet({
                ...supplier,
                businessPartnerId: primary.id,
                updatedAt: now,
                version: supplier.version + 1,
                ...getSyncMetadata(primary.workspaceId, now)
            })
        }
    }

    if (secondary.agentFacetId) {
        const agent = await db.agents.get(secondary.agentFacetId)
        if (agent) {
            await syncAgentFacet({
                ...agent,
                businessPartnerId: mergedPrimary.agentFacetId === agent.id ? primary.id : secondary.id,
                status: mergedPrimary.agentFacetId === agent.id && mergedRole === 'agent' ? agent.status : 'inactive',
                updatedAt: now,
                version: agent.version + 1,
                ...getSyncMetadata(primary.workspaceId, now)
            })
        }
    }

    if (mergedRole !== 'agent') {
        await setAgentFacetInactive(mergedPrimary)
    }

    const salesOrders = await db.sales_orders.where('workspaceId').equals(primary.workspaceId).and((item) => !item.isDeleted && item.businessPartnerId === secondary.id).toArray()
    const purchaseOrders = await db.purchase_orders.where('workspaceId').equals(primary.workspaceId).and((item) => !item.isDeleted && item.businessPartnerId === secondary.id).toArray()
    const travelSales = await db.travel_agency_sales.where('workspaceId').equals(primary.workspaceId).and((item) => !item.isDeleted && item.businessPartnerId === secondary.id).toArray()
    const loans = await db.loans.where('workspaceId').equals(primary.workspaceId).and((item) => !item.isDeleted && item.linkedPartyId === secondary.id).toArray()

    await Promise.all(salesOrders.map((order) => db.sales_orders.update(order.id, { businessPartnerId: primary.id, customerId: mergedPrimary.customerFacetId || order.customerId })))
    await Promise.all(purchaseOrders.map((order) => db.purchase_orders.update(order.id, { businessPartnerId: primary.id, supplierId: mergedPrimary.supplierFacetId || order.supplierId })))
    await Promise.all(travelSales.map((sale) => db.travel_agency_sales.update(sale.id, { businessPartnerId: primary.id, supplierId: mergedPrimary.supplierFacetId || sale.supplierId })))
    await Promise.all(loans.map((loan) => db.loans.update(loan.id, { linkedPartyId: primary.id, linkedPartyType: 'business_partner' })))

    const candidates = await db.business_partner_merge_candidates.where('workspaceId').equals(primary.workspaceId).and((item) => {
        if (item.isDeleted) {
            return false
        }

        return item.primaryPartnerId === primary.id && item.secondaryPartnerId === secondary.id
            || item.primaryPartnerId === secondary.id
            || item.secondaryPartnerId === secondary.id
    }).toArray()

    const updatedCandidates = candidates.map((candidate) => ({
        ...candidate,
        status: candidate.primaryPartnerId === primary.id && candidate.secondaryPartnerId === secondary.id ? 'accepted' : candidate.status,
        isDeleted: candidate.primaryPartnerId === primary.id && candidate.secondaryPartnerId === secondary.id ? candidate.isDeleted : true,
        updatedAt: now,
        version: candidate.version + 1,
        ...getSyncMetadata(primary.workspaceId, now)
    })) as BusinessPartnerMergeCandidate[]
    if (updatedCandidates.length > 0) {
        await db.business_partner_merge_candidates.bulkPut(updatedCandidates)
        await syncUpsertEntities('business_partner_merge_candidates', updatedCandidates as unknown as SyncEntity[], primary.workspaceId)
    }

    await mirrorPartnerToFacets(mergedPrimary)
    await recalculateBusinessPartnerSummary(primary.workspaceId, primary.id)
    await refreshBusinessPartnerMergeCandidates(primary.workspaceId)
    return mergedPrimary
}

export async function dismissBusinessPartnerMergeCandidate(id: string) {
    const candidate = await db.business_partner_merge_candidates.get(id)
    if (!candidate || candidate.isDeleted) {
        return
    }

    const now = new Date().toISOString()
    const updated: BusinessPartnerMergeCandidate = {
        ...candidate,
        status: 'dismissed',
        updatedAt: now,
        version: candidate.version + 1,
        ...getSyncMetadata(candidate.workspaceId, now)
    }

    await db.business_partner_merge_candidates.put(updated)
    await syncUpsertEntities('business_partner_merge_candidates', [updated as unknown as SyncEntity], candidate.workspaceId)
}

export function useCustomers(workspaceId: string | undefined) {
    const partners = useBusinessPartners(workspaceId, { roles: ['customer'] })
    return partners.filter((partner) => roleIncludesCustomer(partner.role)).map(partnerToCustomer)
}

export function useSuppliers(workspaceId: string | undefined) {
    const partners = useBusinessPartners(workspaceId, { roles: ['supplier'] })
    return partners.filter((partner) => roleIncludesSupplier(partner.role)).map(partnerToSupplier)
}

export function useCustomer(customerId: string | undefined) {
    return useLiveQuery(async () => {
        if (!customerId) {
            return undefined
        }

        const partner = await getPartnerByAnyId(customerId)
        if (!partner || !roleIncludesCustomer(partner.role)) {
            return undefined
        }

        return partnerToCustomer(partner)
    }, [customerId])
}

export function useSupplier(supplierId: string | undefined) {
    return useLiveQuery(async () => {
        if (!supplierId) {
            return undefined
        }

        const partner = await getPartnerByAnyId(supplierId)
        if (!partner || !roleIncludesSupplier(partner.role)) {
            return undefined
        }

        return partnerToSupplier(partner)
    }, [supplierId])
}

export async function createCustomer(
    workspaceId: string,
    data: Omit<Customer, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'totalOrders' | 'totalSpent' | 'outstandingBalance'>
) {
    const partner = await createBusinessPartner(workspaceId, {
        partnerName: data.partnerName,
        phone: data.phone,
        address: data.address,
        city: data.city,
        defaultCurrency: data.defaultCurrency,
        notes: data.notes,
        role: 'customer',
        creditLimit: data.creditLimit,
        receivableCreditLimit: data.creditLimit
    })

    return partnerToCustomer(partner)
}

export async function createSupplier(
    workspaceId: string,
    data: Omit<Supplier, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'totalPurchases' | 'totalSpent'>
) {
    const partner = await createBusinessPartner(workspaceId, {
        partnerName: data.partnerName,
        phone: data.phone,
        address: data.address,
        city: data.city,
        defaultCurrency: data.defaultCurrency,
        notes: data.notes,
        role: 'supplier',
        creditLimit: data.creditLimit,
        payableCreditLimit: data.creditLimit
    })

    return partnerToSupplier(partner)
}

export async function updateCustomer(id: string, data: Partial<Customer>) {
    const partner = await updateBusinessPartner(id, {
        partnerName: data.partnerName,
        phone: data.phone,
        address: data.address,
        city: data.city,
        defaultCurrency: data.defaultCurrency,
        notes: data.notes,
        creditLimit: data.creditLimit,
        receivableCreditLimit: data.creditLimit
    })

    return partnerToCustomer(partner)
}

export async function updateSupplier(id: string, data: Partial<Supplier>) {
    const partner = await updateBusinessPartner(id, {
        partnerName: data.partnerName,
        phone: data.phone,
        address: data.address,
        city: data.city,
        defaultCurrency: data.defaultCurrency,
        notes: data.notes,
        creditLimit: data.creditLimit,
        payableCreditLimit: data.creditLimit
    })

    return partnerToSupplier(partner)
}

export async function deleteCustomer(id: string) {
    await deleteBusinessPartner(id)
}

export async function deleteSupplier(id: string) {
    await deleteBusinessPartner(id)
}
