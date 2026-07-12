import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, LogOut, RefreshCw, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AuthUser } from '@/auth/AuthContext'
import { markInternetReachable, type OfflineLeaseStatus } from '@/lib/offlineLease'
import { Button } from '@/ui/components/button'

interface OfflineLeaseBlockerProps {
    user: AuthUser
    status: OfflineLeaseStatus
    onSignOut: () => Promise<void>
}

function getReasonKey(status: OfflineLeaseStatus) {
    if (status.reason === 'clock-rollback') {
        return 'clockRollback'
    }

    if (status.reason === 'missing') {
        return 'missing'
    }

    return 'expired'
}

function getReasonFallback(status: OfflineLeaseStatus) {
    if (status.reason === 'clock-rollback') {
        return 'Check the device date and time, then reconnect to the internet.'
    }

    if (status.reason === 'missing') {
        return 'This device needs one successful online session before offline use can continue.'
    }

    return 'This device has been offline for more than 10 days.'
}

export function OfflineLeaseBlocker({ user, status, onSignOut }: OfflineLeaseBlockerProps) {
    const { t } = useTranslation()
    const [isRetrying, setIsRetrying] = useState(false)
    const [retryError, setRetryError] = useState<string | null>(null)
    const retryInFlightRef = useRef(false)
    const autoRetryAttemptedRef = useRef(false)

    const retryConnection = useCallback(async () => {
        if (retryInFlightRef.current) return

        retryInFlightRef.current = true
        setIsRetrying(true)
        setRetryError(null)

        try {
            if (navigator.onLine === false) {
                setRetryError(t('offlineLease.errors.offline', {
                    defaultValue: 'No internet connection detected. Connect and try again.'
                }))
                return
            }

            markInternetReachable({
                userId: user.id,
                workspaceId: user.workspaceId,
                dataMode: user.workspaceMode,
                source: 'offline-lease-browser-online'
            })
        } finally {
            retryInFlightRef.current = false
            setIsRetrying(false)
        }
    }, [t, user.id, user.workspaceId, user.workspaceMode])

    useEffect(() => {
        const attemptAutoRetry = () => {
            if (autoRetryAttemptedRef.current) return
            autoRetryAttemptedRef.current = true
            void retryConnection()
        }

        const retryTimer = navigator.onLine
            ? window.setTimeout(attemptAutoRetry, 500)
            : null

        const handleOnline = () => {
            autoRetryAttemptedRef.current = false
            attemptAutoRetry()
        }

        window.addEventListener('online', handleOnline)

        return () => {
            if (retryTimer) window.clearTimeout(retryTimer)
            window.removeEventListener('online', handleOnline)
        }
    }, [retryConnection])

    return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-lg">
                <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    <Wifi className="h-6 w-6" />
                </div>

                <h1 className="text-xl font-semibold text-foreground">
                    {t('offlineLease.title', { defaultValue: 'Connect to the internet to continue' })}
                </h1>

                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {t(`offlineLease.reasons.${getReasonKey(status)}`, {
                        defaultValue: getReasonFallback(status)
                    })}
                </p>

                {retryError && (
                    <div className="mt-5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-start text-sm text-destructive">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{retryError}</span>
                    </div>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <Button type="button" allowViewer onClick={() => void retryConnection()} disabled={isRetrying}>
                        <RefreshCw className={isRetrying ? 'animate-spin' : undefined} />
                        {isRetrying
                            ? t('offlineLease.checking', { defaultValue: 'Checking...' })
                            : t('offlineLease.retry', { defaultValue: 'Try again' })}
                    </Button>
                    <Button type="button" variant="outline" allowViewer onClick={() => void onSignOut()}>
                        <LogOut />
                        {t('common.signOut', { defaultValue: 'Sign out' })}
                    </Button>
                </div>
            </div>
        </div>
    )
}
