import { isDesktop, isPwaDesktop } from '@/lib/platform'
import type { Webview } from '@tauri-apps/api/webview'

const TAURI_STORAGE_KEY = 'atlas_tauri_webview_zoom'
const PWA_STORAGE_KEY = 'atlas_pwa_desktop_zoom'
const DEFAULT_ZOOM = 1
const MIN_ZOOM = 0.25
const MAX_ZOOM = 5
const WHEEL_DELTA_THRESHOLD = 100
const WHEEL_DELTA_RESET_MS = 400
const ZOOM_STEPS = [
    0.25,
    0.33,
    0.5,
    0.67,
    0.75,
    0.8,
    0.9,
    1,
    1.1,
    1.25,
    1.5,
    1.75,
    2,
    2.5,
    3,
    4,
    5,
]

let initialized = false
let currentZoom = DEFAULT_ZOOM
let webviewPromise: Promise<Webview> | null = null
let accumulatedWheelDelta = 0
let lastWheelAt = 0
let zoomRuntime: 'tauri' | 'pwa' | null = null

const isPrintPreviewEditorRoute = () => {
    const hashPath = window.location.hash.replace(/^#/, '').split('?')[0] || '/'
    return /^(?:\/(?:en|ar|ku))?\/print-preview-editor\/?$/.test(hashPath)
}

const clampZoom = (zoom: number): number => {
    if (!Number.isFinite(zoom)) return DEFAULT_ZOOM
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100))
}

const getZoomRuntime = (): 'tauri' | 'pwa' | null => {
    if (isDesktop()) return 'tauri'
    if (isPwaDesktop()) return 'pwa'
    return null
}

const getStorageKey = (runtime: 'tauri' | 'pwa') =>
    runtime === 'tauri' ? TAURI_STORAGE_KEY : PWA_STORAGE_KEY

const readStoredZoom = (storageKey: string): number => {
    try {
        const raw = window.localStorage.getItem(storageKey)
        if (!raw) return DEFAULT_ZOOM

        const zoom = Number(raw)
        if (!Number.isFinite(zoom)) {
            window.localStorage.removeItem(storageKey)
            return DEFAULT_ZOOM
        }

        return clampZoom(zoom)
    } catch {
        return DEFAULT_ZOOM
    }
}

const writeStoredZoom = (storageKey: string, zoom: number) => {
    try {
        window.localStorage.setItem(storageKey, zoom.toFixed(2))
    } catch {
        // Ignore storage failures; zoom still applies for the current session.
    }
}

const getWebview = () => {
    webviewPromise ??= import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => getCurrentWebview())
    return webviewPromise
}

const applyZoom = (zoom: number, persist: boolean) => {
    const nextZoom = clampZoom(zoom)
    currentZoom = nextZoom

    if (!zoomRuntime) return

    if (persist) {
        writeStoredZoom(getStorageKey(zoomRuntime), nextZoom)
    }

    if (zoomRuntime === 'pwa') {
        // Installed desktop PWAs do not have a native webview zoom API. CSS zoom
        // scales the complete app window, including portals rendered outside #root.
        document.documentElement.style.setProperty('zoom', nextZoom.toFixed(2))
        return
    }

    void getWebview()
        .then((webview) => webview.setZoom(nextZoom))
        .catch((error) => {
            console.error('Failed to apply Tauri webview zoom:', error)
        })
}

const getNextZoomStep = (direction: 1 | -1) => {
    if (direction > 0) {
        return ZOOM_STEPS.find((step) => step > currentZoom + 0.001) ?? MAX_ZOOM
    }

    return [...ZOOM_STEPS].reverse().find((step) => step < currentZoom - 0.001) ?? MIN_ZOOM
}

const zoomByStep = (direction: 1 | -1) => {
    applyZoom(getNextZoomStep(direction), true)
}

const resetZoom = () => {
    applyZoom(DEFAULT_ZOOM, true)
}

const stopNativeZoom = (event: KeyboardEvent | WheelEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
}

const handleKeyDown = (event: KeyboardEvent) => {
    // The print preview editor owns Ctrl/⌘ keyboard zoom so it can scale only its document.
    if (isPrintPreviewEditorRoute()) return

    if ((!event.ctrlKey && !event.metaKey) || event.altKey) return

    const key = event.key.toLowerCase()
    const code = event.code

    if (key === '+' || key === '=' || code === 'NumpadAdd') {
        stopNativeZoom(event)
        zoomByStep(1)
        return
    }

    if (key === '-' || key === '_' || code === 'NumpadSubtract') {
        stopNativeZoom(event)
        zoomByStep(-1)
        return
    }

    if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
        stopNativeZoom(event)
        resetZoom()
    }
}

const normalizeWheelDelta = (event: WheelEvent) => {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        return event.deltaY * 16
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        return event.deltaY * window.innerHeight
    }

    return event.deltaY
}

const handleWheel = (event: WheelEvent) => {
    // The print preview editor owns Ctrl/⌘ + wheel zoom so it can scale only its document.
    if (isPrintPreviewEditorRoute()) return

    if (!event.ctrlKey && !event.metaKey) return

    stopNativeZoom(event)

    const now = Date.now()
    if (now - lastWheelAt > WHEEL_DELTA_RESET_MS) {
        accumulatedWheelDelta = 0
    }
    lastWheelAt = now

    accumulatedWheelDelta += normalizeWheelDelta(event)

    if (Math.abs(accumulatedWheelDelta) < WHEEL_DELTA_THRESHOLD) return

    zoomByStep(accumulatedWheelDelta < 0 ? 1 : -1)
    accumulatedWheelDelta = 0
}

export const initDesktopZoomPersistence = () => {
    if (initialized) return

    zoomRuntime = getZoomRuntime()
    if (!zoomRuntime) return

    initialized = true
    currentZoom = readStoredZoom(getStorageKey(zoomRuntime))
    applyZoom(currentZoom, false)

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false })
}

// Kept for existing callers while desktop PWA support uses the same controller.
export const initTauriZoomPersistence = initDesktopZoomPersistence
