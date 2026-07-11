import { createAdminClient } from '../_shared/supabase.ts'
import { computeDiscountPrice, type ResolvedWorkspaceDiscountRow } from '../_shared/discounts.ts'
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/http.ts'
import {
    listMarketplaceAssetUrls,
    resolvePublicAssetUrl,
    sanitizeMarketplaceText
} from '../_shared/marketplace.ts'

type WorkspaceRow = {
    id: string
    name: string
    store_slug: string | null
    store_description: string | null
    logo_url: string | null
    default_currency: string | null
}

type ProductRow = {
    id: string
    name: string
    sku: string
    description: string | null
    price: number
    currency: string | null
    unit: string | null
    category_id: string | null
    image_url: string | null
    created_at: string | null
}

type CategoryRow = {
    id: string
    name: string
}

type ContactRow = {
    type: string
    value: string
    label: string | null
    is_primary: boolean | null
}

type InventoryRow = {
    product_id: string
    quantity: number | null
    created_at: string | null
}

function buildStorePayload(workspace: WorkspaceRow, logoUrl: string | null, contacts: ContactRow[]) {
    return {
        name: workspace.name,
        slug: workspace.store_slug,
        description: workspace.store_description,
        logo_url: logoUrl,
        currency: workspace.default_currency ?? 'iqd',
        contacts: contacts.map((contact) => ({
            type: contact.type,
            value: contact.value,
            label: contact.label,
            is_primary: Boolean(contact.is_primary)
        }))
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    if (req.method !== 'GET') {
        return errorResponse('Method not allowed', 405)
    }

    try {
        const url = new URL(req.url)
        const slug = sanitizeMarketplaceText(url.searchParams.get('slug'), 80).toLowerCase()
        if (!slug) {
            return errorResponse('Store slug is required')
        }

        const adminClient = createAdminClient()

        const { data: workspace, error: workspaceError } = await adminClient
            .from('workspaces')
            .select('id, name, store_slug, store_description, logo_url, default_currency')
            .eq('store_slug', slug)
            .eq('visibility', 'public')
            .is('deleted_at', null)
            .maybeSingle()

        if (workspaceError) {
            return errorResponse(workspaceError.message, 500)
        }

        if (!workspace) {
            return errorResponse('Store not found', 404)
        }

        const resolvedWorkspace = workspace as WorkspaceRow

        const [
            { data: contacts, error: contactsError },
            { data: marketplaceStorageId, error: marketplaceStorageError }
        ] = await Promise.all([
            adminClient
                .from('workspace_contacts')
                .select('type, value, label, is_primary')
                .eq('workspace_id', resolvedWorkspace.id)
                .order('is_primary', { ascending: false })
                .order('created_at', { ascending: true }),
            adminClient.rpc('ensure_marketplace_storage', {
                p_workspace_id: resolvedWorkspace.id
            })
        ])

        if (contactsError) {
            return errorResponse(contactsError.message, 500)
        }

        if (marketplaceStorageError) {
            return errorResponse(marketplaceStorageError.message, 500)
        }

        const storeContacts = ((contacts ?? []) as ContactRow[])
        const resolvedLogoUrl = resolvePublicAssetUrl(resolvedWorkspace.logo_url)
            ?? (await listMarketplaceAssetUrls([
                `${resolvedWorkspace.id}/workspace-logos/`,
                `${resolvedWorkspace.id}/workspaces/`
            ], 1))[0]
            ?? null

        if (!marketplaceStorageId) {
            return jsonResponse(
                {
                    store: buildStorePayload(resolvedWorkspace, resolvedLogoUrl, storeContacts),
                    categories: [],
                    products: []
                },
                {
                    headers: {
                        'Cache-Control': 'public, max-age=30, s-maxage=120'
                    }
                }
            )
        }

        const [
            { data: inventoryRows, error: inventoryError },
            { data: activeDiscounts, error: discountsError }
        ] = await Promise.all([
            adminClient
                .from('inventory')
                .select('product_id, quantity, created_at')
                .eq('workspace_id', resolvedWorkspace.id)
                .eq('storage_id', marketplaceStorageId)
                .eq('is_deleted', false),
            adminClient.rpc('get_active_discounts_for_marketplace_storage', {
                p_workspace_id: resolvedWorkspace.id,
                p_storage_id: marketplaceStorageId
            })
        ])

        if (inventoryError) {
            return errorResponse(inventoryError.message, 500)
        }

        if (discountsError) {
            return errorResponse(discountsError.message, 500)
        }

        const visibleProductIds = Array.from(new Set(
            ((inventoryRows ?? []) as InventoryRow[])
                .map((row) => row.product_id)
                .filter(Boolean)
        ))

        if (visibleProductIds.length === 0) {
            return jsonResponse(
                {
                    store: buildStorePayload(resolvedWorkspace, resolvedLogoUrl, storeContacts),
                    categories: [],
                    products: []
                },
                {
                    headers: {
                        'Cache-Control': 'public, max-age=30, s-maxage=120'
                    }
                }
            )
        }

        const { data: products, error: productsError } = await adminClient
            .from('products')
            .select('id, name, sku, description, price, currency, unit, category_id, image_url, created_at')
            .eq('workspace_id', resolvedWorkspace.id)
            .eq('is_deleted', false)
            .in('id', visibleProductIds)
            .order('name', { ascending: true })

        if (productsError) {
            return errorResponse(productsError.message, 500)
        }

        const productRows = (products ?? []) as ProductRow[]
        const marketplaceAddedAtByProductId = new Map(
            ((inventoryRows ?? []) as InventoryRow[])
                .map((row) => [row.product_id, row.created_at] as const)
        )
        const discountByProductId = new Map<string, ResolvedWorkspaceDiscountRow>()
        for (const discount of (activeDiscounts ?? []) as ResolvedWorkspaceDiscountRow[]) {
            if (discount.is_stock_ok) {
                discountByProductId.set(discount.product_id, {
                    ...discount,
                    discount_value: Number(discount.discount_value ?? 0)
                })
            }
        }

        const categoryIds = Array.from(new Set(productRows.map((product) => product.category_id).filter((value): value is string => Boolean(value))))
        const categoryNameById = new Map<string, string>()

        if (categoryIds.length > 0) {
            const { data: categories, error: categoryError } = await adminClient
                .from('categories')
                .select('id, name')
                .in('id', categoryIds)
                .eq('is_deleted', false)
                .order('name', { ascending: true })

            if (categoryError) {
                return errorResponse(categoryError.message, 500)
            }

            for (const category of (categories ?? []) as CategoryRow[]) {
                categoryNameById.set(category.id, category.name)
            }
        }

        const resolvedProductImageUrls = productRows.map((product) => resolvePublicAssetUrl(product.image_url))
        const missingProductImageCount = resolvedProductImageUrls.filter((value) => !value).length
        const fallbackProductImageUrls = missingProductImageCount > 0
            ? await listMarketplaceAssetUrls([`${resolvedWorkspace.id}/product-images/`], missingProductImageCount)
            : []
        let fallbackProductImageIndex = 0

        return jsonResponse(
            {
                store: buildStorePayload(resolvedWorkspace, resolvedLogoUrl, storeContacts),
                categories: categoryIds
                    .map((categoryId) => ({
                        id: categoryId,
                        name: categoryNameById.get(categoryId)
                    }))
                    .filter((category): category is { id: string; name: string } => Boolean(category.name)),
                products: productRows.map((product, index) => {
                    const basePrice = Number(product.price ?? 0)
                    const resolvedDiscount = discountByProductId.get(product.id)

                    return {
                        id: product.id,
                        name: product.name,
                        sku: product.sku,
                        description: product.description ?? '',
                        price: basePrice,
                        currency: product.currency ?? resolvedWorkspace.default_currency ?? 'iqd',
                        unit: product.unit ?? 'pcs',
                        category_id: product.category_id,
                        category_name: product.category_id ? (categoryNameById.get(product.category_id) ?? null) : null,
                        image_url: resolvedProductImageUrls[index]
                            ?? fallbackProductImageUrls[fallbackProductImageIndex++]
                            ?? resolvedLogoUrl,
                        discount_price: resolvedDiscount
                            ? computeDiscountPrice(basePrice, resolvedDiscount.discount_type, resolvedDiscount.discount_value)
                            : null,
                        discount_type: resolvedDiscount?.discount_type ?? null,
                        discount_value: resolvedDiscount?.discount_value ?? null,
                        discount_ends_at: resolvedDiscount?.ends_at ?? null,
                        marketplace_added_at: marketplaceAddedAtByProductId.get(product.id) ?? product.created_at ?? null
                    }
                })
            },
            {
                headers: {
                    'Cache-Control': 'public, max-age=30, s-maxage=120'
                }
            }
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error'
        return errorResponse(message, 500)
    }
})
