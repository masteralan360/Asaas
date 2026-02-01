import { Sale, UniversalInvoice } from '@/types'
import { Invoice } from '@/local-db/models'

export function mapSaleToUniversal(sale: Sale): UniversalInvoice {
    const sequenceId = sale.sequence_id ? String(sale.sequence_id).padStart(5, '0') : sale.id.slice(0, 8)
    return {
        id: sale.id,
        sequence_id: sale.sequence_id,
        invoiceid: `#${sequenceId}`,
        created_at: sale.created_at,

        cashier_name: sale.cashier_name,
        total_amount: sale.total_amount,
        settlement_currency: sale.settlement_currency || 'usd',
        payment_method: sale.payment_method,
        exchange_rates: sale.exchange_rates,
        exchange_rate: sale.exchange_rate,
        exchange_source: sale.exchange_source,
        exchange_rate_timestamp: sale.exchange_rate_timestamp,
        origin: 'pos',
        items: (sale.items || []).map(item => ({
            product_id: item.product_id,
            product_name: item.product_name || 'Unknown Product',
            product_sku: item.product_sku,
            quantity: item.quantity,
            unit_price: item.converted_unit_price || item.unit_price,
            total_price: item.total_price || ((item.converted_unit_price || item.unit_price) * item.quantity),
            original_unit_price: item.original_unit_price,
            original_currency: item.original_currency,
            settlement_currency: item.settlement_currency,
            discount_amount: (item.original_unit_price && item.negotiated_price) ?
                (item.original_unit_price - item.negotiated_price) * item.quantity : 0
        }))
    }
}

export function mapInvoiceToUniversal(invoice: Invoice): UniversalInvoice {
    return {
        id: invoice.id,
        invoiceid: invoice.invoiceid,
        created_at: invoice.createdAt,
        items: invoice.items.map(i => ({
            product_id: i.productId,
            product_name: i.productName,
            quantity: i.quantity,
            unit_price: i.unitPrice,
            total_price: i.total,
            discount_amount: 0, // Fallback as we removed item-level discount tracking if it was there, or keep 0
            product_sku: ''
        })),
        total_amount: invoice.total,
        settlement_currency: invoice.currency,
        cashier_name: invoice.cashierName || invoice.createdBy || 'System', // Sold By
        created_by_name: invoice.createdByName, // The person who generated the invoice
        customer_name: undefined
    }
}
