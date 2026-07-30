/*
 * This worker is deliberately deployment-stable. Vercel can deploy a new app
 * shell without replacing this worker, so an installed Local Mode PWA keeps
 * serving its cached shell until the application explicitly stages an update.
 */
const APP_CACHE = 'atlas-app-shell-v2'
const NEXT_APP_CACHE = 'atlas-app-shell-v2-next'
const LEGACY_APP_CACHES = ['atlas-app-shell-v1']
const ASSET_MANIFEST_URL = '/atlas-assets.json'
const DEPLOYMENT_CHECK_QUERY_PARAM = '__atlas_deployment_check'
const RUNTIME_APP_ASSETS = [
    '/sql-wasm.wasm',
    '/pwa-icon.png',
    '/logo.png',
    '/logo.ico'
]
let updatesEnabled = true
let updateToken = 0
let missingAssetRecoveryPromise = null

const appShellRequest = () => new Request(new URL('/', self.location.origin).href)

function isCacheableRequest(request) {
    if (request.mode === 'navigate') return true

    const destination = request.destination
    if (['script', 'style', 'image', 'font', 'worker', 'manifest'].includes(destination)) {
        return true
    }

    return /\.(?:js|mjs|css|png|svg|ico|woff2?|wasm)$/i.test(new URL(request.url).pathname)
}

function isMissingBuildAsset(request) {
    const url = new URL(request.url)
    return request.destination === 'script'
        && /^\/assets\/[^/]+\.js$/i.test(url.pathname)
}

async function putResponse(cacheName, request, response) {
    if (!response || (!response.ok && response.type !== 'opaque')) return
    const cache = await caches.open(cacheName)
    await cache.put(request, response.clone())
}

async function cacheUrls(cacheName, urls, reload) {
    const failedUrls = []
    for (const value of urls) {
        try {
            const url = new URL(value, self.location.origin)
            if (url.origin !== self.location.origin) continue

            const request = new Request(url.href, { cache: reload ? 'reload' : 'default' })
            const response = await fetch(request)
            if (!response.ok && response.type !== 'opaque') {
                failedUrls.push(url.href)
                continue
            }
            await putResponse(cacheName, request, response)
        } catch {
            failedUrls.push(value)
        }
    }
    return failedUrls
}

async function retainCachedUrls(urls) {
    const cache = await caches.open(APP_CACHE)
    for (const value of urls) {
        try {
            const request = new Request(new URL(value, self.location.origin).href)
            const response = await caches.match(request, {
                ignoreSearch: request.mode === 'navigate'
            })
            if (response) await cache.put(request, response.clone())
        } catch {
            // Ignore malformed or already-evicted entries.
        }
    }
}

async function getCachedResponse(request) {
    const current = await caches.open(APP_CACHE)
    const currentMatch = await current.match(request, {
        ignoreSearch: request.mode === 'navigate'
    })
    if (currentMatch) return currentMatch

    // This allows a seamless migration from the first custom Atlas worker.
    // Never search the staged cache here: an incomplete staged deployment must
    // never be served as the active app.
    for (const legacyCacheName of LEGACY_APP_CACHES) {
        const legacy = await caches.open(legacyCacheName)
        const legacyMatch = await legacy.match(request, {
            ignoreSearch: request.mode === 'navigate'
        })
        if (legacyMatch) {
            await current.put(request, legacyMatch.clone())
            return legacyMatch
        }
    }

    return undefined
}

function extractInitialAssetUrls(html) {
    const urls = []
    const pattern = /<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["']/gi
    let match
    while ((match = pattern.exec(html)) !== null) {
        try {
            const url = new URL(match[1], self.location.origin)
            if (url.origin === self.location.origin) urls.push(url.href)
        } catch {
            // Ignore malformed markup; the page can still fetch the resource.
        }
    }
    return urls
}

function createFreshDeploymentRequest(path, token) {
    const url = new URL(path, self.location.origin)
    // Vercel can legitimately cache static documents at the edge. A distinct
    // URL plus no-store makes an explicit Atlas update check reach the current
    // deployment instead of comparing a cached document with itself.
    url.searchParams.set(DEPLOYMENT_CHECK_QUERY_PARAM, `${Date.now()}-${token}`)
    return new Request(url.href, { cache: 'no-store' })
}

async function getDeploymentAssetUrls(token) {
    try {
        const manifestRequest = createFreshDeploymentRequest(ASSET_MANIFEST_URL, token)
        const response = await fetch(manifestRequest)
        if (!response.ok) return null

        const manifest = await response.json()
        if (!manifest || typeof manifest !== 'object') return null
        const urls = new Set([manifestRequest.url])
        for (const entry of Object.values(manifest)) {
            if (!entry || typeof entry !== 'object') continue

            for (const value of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
                if (typeof value === 'string' && value) {
                    urls.add(new URL(value, self.location.origin).href)
                }
            }
        }
        return [...urls]
    } catch {
        return null
    }
}

async function stageLatestDeployment(token) {
    const shellRequest = appShellRequest()
    const current = await getCachedResponse(shellRequest)
    const latestResponse = await fetch(createFreshDeploymentRequest('/', token))
    if (!latestResponse.ok) return 'failed'

    const latestHtml = await latestResponse.clone().text()
    const currentHtml = current ? await current.clone().text() : ''
    if (latestHtml === currentHtml) return 'current'

    const deploymentAssets = await getDeploymentAssetUrls(token)
    if (!deploymentAssets) {
        // Do not switch an offline-capable app to a deployment whose complete
        // bundle could not be verified. It is safer to keep the current app.
        return 'failed'
    }

    await caches.delete(NEXT_APP_CACHE)
    await putResponse(NEXT_APP_CACHE, shellRequest, latestResponse)
    const failedUrls = await cacheUrls(NEXT_APP_CACHE, [
        ...deploymentAssets,
        ...extractInitialAssetUrls(latestHtml),
        ...RUNTIME_APP_ASSETS,
    ], true)

    if (failedUrls.length > 0) {
        console.warn('[Atlas PWA] Update was not staged because assets are unavailable:', failedUrls)
        await caches.delete(NEXT_APP_CACHE)
        return 'failed'
    }

    if (!updatesEnabled || token !== updateToken) {
        await caches.delete(NEXT_APP_CACHE)
        return 'failed'
    }

    return 'staged'
}

async function notifyClients(message) {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    clients.forEach((client) => client.postMessage(message))
}

async function applyStagedDeployment(notify = true) {
    if (!updatesEnabled) return false

    const next = await caches.open(NEXT_APP_CACHE)
    const keys = await next.keys()
    if (keys.length === 0) return false

    await caches.delete(APP_CACHE)
    const current = await caches.open(APP_CACHE)
    for (const request of keys) {
        const response = await next.match(request)
        if (response) await current.put(request, response)
    }
    await caches.delete(NEXT_APP_CACHE)
    await Promise.all(LEGACY_APP_CACHES.map((cacheName) => caches.delete(cacheName)))

    if (notify) {
        await notifyClients({ type: 'UPDATE_APPLIED' })
    }
    return true
}

async function refreshToLatestDeployment(port) {
    const token = ++updateToken
    let status = 'failed'

    try {
        const staged = await stageLatestDeployment(token)
        if (staged === 'staged') {
            status = await applyStagedDeployment(false) ? 'updated' : 'failed'
        } else if (staged === 'current') {
            status = 'current'
        }
    } catch (error) {
        console.warn('[Atlas PWA] Manual refresh could not complete:', error)
    }

    try {
        port?.postMessage({ type: 'REFRESH_COMPLETE', status })
    } catch {
        // The page may have closed while the deployment was being staged.
    }
}

/**
 * A cached index can occasionally reference a hashed module that Vercel has
 * already removed. Recover from that precise situation without clearing the
 * current cache: only a fully verified deployment is allowed to replace it.
 */
function recoverFromMissingBuildAsset() {
    if (!updatesEnabled) return Promise.resolve()
    if (missingAssetRecoveryPromise) return missingAssetRecoveryPromise

    const token = ++updateToken
    missingAssetRecoveryPromise = (async () => {
        try {
            const staged = await stageLatestDeployment(token)
            if (staged === 'staged') {
                await applyStagedDeployment()
            }
        } catch (error) {
            console.warn('[Atlas PWA] Missing build asset recovery failed:', error)
        } finally {
            missingAssetRecoveryPromise = null
        }
    })()
    return missingAssetRecoveryPromise
}

self.addEventListener('install', () => {
    self.skipWaiting()
})

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
    const request = event.request
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin || !isCacheableRequest(request)) {
        return
    }

    const responsePromise = (async () => {
        const cached = await getCachedResponse(request)
        if (cached) return cached

        try {
            const response = await fetch(request)
            await putResponse(APP_CACHE, request, response)
            return response
        } catch (error) {
            if (request.mode === 'navigate') {
                const shell = await getCachedResponse(appShellRequest())
                if (shell) return shell
            }
            throw error
        }
    })()

    if (isMissingBuildAsset(request)) {
        // Attach this while the fetch event is still active. The original 404
        // is returned to the browser, while the safe recovery runs in the
        // background and reloads clients only after its cache swap succeeds.
        event.waitUntil(responsePromise.then((response) => (
            response.status === 404 ? recoverFromMissingBuildAsset() : undefined
        )).catch(() => undefined))
    }

    event.respondWith(responsePromise)
})

self.addEventListener('message', (event) => {
    const message = event.data || {}

    if (message.type === 'SET_UPDATE_POLICY') {
        updatesEnabled = !message.disabled
        if (!updatesEnabled) {
            updateToken += 1
            event.waitUntil(caches.delete(NEXT_APP_CACHE))
        }
        return
    }

    if (message.type === 'CACHE_CURRENT_VERSION' && Array.isArray(message.urls)) {
        // Never fetch here. This command only preserves the version that is
        // already cached/running, which keeps the disabled policy offline-safe.
        event.waitUntil(retainCachedUrls(message.urls))
        return
    }

    if (message.type === 'CHECK_FOR_UPDATE') {
        if (!updatesEnabled) return
        const token = ++updateToken
        event.waitUntil((async () => {
            const staged = await stageLatestDeployment(token)
            if (staged === 'staged') {
                await notifyClients({ type: 'UPDATE_READY' })
            }
        })())
        return
    }

    if (message.type === 'REFRESH_TO_LATEST') {
        if (!updatesEnabled) return
        event.waitUntil(refreshToLatestDeployment(event.ports?.[0]))
        return
    }

    if (message.type === 'APPLY_UPDATE') {
        event.waitUntil(applyStagedDeployment())
    }
})
