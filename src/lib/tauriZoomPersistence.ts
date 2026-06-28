import { isDesktop } from '@/lib/platform'
import type { Webview } from '@tauri-apps/api/webview'

const STORAGE_KEY = 'atlas_tauri_webview_zoom'
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

const clampZoom = (zoom: number): number => {
    if (!Number.isFinite(zoom)) return DEFAULT_ZOOM
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100))
}

const readStoredZoom = (): number => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return DEFAULT_ZOOM

        const zoom = Number(raw)
        if (!Number.isFinite(zoom)) {
            window.localStorage.removeItem(STORAGE_KEY)
            return DEFAULT_ZOOM
        }

        return clampZoom(zoom)
    } catch {
        return DEFAULT_ZOOM
    }
}

const writeStoredZoom = (zoom: number) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, zoom.toFixed(2))
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

    if (persist) {
        writeStoredZoom(nextZoom)
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

export const initTauriZoomPersistence = () => {
    if (initialized || !isDesktop()) return

    initialized = true
    currentZoom = readStoredZoom()
    applyZoom(currentZoom, false)

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false })
}
