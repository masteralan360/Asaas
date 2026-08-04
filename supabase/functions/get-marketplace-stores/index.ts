import { createAdminClient } from '../_shared/supabase.ts'
import { errorResponse, jsonResponse, corsHeaders } from '../_shared/http.ts'
import {
    listMarketplaceAssetUrls,
    resolvePublicAssetUrl,
    resolveStorefrontVisibleProductIds,
    type StorefrontCatalogRule
} from '../_shared/marketplace.ts'

type WorkspaceRow = {
    id: string
    name: string
    visibility: string | null
    store_slug: string | null
    store_description: string | null
    logo_url: string | null
    default_currency: string | null
}

type StorefrontRow = {
    id: string
    workspace_id: string
    slug: string
    description: string | null
}

type StorefrontEntry = {
    workspaceId: string
    name: string
    slug: string
    description: string | null
    logo_url: string | null
    default_currency: string | null
    storefrontId: string | null
}

type MarketplaceStorageRow = {
    id: string
    workspace_id: string
}

type ProductSummaryRow = {
    id: string
    workspace_id: string
    category_id: string | null
}

type InventoryRow = {
    workspace_id: string
    storage_id: string
    product_id: string
    quantity: number | null
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    if (req.method !== 'GET') {
        return errorResponse('Method not allowed', 405)
    }

    try {
        const adminClient = createAdminClient()

        const { data: workspaces, error: workspaceError } = await adminClient
            .from('workspaces')
            .select('id, name, visibility, store_slug, store_description, logo_url, default_currency')
            .is('deleted_at', null)
            .order('name', { ascending: true })

        if (workspaceError) {
            return errorResponse(workspaceError.message, 500)
        }

        const workspaceRows = ((workspaces ?? []) as WorkspaceRow[])
        const workspaceById = new Map(workspaceRows.map((workspace) => [workspace.id, workspace] as const))

        const entries: StorefrontEntry[] = []
        const entryWorkspaceIds = new Set<string>()

        for (const workspace of workspaceRows) {
            if (workspace.visibility === 'public' && Boolean(workspace.store_slug)) {
                entries.push({
                    workspaceId: workspace.id,
                    name: workspace.name,
                    slug: workspace.store_slug!,
                    description: workspace.store_description,
                    logo_url: workspace.logo_url,
                    default_currency: workspace.default_currency,
                    storefrontId: null
                })
                entryWorkspaceIds.add(workspace.id)
            }
        }

        const { data: storefronts, error: storefrontsError } = await adminClient
            .from('workspace_storefronts')
            .select('id, workspace_id, slug, description')
            .eq('visibility', 'public')

        if (storefrontsError) {
            return errorResponse(storefrontsError.message, 500)
        }

        for (const storefront of (storefronts ?? []) as StorefrontRow[]) {
            const workspace = workspaceById.get(storefront.workspace_id)
            if (!workspace || !storefront.slug) {
                continue
            }

            entries.push({
                workspaceId: workspace.id,
                name: workspace.name,
                slug: storefront.slug,
                description: storefront.description,
                logo_url: workspace.logo_url,
                default_currency: workspace.default_currency,
                storefrontId: storefront.id
            })
            entryWorkspaceIds.add(workspace.id)
        }

        const workspaceIds = Array.from(entryWorkspaceIds)
        const countsByWorkspace = new Map<string, { productIds: Set<string>; categoryIds: Set<string> }>()
        const productById = new Map<string, ProductSummaryRow>()

        if (workspaceIds.length > 0) {
            const [
                { data: marketplaceStorages, error: marketplaceStorageError },
                { data: products, error: productError }
            ] = await Promise.all([
                adminClient
                    .from('storages')
                    .select('id, workspace_id')
                    .in('workspace_id', workspaceIds)
                    .eq('is_deleted', false)
                    .eq('is_marketplace', true),
                adminClient
                    .from('products')
                    .select('id, workspace_id, category_id')
                    .in('workspace_id', workspaceIds)
                    .eq('is_deleted', false)
            ])

            if (marketplaceStorageError) {
                return errorResponse(marketplaceStorageError.message, 500)
            }

            if (productError) {
                return errorResponse(productError.message, 500)
            }

            const marketplaceStorageIdByWorkspace = new Map<string, string>()
            for (const row of (marketplaceStorages ?? []) as MarketplaceStorageRow[]) {
                if (!marketplaceStorageIdByWorkspace.has(row.workspace_id)) {
                    marketplaceStorageIdByWorkspace.set(row.workspace_id, row.id)
                }
            }

            for (const row of (products ?? []) as ProductSummaryRow[]) {
                productById.set(row.id, row)
            }

            const marketplaceStorageIds = Array.from(new Set(Array.from(marketplaceStorageIdByWorkspace.values())))
            if (marketplaceStorageIds.length > 0) {
                const { data: inventoryRows, error: inventoryError } = await adminClient
                    .from('inventory')
                    .select('workspace_id, storage_id, product_id, quantity')
                    .in('workspace_id', workspaceIds)
                    .in('storage_id', marketplaceStorageIds)
                    .eq('is_deleted', false)
                    .gt('quantity', 0)

                if (inventoryError) {
                    return errorResponse(inventoryError.message, 500)
                }

                for (const row of (inventoryRows ?? []) as InventoryRow[]) {
                    if (marketplaceStorageIdByWorkspace.get(row.workspace_id) !== row.storage_id) {
                        continue
                    }

                    const product = productById.get(row.product_id)
                    if (!product || product.workspace_id !== row.workspace_id) {
                        continue
                    }

                    const current = countsByWorkspace.get(row.workspace_id) ?? {
                        productIds: new Set<string>(),
                        categoryIds: new Set<string>()
                    }

                    current.productIds.add(product.id)
                    if (product.category_id) {
                        current.categoryIds.add(product.category_id)
                    }

                    countsByWorkspace.set(row.workspace_id, current)
                }
            }
        }

        const rulesByKey = new Map<string, StorefrontCatalogRule[]>()
        if (workspaceIds.length > 0) {
            const { data: ruleRows, error: rulesError } = await adminClient
                .from('workspace_storefront_catalog_rules')
                .select('workspace_id, storefront_id, rule_type, price_book_id, override_prices')
                .in('workspace_id', workspaceIds)

            if (rulesError) {
                return errorResponse(rulesError.message, 500)
            }

            for (const row of (ruleRows ?? []) as {
                workspace_id: string
                storefront_id: string | null
                rule_type: string
                price_book_id: string | null
                override_prices: boolean | null
            }[]) {
                const key = `${row.workspace_id}:${row.storefront_id ?? ''}`
                const rules = rulesByKey.get(key) ?? []
                rules.push({
                    rule_type: row.rule_type === 'exclusion' ? 'exclusion' : 'inclusion',
                    price_book_id: row.price_book_id,
                    override_prices: Boolean(row.override_prices)
                })
                rulesByKey.set(key, rules)
            }
        }

        const logoUrlByWorkspace = new Map<string, string | null>()
        const getLogoUrl = async (workspaceId: string, rawLogoUrl: string | null) => {
            if (logoUrlByWorkspace.has(workspaceId)) {
                return logoUrlByWorkspace.get(workspaceId) ?? null
            }

            const logoUrl = resolvePublicAssetUrl(rawLogoUrl)
                ?? (await listMarketplaceAssetUrls([
                    `${workspaceId}/workspace-logos/`,
                    `${workspaceId}/workspaces/`
                ], 1))[0]
                ?? null
            logoUrlByWorkspace.set(workspaceId, logoUrl)
            return logoUrl
        }

        const stores = await Promise.all(entries.map(async (entry) => {
            const counts = countsByWorkspace.get(entry.workspaceId) ?? {
                productIds: new Set<string>(),
                categoryIds: new Set<string>()
            }
            const rules = rulesByKey.get(`${entry.workspaceId}:${entry.storefrontId ?? ''}`)

            let productCount = counts.productIds.size
            let categoryCount = counts.categoryIds.size

            if (rules && rules.length > 0 && counts.productIds.size > 0) {
                const visibleProductIds = await resolveStorefrontVisibleProductIds(
                    adminClient,
                    entry.workspaceId,
                    Array.from(counts.productIds),
                    { storefrontId: entry.storefrontId, rules }
                )

                if (visibleProductIds) {
                    const visibleProductIdSet = new Set(
                        Array.from(counts.productIds).filter((productId) => visibleProductIds.has(productId))
                    )
                    productCount = visibleProductIdSet.size
                    categoryCount = new Set(
                        Array.from(visibleProductIdSet)
                            .map((productId) => productById.get(productId)?.category_id)
                            .filter((value): value is string => Boolean(value))
                    ).size
                }
            }

            return {
                name: entry.name,
                slug: entry.slug,
                description: entry.description,
                logo_url: await getLogoUrl(entry.workspaceId, entry.logo_url),
                default_currency: entry.default_currency ?? 'iqd',
                product_count: productCount,
                category_count: categoryCount
            }
        }))

        return jsonResponse(
            { stores },
            {
                headers: {
                    'Cache-Control': 'public, max-age=60, s-maxage=300'
                }
            }
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error'
        return errorResponse(message, 500)
    }
})