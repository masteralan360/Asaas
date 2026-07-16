import { supabase } from '@/auth/supabase'
import { normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import { WORKSPACE_PAYMENT_HOLD_DURATION_MS } from '@/lib/pressAndHold'

export const WORKSPACE_PAYMENT_CURRENCY = 'IQD' as const
export const OPEN_WORKSPACE_PAYMENT_DIALOG_EVENT = 'open-workspace-payment-dialog'
export { WORKSPACE_PAYMENT_HOLD_DURATION_MS }

export type WorkspacePaymentProvider = 'fib' | 'qicard' | 'free'
export type WorkspacePaymentStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'unknown'
export type WorkspacePaymentType = 'subscription' | 'usage' | 'unknown'
export type WorkspacePaymentAlertKind =
    | 'subscription_expired'
    | 'usage_exhausted'

export interface WorkspacePaymentConfiguration {
    id: string
    workspaceId: string
    subscriptionAmount: string
    currency: typeof WORKSPACE_PAYMENT_CURRENCY
    isPaymentEnabled: boolean
    usageEnabled: boolean
    gbPerPayment: string
    renewalDueAt: string | null
    usageStartDate: string | null
}

export interface WorkspacePaymentTransaction {
    id: string
    provider: WorkspacePaymentProvider
    amount: string
    currency: string
    gbAdded: string
    paymentType: WorkspacePaymentType
    status: WorkspacePaymentStatus
    expiresAt: string | null
    paidAt: string | null
    reviewNote: string | null
    createdAt: string
}

export interface WorkspacePaymentEligibility {
    subscriptionExpired: boolean
    usageExhausted: boolean
    usageRenewalDue: boolean
    alertReason: string | null
    paymentEnabled: boolean
}

export interface WorkspacePaymentSummary {
    workspaceId: string
    billingWorkspaceId: string
    workspaceName: string
    configuration: WorkspacePaymentConfiguration | null
    eligibility: WorkspacePaymentEligibility
    hasWorkspacePendingTransaction: boolean
    pendingTransaction: WorkspacePaymentTransaction | null
    transactions: WorkspacePaymentTransaction[]
}

type UnknownRecord = Record<string, unknown>

const SUPPORTED_PROVIDERS = new Set<WorkspacePaymentProvider>(['fib', 'qicard', 'free'])
const SUPPORTED_STATUSES = new Set<Exclude<WorkspacePaymentStatus, 'unknown'>>([
    'pending',
    'approved',
    'rejected',
    'expired'
])
const SUPPORTED_PAYMENT_TYPES = new Set<Exclude<WorkspacePaymentType, 'unknown'>>([
    'subscription',
    'usage'
])

let submitPaymentInFlight: Promise<WorkspacePaymentTransaction> | null = null

function isRecord(value: unknown): value is UnknownRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unwrapRpcJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value[0] ?? null
    }

    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as unknown
        } catch {
            return value
        }
    }

    return value
}

function getText(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback
}

function getNullableText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null
}

function getDecimalText(value: unknown): string {
    const raw = typeof value === 'string'
        ? value.trim()
        : typeof value === 'number' && Number.isFinite(value)
            ? Math.max(0, value).toLocaleString('en-US', {
                useGrouping: false,
                maximumFractionDigits: 20
            })
            : ''

    return /^\d+(?:\.\d+)?$/.test(raw) ? raw : '0'
}

export function formatWorkspacePaymentDecimal(
    value: string,
    locale: string,
    maximumFractionDigits: number
): string {
    const [rawWhole, rawFraction = ''] = getDecimalText(value).split('.')
    const whole = rawWhole.replace(/^0+(?=\d)/, '') || '0'
    const fraction = rawFraction
        .slice(0, Math.max(0, maximumFractionDigits))
        .replace(/0+$/, '')

    try {
        const integerFormatter = new Intl.NumberFormat(locale, {
            useGrouping: true,
            maximumFractionDigits: 0
        })
        const formattedWhole = integerFormatter.format(BigInt(whole))
        if (!fraction) return formattedWhole

        const decimalSeparator = new Intl.NumberFormat(locale, {
            minimumFractionDigits: 1
        }).formatToParts(1.1).find(({ type }) => type === 'decimal')?.value ?? '.'
        const digitFormatter = new Intl.NumberFormat(locale, {
            useGrouping: false,
            maximumFractionDigits: 0
        })
        const localizedFraction = Array.from(fraction, (digit) => (
            digitFormatter.format(Number(digit))
        )).join('')

        return `${formattedWhole}${decimalSeparator}${localizedFraction}`
    } catch {
        return fraction ? `${whole}.${fraction}` : whole
    }
}

function getBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback
}

function normalizeProvider(value: unknown): WorkspacePaymentProvider {
    return value === 'qicard' ? 'qicard' : 'fib'
}

function normalizeStatus(value: unknown): WorkspacePaymentStatus {
    return typeof value === 'string' && SUPPORTED_STATUSES.has(value as Exclude<WorkspacePaymentStatus, 'unknown'>)
        ? value as Exclude<WorkspacePaymentStatus, 'unknown'>
        : 'unknown'
}

function normalizePaymentType(value: unknown): WorkspacePaymentType {
    return typeof value === 'string' && SUPPORTED_PAYMENT_TYPES.has(value as Exclude<WorkspacePaymentType, 'unknown'>)
        ? value as Exclude<WorkspacePaymentType, 'unknown'>
        : 'unknown'
}

function normalizeConfiguration(value: unknown): WorkspacePaymentConfiguration | null {
    if (!isRecord(value)) return null

    return {
        id: getText(value.id),
        workspaceId: getText(value.workspace_id),
        subscriptionAmount: getDecimalText(value.subscription_amount),
        currency: WORKSPACE_PAYMENT_CURRENCY,
        isPaymentEnabled: getBoolean(value.is_payment_enabled),
        usageEnabled: getBoolean(value.usage_enabled),
        gbPerPayment: getDecimalText(value.gb_per_payment),
        renewalDueAt: getNullableText(value.renewal_due_at),
        usageStartDate: getNullableText(value.usage_start_date)
    }
}

export function normalizeWorkspacePaymentTransaction(value: unknown): WorkspacePaymentTransaction | null {
    if (!isRecord(value)) return null

    const id = getText(value.id)
    if (!id) return null

    return {
        id,
        provider: normalizeProvider(value.provider),
        amount: getDecimalText(value.amount),
        currency: getText(value.currency, WORKSPACE_PAYMENT_CURRENCY).toUpperCase(),
        gbAdded: getDecimalText(value.gb_added),
        paymentType: normalizePaymentType(value.payment_type),
        status: normalizeStatus(value.status),
        expiresAt: getNullableText(value.expires_at),
        paidAt: getNullableText(value.paid_at),
        reviewNote: getNullableText(value.review_note),
        createdAt: getText(value.created_at, new Date(0).toISOString())
    }
}

export function normalizeWorkspacePaymentSummary(value: unknown): WorkspacePaymentSummary {
    const unwrapped = unwrapRpcJson(value)
    if (!isRecord(unwrapped)) {
        throw new Error('Workspace payment summary is invalid')
    }

    const configuration = normalizeConfiguration(unwrapped.configuration)
    const rawEligibility = isRecord(unwrapped.eligibility) ? unwrapped.eligibility : {}
    const transactions = (Array.isArray(unwrapped.transactions) ? unwrapped.transactions : [])
        .map(normalizeWorkspacePaymentTransaction)
        .filter((transaction): transaction is WorkspacePaymentTransaction => Boolean(transaction))
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    const explicitPending = normalizeWorkspacePaymentTransaction(unwrapped.pending_transaction)
    const pendingTransaction = explicitPending?.status === 'pending'
        ? explicitPending
        : transactions.find((transaction) => transaction.status === 'pending') ?? null

    return {
        workspaceId: getText(unwrapped.workspace_id),
        billingWorkspaceId: getText(unwrapped.billing_workspace_id, getText(unwrapped.workspace_id)),
        workspaceName: getText(unwrapped.workspace_name),
        configuration,
        eligibility: {
            subscriptionExpired: getBoolean(rawEligibility.subscription_expired),
            usageExhausted: getBoolean(rawEligibility.usage_exhausted),
            usageRenewalDue: getBoolean(rawEligibility.usage_renewal_due),
            alertReason: getNullableText(rawEligibility.alert_reason),
            paymentEnabled: getBoolean(
                rawEligibility.payment_enabled,
                Boolean(configuration?.isPaymentEnabled)
            )
        },
        hasWorkspacePendingTransaction: getBoolean(
            unwrapped.has_workspace_pending_transaction,
            Boolean(pendingTransaction)
        ),
        pendingTransaction,
        transactions
    }
}

export function isWorkspacePaymentProvider(value: unknown): value is WorkspacePaymentProvider {
    return typeof value === 'string' && SUPPORTED_PROVIDERS.has(value as WorkspacePaymentProvider)
}

export function getWorkspacePaymentQrPath(provider: WorkspacePaymentProvider): string | null {
    if (provider === 'free') return null
    return provider === 'fib' ? '/atlas_fib_qr.svg' : '/atlas_qi_card_qr.svg'
}

export function openWorkspacePaymentDialog() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_PAYMENT_DIALOG_EVENT))
}

export function getWorkspacePaymentAlertKind(
    summary?: WorkspacePaymentSummary | null
): WorkspacePaymentAlertKind | null {
    if (!summary) return null

    if (summary.eligibility.usageExhausted || summary.eligibility.alertReason === 'usage_exhausted') {
        return 'usage_exhausted'
    }
    // Usage renewal now behaves like subscription expiry — the server maps
    // usage_renewal_due to subscription_expired in alert_reason.
    if (summary.eligibility.subscriptionExpired || summary.eligibility.alertReason === 'subscription_expired') {
        return 'subscription_expired'
    }
    if (summary.eligibility.usageRenewalDue || summary.eligibility.alertReason === 'usage_renewal_due') {
        return 'subscription_expired'
    }

    return null
}

export function shouldWorkspacePaymentLockAccess(summary?: WorkspacePaymentSummary | null): boolean {
    return getWorkspacePaymentAlertKind(summary) !== null
}

export function shouldApplyWorkspaceSubscriptionExpiry(_options: {
    hasUsageLimits: boolean
    summary?: WorkspacePaymentSummary | null
}): boolean {
    // Usage workspaces now behave like subscription workspaces — their
    // renewal_due_at expiry triggers the same locked/expired state.
    return true
}

export function hasWorkspacePaymentAccessStateUpdate(
    current: {
        lockedWorkspace: boolean
        subscriptionExpiresAt: string | null
    },
    incoming: {
        locked_workspace?: unknown
        subscription_expires_at?: unknown
    }
): boolean {
    const lockedChanged = typeof incoming.locked_workspace === 'boolean'
        && incoming.locked_workspace !== current.lockedWorkspace
    const hasExpiry = Object.prototype.hasOwnProperty.call(incoming, 'subscription_expires_at')
    const nextExpiry = incoming.subscription_expires_at === null
        || typeof incoming.subscription_expires_at === 'string'
        ? incoming.subscription_expires_at
        : current.subscriptionExpiresAt

    return lockedChanged || (hasExpiry && nextExpiry !== current.subscriptionExpiresAt)
}

export function hasNewlyApprovedWorkspacePayment(
    previousSummary: WorkspacePaymentSummary | null,
    nextSummary: WorkspacePaymentSummary | null
): boolean {
    if (!previousSummary || !nextSummary) return false

    const previousStatuses = new Map(
        previousSummary.transactions.map((transaction) => [transaction.id, transaction.status])
    )
    if (previousSummary.pendingTransaction) {
        previousStatuses.set(previousSummary.pendingTransaction.id, previousSummary.pendingTransaction.status)
    }

    return nextSummary.transactions.some((transaction) => (
        transaction.status === 'approved'
        && previousStatuses.get(transaction.id) === 'pending'
    ))
}

export function hasWorkspacePaymentAccessBeenRestored(
    previousSummary: WorkspacePaymentSummary | null,
    nextSummary: WorkspacePaymentSummary | null
): boolean {
    return Boolean(
        getWorkspacePaymentAlertKind(previousSummary)
        && !getWorkspacePaymentAlertKind(nextSummary)
    )
}

export function canSubmitWorkspacePayment(options: {
    provider: WorkspacePaymentProvider | null
    isSubmitting: boolean
    hasWorkspacePendingTransaction?: boolean
    pendingTransaction?: WorkspacePaymentTransaction | null
}) {
    return Boolean(
        options.provider
        && !options.isSubmitting
        && !options.hasWorkspacePendingTransaction
        && !options.pendingTransaction
    )
}

export async function getWorkspacePaymentSummary(): Promise<WorkspacePaymentSummary> {
    const result = await runSupabaseAction(
        'workspacePayments.getSummary',
        () => supabase.rpc('get_workspace_payment_summary'),
        { timeoutMs: 12_000, platform: 'all' }
    ) as { data: unknown; error?: unknown }

    if (result.error) {
        throw normalizeSupabaseActionError(result.error)
    }

    return normalizeWorkspacePaymentSummary(result.data)
}

async function performWorkspacePaymentSubmission(
    provider: WorkspacePaymentProvider
): Promise<WorkspacePaymentTransaction> {
    const result = await runSupabaseAction(
        'workspacePayments.submit',
        () => supabase.rpc('submit_workspace_payment', { p_provider: provider }),
        { timeoutMs: 12_000, platform: 'all' }
    ) as { data: unknown; error?: unknown }

    if (result.error) {
        throw normalizeSupabaseActionError(result.error)
    }

    const transaction = normalizeWorkspacePaymentTransaction(unwrapRpcJson(result.data))
    if (!transaction) {
        throw new Error('Workspace payment transaction is invalid')
    }

    return transaction
}

export function submitWorkspacePayment(
    provider: WorkspacePaymentProvider
): Promise<WorkspacePaymentTransaction> {
    if (!isWorkspacePaymentProvider(provider)) {
        return Promise.reject(new Error('Unsupported payment provider'))
    }

    if (submitPaymentInFlight) {
        return submitPaymentInFlight
    }

    const request = performWorkspacePaymentSubmission(provider)
    const guardedRequest = request.finally(() => {
        submitPaymentInFlight = null
    })
    submitPaymentInFlight = guardedRequest
    return guardedRequest
}

export const workspacePaymentTestInternals = {
    resetSubmissionGuard() {
        submitPaymentInFlight = null
    }
}
