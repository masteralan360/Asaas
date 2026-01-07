import { type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { Redirect, useLocation } from 'wouter'
import type { UserRole } from '@/local-db/models'
import { useWorkspace, type WorkspaceFeatures } from '@/workspace'

interface ProtectedRouteProps {
    children: ReactNode
    allowedRoles?: UserRole[]
    redirectTo?: string
    allowKicked?: boolean
    requiredFeature?: keyof Omit<WorkspaceFeatures, 'is_configured'>
}

export function ProtectedRoute({
    children,
    allowedRoles,
    redirectTo = '/login',
    allowKicked = false,
    requiredFeature
}: ProtectedRouteProps) {
    const { isAuthenticated, isLoading, hasRole, isKicked, user } = useAuth()
    const { hasFeature, features, isLoading: featuresLoading } = useWorkspace()
    const [location] = useLocation()

    if (isLoading || featuresLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-muted-foreground">Loading...</p>
                </div>
            </div>
        )
    }

    if (!isAuthenticated) {
        return <Redirect to={`${redirectTo}?redirect=${encodeURIComponent(location)}`} />
    }

    // Redirect kicked users to workspace registration (unless this route allows kicked users)
    if (isKicked && !allowKicked) {
        return <Redirect to="/workspace-registration" />
    }

    // Redirect admins to workspace configuration if not configured
    // Redirect admins to workspace configuration if not configured
    // Note: features.is_configured defaults to true (in WorkspaceContext) until fetched.
    // However, fetch happens fast. If isLoading/featuresLoading is false, we trust the value.
    if (user?.role === 'admin' && !features.is_configured && location !== '/workspace-configuration') {
        return <Redirect to="/workspace-configuration" />
    }

    if (allowedRoles && !hasRole(allowedRoles)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="text-center">
                    <h1 className="text-4xl font-bold text-destructive mb-4">403</h1>
                    <p className="text-muted-foreground">You don't have permission to access this page.</p>
                </div>
            </div>
        )
    }

    // Check if required feature is enabled
    // 1. Check Workspace Level
    if (requiredFeature && !hasFeature(requiredFeature)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="text-center">
                    <h1 className="text-4xl font-bold text-amber-500 mb-4">Feature Disabled</h1>
                    <p className="text-muted-foreground mb-4">This feature is not enabled for your workspace.</p>
                    <a href="/" className="text-primary hover:underline">Return to Dashboard</a>
                </div>
            </div>
        )
    }

    // 2. Check User Permission Level
    if (requiredFeature && user?.permissions) {
        // We cast requiredFeature because WorkspaceFeatures includes 'is_configured' but permissions obj does not
        // However, requiredFeature prop is already Omit<..., 'is_configured'>
        const userHasPermission = user.permissions[requiredFeature as keyof typeof user.permissions]

        if (userHasPermission === false) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-background">
                    <div className="text-center">
                        <h1 className="text-4xl font-bold text-destructive mb-4">Access Denied</h1>
                        <p className="text-muted-foreground mb-4">You do not have permission to access this feature.</p>
                        <a href="/" className="text-primary hover:underline">Return to Dashboard</a>
                    </div>
                </div>
            )
        }
    }

    return <>{children}</>
}

interface GuestRouteProps {
    children: ReactNode
    redirectTo?: string
}

export function GuestRoute({ children, redirectTo = '/' }: GuestRouteProps) {
    const { isAuthenticated, isLoading } = useAuth()

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-muted-foreground">Loading...</p>
                </div>
            </div>
        )
    }

    if (isAuthenticated) {
        return <Redirect to={redirectTo} />
    }

    return <>{children}</>
}
