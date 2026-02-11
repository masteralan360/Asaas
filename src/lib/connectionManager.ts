type ConnectionEvent = 'wake' | 'online' | 'offline' | 'heartbeat'
type ConnectionListener = (event: ConnectionEvent) => void

interface ConnectionState {
    isOnline: boolean
    isVisible: boolean
    lastActiveAt: number
}

class ConnectionManager {
    private listeners = new Set<ConnectionListener>()
    private state: ConnectionState = {
        isOnline: navigator.onLine,
        isVisible: document.visibilityState === 'visible',
        lastActiveAt: Date.now()
    }
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null
    private debounceTimer: ReturnType<typeof setTimeout> | null = null
    private heartbeatFailures = 0
    private initialized = false

    // Minimum idle time (ms) before a "wake" event is emitted
    private static WAKE_THRESHOLD = 60_000 // 1 minute
    private static HEARTBEAT_INTERVAL = 30_000 // 30 seconds
    private static DEBOUNCE_MS = 500

    init() {
        if (this.initialized) return
        this.initialized = true

        window.addEventListener('online', this.handleOnline)
        window.addEventListener('offline', this.handleOffline)
        document.addEventListener('visibilitychange', this.handleVisibilityChange)
        window.addEventListener('focus', this.handleFocus)

        this.startHeartbeat()
        console.log('[ConnectionManager] Initialized')
    }

    destroy() {
        window.removeEventListener('online', this.handleOnline)
        window.removeEventListener('offline', this.handleOffline)
        document.removeEventListener('visibilitychange', this.handleVisibilityChange)
        window.removeEventListener('focus', this.handleFocus)
        this.stopHeartbeat()
        this.listeners.clear()
        this.initialized = false
    }

    subscribe(listener: ConnectionListener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getState(): Readonly<ConnectionState> {
        return { ...this.state }
    }

    private emit(event: ConnectionEvent) {
        this.listeners.forEach(fn => {
            try { fn(event) } catch (e) {
                console.error('[ConnectionManager] Listener error:', e)
            }
        })
    }

    private debouncedEmit(event: ConnectionEvent) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.debounceTimer = setTimeout(() => this.emit(event), ConnectionManager.DEBOUNCE_MS)
    }

    private handleOnline = () => {
        if (this.state.isOnline) return // already online
        console.log('[ConnectionManager] Network: online')
        this.state.isOnline = true
        this.debouncedEmit('online')
        this.startHeartbeat()
    }

    private handleOffline = () => {
        if (!this.state.isOnline) return // already offline
        console.log('[ConnectionManager] Network: offline')
        this.state.isOnline = false
        this.stopHeartbeat()
        this.emit('offline') // offline is immediate, no debounce
    }

    private handleVisibilityChange = () => {
        const nowVisible = document.visibilityState === 'visible'
        this.state.isVisible = nowVisible

        if (nowVisible) {
            const idleDuration = Date.now() - this.state.lastActiveAt
            console.log(`[ConnectionManager] Tab visible after ${Math.round(idleDuration / 1000)}s idle`)

            if (idleDuration >= ConnectionManager.WAKE_THRESHOLD) {
                this.emit('wake')
            }

            this.state.lastActiveAt = Date.now()
            this.startHeartbeat()
        } else {
            this.state.lastActiveAt = Date.now()
            this.stopHeartbeat() // save resources when tab is hidden
        }
    }

    private handleFocus = () => {
        // Focus can fire without visibilitychange (e.g., alt-tabbing between windows)
        const idleDuration = Date.now() - this.state.lastActiveAt
        if (idleDuration >= ConnectionManager.WAKE_THRESHOLD) {
            this.state.isVisible = true
            this.emit('wake')
        }
        this.state.lastActiveAt = Date.now()
    }

    private startHeartbeat() {
        this.stopHeartbeat()
        this.heartbeatTimer = setInterval(() => {
            if (!this.state.isVisible) return
            this.checkConnectivity()
        }, ConnectionManager.HEARTBEAT_INTERVAL)
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
    }

    private async checkConnectivity() {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10000) // Increased to 10s

            await fetch('https://www.google.com/favicon.ico?v=' + Date.now(), {
                mode: 'no-cors',
                cache: 'no-store',
                signal: controller.signal
            })
            clearTimeout(timeoutId)

            // Success: Reset failures
            this.heartbeatFailures = 0

            if (!this.state.isOnline) {
                console.log('[ConnectionManager] Heartbeat restored — marking online')
                this.state.isOnline = true
                this.emit('online')
            }
            this.emit('heartbeat')
        } catch {
            this.heartbeatFailures++

            // Only mark offline if we fail 2 times in a row
            if (this.state.isOnline && this.heartbeatFailures >= 2) {
                console.log(`[ConnectionManager] Heartbeat failed ${this.heartbeatFailures} times — marking offline`)
                this.state.isOnline = false
                this.emit('offline')
            } else if (this.state.isOnline) {
                console.log(`[ConnectionManager] Heartbeat missed once (${this.heartbeatFailures}/2) — waiting for next attempt`)
            }
        }
    }
}

export const connectionManager = new ConnectionManager()
