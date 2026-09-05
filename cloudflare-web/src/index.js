const WORKSPACE_TRANSFER_LIMIT_MESSAGE = 'Workspace monthly data transfer limit exceeded'

const REST_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const STORAGE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH'])
const R2_METHODS = new Set(['GET', 'PUT', 'DELETE'])

const PASS_THROUGH_REQUEST_HEADERS = [
    'accept',
    'accept-profile',
    'accept-language',
    'authorization',
    'cache-control',
    'content-profile',
    'content-type',
    'if-match',
    'if-none-match',
    'prefer',
    'range',
    'x-client-info',
    'x-metadata',
    'x-upsert'
]

const PASS_THROUGH_RESPONSE_HEADERS = [
    'cache-control',
    'content-disposition',
    'content-language',
    'content-range',
    'content-type',
    'etag',
    'last-modified',
    'location',
    'preference-applied',
    'range',
    'x-request-id'
]

const RATE_PROXY_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

function jsonResponse(status, payload, headers = {}) {
    const responseHeaders = new Headers(headers)
    responseHeaders.set('Content-Type', 'application/json; charset=utf-8')
    responseHeaders.set('Cache-Control', 'no-store')
    return new Response(JSON.stringify(payload), { status, headers: responseHeaders })
}

function errorMessage(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback
}

function configuredValue(env, name) {
    const value = env[name]
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Missing required Worker secret: ${name}`)
    }
    return value.trim()
}

function supabaseConfig(env) {
    return {
        url: configuredValue(env, 'SUPABASE_URL').replace(/\/+$/, ''),
        anonKey: configuredValue(env, 'SUPABASE_ANON_KEY'),
        serviceRoleKey: configuredValue(env, 'SUPABASE_SERVICE_ROLE_KEY')
    }
}

function bearerToken(request) {
    const value = request.headers.get('Authorization')
    return value && /^Bearer\s+.+/i.test(value) ? value : null
}

function routePath(url, prefix) {
    const suffix = url.pathname.slice(prefix.length).replace(/^\/+/, '')
    const queryPath = url.searchParams.get('path')?.replace(/^\/+/, '') || ''
    const path = suffix || queryPath

    if (!path || path.split('/').some((segment) => segment === '..')) return null
    return path
}

function copyRequestHeaders(request, body) {
    const headers = new Headers()
    for (const name of PASS_THROUGH_REQUEST_HEADERS) {
        const value = request.headers.get(name)
        if (value) headers.set(name, value)
    }
    if (body.byteLength > 0) headers.set('Content-Length', String(body.byteLength))
    return headers
}

function copyResponseHeaders(upstream) {
    const headers = new Headers()
    for (const name of PASS_THROUGH_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
    }
    return headers
}

function withoutProxyPath(url) {
    const params = new URLSearchParams(url.search)
    params.delete('path')
    return params
}

function endpointUrl(baseUrl, prefix, path, requestUrl) {
    const target = new URL(`${baseUrl}/${prefix}/${path}`)
    target.search = withoutProxyPath(requestUrl).toString()
    return target
}

async function requestBody(request) {
    if (request.method === 'GET' || request.method === 'HEAD') return new ArrayBuffer(0)
    return request.arrayBuffer()
}

async function resolveWorkspaceUsage(request, env) {
    const authorization = bearerToken(request)
    if (!authorization) return { authorization: null, workspace: null }

    const { url, anonKey } = supabaseConfig(env)
    const response = await fetch(`${url}/rest/v1/rpc/get_current_workspace_usage_access`, {
        method: 'POST',
        headers: {
            apikey: anonKey,
            Authorization: authorization,
            'Content-Type': 'application/json'
        },
        body: '{}'
    })

    if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Unable to resolve workspace usage (${response.status})${detail ? `: ${detail}` : ''}`)
    }

    const rows = await response.json()
    const workspace = Array.isArray(rows) ? rows[0] : rows
    if (!workspace?.workspace_id) {
        throw new Error('Workspace usage preflight did not identify a workspace')
    }

    return { authorization, workspace }
}

async function recordWebLiveUsage(env, workspaceId, measuredBytes, source) {
    if (!workspaceId || !Number.isFinite(measuredBytes) || measuredBytes <= 0) return

    const { url, serviceRoleKey } = supabaseConfig(env)
    const response = await fetch(`${url}/rest/v1/rpc/record_workspace_data_transfer`, {
        method: 'POST',
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
        },
        body: JSON.stringify({
            p_workspace_id: workspaceId,
            p_bytes: Math.trunc(measuredBytes),
            p_source: source,
            p_channel: 'web_live'
        })
    })

    if (response.ok) return

    const detail = await response.text().catch(() => '')
    const error = new Error(detail || 'Workspace usage could not be recorded')
    error.statusCode = detail.includes(WORKSPACE_TRANSFER_LIMIT_MESSAGE) ? 429 : 502
    throw error
}

function errorStatus(error) {
    return typeof error === 'object' && error !== null && error.statusCode === 429 ? 429 : 502
}

function methodNotAllowed(methods) {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: {
            Allow: Array.from(methods).join(', '),
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    })
}

function responseFromUpstream(upstream, body, cacheControl) {
    const headers = copyResponseHeaders(upstream)
    if (cacheControl) headers.set('Cache-Control', cacheControl)
    return new Response(body, { status: upstream.status, headers })
}

async function workspaceProxy(request, env, url, route) {
    const methods = route.type === 'rest' ? REST_METHODS : route.type === 'storage' ? STORAGE_METHODS : R2_METHODS
    if (!methods.has(request.method)) return methodNotAllowed(methods)

    const path = routePath(url, route.prefix)
    if (!path) return jsonResponse(400, { error: `A valid ${route.type === 'r2' ? 'R2' : 'proxy'} path is required` })

    let usageContext
    try {
        usageContext = await resolveWorkspaceUsage(request, env)
    } catch (error) {
        return jsonResponse(502, { error: errorMessage(error, 'Unable to resolve workspace usage') })
    }

    if (!usageContext.workspace) return jsonResponse(401, { error: 'Workspace authentication is required' })
    if (usageContext.workspace.usage_limit_locked === true) {
        return jsonResponse(429, { error: WORKSPACE_TRANSFER_LIMIT_MESSAGE })
    }

    let body
    try {
        body = await requestBody(request)
    } catch {
        return jsonResponse(400, { error: 'Unable to read request body' })
    }

    let upstream
    let responseBody
    try {
        const headers = copyRequestHeaders(request, body)
        let target

        if (route.type === 'r2') {
            const workerUrl = configuredValue(env, 'R2_WORKER_URL').replace(/\/+$/, '')
            target = endpointUrl(workerUrl, '', path, url)
            target.pathname = `${new URL(workerUrl).pathname.replace(/\/$/, '')}/${path}`
            target.searchParams.set('usage_client_recorded', '1')
        } else {
            const { url: supabaseUrl, anonKey } = supabaseConfig(env)
            headers.set('apikey', anonKey)
            target = endpointUrl(supabaseUrl, route.type === 'rest' ? 'rest/v1' : 'storage/v1', path, url)
        }

        upstream = await fetch(target, {
            method: request.method,
            headers,
            body: body.byteLength > 0 ? body : undefined
        })
        responseBody = await upstream.arrayBuffer()
    } catch (error) {
        const message = route.type === 'r2' ? 'Unable to reach R2' : 'Unable to reach Supabase'
        return jsonResponse(502, { error: errorMessage(error, message) })
    }

    const isR2ListRequest = route.type === 'r2' && url.searchParams.get('list') === '1'
    if (!upstream.ok || isR2ListRequest) return responseFromUpstream(upstream, responseBody)

    try {
        const source = route.type === 'rest'
            ? `web_live:rest:${request.method}:${path}`
            : route.type === 'storage'
                ? `web_live:storage:${request.method}`
                : `web_live:r2:${request.method}:${path}`
        await recordWebLiveUsage(env, usageContext.workspace.workspace_id, body.byteLength + responseBody.byteLength, source)
    } catch (error) {
        return jsonResponse(errorStatus(error), { error: errorMessage(error, 'Workspace usage could not be recorded') })
    }

    return responseFromUpstream(upstream, responseBody, 'no-store')
}

function targetProxyUrl(url, prefix, origin) {
    const target = new URL(origin)
    const suffix = url.pathname.slice(prefix.length)
    target.pathname = suffix ? (suffix.startsWith('/') ? suffix : `/${suffix}`) : '/'
    target.search = url.search
    return target
}

async function htmlProxy(target, { cacheControl, fallbackPath, extraHeaders = {} } = {}) {
    const requestHeaders = new Headers({ ...RATE_PROXY_HEADERS, ...extraHeaders })
    let upstream = await fetch(target, { headers: requestHeaders })

    if (!upstream.ok && fallbackPath && target.pathname !== fallbackPath) {
        const fallback = new URL(target.origin)
        fallback.pathname = fallbackPath
        upstream = await fetch(fallback, { headers: requestHeaders })
    }

    const headers = new Headers({ 'Content-Type': 'text/html' })
    if (cacheControl) headers.set('Cache-Control', cacheControl)
    return new Response(await upstream.text(), { status: upstream.status, headers })
}

async function rateProxy(url) {
    try {
        if (url.pathname === '/api-pmcgroup') {
            return await htmlProxy(new URL('https://t.me/s/PMCgroup'), { cacheControl: 'no-store, max-age=0' })
        }

        if (url.pathname === '/api-xeiqd' || url.pathname.startsWith('/api-xeiqd/')) {
            return await htmlProxy(targetProxyUrl(url, '/api-xeiqd', 'https://xeiqd.com'))
        }

        if (url.pathname === '/api-forexfy' || url.pathname.startsWith('/api-forexfy/')) {
            return await htmlProxy(targetProxyUrl(url, '/api-forexfy', 'https://forexfy.app'), {
                cacheControl: 'no-store, max-age=0',
                fallbackPath: '/en',
                extraHeaders: {
                    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'cross-site',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1'
                }
            })
        }
    } catch (error) {
        if (url.pathname.startsWith('/api-forexfy')) {
            return new Response(`<!-- Error: ${errorMessage(error, 'Rate Error')} --><html><body>Rate Error</body></html>`, {
                status: 200,
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, max-age=0' }
            })
        }
        return jsonResponse(500, { error: errorMessage(error, 'Unable to fetch exchange-rate source') })
    }

    return null
}

function hasFileExtension(pathname) {
    const lastSegment = pathname.split('/').filter(Boolean).at(-1) || ''
    return lastSegment.includes('.')
}

function staticCacheControl(pathname) {
    if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
    if (pathname === '/' || pathname === '/index.html' || pathname === '/marketplace.html' || pathname === '/sw.js' || pathname === '/firebase-messaging-sw.js' || pathname === '/manifest.webmanifest') {
        return 'public, max-age=0, must-revalidate'
    }
    return null
}

async function serveAsset(request, env, url) {
    const marketplaceHost = (env.MARKETPLACE_HOST || 'shop.atlaserp.dev').toLowerCase()
    const useMarketplaceEntry = url.hostname.toLowerCase() === marketplaceHost && !hasFileExtension(url.pathname)
    const useMainEntry = !useMarketplaceEntry && !hasFileExtension(url.pathname)
    const assetUrl = new URL(request.url)

    if (useMarketplaceEntry) assetUrl.pathname = '/marketplace.html'
    if (useMainEntry) assetUrl.pathname = '/index.html'

    const upstream = await env.ASSETS.fetch(new Request(assetUrl, request))
    const cacheControl = staticCacheControl(assetUrl.pathname)
    if (!cacheControl) return upstream

    const headers = new Headers(upstream.headers)
    headers.set('Cache-Control', cacheControl)
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
}

const workspaceRoutes = [
    { prefix: '/api-workspace-data', type: 'rest' },
    { prefix: '/api-workspace-storage', type: 'storage' },
    { prefix: '/api-workspace-r2', type: 'r2' }
]

export default {
    async fetch(request, env) {
        const url = new URL(request.url)

        for (const route of workspaceRoutes) {
            if (url.pathname === route.prefix || url.pathname.startsWith(`${route.prefix}/`)) {
                return workspaceProxy(request, env, url, route)
            }
        }

        const proxiedRateResponse = await rateProxy(url)
        if (proxiedRateResponse) return proxiedRateResponse

        return serveAsset(request, env, url)
    }
}
