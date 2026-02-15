import { Sale, UniversalInvoice } from '@/types'

export function mapSaleToUniversal(sale: Sale): UniversalInvoice {
    const sequenceId = sale.sequenceId ? String(sale.sequenceId).padStart(5, '0') : sale.id.slice(0, 8)
    return {
        id: sale.id,
        sequenceId: sale.sequenceId,
        invoiceid: `#${sequenceId}`,
        created_at: sale.created_at,
        workspaceId: sale.workspace_id,

        cashier_name: sale.cashier_name,
        total_amount: sale.total_amount,
        settlement_currency: sale.settlement_currency || 'usd',
        payment_method: sale.payment_method,
        exchange_rates: sale.exchange_rates,
        exchange_rate: sale.exchange_rate,
        exchange_source: sale.exchange_source,
        exchange_rate_timestamp: sale.exchange_rate_timestamp,
        origin: 'pos',
        items: (sale.items || []).map(item => {
            const unitPrice = item.converted_unit_price || item.unit_price || 0
            return {
                product_id: item.product_id,
                product_name: item.product_name || 'Unknown Product',
                product_sku: item.product_sku,
                quantity: item.quantity,
                unit_price: unitPrice,
                // Ensure total_price is in settlement currency
                total_price: unitPrice * (item.quantity || 0),
                original_unit_price: item.original_unit_price,
                original_currency: item.original_currency,
                settlement_currency: item.settlement_currency,
                discount_amount: (item.original_unit_price && item.negotiated_price) ?
                    (unitPrice / (item.negotiated_price / item.original_unit_price) - unitPrice) : 0
            }
        }),
        status: 'paid',
        customer_id: (sale as any).customerId || (sale as any).customer_id || '',
        order_id: (sale as any).orderId || (sale as any).order_id || ''
    }
}

// Note: mapInvoiceToUniversal has been removed.
// Invoices are now stored as PDFs in R2. There is no need to map them to UniversalInvoice.
// For viewing/printing, fetch the PDF directly from R2 using invoice.r2PathA4 or invoice.r2PathReceipt.

