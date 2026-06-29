import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
    activeWorkspaceId: null as string | null,
    localWorkspaceIds: new Set<string>()
}))

vi.mock('@/lib/network', () => ({
    getActiveBusinessWorkspaceId: () => testState.activeWorkspaceId
}))

vi.mock('@/workspace/workspaceMode', () => ({
    isLocalWorkspaceMode: (workspaceId?: string | null) => Boolean(workspaceId && testState.localWorkspaceIds.has(workspaceId))
}))

import {
    createWorkspaceUsageFetch,
    workspaceUsageFetchInternals
} from './workspaceUsageFetch'

const workspaceId = '2f3c9c52-1d56-42d0-9643-a381f14bac6d'

describe('workspace usage fetch metering', () => {
    beforeEach(() => {
        testState.activeWorkspaceId = null
        testState.localWorkspaceIds.clear()
    })

    it('extracts workspace filters from PostgREST URLs', () => {
        const url = new URL(`https://example.supabase.co/rest/v1/products?workspace_id=eq.${workspaceId}`)
        expect(workspaceUsageFetchInternals.extractWorkspaceIdsFromUrl(url, 'products')).toEqual([workspaceId])
    })

    it('counts GET table response bytes through the usage RPC', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = []
        const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            calls.push({ url: String(input), init })

            if (String(input).includes('/rpc/record_workspace_data_transfer')) {
                return new Response(JSON.stringify({ success: true }), { status: 200 })
            }

            return new Response(JSON.stringify([{ id: 'product-1' }]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        }) as unknown as typeof fetch

        const meteredFetch = createWorkspaceUsageFetch({
            supabaseUrl: 'https://example.supabase.co',
            supabaseAnonKey: 'anon-key',
            fetchImpl
        })

        const response = await meteredFetch(
            `https://example.supabase.co/rest/v1/products?workspace_id=eq.${workspaceId}`,
            {
                headers: {
                    Authorization: 'Bearer token'
                }
            }
        )

        expect(response.ok).toBe(true)
        expect(fetchImpl).toHaveBeenCalledTimes(2)

        const usageCall = calls[1]
        expect(usageCall.url).toBe('https://example.supabase.co/rest/v1/rpc/record_workspace_data_transfer')
        expect(JSON.parse(String(usageCall.init?.body))).toMatchObject({
            p_workspace_id: workspaceId,
            p_source: 'table_fetch:products'
        })
        expect(JSON.parse(String(usageCall.init?.body)).p_bytes).toBeGreaterThan(0)
    })

    it('does not count RPC responses or local workspaces', async () => {
        testState.localWorkspaceIds.add(workspaceId)
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })) as unknown as typeof fetch
        const meteredFetch = createWorkspaceUsageFetch({
            supabaseUrl: 'https://example.supabase.co',
            supabaseAnonKey: 'anon-key',
            fetchImpl
        })

        await meteredFetch(`https://example.supabase.co/rest/v1/products?workspace_id=eq.${workspaceId}`, {
            headers: { Authorization: 'Bearer token' }
        })
        await meteredFetch(`https://example.supabase.co/rest/v1/rpc/get_workspace_usage_status`, {
            method: 'POST',
            headers: { Authorization: 'Bearer token' }
        })

        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })
})
