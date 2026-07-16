import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
    AlertCircle,
    CalendarClock,
    CheckCircle2,
    Clock3,
    CreditCard,
    Gift,
    QrCode,
    RefreshCw,
    XCircle
} from 'lucide-react'
import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'
import { Button } from '@/ui/components/button'
import { Label } from '@/ui/components/label'
import { PaymentAccountHolderNameAutocomplete } from '@/ui/components/PaymentAccountHolderNameAutocomplete'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/components/dialog'
import { PressAndHoldButton } from '@/ui/components/PressAndHoldButton'
import { cn } from '@/lib/utils'
import {
    OPEN_WORKSPACE_PAYMENT_DIALOG_EVENT,
    WORKSPACE_PAYMENT_CURRENCY,
    canSubmitWorkspacePayment,
    formatWorkspacePaymentDecimal,
    getWorkspacePaymentAlertKind,
    getWorkspacePaymentQrPath,
    getSavedWorkspacePaymentAccountHolderNames,
    hasNewlyApprovedWorkspacePayment,
    hasWorkspacePaymentAccessBeenRestored,
    isValidWorkspacePaymentAccountHolderName,
    normalizeWorkspacePaymentAccountHolderName,
    submitWorkspacePayment,
    type WorkspacePaymentAlertKind,
    type WorkspacePaymentProvider,
    type WorkspacePaymentStatus,
    type WorkspacePaymentSummary,
    type WorkspacePaymentTransaction
} from '@/lib/workspacePayments'

const PENDING_PAYMENT_POLL_INTERVAL_MS = 10_000
const PAYMENT_SUMMARY_REFRESH_INTERVAL_MS = 60_000
const PAYMENT_CONFIRMATION_DELAY_MS = 15_000

let hasUsedPaymentConfirmationDelay = false
let paymentConfirmationDelayEndsAtForSession: number | null = null

function getPaymentConfirmationDelayRemaining(endsAt: number | null) {
    return endsAt ? Math.max(0, endsAt - Date.now()) : 0
}

function getWorkspacePaymentCurrencyLabel(iqdDisplayPreference: string) {
    return iqdDisplayPreference === 'د.ع' ? 'د.ع' : WORKSPACE_PAYMENT_CURRENCY
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return 'Unable to submit the payment. Please try again.'
}

function getAlertCopy(kind: WorkspacePaymentAlertKind | null, t: ReturnType<typeof useTranslation>['t']) {
    switch (kind) {
        case 'subscription_expired':
            return {
                title: t('workspacePayments.subscriptionExpiredTitle'),
                description: t('workspacePayments.subscriptionExpiredDescription')
            }
        case 'usage_exhausted':
            return {
                title: t('workspacePayments.usageExhaustedTitle'),
                description: t('workspacePayments.usageExhaustedDescription')
            }
        default:
            return {
                title: t('workspacePayments.dialogTitle'),
                description: t('workspacePayments.dialogDescription')
            }
    }
}

function getStatusPresentation(status: WorkspacePaymentStatus, t: ReturnType<typeof useTranslation>['t']) {
    switch (status) {
        case 'pending':
            return {
                label: t('workspacePayments.statuses.pending'),
                icon: Clock3,
                className: 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300'
            }
        case 'approved':
            return {
                label: t('workspacePayments.statuses.approved'),
                icon: CheckCircle2,
                className: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300'
            }
        case 'rejected':
            return {
                label: t('workspacePayments.statuses.rejected'),
                icon: XCircle,
                className: 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300'
            }
        case 'expired':
        default:
            return {
                label: t('workspacePayments.statuses.expired'),
                icon: CalendarClock,
                className: 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-300'
            }
    }
}

function TransactionHistory({
    transactions,
    locale,
    iqdDisplayPreference,
    t
}: {
    transactions: WorkspacePaymentTransaction[]
    locale: string
    iqdDisplayPreference: string
    t: ReturnType<typeof useTranslation>['t']
}) {
    const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }), [locale])

    return (
        <section className="space-y-3 border-t border-border/60 pt-5">
            <h3 className="text-sm font-bold text-foreground">
                {t('workspacePayments.statusHistory')}
            </h3>
            {transactions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    {t('workspacePayments.noTransactions')}
                </p>
            ) : (
                <div className="max-h-56 space-y-2 overflow-y-auto pe-1">
                    {transactions.map((transaction) => {
                        const status = getStatusPresentation(transaction.status, t)
                        const StatusIcon = status.icon
                        const createdAt = new Date(transaction.createdAt)
                        const paidAt = transaction.paidAt ? new Date(transaction.paidAt) : null

                        return (
                            <article key={transaction.id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="font-semibold text-foreground">
                                            {transaction.provider === 'fib'
                                                ? t('workspacePayments.fib')
                                                : t('workspacePayments.qicard')}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {formatWorkspacePaymentDecimal(transaction.amount, locale, 3)} {transaction.currency === WORKSPACE_PAYMENT_CURRENCY
                                                ? getWorkspacePaymentCurrencyLabel(iqdDisplayPreference)
                                                : transaction.currency}
                                            {' \u00b7 '}{formatWorkspacePaymentDecimal(transaction.gbAdded, locale, 6)} GB
                                        </p>
                                    </div>
                                    <span className={cn(
                                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1',
                                        status.className
                                    )}>
                                        <StatusIcon className="h-3.5 w-3.5" />
                                        {status.label}
                                    </span>
                                </div>
                                <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                                    <div>
                                        <dt className="font-medium">{t('workspacePayments.submittedAt')}</dt>
                                        <dd>{Number.isNaN(createdAt.getTime()) ? '\u2014' : dateFormatter.format(createdAt)}</dd>
                                    </div>
                                    {paidAt && (
                                        <div>
                                            <dt className="font-medium">{t('workspacePayments.paidAt')}</dt>
                                            <dd>{Number.isNaN(paidAt.getTime()) ? '\u2014' : dateFormatter.format(paidAt)}</dd>
                                        </div>
                                    )}
                                </dl>
                                {transaction.reviewNote && (
                                    <p className="mt-3 rounded-lg bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                                        <span className="font-semibold text-foreground">{t('workspacePayments.reviewNote')}: </span>
                                        {transaction.reviewNote}
                                    </p>
                                )}
                            </article>
                        )
                    })}
                </div>
            )}
        </section>
    )
}

function ProviderButton({
    provider,
    selected,
    onSelect,
    label,
    currencyLabel
}: {
    provider: WorkspacePaymentProvider
    selected: boolean
    onSelect: (provider: WorkspacePaymentProvider) => void
    label: string
    currencyLabel: string
}) {
    const isFree = provider === 'free'
    const providerIcon = provider === 'fib' ? '/icons/fib.svg' : '/icons/qi.svg'
    return (
        <button
            type="button"
            onClick={() => onSelect(provider)}
            aria-pressed={selected}
            className={cn(
                'flex min-h-[5.5rem] items-center gap-3 rounded-2xl border p-4 text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5',
                selected
                    ? 'border-primary bg-primary/[0.08] shadow-sm ring-1 ring-primary/20'
                    : 'border-border/70 bg-background hover:border-primary/40 hover:bg-accent/40'
            )}
        >
            <span className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
                selected ? 'bg-background shadow-sm ring-1 ring-primary/15' : 'bg-muted'
            )}>
                {isFree ? (
                    <Gift className="h-5 w-5 text-foreground" />
                ) : (
                    <img
                        src={providerIcon}
                        alt=""
                        aria-hidden="true"
                        className="h-8 w-8 rounded-lg object-contain"
                    />
                )}
            </span>
            <span>
                <span className="block text-sm font-bold text-foreground">{label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                    {isFree ? 'No payment required' : currencyLabel}
                </span>
            </span>
        </button>
    )
}

export function WorkspacePaymentController() {
    const { t, i18n } = useTranslation()
    const { isAuthenticated } = useAuth()
    const {
        activeWorkspace,
        features,
        isDemoMode,
        paymentSummary,
        isPaymentSummaryLoading,
        refreshPaymentSummary,
        refreshFeatures
    } = useWorkspace()
    const [open, setOpen] = useState(false)
    const [selectedProvider, setSelectedProvider] = useState<WorkspacePaymentProvider | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [submittedTransactionId, setSubmittedTransactionId] = useState<string | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [accountHolderName, setAccountHolderName] = useState('')
    const [savedAccountHolderNames, setSavedAccountHolderNames] = useState<string[]>([])
    const [isConfirmationHighlighted, setIsConfirmationHighlighted] = useState(false)
    const [confirmationDelayEndsAt, setConfirmationDelayEndsAt] = useState<number | null>(
        () => paymentConfirmationDelayEndsAtForSession
    )
    const [confirmationDelayRemainingMs, setConfirmationDelayRemainingMs] = useState(
        () => getPaymentConfirmationDelayRemaining(paymentConfirmationDelayEndsAtForSession)
    )
    const submissionGuardRef = useRef(false)
    const previousSummaryRef = useRef<WorkspacePaymentSummary | null>(null)
    const refreshPaymentSummaryRef = useRef(refreshPaymentSummary)
    const refreshFeaturesRef = useRef(refreshFeatures)

    useEffect(() => {
        refreshPaymentSummaryRef.current = refreshPaymentSummary
        refreshFeaturesRef.current = refreshFeatures
    }, [refreshFeatures, refreshPaymentSummary])

    useEffect(() => {
        const handleOpen = () => setOpen(true)
        window.addEventListener(OPEN_WORKSPACE_PAYMENT_DIALOG_EVENT, handleOpen)
        return () => window.removeEventListener(OPEN_WORKSPACE_PAYMENT_DIALOG_EVENT, handleOpen)
    }, [])

    useEffect(() => {
        setOpen(false)
        setSelectedProvider(null)
        setSubmitted(false)
        setSubmittedTransactionId(null)
        setLoadError(null)
        setSubmitError(null)
        setAccountHolderName('')
        setSavedAccountHolderNames([])
        setIsConfirmationHighlighted(false)
        submissionGuardRef.current = false
        previousSummaryRef.current = null
    }, [activeWorkspace?.id])

    useEffect(() => {
        if (!open) return
        const config = paymentSummary?.configuration
        if (!config) return
        if (config.subscriptionAmount === '0' && selectedProvider === null) {
            setSelectedProvider('free')
        }
    }, [open, paymentSummary?.configuration, selectedProvider])

    useEffect(() => {
        const previousSummary = previousSummaryRef.current
        previousSummaryRef.current = paymentSummary

        if (
            hasNewlyApprovedWorkspacePayment(previousSummary, paymentSummary)
            || hasWorkspacePaymentAccessBeenRestored(previousSummary, paymentSummary)
        ) {
            void refreshFeaturesRef.current()
        }
    }, [paymentSummary])

    useEffect(() => {
        if (!isAuthenticated || isDemoMode || !activeWorkspace?.id) return

        const refresh = () => {
            void refreshPaymentSummaryRef.current().catch(() => undefined)
        }
        const intervalMs = paymentSummary?.hasWorkspacePendingTransaction
            ? PENDING_PAYMENT_POLL_INTERVAL_MS
            : PAYMENT_SUMMARY_REFRESH_INTERVAL_MS
        const intervalId = window.setInterval(refresh, intervalMs)
        window.addEventListener('focus', refresh)

        return () => {
            window.clearInterval(intervalId)
            window.removeEventListener('focus', refresh)
        }
    }, [activeWorkspace?.id, isAuthenticated, isDemoMode, paymentSummary?.hasWorkspacePendingTransaction])

    useEffect(() => {
        if (!open || paymentSummary || isPaymentSummaryLoading || isDemoMode || !isAuthenticated) return

        setLoadError(null)
        void refreshPaymentSummaryRef.current().catch((error) => {
            setLoadError(getErrorMessage(error))
        })
    }, [isAuthenticated, isDemoMode, isPaymentSummaryLoading, open, paymentSummary])

    useEffect(() => {
        if (paymentSummary?.pendingTransaction) {
            setSelectedProvider(null)
        }

        if (paymentSummary) {
            setLoadError(null)
        }

        if (!submittedTransactionId) return

        const submittedTransaction = paymentSummary?.pendingTransaction?.id === submittedTransactionId
            ? paymentSummary.pendingTransaction
            : paymentSummary?.transactions.find(({ id }) => id === submittedTransactionId)

        if (submittedTransaction && submittedTransaction.status !== 'pending') {
            setSubmitted(false)
            setSubmittedTransactionId(null)
        }
    }, [paymentSummary, submittedTransactionId])

    useEffect(() => {
        if (!confirmationDelayEndsAt) {
            setConfirmationDelayRemainingMs(0)
            return
        }

        const updateRemainingTime = () => {
            const remainingMs = getPaymentConfirmationDelayRemaining(confirmationDelayEndsAt)
            setConfirmationDelayRemainingMs(remainingMs)

            if (remainingMs === 0) {
                paymentConfirmationDelayEndsAtForSession = null
                setConfirmationDelayEndsAt(null)
            }
        }

        updateRemainingTime()
        const intervalId = window.setInterval(updateRemainingTime, 250)
        return () => window.clearInterval(intervalId)
    }, [confirmationDelayEndsAt])

    const loadSavedAccountHolderNames = useCallback(() => {
        void getSavedWorkspacePaymentAccountHolderNames()
            .then(setSavedAccountHolderNames)
            .catch((error) => {
                console.warn('[WorkspacePayment] Failed to load saved account holder names:', error)
            })
    }, [])

    if (!isAuthenticated || isDemoMode) return null

    const locale = i18n.language || 'en'
    const workspacePaymentCurrencyLabel = getWorkspacePaymentCurrencyLabel(features.iqd_display_preference)
    const configuration = paymentSummary?.configuration ?? null
    const isFreeRenewal = Boolean(configuration && Number(configuration.subscriptionAmount) === 0)
    const alertKind = getWorkspacePaymentAlertKind(paymentSummary)
    const alertCopy = getAlertCopy(alertKind, t)
    const pendingTransaction = paymentSummary?.pendingTransaction ?? null
    const hasWorkspacePendingTransaction = paymentSummary?.hasWorkspacePendingTransaction ?? false
    const paymentEnabled = Boolean(
        configuration?.isPaymentEnabled
        && paymentSummary?.eligibility.paymentEnabled
    )
    const gbForPayment = configuration?.usageEnabled
        ? configuration.gbPerPayment
        : '0'
    const isConfirmationDelayActive = confirmationDelayRemainingMs > 0
    const confirmationDelaySeconds = Math.ceil(confirmationDelayRemainingMs / 1000)
    const normalizedAccountHolderName = normalizeWorkspacePaymentAccountHolderName(accountHolderName)
    const isAccountHolderNameIncomplete = Boolean(normalizedAccountHolderName)
        && !isValidWorkspacePaymentAccountHolderName(normalizedAccountHolderName)
    const paymentSummaryCardClass = cn(
        'rounded-2xl p-3 transition-all duration-200',
        isConfirmationHighlighted
            ? 'bg-primary/[0.09] ring-2 ring-primary/55 shadow-lg shadow-primary/20'
            : 'bg-muted/[0.28] ring-1 ring-border/60'
    )

    const handleSubmit = async () => {
        if (!selectedProvider || !paymentEnabled) {
            return
        }

        if (selectedProvider !== 'free' && !isValidWorkspacePaymentAccountHolderName(normalizedAccountHolderName)) {
            setSubmitError(t('workspacePayments.accountHolderNameThreeWordsRequired'))
            return
        }

        if (isConfirmationDelayActive || submissionGuardRef.current || !canSubmitWorkspacePayment({
            provider: selectedProvider,
            accountHolderName: normalizedAccountHolderName,
            isSubmitting,
            hasWorkspacePendingTransaction,
            pendingTransaction
        })) {
            return
        }

        submissionGuardRef.current = true
        setIsSubmitting(true)
        setSubmitError(null)
        setAccountHolderName(normalizedAccountHolderName)

        try {
            const transaction = await submitWorkspacePayment(selectedProvider, normalizedAccountHolderName)
            setSubmitted(true)
            setSubmittedTransactionId(transaction.id)
            setSelectedProvider(null)
            await refreshPaymentSummaryRef.current()
        } catch (error) {
            // A database uniqueness guard may have accepted the first request
            // even if this client lost its response. Refresh before presenting
            // an error so the existing pending transaction remains authoritative.
            try {
                const refreshed = await refreshPaymentSummaryRef.current()
                if (refreshed?.pendingTransaction) {
                    setSubmitted(true)
                    setSubmittedTransactionId(refreshed.pendingTransaction.id)
                    setSelectedProvider(null)
                    return
                }
            } catch {
                // Preserve the original submission error below.
            }
            setSubmitError(getErrorMessage(error))
        } finally {
            submissionGuardRef.current = false
            setIsSubmitting(false)
        }
    }

    const handleProviderSelect = (provider: WorkspacePaymentProvider) => {
        setSelectedProvider(provider)

        if (provider === 'free' || hasUsedPaymentConfirmationDelay) return

        const endsAt = Date.now() + PAYMENT_CONFIRMATION_DELAY_MS
        hasUsedPaymentConfirmationDelay = true
        paymentConfirmationDelayEndsAtForSession = endsAt
        setConfirmationDelayEndsAt(endsAt)
        setConfirmationDelayRemainingMs(PAYMENT_CONFIRMATION_DELAY_MS)
    }

    const retryLoad = () => {
        setLoadError(null)
        void refreshPaymentSummaryRef.current().catch((error) => {
            setLoadError(getErrorMessage(error))
        })
    }

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            if (!nextOpen) {
                setSelectedProvider(null)
                setSubmitError(null)
                setAccountHolderName('')
                setIsConfirmationHighlighted(false)
            }
        }}>
            <DialogContent className="max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto rounded-[28px] p-0 shadow-2xl">
                <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.12] via-background to-amber-500/[0.07] px-5 py-5 sm:px-8 sm:py-6">
                    <DialogHeader className="pe-10 text-start">
                        <div className="flex items-start gap-4">
                            <span className="flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
                                <CreditCard className="h-6 w-6" />
                            </span>
                            <div className="space-y-1.5">
                                <DialogTitle className="text-xl sm:text-2xl">{alertCopy.title}</DialogTitle>
                                <DialogDescription className="max-w-2xl leading-relaxed">
                                    {alertCopy.description}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                <div className="space-y-6 px-5 py-5 sm:px-8 sm:py-7">
                    {isPaymentSummaryLoading && !paymentSummary ? (
                        <div className="flex min-h-44 flex-col items-center justify-center gap-3 text-muted-foreground">
                            <RefreshCw className="h-6 w-6 animate-spin" />
                            <p className="text-sm">{t('workspacePayments.loading')}</p>
                        </div>
                    ) : loadError ? (
                        <div className="flex min-h-44 flex-col items-center justify-center gap-3 text-center">
                            <AlertCircle className="h-8 w-8 text-destructive" />
                            <div>
                                <p className="font-semibold text-foreground">{t('workspacePayments.loadFailed')}</p>
                                <p className="mt-1 max-w-md text-sm text-muted-foreground">{loadError}</p>
                            </div>
                            <Button allowViewer={true} variant="outline" onClick={retryLoad}>
                                <RefreshCw className="h-4 w-4" />
                                {t('workspacePayments.retry')}
                            </Button>
                        </div>
                    ) : !configuration ? (
                        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5 text-center">
                            <AlertCircle className="mx-auto h-8 w-8 text-amber-600 dark:text-amber-300" />
                            <h3 className="mt-3 font-bold text-foreground">{t('workspacePayments.paymentUnavailableTitle')}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{t('workspacePayments.noConfiguration')}</p>
                        </div>
                    ) : (
                        <>
                            {(submitted || pendingTransaction) && (
                                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                                    <div className="flex items-start gap-3">
                                        <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
                                        <div>
                                            <p className="font-bold text-foreground">{t('workspacePayments.submittedTitle')}</p>
                                            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                                {t('workspacePayments.submittedMessage')}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {!paymentEnabled && !hasWorkspacePendingTransaction && (
                                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
                                    <p className="font-bold text-foreground">{t('workspacePayments.paymentUnavailableTitle')}</p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {t('workspacePayments.paymentUnavailableDescription')}
                                    </p>
                                </div>
                            )}

                            {hasWorkspacePendingTransaction && !pendingTransaction && (
                                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                                    <div className="flex items-start gap-3">
                                        <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
                                        <p className="text-sm font-medium text-foreground">
                                            {t('workspacePayments.pendingAlreadyExists')}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {!hasWorkspacePendingTransaction && paymentEnabled && (
                                <div className="grid overflow-hidden rounded-[28px] border border-border/70 bg-background shadow-sm md:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
                                    <section className="flex min-h-[34rem] flex-col border-b border-border/60 bg-primary/[0.045] p-5 sm:p-7 md:border-b-0 md:border-e">
                                        <div className="mb-5">
                                            <h3 className="text-sm font-bold text-foreground">
                                                {t('workspacePayments.selectProvider')}
                                            </h3>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {isFreeRenewal ? (
                                                <ProviderButton
                                                    provider="free"
                                                    selected={selectedProvider === 'free'}
                                                    onSelect={handleProviderSelect}
                                                    label={t('workspacePayments.freeRenewal', 'Free Renewal')}
                                                    currencyLabel={workspacePaymentCurrencyLabel}
                                                />
                                            ) : (
                                                <>
                                                    <ProviderButton
                                                        provider="fib"
                                                        selected={selectedProvider === 'fib'}
                                                        onSelect={handleProviderSelect}
                                                        label={t('workspacePayments.fib')}
                                                        currencyLabel={workspacePaymentCurrencyLabel}
                                                    />
                                                    <ProviderButton
                                                        provider="qicard"
                                                        selected={selectedProvider === 'qicard'}
                                                        onSelect={handleProviderSelect}
                                                        label={t('workspacePayments.qicard')}
                                                        currencyLabel={workspacePaymentCurrencyLabel}
                                                    />
                                                </>
                                            )}
                                        </div>

                                        <div className="mt-6 flex flex-1 flex-col items-center justify-center">
                                            {selectedProvider === 'free' ? (
                                                <div className="flex aspect-square w-full max-w-[20rem] flex-col items-center justify-center rounded-3xl border border-dashed border-primary/30 bg-background/70 p-6 text-center">
                                                    <Gift className="h-10 w-10 text-primary" />
                                                    <p className="mt-3 text-sm font-bold text-foreground">
                                                        {t('workspacePayments.freeRenewal', 'Free Renewal')}
                                                    </p>
                                                </div>
                                            ) : selectedProvider ? (
                                                <div className="w-full max-w-[20rem] rounded-[28px] bg-white p-4 shadow-xl ring-1 ring-black/[0.05]">
                                                    <div className="mb-3 flex items-center justify-center gap-2 text-sm font-bold text-primary">
                                                        <QrCode className="h-5 w-5" />
                                                        <span>{selectedProvider === 'fib' ? t('workspacePayments.fib') : t('workspacePayments.qicard')}</span>
                                                    </div>
                                                    <img
                                                        src={getWorkspacePaymentQrPath(selectedProvider)!}
                                                        alt={t('workspacePayments.qrAlt', {
                                                            provider: selectedProvider === 'fib'
                                                                ? t('workspacePayments.fib')
                                                                : t('workspacePayments.qicard')
                                                        })}
                                                        className="aspect-square w-full rounded-2xl object-contain"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="flex aspect-square w-full max-w-[20rem] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-background/70 p-6 text-center text-muted-foreground">
                                                    <QrCode className="h-11 w-11" />
                                                    <p className="mt-3 text-sm font-medium">
                                                        {t('workspacePayments.selectProvider')}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </section>

                                    <section className="flex min-h-[34rem] flex-col p-5 sm:p-7">
                                        <div className="space-y-1.5">
                                            <h3 className="text-xl font-bold text-foreground">
                                                {t('workspacePayments.paymentInstructions')}
                                            </h3>
                                            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                                                {t('workspacePayments.dialogDescription')}
                                            </p>
                                        </div>

                                        {selectedProvider ? (
                                            <>
                                                <dl className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3">
                                                    <div className={paymentSummaryCardClass}>
                                                        <dt className="text-[11px] font-semibold text-muted-foreground">{t('workspacePayments.amount')}</dt>
                                                        <dd className="mt-1 text-sm font-black tabular-nums text-foreground sm:text-base">
                                                            {formatWorkspacePaymentDecimal(configuration.subscriptionAmount, locale, 3)} {workspacePaymentCurrencyLabel}
                                                        </dd>
                                                    </div>
                                                    <div className={paymentSummaryCardClass}>
                                                        <dt className="text-[11px] font-semibold text-muted-foreground">{t('workspacePayments.gigabytes')}</dt>
                                                        <dd className="mt-1 text-sm font-black tabular-nums text-foreground sm:text-base">
                                                            {formatWorkspacePaymentDecimal(gbForPayment, locale, 6)} GB
                                                        </dd>
                                                    </div>
                                                </dl>

                                                {selectedProvider !== 'free' && (
                                                    <div className="mt-5 space-y-2">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <Label htmlFor="workspace-payment-account-holder-name">
                                                                {t('workspacePayments.accountHolderName')}
                                                            </Label>
                                                            <span className="text-xs font-semibold text-destructive">*</span>
                                                        </div>
                                                        <PaymentAccountHolderNameAutocomplete
                                                            id="workspace-payment-account-holder-name"
                                                            value={accountHolderName}
                                                            suggestions={savedAccountHolderNames}
                                                            onChange={(value) => setAccountHolderName(value.toUpperCase())}
                                                            onSelect={(name) => setAccountHolderName(
                                                                normalizeWorkspacePaymentAccountHolderName(name)
                                                            )}
                                                            onFocus={loadSavedAccountHolderNames}
                                                            onBlur={() => setAccountHolderName(normalizedAccountHolderName)}
                                                            placeholder={selectedProvider === 'fib'
                                                                ? t('workspacePayments.fibAccountHolderNameHint')
                                                                : t('workspacePayments.qiCardAccountHolderNameHint')}
                                                            isInvalid={isAccountHolderNameIncomplete}
                                                            inputClassName={cn(
                                                                isAccountHolderNameIncomplete
                                                                && 'border-destructive text-destructive focus-visible:border-destructive focus-visible:ring-destructive/30'
                                                            )}
                                                            required={true}
                                                            disabled={isSubmitting}
                                                        />
                                                        {isAccountHolderNameIncomplete && (
                                                            <p role="alert" aria-live="polite" className="text-xs font-medium text-destructive">
                                                                {t('workspacePayments.accountHolderNameThreeWordsRequired')}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}

                                                {submitError && (
                                                    <p role="alert" className="mt-5 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                                        {submitError}
                                                    </p>
                                                )}

                                                <div className="mt-6 space-y-2">
                                                    <PressAndHoldButton
                                                        onComplete={() => void handleSubmit()}
                                                        idleLabel={isConfirmationDelayActive
                                                            ? t('workspacePayments.completePaymentBeforeConfirm', {
                                                                seconds: confirmationDelaySeconds
                                                            })
                                                            : t('workspacePayments.holdToConfirm')}
                                                        holdingLabel={t('workspacePayments.keepHolding')}
                                                        loadingLabel={t('workspacePayments.submitting')}
                                                        isLoading={isSubmitting}
                                                        disabled={isConfirmationDelayActive || !canSubmitWorkspacePayment({
                                                            provider: selectedProvider,
                                                            accountHolderName: normalizedAccountHolderName,
                                                            isSubmitting,
                                                            hasWorkspacePendingTransaction,
                                                            pendingTransaction
                                                        })}
                                                        className={cn(
                                                            'h-[3.25rem] w-full rounded-2xl font-bold shadow-sm',
                                                            isConfirmationDelayActive && 'bg-muted text-muted-foreground shadow-none hover:bg-muted'
                                                        )}
                                                        onMouseEnter={() => setIsConfirmationHighlighted(true)}
                                                        onMouseLeave={() => setIsConfirmationHighlighted(false)}
                                                        onFocus={() => setIsConfirmationHighlighted(true)}
                                                        onBlur={() => setIsConfirmationHighlighted(false)}
                                                    />
                                                    <p className="text-center text-xs text-muted-foreground">
                                                        {t('workspacePayments.pendingMessage')}
                                                    </p>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex flex-1 items-center justify-center py-10 text-center">
                                                <div className="max-w-xs text-muted-foreground">
                                                    <CreditCard className="mx-auto h-9 w-9 text-primary/70" />
                                                    <p className="mt-3 text-sm leading-relaxed">
                                                        {t('workspacePayments.selectProvider')}
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        <div className="mt-6">
                                            <TransactionHistory
                                                transactions={paymentSummary?.transactions ?? []}
                                                locale={locale}
                                                iqdDisplayPreference={features.iqd_display_preference}
                                                t={t}
                                            />
                                        </div>
                                    </section>
                                </div>
                            )}

                            {(hasWorkspacePendingTransaction || !paymentEnabled) && (
                                <TransactionHistory
                                    transactions={paymentSummary?.transactions ?? []}
                                    locale={locale}
                                    iqdDisplayPreference={features.iqd_display_preference}
                                    t={t}
                                />
                            )}
                        </>
                    )}
                </div>

                <DialogFooter className="border-t border-border/60 bg-muted/[0.12] px-5 py-4 sm:px-8">
                    <Button allowViewer={true} variant="outline" onClick={() => setOpen(false)}>
                        {t('workspacePayments.close')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
