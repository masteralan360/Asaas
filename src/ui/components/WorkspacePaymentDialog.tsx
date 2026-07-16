import { useEffect, useMemo, useRef, useState } from 'react'
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
    WalletCards,
    XCircle
} from 'lucide-react'
import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'
import { Button } from '@/ui/components/button'
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
    hasNewlyApprovedWorkspacePayment,
    hasWorkspacePaymentAccessBeenRestored,
    submitWorkspacePayment,
    type WorkspacePaymentAlertKind,
    type WorkspacePaymentProvider,
    type WorkspacePaymentStatus,
    type WorkspacePaymentSummary,
    type WorkspacePaymentTransaction
} from '@/lib/workspacePayments'

const PENDING_PAYMENT_POLL_INTERVAL_MS = 10_000
const PAYMENT_SUMMARY_REFRESH_INTERVAL_MS = 60_000

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
    t
}: {
    transactions: WorkspacePaymentTransaction[]
    locale: string
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
                                            {formatWorkspacePaymentDecimal(transaction.amount, locale, 3)} {WORKSPACE_PAYMENT_CURRENCY}
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
    label
}: {
    provider: WorkspacePaymentProvider
    selected: boolean
    onSelect: (provider: WorkspacePaymentProvider) => void
    label: string
}) {
    const isFree = provider === 'free'
    return (
        <button
            type="button"
            onClick={() => onSelect(provider)}
            aria-pressed={selected}
            className={cn(
                'flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                    ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary/20'
                    : 'border-border/70 bg-background hover:border-primary/40 hover:bg-accent/40'
            )}
        >
            <span className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl',
                selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
            )}>
                {isFree ? <Gift className="h-5 w-5" /> : <WalletCards className="h-5 w-5" />}
            </span>
            <span>
                <span className="block text-sm font-bold text-foreground">{label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                    {isFree ? 'No payment required' : WORKSPACE_PAYMENT_CURRENCY}
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

    if (!isAuthenticated || isDemoMode) return null

    const locale = i18n.language || 'en'
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

    const handleSubmit = async () => {
        if (submissionGuardRef.current || !canSubmitWorkspacePayment({
            provider: selectedProvider,
            isSubmitting,
            hasWorkspacePendingTransaction,
            pendingTransaction
        }) || !selectedProvider || !paymentEnabled) {
            return
        }

        submissionGuardRef.current = true
        setIsSubmitting(true)
        setSubmitError(null)

        try {
            const transaction = await submitWorkspacePayment(selectedProvider)
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
            }
        }}>
            <DialogContent className="max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto rounded-2xl p-0">
                <div className="border-b border-border/60 bg-gradient-to-br from-primary/10 via-background to-amber-500/5 px-5 py-5 sm:px-7">
                    <DialogHeader className="pe-10 text-start">
                        <div className="flex items-start gap-3">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
                                <CreditCard className="h-6 w-6" />
                            </span>
                            <div className="space-y-1.5">
                                <DialogTitle className="text-xl">{alertCopy.title}</DialogTitle>
                                <DialogDescription className="leading-relaxed">
                                    {alertCopy.description}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
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
                                <>
                                    <section className="space-y-3">
                                        <h3 className="text-sm font-bold text-foreground">
                                            {t('workspacePayments.selectProvider')}
                                        </h3>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {isFreeRenewal ? (
                                                <ProviderButton
                                                    provider="free"
                                                    selected={selectedProvider === 'free'}
                                                    onSelect={setSelectedProvider}
                                                    label={t('workspacePayments.freeRenewal', 'Free Renewal')}
                                                />
                                            ) : (
                                                <>
                                                    <ProviderButton
                                                        provider="fib"
                                                        selected={selectedProvider === 'fib'}
                                                        onSelect={setSelectedProvider}
                                                        label={t('workspacePayments.fib')}
                                                    />
                                                    <ProviderButton
                                                        provider="qicard"
                                                        selected={selectedProvider === 'qicard'}
                                                        onSelect={setSelectedProvider}
                                                        label={t('workspacePayments.qicard')}
                                                    />
                                                </>
                                            )}
                                        </div>
                                    </section>

                                    {selectedProvider && (
                                        <section className="grid gap-5 rounded-2xl border border-border/70 bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:p-5">
                                            <div className="space-y-4">
                                                <div>
                                                    <h3 className="font-bold text-foreground">
                                                        {t('workspacePayments.paymentInstructions')}
                                                    </h3>
                                                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                                        {t('workspacePayments.dialogDescription')}
                                                    </p>
                                                </div>
                                                <dl className="grid grid-cols-3 gap-2">
                                                    <div className="rounded-xl bg-background p-3 ring-1 ring-border/60">
                                                        <dt className="text-[11px] font-semibold text-muted-foreground">{t('workspacePayments.amount')}</dt>
                                                        <dd className="mt-1 text-sm font-black tabular-nums text-foreground">
                                                            {formatWorkspacePaymentDecimal(configuration.subscriptionAmount, locale, 3)}
                                                        </dd>
                                                    </div>
                                                    <div className="rounded-xl bg-background p-3 ring-1 ring-border/60">
                                                        <dt className="text-[11px] font-semibold text-muted-foreground">{t('workspacePayments.currency')}</dt>
                                                        <dd className="mt-1 text-sm font-black text-foreground">{WORKSPACE_PAYMENT_CURRENCY}</dd>
                                                    </div>
                                                    <div className="rounded-xl bg-background p-3 ring-1 ring-border/60">
                                                        <dt className="text-[11px] font-semibold text-muted-foreground">{t('workspacePayments.gigabytes')}</dt>
                                                        <dd className="mt-1 text-sm font-black tabular-nums text-foreground">
                                                            {formatWorkspacePaymentDecimal(gbForPayment, locale, 6)} GB
                                                        </dd>
                                                    </div>
                                                </dl>

                                                {submitError && (
                                                    <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                                        {submitError}
                                                    </p>
                                                )}

                                                <div className="space-y-2">
                                                    <PressAndHoldButton
                                                        onComplete={() => void handleSubmit()}
                                                        idleLabel={t('workspacePayments.holdToConfirm')}
                                                        holdingLabel={t('workspacePayments.keepHolding')}
                                                        loadingLabel={t('workspacePayments.submitting')}
                                                        isLoading={isSubmitting}
                                                        disabled={!canSubmitWorkspacePayment({
                                                            provider: selectedProvider,
                                                            isSubmitting,
                                                            hasWorkspacePendingTransaction,
                                                            pendingTransaction
                                                        })}
                                                        className="h-12 w-full rounded-xl font-bold"
                                                    />
                                                    <p className="text-center text-xs text-muted-foreground">
                                                        {t('workspacePayments.pendingMessage')}
                                                    </p>
                                                </div>
                                            </div>

                                            {selectedProvider !== 'free' && (
                                                <div className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-background p-4 shadow-sm">
                                                    <QrCode className="mb-3 h-5 w-5 text-primary" />
                                                    <img
                                                        src={getWorkspacePaymentQrPath(selectedProvider)!}
                                                        alt={t('workspacePayments.qrAlt', {
                                                            provider: selectedProvider === 'fib'
                                                                ? t('workspacePayments.fib')
                                                                : t('workspacePayments.qicard')
                                                        })}
                                                        className="aspect-square w-full max-w-44 rounded-xl bg-white object-contain p-2"
                                                    />
                                                </div>
                                            )}
                                        </section>
                                    )}
                                </>
                            )}

                            <TransactionHistory
                                transactions={paymentSummary?.transactions ?? []}
                                locale={locale}
                                t={t}
                            />
                        </>
                    )}
                </div>

                <DialogFooter className="border-t border-border/60 px-5 py-4 sm:px-7">
                    <Button allowViewer={true} variant="outline" onClick={() => setOpen(false)}>
                        {t('workspacePayments.close')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
