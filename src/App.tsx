import { Route, Switch, Router, Link } from 'wouter'
import { useHashLocation } from '@/hooks/useHashLocation'
import { AuthProvider, ProtectedRoute, GuestRoute } from '@/auth'
import { WorkspaceProvider } from '@/workspace'
import { Layout, Toaster } from '@/ui/components'
import { lazy, Suspense, useEffect } from 'react'

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


import { ExchangeRateProvider } from '@/context/ExchangeRateContext'
import { isSupabaseConfigured } from '@/auth/supabase'

function App() {
    const isElectron = /electron/i.test(navigator.userAgent)

    // Hard Guard for Electron Connection Configuration
    // If we are in Electron and Supabase is not configured, we catch it here
    // effectively preventing the rest of the app (AuthProvider, etc.) from loading.
    if (isElectron && !isSupabaseConfigured) {
        return (
            <Suspense fallback={<LoadingState />}>
                <ConnectionConfiguration />
            </Suspense>
        )
    }

    useEffect(() => {
        if (isElectron) {
            console.log('[Electron] Pre-loading all pages for snappy navigation...')
            pages.forEach(load => load())
        }
    }, [])

    return (
        <AuthProvider>
            <WorkspaceProvider>
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
            </WorkspaceProvider>
            <Toaster />
        </AuthProvider >
    )
}

export default App
