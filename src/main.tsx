import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { registerSW } from 'virtual:pwa-register'
import { requestPersistentStorage } from '@/local-db/storagePersist'
import { isOpfsSupported } from '@/local-db/pwaSqlite'
import { AtlasSplashScreen } from '@/ui/components/AtlasSplashScreen'

const isMarketplaceHost =
    typeof window !== 'undefined'
    && window.location.hostname === 'marketplace-atlas.vercel.app'

const isTauriRuntime =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function isPwaMode(): boolean {
    if (typeof window === 'undefined') return false
    if ((window.navigator as any).standalone) return true
    try { return window.matchMedia('(display-mode: standalone)').matches } catch { return false }
}

function isColdStart(): boolean {
    try {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
        if (nav) return nav.type === 'navigate'
    } catch { }
    return true
}

const initPwaLocalMode = async () => {
    if (import.meta.env.PROD && isOpfsSupported()) {
        try {
            await requestPersistentStorage()
        } catch (error) {
            console.error('Failed to request persistent storage:', error)
        }
    }
}

const registerAppServiceWorker = () => {
    registerSW({
        immediate: true,
        onRegisteredSW: (_swUrl, registration) => {
            if (!registration) return

            const checkForUpdate = () => {
                if (document.visibilityState === 'hidden') return

                registration.update().catch((error) => {
                    console.error('Failed to check for service worker updates:', error)
                })
            }

            checkForUpdate()
            window.setInterval(checkForUpdate, 30 * 60 * 1000)
            window.addEventListener('focus', checkForUpdate)
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    checkForUpdate()
                }
            })
        },
        onRegisterError: (error) => {
            console.error('Failed to register service worker:', error)
        }
    })
}

if (
    import.meta.env.PROD
    && typeof window !== 'undefined'
    && !('__TAURI_INTERNALS__' in window)
    && 'serviceWorker' in navigator
) {
    window.addEventListener('load', () => {
        if (isMarketplaceHost) {
            navigator.serviceWorker.getRegistrations()
                .then(async (registrations) => {
                    const results = await Promise.all(registrations.map((registration) => registration.unregister()))
                    if (results.some(Boolean)) {
                        window.location.reload()
                    }
                })
                .catch((error) => {
                    console.error('Failed to unregister marketplace service workers:', error)
                })

            return
        }

        registerAppServiceWorker()
    })
}

window.addEventListener('unhandledrejection', (event) => {
    if (event.reason?.message?.includes('Failed to fetch dynamically imported module') ||
        event.reason?.message?.includes('Importing a stopped module')) {
        const key = '__atlas_reload_ts__'
        const last = parseInt(sessionStorage.getItem(key) || '0', 10)
        const now = Date.now()
        if (now - last > 30000) {
            sessionStorage.setItem(key, String(now))
            console.error('[Critical] Chunk load failed. Auto-reloading...', event.reason)
            window.location.reload()
        } else {
            console.error('[Critical] Chunk load failed again within 30s. Breaking reload loop.')
        }
    }
})

const rootElement = document.getElementById('root')

if (!rootElement) {
    throw new Error('Root element not found')
}

const root = createRoot(rootElement)

const renderRoot = (content: ReactNode) => {
    root.render(
        <StrictMode>
            {content}
            <Analytics />
        </StrictMode>,
    )
}



const renderMarketplace = async () => {
    const [, { ThemeProvider }, { Toaster }, { MarketplaceApp }] = await Promise.all([
        import('./index.css'),
        import('@/ui/components/theme-provider'),
        import('@/ui/components'),
        import('./marketplace/MarketplaceApp'),
        import('./i18n/config')
    ])

    renderRoot(
        <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme" defaultStyle="emerald">
            <MarketplaceApp />
            <Toaster />
        </ThemeProvider>,
    )
}

const bootApp = async (splash: boolean) => {
    const preloads: Promise<unknown>[] = []
    if (splash) {
        preloads.push(import('@/ui/pages/Dashboard'), import('@/ui/pages/Login'))
    }

    const [
        ,
        { ThemeProvider },
        { platformService },
        { connectionManager },
        { default: App }
    ] = await Promise.all([
        import('./index.css'),
        import('@/ui/components/theme-provider'),
        import('@/services/platformService'),
        import('@/lib/connectionManager'),
        import('./App.tsx'),
        import('./i18n/config'),
        ...preloads,
    ])

    connectionManager.init()

    try {
        await platformService.initialize()
    } catch (error) {
        console.error('Failed to initialize platform service:', error)
    }

    return { ThemeProvider, App } as const
}

const init = async () => {
    if (isMarketplaceHost && window.location.hash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }

    if (isMarketplaceHost) {
        await renderMarketplace()
        return
    }

    void initPwaLocalMode()

    const canShowSplash = !isMarketplaceHost && isColdStart() && (isPwaMode() || (isTauriRuntime && !import.meta.env.DEV))

    // Start loading immediately
    const bootPromise = bootApp(canShowSplash)

    if (canShowSplash) {
        // Phase 1: Show splash immediately. App container hidden + empty.
        root.render(
            <StrictMode>
                <div id="atlas-splash" style={{}}>
                    <AtlasSplashScreen />
                </div>
                <div id="atlas-app" style={{ display: 'none' }} />
                <Analytics />
            </StrictMode>,
        )

        // Modules load in background while splash plays
        const { ThemeProvider, App } = await bootPromise

        // Phase 2: Inject app into hidden container. AuthProvider (inside App.tsx)
        // mounts and starts initializing. Splash still visible.
        root.render(
            <StrictMode>
                <div id="atlas-splash" style={{}}>
                    <AtlasSplashScreen />
                </div>
                <div id="atlas-app" style={{ display: 'none' }}>
                    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme" defaultStyle="emerald">
                        <App />
                    </ThemeProvider>
                </div>
                <Analytics />
            </StrictMode>,
        )

        const dismissOnKey = new Promise<void>(resolve => {
            window.addEventListener('keydown', () => resolve(), { once: true })
        })

        await Promise.race([dismissOnKey, new Promise<void>(r => setTimeout(r, 2800))])

        // Phase 3: Show app, hide splash. Tree structure identical to Phase 2
        // — React preserves all state (AuthProvider, etc.)
        root.render(
            <StrictMode>
                <div id="atlas-splash" style={{ display: 'none' }}>
                    <AtlasSplashScreen />
                </div>
                <div id="atlas-app" style={{}}>
                    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme" defaultStyle="emerald">
                        <App />
                    </ThemeProvider>
                </div>
                <Analytics />
            </StrictMode>,
        )

        return
    }

    const { ThemeProvider, App } = await bootPromise

    renderRoot(
        <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme" defaultStyle="emerald">
            <App />
        </ThemeProvider>,
    )
}

init()
