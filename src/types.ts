export interface SaleItem {
    id: string
    sale_id: string
    product_id: string
    storage_id?: string | null
    quantity: number
    unit_price: number
    total_price: number
    cost_price?: number
    converted_cost_price?: number
    product_name?: string
    product_sku?: string
    original_currency: string
    original_unit_price: number
    converted_unit_price: number
    settlement_currency: string
    negotiated_price?: number
    inventory_snapshot?: number
    batch_allocations?: {
        batch_id: string
        batch_number: string
        quantity: number
        price?: number | null
        cost_price?: number | null
        currency?: string | null
        expiry_date?: string | null
        manufacturing_date?: string | null
    }[] | null
    original_batch_allocations?: {
        batch_id: string
        batch_number: string
        quantity: number
        price?: number | null
        cost_price?: number | null
        currency?: string | null
        expiry_date?: string | null
        manufacturing_date?: string | null
    }[] | null
    returned_quantity?: number
    is_returned?: boolean
    return_reason?: string
    returned_at?: string
    returned_by?: string
    product?: {
        name: string
        sku: string
        category?: string
        can_be_returned: boolean
        return_rules?: string
        unit?: string
        is_deleted?: boolean
    }
    product_category?: string
}

export interface Sale {
    id: string
    workspace_id: string
    cashier_id: string
    total_amount: number
    totalAmount?: number
    original_total_amount?: number
    returned_amount?: number
    return_status?: 'none' | 'partial' | 'full'
    settlement_currency: string
    sales_exchange?: SalesExchange[]
    // Derived compatibility shape for receipt and invoice rendering.
    exchange_rates?: any[] | null
    created_at: string
    origin: 'pos' | 'manual' | 'instant_pos' | 'sales_order' | 'travel_agency' | 'exchange' | 'real_estate' | 'clinical_appointment'
    payment_method?: 'cash' | 'fib' | 'qicard' | 'zaincash' | 'fastpay' | 'bank_transfer' | 'loan'
    cashier_name?: string
    items?: SaleItem[]
    is_returned?: boolean
    return_reason?: string
    returned_at?: string
    returned_by?: string
    // Sequential ID
    sequenceId?: number
    // System Verification (offline-first, immutable)
    system_verified?: boolean
    system_review_status?: 'approved' | 'flagged' | 'inconsistent'
    system_review_reason?: string | null
    has_partial_return?: boolean
    notes?: string
    updated_at?: string
    _orderNumber?: string
    _isOrder?: boolean
    _sourceChannel?: string | null
    _realEstateTransactionId?: string | null
    _clinicalAppointmentId?: string | null
    _counterpartyName?: string | null
    returns?: SaleReturn[]
}

export interface SalesExchange {
    id: string
    sale_id: string
    workspace_id: string
    base_currency: 'usd' | 'eur' | 'iqd' | 'try'
    quote_currency: 'usd' | 'eur' | 'iqd' | 'try'
    base_amount: number
    quote_amount: number
    source: string
    captured_at: string
    rate_side: 'buy' | 'sell' | 'mid'
    source_price_id?: string | null
    source_price_updated_at?: string | null
    created_at: string
}

export interface SaleReturn {
    id: string
    workspace_id: string
    sale_id: string
    reason: string
    status: 'posted' | 'voided'
    refund_method?: string | null
    refund_amount: number
    returned_by?: string | null
    returned_at: string
    source: 'app' | 'legacy_backfill' | 'system'
    created_at: string
    updated_at: string
    items?: SaleReturnItem[]
}

export interface SaleReturnItem {
    id: string
    workspace_id: string
    return_id: string
    sale_id: string
    sale_item_id: string
    quantity: number
    unit_refund_amount: number
    refund_amount: number
    restored_storage_id?: string | null
    restored_batch_allocations?: SaleItem['batch_allocations']
    created_at: string
    updated_at: string
}

export interface CartItem {
    product_id: string
    storageId?: string
    sku: string
    name: string
    price: number
    discounted_price?: number
    discount_type?: 'percentage' | 'fixed_amount'
    discount_value?: number
    discount_source?: 'product' | 'category'
    discount_ends_at?: string
    quantity: number
    max_stock: number
    negotiated_price?: number
    imageUrl?: string
    unit?: string
}

export interface UniversalInvoiceItem {
    product_id: string
    product_name: string
    product_sku?: string
    unit?: string
    quantity: number
    unit_price: number
    total_price: number
    original_unit_price?: number
    original_currency?: string
    settlement_currency?: string
    discount_amount?: number
    refunded_quantity?: number
    active_quantity?: number
    original_quantity?: number
    refunded_amount?: number
    active_amount?: number
    refund_status?: 'fully_refunded' | 'partially_refunded' | 'not_refunded'
}

export interface Annotation {
    type: 'pen' | 'brush'
    points: { x: number, y: number }[]
    color: string
    brushSize: number
}

export interface AttachedText {
    id: string
    text: string
    x: number
    y: number
    width: number
    rotation?: number
    fontSize?: number | ''
    color?: string
}

export interface UniversalInvoice {
    id: string
    sequenceId?: number
    invoiceid?: string
    created_at: string

    cashier_name?: string
    customer_name?: string
    customer_address?: string
    terms?: string
    items: UniversalInvoiceItem[]
    total_amount: number
    subtotal_amount?: number
    tax_amount?: number
    discount_amount?: number
    settlement_currency: string
    payment_method?: string
    exchange_rates?: any[] | null
    exchange_rate?: number | null
    exchange_source?: string | null
    exchange_rate_timestamp?: string | null
    origin?: string
    created_by_name?: string
    status?: string
    customer_id?: string
    order_id?: string
    workspaceId?: string
    is_refund_invoice?: boolean
    attached_images?: {
        path: string
        x: number
        y: number
        width: number
        height?: number
        rotation?: number
    }[]
    refund_summary?: {
        is_fully_returned: boolean
        refund_reason?: string
        returned_at?: string
        original_total: number
        refunded_total: number
        active_total: number
    }
    annotations?: Annotation[]
    attached_texts?: AttachedText[]
    hiddenPrintFields?: Record<string, boolean>
    notes?: string
}
