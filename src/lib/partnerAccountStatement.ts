import type {
    Loan,
    LoanPayment,
    PaymentTransaction,
    PurchaseOrder,
    SalesOrder
} from '@/local-db'

type StatementOrder = SalesOrder | PurchaseOrder

export type PartnerAccountStatementPeriod = {
    type: 'today' | 'month' | 'lastMonth' | 'allTime' | 'custom'
    start?: string
    end?: string
}

/**
 * The source records needed to create a partner subledger. This deliberately
 * contains source data rather than stored balances: both the screen and the
 * printout must be calculated from the same auditable activity.
 */
export type PartnerAccountStatementData = {
    period: PartnerAccountStatementPeriod
    salesOrders: SalesOrder[]
    purchaseOrders: PurchaseOrder[]
    statementOrders?: StatementOrder[]
    loans?: Loan[]
    loanPayments?: LoanPayment[]
    linkedOrderCodes?: Record<string, string>
    settlementTransactions?: PaymentTransaction[]
}

export type PartnerAccountStatementEntryKind =
    | 'sales_order'
    | 'purchase_order'
    | 'incoming_payment'
    | 'outgoing_payment'
    | 'direct_transaction'
    | 'loan_disbursal'
    | 'loan_repayment'

export type PartnerAccountStatementEntryDescriptionKey =
    | 'salesOrder'
    | 'purchaseOrder'
    | 'paymentReceived'
    | 'paymentMade'
    | 'directReceipt'
    | 'directPayment'
    | 'orderLoanProvided'
    | 'orderLoanReceived'
    | 'loanProvided'
    | 'loanReceived'
    | 'loanRepaymentReceived'
    | 'loanRepaymentMade'
    | 'paymentReversal'
    | 'orderReturnRefund'
    | 'loanRepaymentRefund'
    | 'financingDownPaymentRefund'
    | 'fullSaleReturnRefund'
    | 'returnCredit'

export type PartnerAccountStatementEntrySource =
    | { recordType: 'order'; recordId: string }
    | { recordType: 'loan'; recordId: string; loanCategory: Loan['loanCategory'] }
    | { recordType: 'payment_transaction'; recordId: string }

export type PartnerAccountStatementEntry = {
    id: string
    date: string
    reference: string
    kind: PartnerAccountStatementEntryKind
    description: string
    descriptionKey?: PartnerAccountStatementEntryDescriptionKey
    note?: string | null
    /** A persisted return-reason code or custom return reason, localized only when displayed. */
    returnReason?: string | null
    currency: string
    /** Positive movements increase the amount due from the partner. */
    delta: number
    /** The underlying document, when this statement row originates from one. */
    source?: PartnerAccountStatementEntrySource
}

export type PartnerAccountStatementCurrencyLedger = {
    currency: string
    openingBalance: number
    debitTotal: number
    creditTotal: number
    closingBalance: number
    entries: Array<PartnerAccountStatementEntry & { runningBalance: number }>
}

function isSalesOrder(order: StatementOrder): order is SalesOrder {
    return 'customerId' in order
}

function eventDate(value: string | null | undefined) {
    const parsed = value ? new Date(value) : null
    return parsed && Number.isFinite(parsed.getTime()) ? parsed : null
}

function periodStart(period: PartnerAccountStatementPeriod) {
    return eventDate(period.start)
}

function periodEndExclusive(period: PartnerAccountStatementPeriod) {
    if (!period.end) return null
    const parsed = eventDate(period.end)
    if (!parsed) return null

    // Custom date pickers provide YYYY-MM-DD. Treat that end date as inclusive.
    if (/^\d{4}-\d{2}-\d{2}$/.test(period.end)) {
        parsed.setDate(parsed.getDate() + 1)
        return parsed
    }

    return new Date(parsed.getTime() + 1)
}

function isIncludedInPeriod(value: string, period: PartnerAccountStatementPeriod) {
    const date = eventDate(value)
    if (!date) return false
    const start = periodStart(period)
    const end = periodEndExclusive(period)
    return (!start || date >= start) && (!end || date < end)
}

function isBeforePeriod(value: string, period: PartnerAccountStatementPeriod) {
    const date = eventDate(value)
    const start = periodStart(period)
    return Boolean(date && start && date < start)
}

function compareEntries(left: PartnerAccountStatementEntry, right: PartnerAccountStatementEntry) {
    const dateDifference = new Date(left.date).getTime() - new Date(right.date).getTime()
    return dateDifference || left.reference.localeCompare(right.reference) || left.id.localeCompare(right.id)
}

function paymentKind(transaction: PaymentTransaction): PartnerAccountStatementEntryKind {
    if (transaction.sourceType === 'direct_transaction') return 'direct_transaction'
    return transaction.direction === 'incoming' ? 'incoming_payment' : 'outgoing_payment'
}

function paymentDescription(transaction: PaymentTransaction): {
    description: string
    descriptionKey: PartnerAccountStatementEntryDescriptionKey
} {
    if (transaction.sourceType === 'direct_transaction') {
        return transaction.direction === 'incoming'
            ? { description: 'Direct receipt', descriptionKey: 'directReceipt' }
            : { description: 'Direct payment', descriptionKey: 'directPayment' }
    }

    return transaction.direction === 'incoming'
        ? { description: 'Payment received', descriptionKey: 'paymentReceived' }
        : { description: 'Payment made', descriptionKey: 'paymentMade' }
}

function metadataText(metadata: PaymentTransaction['metadata'], key: string) {
    const value = metadata?.[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metadataFlag(metadata: PaymentTransaction['metadata'], key: string) {
    return metadata?.[key] === true
}

function getLegacyReturnReason(note: string | null | undefined) {
    const match = note?.trim().match(/^(?:Order|Full sale) return [a-z0-9-]+:\s*(.+)$/i)
        || note?.trim().match(/^Return Credit\s*\(\s*Reason:\s*(.+?)\s*\)$/i)
    return match?.[1]?.trim() || null
}

function isGeneratedReversalNote(note: string | null | undefined) {
    return /^Reversal of\s+.+$/i.test(note?.trim() || '')
}

function paymentStatementPresentation(transaction: PaymentTransaction): {
    description: string
    descriptionKey: PartnerAccountStatementEntryDescriptionKey
    note: string | null
    returnReason: string | null
} {
    const note = transaction.note?.trim() || null
    const returnReason = metadataText(transaction.metadata, 'returnReason') || getLegacyReturnReason(note)

    if (metadataFlag(transaction.metadata, 'loanRepaymentRefund')) {
        return { description: 'Loan repayment refund', descriptionKey: 'loanRepaymentRefund', note: null, returnReason }
    }
    if (metadataFlag(transaction.metadata, 'financingInitialPaymentRefund')) {
        return { description: 'Financing down payment refund', descriptionKey: 'financingDownPaymentRefund', note: null, returnReason }
    }
    if (metadataFlag(transaction.metadata, 'fullSaleReturn')) {
        return { description: 'Full sale return refund', descriptionKey: 'fullSaleReturnRefund', note: null, returnReason }
    }
    if (metadataText(transaction.metadata, 'orderReturnId') || /^Order return [a-z0-9-]+:/i.test(note || '')) {
        return { description: 'Order return refund', descriptionKey: 'orderReturnRefund', note: null, returnReason }
    }
    if (transaction.reversalOfTransactionId) {
        return {
            description: 'Payment reversal',
            descriptionKey: 'paymentReversal',
            note: isGeneratedReversalNote(note) ? null : note,
            returnReason: null
        }
    }

    return { ...paymentDescription(transaction), note, returnReason: null }
}

function loanPaymentStatementPresentation(
    payment: LoanPayment,
    lent: boolean
): {
    description: string
    descriptionKey: PartnerAccountStatementEntryDescriptionKey
    note: string | null
    returnReason: string | null
} {
    const returnReason = getLegacyReturnReason(payment.note)
    if (returnReason && /^Return Credit\b/i.test(payment.note?.trim() || '')) {
        return { description: 'Return credit', descriptionKey: 'returnCredit', note: null, returnReason }
    }

    return {
        description: lent ? 'Loan repayment received' : 'Loan repayment made',
        descriptionKey: lent ? 'loanRepaymentReceived' : 'loanRepaymentMade',
        note: payment.note?.trim() || null,
        returnReason: null
    }
}

function createOrderEntries(data: PartnerAccountStatementData): PartnerAccountStatementEntry[] {
    const sourceOrders = data.statementOrders || [...data.salesOrders, ...data.purchaseOrders]
    const loanIds = new Set((data.loans || []).map((loan) => loan.id))
    const entries: PartnerAccountStatementEntry[] = []

    for (const order of sourceOrders) {
        if (order.isDeleted || order.status === 'draft' || order.status === 'cancelled') continue
        // When an order created the loan, the loan is the accounting source of
        // truth. Do not post both rows into the partner account.
        if (order.linkedLoanId && loanIds.has(order.linkedLoanId)) continue
        const sales = isSalesOrder(order)
        entries.push({
            id: `${sales ? 'sales' : 'purchase'}-order:${order.id}`,
            date: order.createdAt,
            reference: order.orderNumber,
            kind: sales ? 'sales_order' : 'purchase_order',
            description: sales ? 'Sales order' : 'Purchase order',
            descriptionKey: sales ? 'salesOrder' : 'purchaseOrder',
            note: order.notes,
            currency: order.currency,
            delta: sales ? Math.abs(Number(order.total || 0)) : -Math.abs(Number(order.total || 0)),
            source: { recordType: 'order', recordId: order.id }
        })
    }

    return entries
}

function createPaymentEntries(transactions: PaymentTransaction[] = []): PartnerAccountStatementEntry[] {
    return transactions
        .filter((transaction) => !transaction.isDeleted)
        .map((transaction) => {
            const rawAmount = Number(transaction.amount || 0)
            const multiplier = transaction.direction === 'incoming' ? -1 : 1
            const presentation = paymentStatementPresentation(transaction)
            return {
                id: `payment:${transaction.id}`,
                date: transaction.paidAt || transaction.createdAt,
                reference: transaction.referenceLabel || transaction.sourceRecordId,
                kind: paymentKind(transaction),
                ...presentation,
                currency: transaction.currency,
                // Retain the stored sign so a reversal remains a visible audit row.
                delta: multiplier * rawAmount,
                source: transaction.sourceType === 'sales_order' || transaction.sourceType === 'purchase_order'
                    ? { recordType: 'order', recordId: transaction.sourceRecordId }
                    : { recordType: 'payment_transaction', recordId: transaction.id }
            }
        })
}

function createLoanEntries(data: PartnerAccountStatementData): PartnerAccountStatementEntry[] {
    const loans = data.loans || []
    const payments = data.loanPayments || []
    const loanById = new Map(loans.map((loan) => [loan.id, loan]))
    const entries: PartnerAccountStatementEntry[] = []

    for (const loan of loans) {
        if (loan.isDeleted || loan.status === 'cancelled') continue
        const lent = loan.direction !== 'borrowed'
        const linkedOrderCode = loan.orderId ? data.linkedOrderCodes?.[loan.orderId]?.trim() : undefined
        const reference = linkedOrderCode ? `${linkedOrderCode} · ${loan.loanNo}` : loan.loanNo
        entries.push({
            id: `loan:${loan.id}`,
            date: loan.createdAt,
            reference,
            kind: 'loan_disbursal',
            description: loan.source === 'order'
                ? lent ? 'Order loan provided' : 'Order loan received'
                : lent ? 'Loan provided' : 'Loan received',
            descriptionKey: loan.source === 'order'
                ? lent ? 'orderLoanProvided' : 'orderLoanReceived'
                : lent ? 'loanProvided' : 'loanReceived',
            currency: loan.settlementCurrency,
            delta: lent ? Math.abs(Number(loan.principalAmount || 0)) : -Math.abs(Number(loan.principalAmount || 0)),
            source: { recordType: 'loan', recordId: loan.id, loanCategory: loan.loanCategory }
        })
    }

    for (const payment of payments) {
        const loan = loanById.get(payment.loanId)
        if (!loan || payment.isDeleted || loan.isDeleted || loan.status === 'cancelled') continue
        const lent = loan.direction !== 'borrowed'
        const linkedOrderCode = loan.orderId ? data.linkedOrderCodes?.[loan.orderId]?.trim() : undefined
        const reference = linkedOrderCode ? `${linkedOrderCode} · ${loan.loanNo}` : loan.loanNo
        const presentation = loanPaymentStatementPresentation(payment, lent)
        entries.push({
            id: `loan-payment:${payment.id}`,
            date: payment.paidAt || payment.createdAt,
            reference,
            kind: 'loan_repayment',
            ...presentation,
            currency: loan.settlementCurrency,
            delta: lent ? -Math.abs(Number(payment.amount || 0)) : Math.abs(Number(payment.amount || 0)),
            source: { recordType: 'loan', recordId: loan.id, loanCategory: loan.loanCategory }
        })
    }

    return entries
}

/**
 * Builds an auditable per-currency partner ledger. A positive balance means
 * the partner owes the workspace; a negative balance means the workspace owes
 * the partner. Currencies are intentionally never converted in this record.
 */
export function buildPartnerAccountStatementLedger(data: PartnerAccountStatementData): PartnerAccountStatementCurrencyLedger[] {
    const entries = [
        ...createOrderEntries(data),
        ...createPaymentEntries(data.settlementTransactions),
        ...createLoanEntries(data)
    ].filter((entry) => Math.abs(entry.delta) > 0.000001)

    const entriesByCurrency = new Map<string, PartnerAccountStatementEntry[]>()
    for (const entry of entries) {
        const key = entry.currency.toLowerCase()
        const current = entriesByCurrency.get(key) || []
        current.push(entry)
        entriesByCurrency.set(key, current)
    }

    return Array.from(entriesByCurrency.entries())
        .map(([currency, currencyEntries]) => {
            const sortedEntries = currencyEntries.slice().sort(compareEntries)
            const openingBalance = sortedEntries
                .filter((entry) => isBeforePeriod(entry.date, data.period))
                .reduce((sum, entry) => sum + entry.delta, 0)
            let runningBalance = openingBalance
            let debitTotal = 0
            let creditTotal = 0
            const periodEntries = sortedEntries
                .filter((entry) => isIncludedInPeriod(entry.date, data.period))
                .map((entry) => {
                    runningBalance += entry.delta
                    if (entry.delta > 0) debitTotal += entry.delta
                    else creditTotal += Math.abs(entry.delta)
                    return { ...entry, runningBalance }
                })

            return {
                currency,
                openingBalance,
                debitTotal,
                creditTotal,
                closingBalance: runningBalance,
                entries: periodEntries
            }
        })
        .filter((ledger) => ledger.entries.length > 0 || Math.abs(ledger.openingBalance) > 0.000001)
        .sort((left, right) => left.currency.localeCompare(right.currency))
}

export function getPartnerAccountStatementDescriptionTranslationKey(
    entry: Pick<PartnerAccountStatementEntry, 'descriptionKey'>
) {
    return entry.descriptionKey
        ? `businessPartners.accountStatement.descriptions.${entry.descriptionKey}`
        : null
}
