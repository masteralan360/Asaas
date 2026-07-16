import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Clock, CreditCard, HardDrive, Lock, LogOut, Mail } from 'lucide-react'
import { Button } from '@/ui/components/button'
import { useAuth } from '@/auth'
import { useLocation } from 'wouter'
import { useWorkspace } from '@/workspace'
import {
    getWorkspacePaymentAlertKind,
    openWorkspacePaymentDialog,
    shouldApplyWorkspaceSubscriptionExpiry
} from '@/lib/workspacePayments'

export function LockedWorkspace() {
    const { t } = useTranslation()
    const { signOut } = useAuth()
    const { features, isLocked, isLoading, paymentSummary, isPaymentSummaryLoading } = useWorkspace()
    const [, setLocation] = useLocation()

    const isUsageMode = Boolean(
        paymentSummary?.configuration?.usageEnabled || features.has_usage_limits
    )
    const expiryDate = isUsageMode
        ? paymentSummary?.configuration?.renewalDueAt ?? features.subscription_expires_at
        : features.subscription_expires_at
    const isExpired = shouldApplyWorkspaceSubscriptionExpiry({
        hasUsageLimits: features.has_usage_limits,
        summary: paymentSummary
    })
        && expiryDate
        && new Date(expiryDate) < new Date()
    const paymentAlertKind = getWorkspacePaymentAlertKind(paymentSummary)
    const pendingTransaction = paymentSummary?.pendingTransaction ?? null
    const showPaymentAction = Boolean(paymentAlertKind || isExpired || pendingTransaction)

    const paymentCopy = (() => {
        switch (paymentAlertKind) {
            case 'usage_exhausted':
                return {
                    title: t('workspacePayments.usageExhaustedTitle'),
                    description: t('workspacePayments.usageExhaustedDescription'),
                    icon: HardDrive
                }
            case 'subscription_expired':
                return {
                    title: t('workspacePayments.subscriptionExpiredTitle'),
                    description: t('workspacePayments.subscriptionExpiredDescription'),
                    icon: Clock
                }
            default:
                if (isExpired) {
                    return {
                        title: t('workspacePayments.subscriptionExpiredTitle'),
                        description: t('workspacePayments.subscriptionExpiredDescription'),
                        icon: Clock
                    }
                }
                return {
                    title: t('lockedWorkspace.title'),
                    description: t('lockedWorkspace.message'),
                    icon: Lock
                }
        }
    })()
    const LockIcon = paymentCopy.icon

    useEffect(() => {
        if (!isLoading && !isLocked) {
            setLocation('/')
        }
    }, [isLoading, isLocked, setLocation])

    const handleContactAdmin = () => {
        // Open email client with admin contact
        window.location.href = 'mailto:admin@example.com?subject=Workspace Access Request'
    }

    const handleSignOut = async () => {
        await signOut()
        setLocation('/login')
    }

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

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/30 p-4">
            <div className="max-w-md w-full text-center space-y-8">
                {/* Lock Icon */}
                <div className="mx-auto w-24 h-24 rounded-full bg-destructive/10 flex items-center justify-center relative">
                    <LockIcon className={`w-12 h-12 text-destructive ${showPaymentAction ? 'animate-pulse' : ''}`} />
                    {showPaymentAction && (
                        <div className="absolute -top-1 -right-1">
                            <AlertCircle className="w-6 h-6 text-destructive fill-background" />
                        </div>
                    )}
                </div>

                {/* Title */}
                <div className="space-y-2">
                    <h1 className="text-3xl font-bold text-foreground">
                        {paymentCopy.title}
                    </h1>
                    <p className="text-muted-foreground text-lg">
                        {paymentCopy.description}
                    </p>
                    {pendingTransaction && (
                        <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-200">
                            {t('workspacePayments.submittedMessage')}
                        </p>
                    )}
                </div>

                {/* Buttons Container */}
                <div className="flex flex-col gap-3 items-center">
                    {showPaymentAction && (
                        <Button
                            allowViewer={true}
                            size="lg"
                            onClick={openWorkspacePaymentDialog}
                            className="gap-2 w-full max-w-[240px]"
                        >
                            <CreditCard className="w-5 h-5" />
                            {isPaymentSummaryLoading && !paymentSummary
                                ? t('workspacePayments.loading')
                                : pendingTransaction
                                    ? t('workspacePayments.viewPaymentStatus')
                                    : t('workspacePayments.renewSubscription')}
                        </Button>
                    )}

                    <Button
                        allowViewer={true}
                        size="lg"
                        onClick={handleContactAdmin}
                        variant={showPaymentAction ? 'outline' : 'default'}
                        className="gap-2 w-full max-w-[240px]"
                    >
                        <Mail className="w-5 h-5" />
                        {t('lockedWorkspace.contactAdmin') || 'Contact an Admin'}
                    </Button>

                    <Button
                        allowViewer={true}
                        variant="outline"
                        size="lg"
                        onClick={handleSignOut}
                        className="gap-2 w-full max-w-[240px]"
                    >
                        <LogOut className="w-5 h-5" />
                        {t('common.signOut') || 'Sign Out'}
                    </Button>
                </div>

                {/* Additional Info */}
                <p className="text-xs text-muted-foreground opacity-70">
                    {t('lockedWorkspace.additionalInfo') || 'If you believe this is an error, please reach out to your workspace administrator.'}
                </p>
            </div>
        </div>
    )
}
