import { Route, Switch } from 'wouter'
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
const WorkspaceConfiguration = lazy(() => import('@/ui/pages/WorkspaceConfiguration').then(m => ({ default: m.WorkspaceConfiguration })))

// Preload list for Electron
const pages = [
    () => import('@/ui/pages/Dashboard'),
    () => import('@/ui/pages/Products'),
    () => import('@/ui/pages/Customers'),
    () => import('@/ui/pages/Orders'),
    () => import('@/ui/pages/Invoices'),
    () => import('@/ui/pages/POS'),
    () => import('@/ui/pages/Sales'),
    () => import('@/ui/pages/Settings'),
    () => import('@/ui/pages/Members'),
    () => import('@/ui/pages/WorkspaceConfiguration'),
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

function App() {
    useEffect(() => {
        // Detect Electron
        const isElectron = /electron/i.test(navigator.userAgent)

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
                                        <a href="/" className="text-primary hover:underline">Go home</a>
                                    </div>
                                </div>
                            </Route>
                        </Switch>
                    </Suspense>
                </ExchangeRateProvider>
            </WorkspaceProvider>
            <Toaster />
        </AuthProvider >
    )
}

export default App
