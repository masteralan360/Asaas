import {
    areApplicationUpdatesDisabled,
    UPDATE_PREFERENCE_CHANGED_EVENT
} from './updatePreference'

type PwaWorkerMessage =
    | { type: 'CACHE_CURRENT_VERSION'; urls: string[] }
    | { type: 'SET_UPDATE_POLICY'; disabled: boolean }
    | { type: 'CHECK_FOR_UPDATE' }
    | { type: 'APPLY_UPDATE' }

let messagingInitialized = false

function canUseServiceWorkers() {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

function postToWorker(message: PwaWorkerMessage): void {
    if (!canUseServiceWorkers()) return

    const post = (worker: ServiceWorker | null | undefined) => worker?.postMessage(message)
    if (navigator.serviceWorker.controller) {
        post(navigator.serviceWorker.controller)
        return
    }

    void navigator.serviceWorker.ready
        .then((registration) => post(registration.active))
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
 * The only path that asks a PWA worker to fetch a newer Vercel deployment.
 * Keeping this guard here prevents accidental update checks from other UI
 * controls while the Local Mode preference is disabled.
 */
export function requestPwaDeploymentUpdate(): void {
    if (areApplicationUpdatesDisabled()) return
    postToWorker({ type: 'CHECK_FOR_UPDATE' })
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
