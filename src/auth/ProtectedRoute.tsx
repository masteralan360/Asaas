import { type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { Redirect, useLocation } from 'wouter'
import type { UserRole } from '@/local-db/models'

interface ProtectedRouteProps {
    children: ReactNode
    allowedRoles?: UserRole[]
    redirectTo?: string
    allowKicked?: boolean
}

export function ProtectedRoute({
    children,
    allowedRoles,
    redirectTo = '/login',
    allowKicked = false
}: ProtectedRouteProps) {
    const { isAuthenticated, isLoading, hasRole, isKicked } = useAuth()
    const [location] = useLocation()

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

    if (!isAuthenticated) {
        return <Redirect to={`${redirectTo}?redirect=${encodeURIComponent(location)}`} />
    }

    // Redirect kicked users to workspace registration (unless this route allows kicked users)
    if (isKicked && !allowKicked) {
        return <Redirect to="/workspace-registration" />
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
