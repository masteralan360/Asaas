import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/components/dialog'
import { useWorkspace } from '@/workspace'
import { useSubscriptionExpiryWarning } from '@/hooks/useSubscriptionExpiryWarning'
import { getSubscriptionExpiryWarningSeenKey } from '@/lib/subscriptionExpiryWarning'
import { formatDate } from '@/lib/utils'
import {
    openWorkspacePaymentDialog,
    shouldApplyWorkspaceSubscriptionExpiry
} from '@/lib/workspacePayments'

export function SubscriptionExpiryWarningModal() {
    const { t } = useTranslation()
    const { activeWorkspace, features, isDemoMode, isLoading, paymentSummary } = useWorkspace()
    const isUsageMode = Boolean(
        paymentSummary?.configuration?.usageEnabled || features.has_usage_limits
    )
    const shouldWarnForSubscription = shouldApplyWorkspaceSubscriptionExpiry({
        hasUsageLimits: features.has_usage_limits,
        summary: paymentSummary
    })
    // For usage workspaces, warn based on renewal_due_at; for normal workspaces, warn based on subscription_expires_at
    const expiryDateToCheck = isUsageMode
        ? paymentSummary?.configuration?.renewalDueAt ?? null
        : features.subscription_expires_at
    const warning = useSubscriptionExpiryWarning(
        isDemoMode || !shouldWarnForSubscription ? null : expiryDateToCheck
    )
    const [open, setOpen] = useState(false)

    const seenKey = useMemo(() => {
        if (!activeWorkspace?.id || !warning) return null
        return getSubscriptionExpiryWarningSeenKey(activeWorkspace.id, warning.expiresAtIso)
    }, [activeWorkspace?.id, warning])

    const dismiss = useCallback(() => {
        if (seenKey) {
            try {
                window.localStorage.setItem(seenKey, new Date().toISOString())
            } catch (error) {
                console.warn('[SubscriptionExpiryWarning] Failed to save seen state:', error)
            }
        }
        setOpen(false)
    }, [seenKey])

    useEffect(() => {
        if (isLoading || !warning || !activeWorkspace?.id || !seenKey) {
            setOpen(false)
            return
        }

        try {
            if (window.localStorage.getItem(seenKey)) {
                setOpen(false)
                return
            }
        } catch (error) {
            console.warn('[SubscriptionExpiryWarning] Failed to read seen state:', error)
        }

        setOpen(true)
    }, [activeWorkspace?.id, isLoading, seenKey, warning])

    useEffect(() => {
        const handleOpen = () => {
            if (!warning || !activeWorkspace?.id) return
            setOpen(true)
        }

        window.addEventListener('open-subscription-expiry-warning', handleOpen)
        return () => window.removeEventListener('open-subscription-expiry-warning', handleOpen)
    }, [activeWorkspace?.id, warning])

    if (!warning) return null

    const daysRemaining = warning.daysRemaining
    const expiryDate = formatDate(warning.expiresAt)
    const renew = () => {
        dismiss()
        openWorkspacePaymentDialog()
    }

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            if (nextOpen) {
                setOpen(true)
            } else {
                dismiss()
            }
        }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            <AlertTriangle className="h-6 w-6" />
                        </div>
                        <div className="min-w-0 space-y-2 text-start">
                            <DialogTitle>
                                {t('subscriptionExpiryWarning.title', {
                                    defaultValue: 'Subscription expiring soon'
                                })}
                            </DialogTitle>
                            <DialogDescription className="leading-relaxed">
                                {t('subscriptionExpiryWarning.description', {
                                    count: daysRemaining,
                                    defaultValue: 'Your subscription is expiring in {{count}} days. Please renew it to keep using this workspace without interruption.'
                                })}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-100">
                    <div className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 shrink-0" />
                        <span className="font-medium">
                            {t('subscriptionExpiryWarning.expiresOn', {
                                date: expiryDate,
                                defaultValue: 'Expires on {{date}}'
                            })}
                        </span>
                    </div>
                </div>

                <DialogFooter>
                    <Button allowViewer={true} variant="outline" onClick={dismiss}>
                        {t('subscriptionExpiryWarning.acknowledge', {
                            defaultValue: 'Got it'
                        })}
                    </Button>
                    <Button allowViewer={true} onClick={renew}>
                        {t('workspacePayments.renewSubscription')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
