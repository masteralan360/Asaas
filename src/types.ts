export interface SaleItem {
    id: string
    sale_id: string
    product_id: string
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
}

export interface Sale {
    id: string
    workspace_id: string
    cashier_id: string
    total_amount: number
    settlement_currency: string
    exchange_source: string
    exchange_rate: number
    exchange_rate_timestamp: string
    exchange_rates?: any[]
    created_at: string
    origin: 'pos' | 'manual'
    cashier_name?: string
    items?: SaleItem[]
}

export interface CartItem {
    product_id: string
    sku: string
    name: string
    price: number
    quantity: number
    max_stock: number
    negotiated_price?: number
}
