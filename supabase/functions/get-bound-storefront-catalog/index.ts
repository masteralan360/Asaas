import { createAdminClient } from '../_shared/supabase.ts'
import { computeDiscountPrice, type ResolvedWorkspaceDiscountRow } from '../_shared/discounts.ts'
import { errorResponse, jsonResponse } from '../_shared/http.ts'
import {
    listMarketplaceAssetUrls,
    resolvePublicAssetUrl
} from '../_shared/marketplace.ts'
import {
    isWebsiteStorefrontGatewayRequest,
    loadVisibleModeProducts,
    loadWebsiteStorefrontContext,
    parseWebsiteStorefrontMode,
    resolveModePrice
} from '../_shared/websiteStorefront.ts'

type ContactRow = {
    type: string
    value: string
    label: string | null
    is_primary: boolean | null
}

type CategoryRow = {
    id: string
    name: string
}

type ProductImageRow = {
    product_id: string
    image_url: string
    position: number
}

function privateJsonResponse(payload: unknown, init: ResponseInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('Cache-Control', 'private, no-store')
    return jsonResponse(payload, { ...init, headers })
}

Deno.serve(async (req) => {
    if (req.method !== 'GET') {
        return errorResponse('Method not allowed', 405)
    }

    if (!isWebsiteStorefrontGatewayRequest(req)) {
        return errorResponse('Unauthorized', 401)
    }

    try {
        const url = new URL(req.url)
        const mode = parseWebsiteStorefrontMode(url.searchParams.get('mode'))
        if (!mode) {
            return errorResponse('A valid storefront mode is required')
        }

        const adminClient = createAdminClient()
        const context = await loadWebsiteStorefrontContext(adminClient, req)
        if ('error' in context) {
            return errorResponse(context.error, context.status)
        }

        const [{ data: contacts, error: contactsError }, visibleProducts] = await Promise.all([
            adminClient
                .from('workspace_contacts')
                .select('type, value, label, is_primary')
                .eq('workspace_id', context.workspace.id)
                .order('is_primary', { ascending: false })
                .order('created_at', { ascending: true }),
            loadVisibleModeProducts(adminClient, context, mode)
        ])

        if (contactsError) {
            return errorResponse(contactsError.message, 500)
        }

        const [
            { data: activeDiscounts, error: discountsError },
            resolvedLogoUrl
        ] = await Promise.all([
            visibleProducts.marketplaceStorageId
                ? adminClient.rpc('get_active_discounts_for_marketplace_storage', {
                    p_workspace_id: context.workspace.id,
                    p_storage_id: visibleProducts.marketplaceStorageId
                })
                : Promise.resolve({ data: [], error: null }),
            (async () => resolvePublicAssetUrl(context.workspace.logo_url)
                ?? (await listMarketplaceAssetUrls([
                    `${context.workspace.id}/workspace-logos/`,
                    `${context.workspace.id}/workspaces/`
                ], 1))[0]
                ?? null)()
        ])

        if (discountsError) {
            return errorResponse(discountsError.message, 500)
        }

        const discountByProductId = new Map<string, ResolvedWorkspaceDiscountRow>()
        for (const discount of (activeDiscounts ?? []) as ResolvedWorkspaceDiscountRow[]) {
            if (discount.is_stock_ok) {
                discountByProductId.set(discount.product_id, {
                    ...discount,
                    discount_value: Number(discount.discount_value ?? 0)
                })
            }
        }

        const categoryIds = Array.from(new Set(
            visibleProducts.productRows
                .map((product) => product.category_id)
                .filter((value): value is string => Boolean(value))
        ))
        const categoryNameById = new Map<string, string>()
        if (categoryIds.length > 0) {
            const { data: categories, error: categoryError } = await adminClient
                .from('categories')
                .select('id, name')
                .eq('workspace_id', context.workspace.id)
                .eq('is_deleted', false)
                .in('id', categoryIds)
                .order('name', { ascending: true })

            if (categoryError) {
                return errorResponse(categoryError.message, 500)
            }

            for (const category of (categories ?? []) as CategoryRow[]) {
                categoryNameById.set(category.id, category.name)
            }
        }

        const productIds = visibleProducts.productRows.map((product) => product.id)
        const quantityByProductId = new Map(
            visibleProducts.inventoryRows.map((inventory) => [
                inventory.product_id,
                Number(inventory.quantity ?? 0)
            ] as const)
        )
        const additionalImageUrlsByProductId = new Map<string, string[]>()
        if (productIds.length > 0) {
            const { data: additionalImages, error: additionalImagesError } = await adminClient
                .from('product_images')
                .select('product_id, image_url, position')
                .eq('workspace_id', context.workspace.id)
                .in('product_id', productIds)
                .order('product_id', { ascending: true })
                .order('position', { ascending: true })

            if (additionalImagesError) {
                return errorResponse(additionalImagesError.message, 500)
            }

            for (const image of (additionalImages ?? []) as ProductImageRow[]) {
                const imageUrl = resolvePublicAssetUrl(image.image_url)
                if (!imageUrl) continue
                const productImages = additionalImageUrlsByProductId.get(image.product_id) ?? []
                productImages.push(imageUrl)
                additionalImageUrlsByProductId.set(image.product_id, productImages)
            }
        }

        const directImageUrls = visibleProducts.productRows.map((product) => resolvePublicAssetUrl(product.image_url))
        const missingImageCount = directImageUrls.filter((value) => !value).length
        const fallbackImageUrls = missingImageCount > 0
            ? await listMarketplaceAssetUrls([`${context.workspace.id}/product-images/`], missingImageCount)
            : []
        let fallbackImageIndex = 0

        return privateJsonResponse({
            mode,
            store: {
                name: context.workspace.name,
                slug: 'jumla-khaleej',
                description: context.workspace.store_description,
                logo_url: resolvedLogoUrl,
                currency: context.workspace.default_currency ?? 'iqd',
                contacts: ((contacts ?? []) as ContactRow[]).map((contact) => ({
                    type: contact.type,
                    value: contact.value,
                    label: contact.label,
                    is_primary: Boolean(contact.is_primary)
                }))
            },
            categories: categoryIds
                .map((categoryId) => ({ id: categoryId, name: categoryNameById.get(categoryId) }))
                .filter((category): category is { id: string; name: string } => Boolean(category.name)),
            products: visibleProducts.productRows.map((product, index) => {
                const resolvedPrice = resolveModePrice(product, mode, visibleProducts.priceBookItemsByProductId)
                const discount = discountByProductId.get(product.id)
                return {
                    id: product.id,
                    parent_product_id: product.parent_product_id,
                    name: product.name,
                    sku: product.sku,
                    description: product.description ?? '',
                    quantity: quantityByProductId.get(product.id) ?? 0,
                    price: resolvedPrice.price,
                    currency: resolvedPrice.currency ?? context.workspace.default_currency ?? 'iqd',
                    unit: product.unit ?? 'pcs',
                    category_id: product.category_id,
                    category_name: product.category_id ? (categoryNameById.get(product.category_id) ?? null) : null,
                    image_url: directImageUrls[index]
                        ?? fallbackImageUrls[fallbackImageIndex++]
                        ?? resolvedLogoUrl,
                    additional_image_urls: additionalImageUrlsByProductId.get(product.id) ?? [],
                    discount_price: discount
                        ? computeDiscountPrice(resolvedPrice.price, discount.discount_type, discount.discount_value)
                        : null,
                    discount_type: discount?.discount_type ?? null,
                    discount_value: discount?.discount_value ?? null,
                    discount_ends_at: discount?.ends_at ?? null,
                    marketplace_added_at: visibleProducts.marketplaceAddedAtByProductId.get(product.id) ?? product.created_at ?? null
                }
            })
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error'
        console.error('[get-bound-storefront-catalog]', error)
        return errorResponse(message, 500)
    }
})
