import { createAdminClient } from './supabase.ts'

export const JUMLA_KHALEEJ_SITE_KEY = 'jumla-khaleej'

export type WebsiteStorefrontMode = 'retail' | 'wholesale'

export type WebsiteStorefrontConfig = {
    site_key: string
    workspace_id: string
    wholesale_price_book_id: string
    primary_domain: string
    is_enabled: boolean
}

export type WebsiteWorkspace = {
    id: string
    name: string
    store_description: string | null
    logo_url: string | null
    default_currency: string | null
}

export type WebsiteStorefrontContext = {
    config: WebsiteStorefrontConfig
    workspace: WebsiteWorkspace
}

export type MarketplaceInventoryRow = {
    product_id: string
    quantity: number | null
    created_at: string | null
}

export type MarketplaceProductRow = {
    id: string
    parent_product_id: string | null
    name: string
    sku: string
    description: string | null
    price: number
    cost_price: number | null
    currency: string | null
    unit: string | null
    category_id: string | null
    image_url: string | null
    created_at: string | null
}

export type WebsitePriceBookItem = {
    product_id: string
    price: number
    cost_price: number | null
    currency: string | null
}

export type VisibleModeProducts = {
    marketplaceStorageId: string
    inventoryRows: MarketplaceInventoryRow[]
    productRows: MarketplaceProductRow[]
    priceBookItemsByProductId: Map<string, WebsitePriceBookItem>
    marketplaceAddedAtByProductId: Map<string, string | null>
}

function normalizeDomain(value: string | null | undefined) {
    return (value ?? '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')
}

export function parseWebsiteStorefrontMode(value: string | null | undefined): WebsiteStorefrontMode | null {
    const mode = (value ?? '').trim().toLowerCase()
    return mode === 'retail' || mode === 'wholesale' ? mode : null
}

export function isWebsiteStorefrontGatewayRequest(req: Request) {
    const expected = Deno.env.get('WEBSITE_STOREFRONT_GATEWAY_SECRET') ?? ''
    const supplied = req.headers.get('x-storefront-gateway-secret') ?? ''

    if (!expected || !supplied || expected.length !== supplied.length) {
        return false
    }

    let mismatch = 0
    for (let index = 0; index < expected.length; index += 1) {
        mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index)
    }

    return mismatch === 0
}

export function getTrustedStorefrontClientIp(req: Request) {
    const value = req.headers.get('x-storefront-client-ip') ?? ''
    return value.slice(0, 128).trim() || null
}

export async function loadWebsiteStorefrontContext(
    adminClient: ReturnType<typeof createAdminClient>,
    req: Request
): Promise<WebsiteStorefrontContext | { error: string; status: number }> {
    const { data: config, error: configError } = await adminClient
        .from('website_storefront_configs')
        .select('site_key, workspace_id, wholesale_price_book_id, primary_domain, is_enabled')
        .eq('site_key', JUMLA_KHALEEJ_SITE_KEY)
        .maybeSingle()

    if (configError) {
        return { error: configError.message, status: 500 }
    }

    if (!config || !(config as WebsiteStorefrontConfig).is_enabled) {
        return { error: 'Storefront is unavailable', status: 404 }
    }

    const resolvedConfig = config as WebsiteStorefrontConfig
    const requestDomain = normalizeDomain(req.headers.get('x-storefront-origin'))
    if (!requestDomain || requestDomain !== normalizeDomain(resolvedConfig.primary_domain)) {
        return { error: 'Storefront origin is not allowed', status: 403 }
    }

    const { data: workspace, error: workspaceError } = await adminClient
        .from('workspaces')
        .select('id, name, store_description, logo_url, default_currency')
        .eq('id', resolvedConfig.workspace_id)
        .in('visibility', ['public', 'link_only'])
        .is('deleted_at', null)
        .maybeSingle()

    if (workspaceError) {
        return { error: workspaceError.message, status: 500 }
    }

    if (!workspace) {
        return { error: 'Storefront is unavailable', status: 404 }
    }

    return {
        config: resolvedConfig,
        workspace: workspace as WebsiteWorkspace
    }
}

export async function loadMarketplaceStorageId(
    adminClient: ReturnType<typeof createAdminClient>,
    workspaceId: string
): Promise<string | null> {
    const { data, error } = await adminClient.rpc('ensure_marketplace_storage', {
        p_workspace_id: workspaceId
    })

    if (error) {
        throw error
    }

    return typeof data === 'string' && data ? data : null
}

export async function loadVisibleModeProducts(
    adminClient: ReturnType<typeof createAdminClient>,
    context: WebsiteStorefrontContext,
    mode: WebsiteStorefrontMode
): Promise<VisibleModeProducts> {
    const marketplaceStorageId = await loadMarketplaceStorageId(adminClient, context.workspace.id)
    if (!marketplaceStorageId) {
        return {
            marketplaceStorageId: '',
            inventoryRows: [],
            productRows: [],
            priceBookItemsByProductId: new Map(),
            marketplaceAddedAtByProductId: new Map()
        }
    }

    const { data: inventoryRows, error: inventoryError } = await adminClient
        .from('inventory')
        .select('product_id, quantity, created_at')
        .eq('workspace_id', context.workspace.id)
        .eq('storage_id', marketplaceStorageId)
        .eq('is_deleted', false)

    if (inventoryError) {
        throw inventoryError
    }

    const resolvedInventoryRows = (inventoryRows ?? []) as MarketplaceInventoryRow[]
    const inventoryProductIds = Array.from(new Set(
        resolvedInventoryRows.map((inventory) => inventory.product_id).filter(Boolean)
    ))

    if (inventoryProductIds.length === 0) {
        return {
            marketplaceStorageId,
            inventoryRows: resolvedInventoryRows,
            productRows: [],
            priceBookItemsByProductId: new Map(),
            marketplaceAddedAtByProductId: new Map()
        }
    }

    let priceBookRows: WebsitePriceBookItem[] = []
    if (mode === 'wholesale') {
        const { data, error } = await adminClient
            .from('price_book_items')
            .select('product_id, price, cost_price, currency')
            .eq('workspace_id', context.workspace.id)
            .eq('price_book_id', context.config.wholesale_price_book_id)
            .eq('is_deleted', false)
            .in('product_id', inventoryProductIds)

        if (error) {
            throw error
        }

        priceBookRows = (data ?? []) as WebsitePriceBookItem[]
    }

    const resolvedPriceBookItems = new Map<string, WebsitePriceBookItem>()
    if (mode === 'wholesale') {
        for (const item of priceBookRows) {
            resolvedPriceBookItems.set(item.product_id, {
                product_id: item.product_id,
                price: Number(item.price ?? 0),
                cost_price: item.cost_price == null ? null : Number(item.cost_price),
                currency: item.currency
            })
        }
    }

    const visibleProductIds = mode === 'wholesale'
        ? inventoryProductIds.filter((productId) => resolvedPriceBookItems.has(productId))
        : inventoryProductIds

    if (visibleProductIds.length === 0) {
        return {
            marketplaceStorageId,
            inventoryRows: resolvedInventoryRows,
            productRows: [],
            priceBookItemsByProductId: resolvedPriceBookItems,
            marketplaceAddedAtByProductId: new Map()
        }
    }

    const { data: products, error: productsError } = await adminClient
        .from('products')
        .select('id, parent_product_id, name, sku, description, price, cost_price, currency, unit, category_id, image_url, created_at')
        .eq('workspace_id', context.workspace.id)
        .eq('is_deleted', false)
        .in('id', visibleProductIds)
        .order('name', { ascending: true })

    if (productsError) {
        throw productsError
    }

    return {
        marketplaceStorageId,
        inventoryRows: resolvedInventoryRows,
        productRows: (products ?? []) as MarketplaceProductRow[],
        priceBookItemsByProductId: resolvedPriceBookItems,
        marketplaceAddedAtByProductId: new Map(
            resolvedInventoryRows.map((inventory) => [inventory.product_id, inventory.created_at] as const)
        )
    }
}

export function resolveModePrice(
    product: MarketplaceProductRow,
    mode: WebsiteStorefrontMode,
    priceBookItemsByProductId: Map<string, WebsitePriceBookItem>
) {
    const priceBookItem = mode === 'wholesale'
        ? priceBookItemsByProductId.get(product.id)
        : null

    return {
        price: priceBookItem?.price ?? Number(product.price ?? 0),
        costPrice: priceBookItem?.cost_price ?? (product.cost_price == null ? null : Number(product.cost_price)),
        currency: priceBookItem?.currency ?? product.currency ?? null
    }
}
