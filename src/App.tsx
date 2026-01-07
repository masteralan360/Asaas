import { Route, Switch } from 'wouter'
import { AuthProvider, ProtectedRoute, GuestRoute } from '@/auth'
import { WorkspaceProvider } from '@/workspace'
import { Layout, Toaster } from '@/ui/components'
import {
    Dashboard,
    Login,
    Register,
    Products,
    Customers,
    Orders,
    Invoices,
    Members,
    Settings,
    Admin,
    WorkspaceRegistration,
    POS,
    Sales,
    WorkspaceConfiguration
} from '@/ui/pages'

function App() {
    return (
        <AuthProvider>
            <WorkspaceProvider>
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
            </WorkspaceProvider>
            <Toaster />
        </AuthProvider >
    )
}

export default App
