import {
    areApplicationUpdatesDisabled,
    UPDATE_PREFERENCE_CHANGED_EVENT
} from './updatePreference'

type PwaWorkerMessage =
    | { type: 'CACHE_CURRENT_VERSION'; urls: string[] }
    | { type: 'SET_UPDATE_POLICY'; disabled: boolean }
    | { type: 'CHECK_FOR_UPDATE' }
    | { type: 'REFRESH_TO_LATEST' }
    | { type: 'APPLY_UPDATE' }

type PwaRefreshResult = 'updated' | 'current' | 'failed' | 'unavailable'

let messagingInitialized = false

function canUseServiceWorkers() {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

async function getActiveWorker(): Promise<ServiceWorker | null> {
    if (!canUseServiceWorkers()) return null

    try {
        const registration = await navigator.serviceWorker.ready
        // Use the registration's active worker rather than the current page's
        // controller. During a worker upgrade, controller can briefly still
        // point at the old worker even though a newer one is already active.
        return registration.active ?? navigator.serviceWorker.controller
    } catch (error) {
        console.warn('Unable to reach the Atlas service worker:', error)
        return null
    }
}

function postToWorker(message: PwaWorkerMessage): void {
    void getActiveWorker()
        .then((worker) => worker?.postMessage(message))
        .catch((error) => console.warn('Unable to reach the Atlas service worker:', error))
}

function getCurrentAppUrls(): string[] {
    if (typeof window === 'undefined') return []

    const urls = new Set<string>([window.location.href])
    for (const entry of performance.getEntriesByType('resource')) {
        try {
            const url = new URL(entry.name, window.location.href)
            if (url.origin === window.location.origin) {
                urls.add(url.href)
            }
        } catch {
            // Ignore non-URL performance entries.
        }
    }

    return [...urls]
}

/** Cache the exact app shell that is already running; this never checks a deployment. */
export function cacheCurrentPwaVersion(): void {
    if (areApplicationUpdatesDisabled()) return
    postToWorker({ type: 'CACHE_CURRENT_VERSION', urls: getCurrentAppUrls() })
}

export function setPwaUpdatePolicy(disabled: boolean): void {
    postToWorker({ type: 'SET_UPDATE_POLICY', disabled })
}

/**
 * The only path that asks a PWA worker to fetch a newer deployment.
 * Keeping this guard here prevents accidental update checks from other UI
 * controls while the Local Mode preference is disabled.
 */
export function requestPwaDeploymentUpdate(): void {
    if (areApplicationUpdatesDisabled()) return
    postToWorker({ type: 'CHECK_FOR_UPDATE' })
}

/**
 * Stages and applies the latest deployment through the active worker. Unlike
 * a background update check, this resolves only once the worker has finished
 * its work, so a user-initiated refresh can safely reload afterwards.
 */
export async function refreshPwaDeployment(): Promise<PwaRefreshResult> {
    if (areApplicationUpdatesDisabled() || !canUseServiceWorkers()) {
        return 'unavailable'
    }

    let registration: ServiceWorkerRegistration
    try {
        registration = await navigator.serviceWorker.ready
        // This also picks up a repaired stable worker for an older installed
        // PWA before asking it to stage the current app deployment.
        await registration.update()
    } catch (error) {
        console.warn('Unable to update the Atlas service worker:', error)
    }

    const worker = await getActiveWorker()
    if (!worker || typeof MessageChannel === 'undefined') {
        return 'unavailable'
    }

    return new Promise((resolve) => {
        const channel = new MessageChannel()
        let settled = false
        const settle = (result: PwaRefreshResult) => {
            if (settled) return
            settled = true
            window.clearTimeout(timeout)
            channel.port1.close()
            resolve(result)
        }
        const timeout = window.setTimeout(() => settle('failed'), 30_000)

        channel.port1.onmessage = (event: MessageEvent<{ type?: string; status?: PwaRefreshResult }>) => {
            if (event.data?.type !== 'REFRESH_COMPLETE') return
            settle(event.data.status === 'updated' || event.data.status === 'current'
                ? event.data.status
                : 'failed')
        }

        try {
            worker.postMessage({ type: 'REFRESH_TO_LATEST' } satisfies PwaWorkerMessage, [channel.port2])
        } catch (error) {
            console.warn('Unable to request an Atlas deployment refresh:', error)
            settle('unavailable')
        }
    })
}

export function initializePwaUpdateControl(): void {
    if (!canUseServiceWorkers() || messagingInitialized) return
    messagingInitialized = true

    navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
        if (event.data?.type === 'UPDATE_READY') {
            if (!areApplicationUpdatesDisabled()) {
                postToWorker({ type: 'APPLY_UPDATE' })
            }
            return
        }

        if (event.data?.type === 'UPDATE_APPLIED' && !areApplicationUpdatesDisabled()) {
            window.location.reload()
        }
    })

    window.addEventListener(UPDATE_PREFERENCE_CHANGED_EVENT, (event: Event) => {
        const disabled = (event as CustomEvent<{ disabled?: boolean }>).detail?.disabled === true
        setPwaUpdatePolicy(disabled)
        if (!disabled) {
            requestPwaDeploymentUpdate()
        }
    })
}
