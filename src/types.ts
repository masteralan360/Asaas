export interface SaleItem {
    id: string
    sale_id: string
    product_id: string
    quantity: number
    unit_price: number
    total_price: number
    product_name?: string // Optional, joined for display
    product_sku?: string // Optional, joined for display
}

export interface Sale {
    id: string
    workspace_id: string
    cashier_id: string
    total_amount: number
    created_at: string
    origin: 'pos' | 'manual'
    cashier_name?: string // Optional, joined for display
    items?: SaleItem[] // Optional, for detailed view
}

export interface CartItem {
    product_id: string
    sku: string
    name: string
    price: number
    quantity: number
    max_stock: number
}
