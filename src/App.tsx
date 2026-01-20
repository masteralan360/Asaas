import { Route, Switch, Router, Link } from 'wouter'
import { useHashLocation } from '@/hooks/useHashLocation'
import { AuthProvider, ProtectedRoute, GuestRoute } from '@/auth'
import { WorkspaceProvider } from '@/workspace'
import { Layout, Toaster, TitleBar } from '@/ui/components'
import { lazy, Suspense, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/workspace'
import { ExchangeRateProvider } from '@/context/ExchangeRateContext'
import { isSupabaseConfigured } from '@/auth/supabase'
import { isMobile } from '@/lib/platform'

// Lazy load pages
const Dashboard = lazy(() => import('@/ui/pages/Dashboard').then(m => ({ default: m.Dashboard })))
const Login = lazy(() => import('@/ui/pages/Login').then(m => ({ default: m.Login })))
const Register = lazy(() => import('@/ui/pages/Register').then(m => ({ default: m.Register })))
const Products = lazy(() => import('@/ui/pages/Products').then(m => ({ default: m.Products })))
const Customers = lazy(() => import('@/ui/pages/Customers').then(m => ({ default: m.Customers })))
const Orders = lazy(() => import('@/ui/pages/Orders').then(m => ({ default: m.Orders })))
const Invoices = lazy(() => import('@/ui/pages/Invoices').then(m => ({ default: m.Invoices })))
const Members = lazy(() => import('@/ui/pages/Members').then(m => ({ default: m.Members })))
const Settings = lazy(() => import('@/ui/pages/Settings').then(m => ({ default: m.Settings })))
const Admin = lazy(() => import('@/ui/pages/Admin').then(m => ({ default: m.Admin })))
const WorkspaceRegistration = lazy(() => import('@/ui/pages/WorkspaceRegistration').then(m => ({ default: m.WorkspaceRegistration })))
const POS = lazy(() => import('@/ui/pages/POS').then(m => ({ default: m.POS })))
const Sales = lazy(() => import('@/ui/pages/Sales').then(m => ({ default: m.Sales })))
const Revenue = lazy(() => import('@/ui/pages/Revenue').then(m => ({ default: m.Revenue })))
const TeamPerformance = lazy(() => import('@/ui/pages/TeamPerformance').then(m => ({ default: m.TeamPerformance })))
const WorkspaceConfiguration = lazy(() => import('@/ui/pages/WorkspaceConfiguration').then(m => ({ default: m.WorkspaceConfiguration })))
const LockedWorkspace = lazy(() => import('@/ui/pages/LockedWorkspace').then(m => ({ default: m.LockedWorkspace })))
const CurrencyConverter = lazy(() => import('@/ui/pages/CurrencyConverter').then(m => ({ default: m.CurrencyConverter })))
const ConnectionConfiguration = lazy(() => import('@/ui/pages/ConnectionConfiguration').then(m => ({ default: m.ConnectionConfiguration })))

// @ts-ignore
const isTauri = !!window.__TAURI_INTERNALS__

// Preload list for Electron
const pages = [
    () => import('@/ui/pages/Dashboard'),
    () => import('@/ui/pages/Products'),
    () => import('@/ui/pages/Customers'),
    () => import('@/ui/pages/Orders'),
    () => import('@/ui/pages/Invoices'),
    () => import('@/ui/pages/POS'),
    () => import('@/ui/pages/Sales'),
    () => import('@/ui/pages/Revenue'),
    () => import('@/ui/pages/TeamPerformance'),
    () => import('@/ui/pages/Settings'),
    () => import('@/ui/pages/Members'),
    () => import('@/ui/pages/WorkspaceConfiguration'),
    () => import('@/ui/pages/CurrencyConverter'),
]

function LoadingState() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-muted-foreground font-medium animate-pulse">Loading...</p>
            </div>
        </div>
    )
}

function UpdateHandler() {
    const { setPendingUpdate } = useWorkspace()
    const { t } = useTranslation()

    const checkForUpdates = useCallback(async (isManual = false) => {
        if (!isTauri || isMobile()) return

        try {
            const { check } = await import('@tauri-apps/plugin-updater')
            const { ask, message } = await import('@tauri-apps/plugin-dialog')

            console.log('[Tauri] Checking for updates...')
            const update = await check()

            if (update) {
                console.log(`[Tauri] Update available: ${update.version}`)

                const shouldUpdate = await ask(
                    t('updater.message', { version: update.version }),
                    {
                        title: t('updater.title'),
                        kind: 'info',
                        okLabel: t('updater.updateNow'),
                        cancelLabel: t('updater.later'),
                    }
                )

                if (shouldUpdate) {
                    let downloaded = 0
                    let contentLength: number | undefined = 0

                    await update.downloadAndInstall((event) => {
                        switch (event.event) {
                            case 'Started':
                                contentLength = event.data.contentLength
                                console.log(`[Tauri] Started downloading ${event.data.contentLength} bytes`)
                                break
                            case 'Progress':
                                downloaded += event.data.chunkLength
                                console.log(`[Tauri] Downloaded ${downloaded} from ${contentLength}`)
                                break
                            case 'Finished':
                                console.log('[Tauri] Download finished')
                                break
                        }
                    })

                    console.log('[Tauri] Update installed. The installer will now replace the application.')
                } else {
                    console.log('[Tauri] User deferred update.')
                    setPendingUpdate({
                        version: update.version,
                        date: update.date,
                        body: update.body
                    })
                }
            } else {
                console.log('[Tauri] No updates available')
                if (isManual) {
                    await message(t('settings.messages.noUpdate'), {
                        title: t('updater.title'),
                        kind: 'info',
                    })
                }
            }
        } catch (error) {
            console.error('[Tauri] Failed to check for updates:', error)
        }
    }, [t, setPendingUpdate])

    useEffect(() => {
        if (isTauri) {
            // Delay startup check slightly to ensure network and WebView are fully ready
            const timer = setTimeout(() => {
                checkForUpdates()
            }, 3000)

            const handleManualCheck = () => {
                checkForUpdates(true)
            }

            window.addEventListener('check-for-updates', handleManualCheck)

            const handleKeyDown = async (e: KeyboardEvent) => {
                if (e.key === 'F11' && !isMobile()) {
                    e.preventDefault()
                    const { getCurrentWindow } = await import('@tauri-apps/api/window')
                    const window = getCurrentWindow()
                    const fullscreen = await window.isFullscreen()
                    const maximized = await window.isMaximized()

                    console.log('[Tauri] F11: Toggling fullscreen to:', !fullscreen, '(Maximized:', maximized, ')')

                    if (!fullscreen && maximized) {
                        await window.unmaximize()
                    }

                    await window.setFullscreen(!fullscreen)
                }
            }

            window.addEventListener('keydown', handleKeyDown)
            return () => {
                clearTimeout(timer)
                window.removeEventListener('keydown', handleKeyDown)
                window.removeEventListener('check-for-updates', handleManualCheck)
            }
        }
    }, [checkForUpdates])

    return null
}




function App() {
    useEffect(() => {
        if (isMobile()) {
            document.documentElement.setAttribute('data-mobile', 'true')
        } else {
            document.documentElement.removeAttribute('data-mobile')
        }

        if (isTauri && !isMobile()) {
            console.log('[Tauri] Pre-loading all pages for snappy navigation...')
            pages.forEach(load => load())
        }
    }, [])

    return (
        <AuthProvider>
            <WorkspaceProvider>
                <UpdateHandler />
                {(!isMobile()) && <TitleBar />}
                {isTauri && !isSupabaseConfigured ? (
                    <Suspense fallback={<LoadingState />}>
                        <ConnectionConfiguration />
                    </Suspense>
                ) : (
                    <ExchangeRateProvider>
                        <Suspense fallback={<LoadingState />}>
                            <Router hook={useHashLocation}>
                                <Switch>
                                    {/* Guest Routes */}
                                    <Route path="/login">
                                        <GuestRoute>
                                            <Login />
                                        </GuestRoute>
                                    </Route>
                                    <Route path="/register">
                                        <GuestRoute>
                                            <Register />
                                        </GuestRoute>
                                    </Route>

                                    {/* Locked Workspace Route - no layout, standalone page */}
                                    <Route path="/locked-workspace">
                                        <LockedWorkspace />
                                    </Route>

                                    {/* Connection Configuration Route - Electron Guard */}
                                    <Route path="/connection-configuration">
                                        <ConnectionConfiguration />
                                    </Route>

                                    {/* Protected Routes */}
                                    <Route path="/">
                                        <ProtectedRoute>
                                            <Layout>
                                                <Dashboard />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/pos">
                                        <ProtectedRoute allowedRoles={['admin', 'staff']} requiredFeature="allow_pos">
                                            <Layout>
                                                <POS />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/sales">
                                        <ProtectedRoute>
                                            <Layout>
                                                <Sales />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/revenue">
                                        <ProtectedRoute allowedRoles={['admin']}>
                                            <Layout>
                                                <Revenue />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/performance">
                                        <ProtectedRoute allowedRoles={['admin', 'staff', 'viewer']}>
                                            <Layout>
                                                <TeamPerformance />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/products">
                                        <ProtectedRoute>
                                            <Layout>
                                                <Products />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/customers">
                                        <ProtectedRoute requiredFeature="allow_customers">
                                            <Layout>
                                                <Customers />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/orders">
                                        <ProtectedRoute requiredFeature="allow_orders">
                                            <Layout>
                                                <Orders />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>

                                    <Route path="/invoices">
                                        <ProtectedRoute requiredFeature="allow_invoices">
                                            <Layout>
                                                <Invoices />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/currency-converter">
                                        <ProtectedRoute allowedRoles={['admin', 'staff']}>
                                            <Layout>
                                                <CurrencyConverter />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/members">
                                        <ProtectedRoute allowedRoles={['admin']}>
                                            <Layout>
                                                <Members />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/workspace-registration">
                                        <ProtectedRoute allowKicked={true}>
                                            <WorkspaceRegistration />
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/settings">
                                        <ProtectedRoute allowedRoles={['admin']}>
                                            <Layout>
                                                <Settings />
                                            </Layout>
                                        </ProtectedRoute>
                                    </Route>
                                    <Route path="/admin">
                                        <Admin />
                                    </Route>
                                    <Route path="/workspace-configuration">
                                        <ProtectedRoute allowedRoles={['admin']}>
                                            <WorkspaceConfiguration />
                                        </ProtectedRoute>
                                    </Route>

                                    {/* 404 */}
                                    <Route>
                                        <div className="min-h-screen flex items-center justify-center bg-background">
                                            <div className="text-center">
                                                <h1 className="text-6xl font-bold gradient-text mb-4">404</h1>
                                                <p className="text-muted-foreground mb-4">Page not found</p>
                                                <Link href="/" className="text-primary hover:underline">Go home</Link>
                                            </div>
                                        </div>
                                    </Route>
                                </Switch>
                            </Router>
                        </Suspense>
                    </ExchangeRateProvider>
                )}
                <Toaster />
            </WorkspaceProvider>
        </AuthProvider>
    )
}

export default App
