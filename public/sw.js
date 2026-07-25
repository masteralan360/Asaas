/*
 * This worker is deliberately deployment-stable. Vercel can deploy a new app
 * shell without replacing this worker, so an installed Local Mode PWA keeps
 * serving its cached shell until the application explicitly stages an update.
 */
const APP_CACHE = 'atlas-app-shell-v1'
const NEXT_APP_CACHE = 'atlas-app-shell-v1-next'
let updatesEnabled = true
let updateToken = 0

const appShellRequest = () => new Request(new URL('/', self.location.origin).href)

function isCacheableRequest(request) {
    if (request.mode === 'navigate') return true

    const destination = request.destination
    if (['script', 'style', 'image', 'font', 'worker', 'manifest'].includes(destination)) {
        return true
    }

    return /\.(?:js|mjs|css|png|svg|ico|woff2?|wasm)$/i.test(new URL(request.url).pathname)
}

async function putResponse(cacheName, request, response) {
    if (!response || (!response.ok && response.type !== 'opaque')) return
    const cache = await caches.open(cacheName)
    await cache.put(request, response.clone())
}

async function cacheUrls(cacheName, urls, reload) {
    for (const value of urls) {
        try {
            const url = new URL(value, self.location.origin)
            if (url.origin !== self.location.origin) continue

            const request = new Request(url.href, { cache: reload ? 'reload' : 'default' })
            const response = await fetch(request)
            await putResponse(cacheName, request, response)
        } catch {
            // A missing optional asset must not make the installed app unusable.
        }
    }
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

    // This also migrates users from the previous Workbox worker on their first
    // launch after this worker is deployed.
    const legacyMatch = await caches.match(request, {
        ignoreSearch: request.mode === 'navigate'
    })
    if (legacyMatch) {
        await current.put(request, legacyMatch.clone())
        return legacyMatch
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

async function stageLatestDeployment(token) {
    const shellRequest = appShellRequest()
    const current = await getCachedResponse(shellRequest)
    const latestResponse = await fetch(new Request(shellRequest, { cache: 'reload' }))
    if (!latestResponse.ok) return

    const latestHtml = await latestResponse.clone().text()
    const currentHtml = current ? await current.clone().text() : ''
    if (latestHtml === currentHtml) return

    await caches.delete(NEXT_APP_CACHE)
    await putResponse(NEXT_APP_CACHE, shellRequest, latestResponse)
    await cacheUrls(NEXT_APP_CACHE, extractInitialAssetUrls(latestHtml), true)

    if (!updatesEnabled || token !== updateToken) {
        await caches.delete(NEXT_APP_CACHE)
        return
    }

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    clients.forEach((client) => client.postMessage({ type: 'UPDATE_READY' }))
}

async function applyStagedDeployment() {
    if (!updatesEnabled) return

    const next = await caches.open(NEXT_APP_CACHE)
    const keys = await next.keys()
    if (keys.length === 0) return

    await caches.delete(APP_CACHE)
    const current = await caches.open(APP_CACHE)
    for (const request of keys) {
        const response = await next.match(request)
        if (response) await current.put(request, response)
    }
    await caches.delete(NEXT_APP_CACHE)

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    clients.forEach((client) => client.postMessage({ type: 'UPDATE_APPLIED' }))
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

    event.respondWith((async () => {
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
    })())
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
        event.waitUntil(stageLatestDeployment(token))
        return
    }

    if (message.type === 'APPLY_UPDATE') {
        event.waitUntil(applyStagedDeployment())
    }
})
