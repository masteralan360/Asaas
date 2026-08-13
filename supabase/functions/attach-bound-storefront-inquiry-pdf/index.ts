import { createAdminClient } from '../_shared/supabase.ts'
import { errorResponse, jsonResponse, readJson } from '../_shared/http.ts'
import {
    isWebsiteStorefrontGatewayRequest,
    JUMLA_KHALEEJ_SITE_KEY,
    loadWebsiteStorefrontContext
} from '../_shared/websiteStorefront.ts'

type AttachInquiryPdfRequest = {
    order_id?: string
    order_number?: string
    document_number?: string
    storage_id?: string
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isStorageId(value: string) {
    return /^[A-Za-z0-9_-]{24,64}$/.test(value)
}

function isMarketplaceNumber(value: string) {
    return /^MKT-[0-9]{5,}$/.test(value)
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405)
    if (!isWebsiteStorefrontGatewayRequest(req)) return errorResponse('Unauthorized', 401)

    const body = await readJson<AttachInquiryPdfRequest>(req)
    const orderId = body?.order_id?.trim() ?? ''
    const orderNumber = body?.order_number?.trim() ?? ''
    const documentNumber = body?.document_number?.trim() ?? ''
    const storageId = body?.storage_id?.trim() ?? ''

    if (!isUuid(orderId) || !isMarketplaceNumber(orderNumber) || documentNumber !== orderNumber || !isStorageId(storageId)) {
        return errorResponse('Invalid inquiry PDF reference')
    }

    try {
        const adminClient = createAdminClient()
        const context = await loadWebsiteStorefrontContext(adminClient, req)
        if ('error' in context) return errorResponse(context.error, context.status)

        const { data: order, error: orderError } = await adminClient
            .from('marketplace_orders')
            .select('id, order_number, inquiry_pdf_storage_id')
            .eq('id', orderId)
            .eq('workspace_id', context.workspace.id)
            .eq('website_storefront_key', JUMLA_KHALEEJ_SITE_KEY)
            .eq('source_domain', context.config.primary_domain)
            .eq('is_deleted', false)
            .maybeSingle()

        if (orderError) return errorResponse(orderError.message, 500)
        if (!order || order.order_number !== orderNumber) return errorResponse('Marketplace order not found', 404)
        if (order.inquiry_pdf_storage_id && order.inquiry_pdf_storage_id !== storageId) {
            return errorResponse('A different inquiry PDF is already attached to this order', 409)
        }

        const { error: updateError } = await adminClient
            .from('marketplace_orders')
            .update({
                inquiry_pdf_storage_id: storageId,
                inquiry_pdf_document_number: documentNumber,
                inquiry_pdf_uploaded_at: new Date().toISOString()
            })
            .eq('id', orderId)

        if (updateError) return errorResponse(updateError.message, 500)
        return jsonResponse({ attached: true })
    } catch (error) {
        console.error('[attach-bound-storefront-inquiry-pdf]', error)
        return errorResponse(error instanceof Error ? error.message : 'Failed to attach inquiry PDF', 500)
    }
})
