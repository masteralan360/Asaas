import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const workspaceId = '2f3c9c52-1d56-42d0-9643-a381f14bac6d'

function createEnv(overrides = {}) {
    return {
        SUPABASE_URL: 'https://atlas.example.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        R2_WORKER_URL: 'https://r2.example.workers.dev',
        MARKETPLACE_HOST: 'shop.atlaserp.dev',
        ASSETS: {
            fetch: vi.fn(async (request) => new Response(new URL(request.url).pathname, { status: 200 }))
        },
        ...overrides
    }
}

function workspaceAccess({ locked = false } = {}) {
    return new Response(JSON.stringify([{ workspace_id: workspaceId, usage_limit_locked: locked }]), {
        headers: { 'Content-Type': 'application/json' }
    })
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('Atlas Cloudflare web Worker', () => {
    it('proxies authenticated Supabase REST traffic and meters successful Web Live usage', async () => {
        const calls = []
        vi.stubGlobal('fetch', vi.fn(async (input, init) => {
            const url = String(input)
            calls.push({ url, init })
            if (url.includes('get_current_workspace_usage_access')) return workspaceAccess()
            if (url.includes('record_workspace_data_transfer')) return new Response(null, { status: 204 })
            return new Response(JSON.stringify([{ id: 'product-1' }]), {
                headers: { 'Content-Type': 'application/json', ETag: 'products-v1' }
            })
        }))

        const response = await worker.fetch(new Request(
            'https://app.atlaserp.dev/api-workspace-data/products?workspace_id=eq.' + workspaceId,
            { headers: { Authorization: 'Bearer user-token' } }
        ), createEnv())

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([{ id: 'product-1' }])
        expect(response.headers.get('ETag')).toBe('products-v1')
        expect(calls.map((call) => call.url)).toEqual([
            'https://atlas.example.supabase.co/rest/v1/rpc/get_current_workspace_usage_access',
            `https://atlas.example.supabase.co/rest/v1/products?workspace_id=eq.${workspaceId}`,
            'https://atlas.example.supabase.co/rest/v1/rpc/record_workspace_data_transfer'
        ])
        expect(new Headers(calls[1].init.headers).get('Authorization')).toBe('Bearer user-token')
        expect(new Headers(calls[1].init.headers).get('apikey')).toBe('anon-key')
        expect(JSON.parse(calls[2].init.body)).toMatchObject({
            p_workspace_id: workspaceId,
            p_source: 'web_live:rest:GET:products',
            p_channel: 'web_live'
        })
    })

    it('rejects missing authorization before reaching Supabase data', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const response = await worker.fetch(new Request('https://app.atlaserp.dev/api-workspace-data/products'), createEnv())

        expect(response.status).toBe(401)
        await expect(response.json()).resolves.toEqual({ error: 'Workspace authentication is required' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('stops requests for a workspace whose monthly transfer limit is locked', async () => {
        const fetchMock = vi.fn(async () => workspaceAccess({ locked: true }))
        vi.stubGlobal('fetch', fetchMock)

        const response = await worker.fetch(new Request('https://app.atlaserp.dev/api-workspace-storage/object/voice/file.flac', {
            headers: { Authorization: 'Bearer user-token' }
        }), createEnv())

        expect(response.status).toBe(429)
        await expect(response.json()).resolves.toEqual({ error: 'Workspace monthly data transfer limit exceeded' })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('routes Web Live R2 access through the existing R2 Worker and meters it once', async () => {
        const calls = []
        vi.stubGlobal('fetch', vi.fn(async (input, init) => {
            const url = String(input)
            calls.push({ url, init })
            if (url.includes('get_current_workspace_usage_access')) return workspaceAccess()
            if (url.includes('record_workspace_data_transfer')) return new Response(null, { status: 204 })
            return new Response('invoice-pdf', { headers: { 'Content-Type': 'application/pdf' } })
        }))

        const response = await worker.fetch(new Request(
            `https://app.atlaserp.dev/api-workspace-r2/${workspaceId}/printed-invoices/A4/sale.pdf`,
            { headers: { Authorization: 'Bearer user-token' } }
        ), createEnv())

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('invoice-pdf')
        expect(calls[1].url).toBe(`https://r2.example.workers.dev/${workspaceId}/printed-invoices/A4/sale.pdf?usage_client_recorded=1`)
        expect(JSON.parse(calls[2].init.body)).toMatchObject({
            p_workspace_id: workspaceId,
            p_source: `web_live:r2:GET:${workspaceId}/printed-invoices/A4/sale.pdf`
        })
    })

    it('serves marketplace.html for extensionless shop routes and preserves static cache policy', async () => {
        const env = createEnv()

        const response = await worker.fetch(new Request('https://shop.atlaserp.dev/products/coffee'), env)

        expect(await response.text()).toBe('/marketplace.html')
        expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1)
        expect(new URL(env.ASSETS.fetch.mock.calls[0][0].url).pathname).toBe('/marketplace.html')
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
    })

    it('delegates main-app navigations to the SPA asset binding without an index redirect loop', async () => {
        const env = createEnv()

        const response = await worker.fetch(new Request('https://app.atlaserp.dev/'), env)

        expect(await response.text()).toBe('/')
        expect(new URL(env.ASSETS.fetch.mock.calls[0][0].url).pathname).toBe('/')
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
    })

    it('keeps hashed application assets immutable', async () => {
        const env = createEnv()

        const response = await worker.fetch(new Request('https://app.atlaserp.dev/assets/app-abc123.js'), env)

        expect(await response.text()).toBe('/assets/app-abc123.js')
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    })
})
