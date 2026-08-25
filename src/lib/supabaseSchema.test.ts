import { describe, expect, it, vi } from 'vitest'

const clients = vi.hoisted(() => ({
    public: {},
    crm: {},
    schema: vi.fn((schemaName: string) => schemaName === 'crm' ? clients.crm : {})
}))

vi.mock('@/auth/supabase', () => ({
    supabase: {
        ...clients.public,
        schema: clients.schema
    }
}))

import { getSupabaseClientForTable, isCrmTable } from './supabaseSchema'

describe('commission Supabase schema routing', () => {
    it.each([
        'agent_commission_entries',
        'agent_commission_memberships',
        'agent_commission_plans',
        'sales_order_agent_assignments'
    ])('routes %s through the crm schema', (tableName) => {
        expect(isCrmTable(tableName)).toBe(true)
        expect(getSupabaseClientForTable(tableName)).toBe(clients.crm)
    })
})
