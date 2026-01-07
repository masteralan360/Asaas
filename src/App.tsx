import { Route, Switch } from 'wouter'
import { AuthProvider, ProtectedRoute, GuestRoute } from '@/auth'
import { Layout } from '@/ui/components'
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
    WorkspaceRegistration
} from '@/ui/pages'

function App() {
    return (
        <AuthProvider>
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
                <Route path="/products">
                    <ProtectedRoute>
                        <Layout>
                            <Products />
                        </Layout>
                    </ProtectedRoute>
                </Route>
                <Route path="/customers">
                    <ProtectedRoute>
                        <Layout>
                            <Customers />
                        </Layout>
                    </ProtectedRoute>
                </Route>
                <Route path="/orders">
                    <ProtectedRoute>
                        <Layout>
                            <Orders />
                        </Layout>
                    </ProtectedRoute>
                </Route>

                <Route path="/invoices">
                    <ProtectedRoute>
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
        </AuthProvider >
    )
}

export default App
