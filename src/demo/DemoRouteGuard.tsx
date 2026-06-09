import { type ReactNode } from 'react'
import { useAuth } from '@/auth'
import { useLocation, Link } from 'wouter'
import { isDemoWorkspace, parseDemoCode, DEMO_JOB_DISABLED_FEATURES, type DemoJob } from './demoConfig'

interface DemoRouteGuardProps {
  children: ReactNode
  feature?: string
}

const RESTRICTED_FEATURES_BY_JOB: Record<DemoJob, string[]> = {
  general: [],
  market: [],
  shop: ['ecommerce'],
  real_estate: [],
  currency_exchange: [],
  clinic: [],
}

export function DemoRouteGuard({ children, feature }: DemoRouteGuardProps) {
  const { user } = useAuth()
  const [location] = useLocation()

  if (!user?.workspaceCode || !feature) {
    return <>{children}</>
  }

  if (!isDemoWorkspace(user.workspaceCode)) {
    return <>{children}</>
  }

  const parsed = parseDemoCode(user.workspaceCode)
  if (!parsed) {
    return <>{children}</>
  }

  const { job } = parsed
  const disabledFeatures = RESTRICTED_FEATURES_BY_JOB[job] ?? []

  if (disabledFeatures.includes(feature)) {
    const isDemoSetupRoute = location.startsWith('/demo-setup')
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md p-8">
          <h1 className="text-4xl font-bold text-amber-500 mb-4">{'Demo Restriction'}</h1>
          <p className="text-muted-foreground mb-6">
            {'This module is not available in the current demo type. Please select a different demo type or sign in to your workspace.'}
          </p>
          <Link href="/" className="text-primary hover:underline">
            {'Return to Dashboard'}
          </Link>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
