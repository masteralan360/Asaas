const DEPLOYMENT_REFRESH_QUERY_PARAM = '__atlas_refresh'

import { refreshPwaDeployment, requestPwaDeploymentUpdate } from './pwaUpdateControl'
import { areApplicationUpdatesDisabled } from './updatePreference'

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
    if (areApplicationUpdatesDisabled()) return
    requestPwaDeploymentUpdate()
}

export async function refreshToLatestDeployment(): Promise<void> {
    if (areApplicationUpdatesDisabled()) return

    // A manual hold must always behave like a refresh. The worker first
    // completes its atomic cache swap (when a new deployment exists), then
    // this navigation loads that updated cache. If it is already current, the
    // reload still gives the user the expected recovery action.
    await refreshPwaDeployment()
    window.location.reload()
}
