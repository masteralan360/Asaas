import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { registerSW } from 'virtual:pwa-register'

const isMarketplaceHost =
    typeof window !== 'undefined'
    && window.location.hostname === 'marketplace-atlas.vercel.app'

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
        console.error('[Critical] Chunk load failed. Auto-reloading...', event.reason)
        window.location.reload()
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

const renderApp = async () => {
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
        import('./i18n/config')
    ])

    connectionManager.init()

    try {
        await platformService.initialize()
    } catch (error) {
        console.error('Failed to initialize platform service:', error)
    }

    renderRoot(
        <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme" defaultStyle="emerald">
            <App />
        </ThemeProvider>,
    )
}

const init = async () => {
    if (isMarketplaceHost && window.location.hash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }

    if (isMarketplaceHost) {
        await renderMarketplace()
        return
    }

    await renderApp()
}

init()
