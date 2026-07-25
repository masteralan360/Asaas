const DEPLOYMENT_REFRESH_QUERY_PARAM = '__atlas_refresh'

/**
 * Makes a navigation URL unique so the browser and the active service worker
 * must request the current Vercel document instead of reusing an old app shell.
 */
export function createDeploymentRefreshUrl(currentUrl: string, timestamp = Date.now()): string {
    const url = new URL(currentUrl)
    url.searchParams.set(DEPLOYMENT_REFRESH_QUERY_PARAM, String(timestamp))
    return url.toString()
}

/**
 * Removes the one-time cache-busting parameter after the fresh document has
 * loaded, keeping the address bar and shareable URLs clean.
 */
export function removeDeploymentRefreshParam(currentUrl: string): string {
    const url = new URL(currentUrl)
    url.searchParams.delete(DEPLOYMENT_REFRESH_QUERY_PARAM)
    return `${url.pathname}${url.search}${url.hash}`
}

export function requestServiceWorkerUpdate(): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.update())))
        .catch((error) => {
            console.warn('Failed to check for a service worker update before refreshing:', error)
        })
}

export function refreshToLatestDeployment(): void {
    if (typeof window === 'undefined') return

    requestServiceWorkerUpdate()
    window.location.replace(createDeploymentRefreshUrl(window.location.href))
}
