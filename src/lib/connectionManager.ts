import { isSupabaseConfigured, resolvedSupabaseAnonKey, resolvedSupabaseUrl } from '@/auth/supabase'
import { setNetworkStatus } from '@/lib/network'

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

    // Minimum idle time (ms) before a "wake" event is emitted.
    private static WAKE_THRESHOLD = 60_000
    private static HEARTBEAT_INTERVAL = 30_000
    private static HEARTBEAT_TIMEOUT = 10_000
    private static DEBOUNCE_MS = 500

    init() {
        if (this.initialized) return
        this.initialized = true

        window.addEventListener('online', this.handleOnline)
        window.addEventListener('offline', this.handleOffline)
        document.addEventListener('visibilitychange', this.handleVisibilityChange)
        window.addEventListener('focus', this.handleFocus)

        setNetworkStatus(this.state.isOnline)
        this.startHeartbeat()
        void this.checkConnectivity()
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

    reportConnectivitySuccess(source = 'supabase') {
        this.heartbeatFailures = 0
        if (navigator.onLine === false) return

        if (!this.state.isOnline) {
            console.log(`[ConnectionManager] ${source} reachable - marking online`)
            this.state.isOnline = true
            setNetworkStatus(true)
            this.emit('online')
            this.startHeartbeat()
            return
        }

        setNetworkStatus(true)
    }

    reportConnectivityFailure(source = 'supabase') {
        this.heartbeatFailures++

        if (this.state.isOnline) {
            console.log(`[ConnectionManager] ${source} unreachable - marking offline`)
            this.state.isOnline = false
            setNetworkStatus(false)
            this.emit('offline')
        }
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
        console.log('[ConnectionManager] Browser network: online')
        this.startHeartbeat()
        void this.checkConnectivity(true)
    }

    private handleOffline = () => {
        if (!this.state.isOnline) return
        console.log('[ConnectionManager] Browser network: offline')
        this.state.isOnline = false
        setNetworkStatus(false)
        this.stopHeartbeat()
        this.emit('offline')
    }

    private handleVisibilityChange = () => {
        const nowVisible = document.visibilityState === 'visible'
        this.state.isVisible = nowVisible

        if (nowVisible) {
            const idleDuration = Date.now() - this.state.lastActiveAt
            console.log(`[ConnectionManager] Tab visible after ${Math.round(idleDuration / 1000)}s idle`)

            this.state.lastActiveAt = Date.now()
            this.startHeartbeat()

            if (idleDuration >= ConnectionManager.WAKE_THRESHOLD) {
                void this.checkConnectivity().then((online) => {
                    if (online) this.emit('wake')
                })
            } else {
                void this.checkConnectivity()
            }
        } else {
            this.state.lastActiveAt = Date.now()
            this.stopHeartbeat()
        }
    }

    private handleFocus = () => {
        // Focus can fire without visibilitychange, e.g. alt-tabbing between windows.
        const idleDuration = Date.now() - this.state.lastActiveAt
        if (idleDuration >= ConnectionManager.WAKE_THRESHOLD) {
            this.state.isVisible = true
            void this.checkConnectivity().then((online) => {
                if (online) this.emit('wake')
            })
        }
        this.state.lastActiveAt = Date.now()
    }

    private startHeartbeat() {
        this.stopHeartbeat()
        this.heartbeatTimer = setInterval(() => {
            if (!this.state.isVisible) return
            void this.checkConnectivity()
        }, ConnectionManager.HEARTBEAT_INTERVAL)
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
    }

    private getConnectivityCheck() {
        if (isSupabaseConfigured) {
            const supabaseUrl = resolvedSupabaseUrl.replace(/\/+$/, '')

            return {
                url: `${supabaseUrl}/auth/v1/health?_=${Date.now()}`,
                init: {
                    method: 'GET',
                    headers: {
                        apikey: resolvedSupabaseAnonKey,
                        Authorization: `Bearer ${resolvedSupabaseAnonKey}`
                    }
                } satisfies RequestInit
            }
        }

        return {
            url: `https://www.google.com/favicon.ico?v=${Date.now()}`,
            init: {
                mode: 'no-cors',
                cache: 'no-store'
            } satisfies RequestInit
        }
    }

    private async checkConnectivity(useDebouncedOnlineEvent = false): Promise<boolean> {
        if (navigator.onLine === false) {
            this.reportConnectivityFailure('browser network')
            return false
        }

        let timeoutId: ReturnType<typeof setTimeout> | null = null

        try {
            const controller = new AbortController()
            timeoutId = setTimeout(() => controller.abort(), ConnectionManager.HEARTBEAT_TIMEOUT)
            const { url, init } = this.getConnectivityCheck()

            const response = await fetch(url, {
                ...init,
                cache: 'no-store',
                signal: controller.signal
            })

            if (response.type !== 'opaque' && !response.ok) {
                throw new Error(`Connectivity check failed with HTTP ${response.status}`)
            }

            this.heartbeatFailures = 0

            if (!this.state.isOnline) {
                console.log('[ConnectionManager] Heartbeat restored - marking online')
                this.state.isOnline = true
                setNetworkStatus(true)
                if (useDebouncedOnlineEvent) {
                    this.debouncedEmit('online')
                } else {
                    this.emit('online')
                }
            } else {
                setNetworkStatus(true)
            }

            this.emit('heartbeat')
            return true
        } catch {
            this.heartbeatFailures++

            if (this.state.isOnline) {
                console.log(`[ConnectionManager] Heartbeat failed ${this.heartbeatFailures} time(s) - marking offline`)
                this.state.isOnline = false
                setNetworkStatus(false)
                this.emit('offline')
            }

            return false
        } finally {
            if (timeoutId) clearTimeout(timeoutId)
        }
    }
}

export const connectionManager = new ConnectionManager()
