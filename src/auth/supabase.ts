import { createClient } from '@supabase/supabase-js'
import { getAppSettingSync } from '@/local-db/settings'
import { isMobile } from '@/lib/platform'

const supabaseUrl = getAppSettingSync('supabase_url') || (isMobile() ? '' : import.meta.env.VITE_SUPABASE_URL) || ''
const supabaseAnonKey = getAppSettingSync('supabase_anon_key') || (isMobile() ? '' : import.meta.env.VITE_SUPABASE_ANON_KEY) || ''

// Check if Supabase is configured with valid values
// We check against the actual values before fallback
const isUrlValid = supabaseUrl && supabaseUrl.startsWith('https://') && !supabaseUrl.includes('your_supabase_url')
const isKeyValid = supabaseAnonKey && !supabaseAnonKey.includes('your_supabase_anon')

export const isSupabaseConfigured = Boolean(isUrlValid && isKeyValid)

// Create Supabase client with fallbacks to prevent crash if not configured
// The app will redirect to configuration page if isSupabaseConfigured is false
const clientUrl = isUrlValid ? supabaseUrl : 'https://placeholder.supabase.co'
const clientKey = isKeyValid ? supabaseAnonKey : 'placeholder-key'

export const supabase = createClient(clientUrl, clientKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
})
// Database table types for Supabase
export type SupabaseProduct = {
    id: string
    sku: string
    name: string
    description: string
    category: string
    price: number
    cost_price: number
    quantity: number
    min_stock_level: number
    unit: string
    image_url: string | null
    created_at: string
    updated_at: string
    version: number
    is_deleted: boolean
    user_id: string
}

export type SupabaseCustomer = {
    id: string
    name: string
    email: string
    phone: string
    address: string
    city: string
    country: string
    notes: string | null
    total_orders: number
    total_spent: number
    created_at: string
    updated_at: string
    version: number
    is_deleted: boolean
    user_id: string
}

export type SupabaseOrder = {
    id: string
    order_number: string
    customer_id: string
    customer_name: string
    items: object[]
    subtotal: number
    tax: number
    discount: number
    total: number
    status: string
    notes: string | null
    shipping_address: string
    created_at: string
    updated_at: string
    version: number
    is_deleted: boolean
    user_id: string
}

export type SupabaseInvoice = {
    id: string
    invoice_number: string
    order_id: string
    customer_id: string
    customer_name: string
    items: object[]
    subtotal: number
    tax: number
    discount: number
    total: number
    status: string
    due_date: string
    paid_at: string | null
    notes: string | null
    created_at: string
    updated_at: string
    version: number
    is_deleted: boolean
    user_id: string
}
