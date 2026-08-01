import { useTranslation } from 'react-i18next'

import type {
    IQDDisplayPreference,
    Loan,
    LoanPayment,
    PaymentTransaction,
    PurchaseOrder,
    SalesOrder
} from '@/local-db'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import type { CustomTemplateComponentPosition } from '@/lib/pdfPreviewStore'
import { platformService } from '@/services/platformService'
import { MovableOrderPrintBlock } from '@/ui/components/MovableComponentPrint'

export type PartnerOrderItemsPrintPeriod = {
    type: 'today' | 'month' | 'lastMonth' | 'allTime' | 'custom'
    start?: string
    end?: string
}

export type PartnerOrderItemsPrintRowKind =
    | 'item'
    | 'discount'
    | 'tax'
    | 'adjustment'
    | 'order_note'
    | 'order_total'
    | 'loan_repayment'
    | 'direct_transaction'

export type PartnerOrderItemsPrintRow = {
    id: string
    orderId: string
    orderCode: string
    orderDate: string
    kind: PartnerOrderItemsPrintRowKind
    description: string
    note?: string | null
    unit?: string | null
    quantity?: number | null
    unitPrice?: number | null
    amount?: number | null
    paidAmount?: number | null
    remainingAmount?: number | null
    currency: string
    adjustmentType?: 'addition' | 'deduction'
    /** True when the source order has posted returns (partial or full); such rows are flagged in the print. */
    isReturned?: boolean
    /** True when the source order is only partially paid; its hierarchy line is drawn in blue. */
    isPartialPaid?: boolean
    /** True when the source order is unpaid; its hierarchy line is drawn in yellow. */
    isUnpaid?: boolean
    /** 'sales' or 'purchase' when the row comes from an order section (used to tag merged-timeline blocks). */
    sectionKind?: 'sales' | 'purchase'
    /** Direction of a money movement row (loan repayment or direct transaction). */
    direction?: 'incoming' | 'outgoing'
    paymentMethod?: string | null
}

export type PartnerOrderItemsPrintCurrencySummary = {
    currency: string
    orderCount: number
    itemSubtotal: number
    discount: number
    tax: number
    additions: number
    deductions: number
    total: number
    paidAmount: number
    remainingAmount: number
}

export type PartnerOrderItemsPrintSection = {
    rows: PartnerOrderItemsPrintRow[]
    summaries: PartnerOrderItemsPrintCurrencySummary[]
}

export type PartnerOrderItemsPrintMoneyMovementSummary = {
    currency: string
    count: number
    /** Total of incoming money movements in this currency. */
    received: number
    /** Total of outgoing money movements in this currency. */
    paid: number
}

export type PartnerOrderItemsPrintCurrencyBalance = {
    currency: string
    amount: number
}

export type PartnerOrderItemsPrintBalanceSummary = {
    /** Canonical current amount the partner owes the workspace. */
    receivable: PartnerOrderItemsPrintCurrencyBalance[]
    /** Canonical current amount the workspace owes the partner. */
    payable: PartnerOrderItemsPrintCurrencyBalance[]
}

/**
 * The whole statement rendered as one chronological timeline: sales orders,
 * purchase orders, loan/installment repayments and direct transactions are
 * interleaved by their own dates. The per-type summaries stay at the end of
 * the document.
 */
export type PartnerOrderItemsPrintTimeline = {
    rows: PartnerOrderItemsPrintRow[]
    salesSummary: PartnerOrderItemsPrintCurrencySummary[]
    purchaseSummary: PartnerOrderItemsPrintCurrencySummary[]
    loanRepaymentSummary: PartnerOrderItemsPrintMoneyMovementSummary[]
    directTransactionSummary: PartnerOrderItemsPrintMoneyMovementSummary[]
}

export type PartnerOrderItemsPrintData = {
    workspace?: {
        phone?: string
        address?: string
        email?: string
    }
    partner: {
        name: string
        contactName?: string
        email?: string
        phone?: string
        address?: string
        city?: string
        country?: string
    }
    period: PartnerOrderItemsPrintPeriod
    generatedAt: string
    /** Uses the same balance calculation as the Partner Profile, independent of the selected activity period. */
    balanceSummary: PartnerOrderItemsPrintBalanceSummary
    salesOrders: SalesOrder[]
    purchaseOrders: PurchaseOrder[]
    /** All partner orders, including records outside the selected activity period, used to reconcile payment transactions. */
    statementOrders?: Array<SalesOrder | PurchaseOrder>
    /** All loans linked to the partner, including loans originated before the selected activity period. */
    loans?: Loan[]
    /** All partner loan/installment repayments, used to calculate opening and closing balances for the selected period. */
    loanPayments?: LoanPayment[]
    /** Source order codes for linked loans, including orders that predate the selected activity period. */
    linkedOrderCodes?: Record<string, string>
    /** All order and direct-payment transactions for this partner, including reversals needed to calculate active amounts. */
    settlementTransactions?: PaymentTransaction[]
    /** Partner direct transactions, already period-filtered by paidAt. */
    directTransactions?: PaymentTransaction[]
}

interface PartnerOrderItemsPrintTemplateProps {
    workspaceName?: string | null
    workspaceDescription?: string | null
    printLang: string
    data: PartnerOrderItemsPrintData
    iqdPreference?: IQDDisplayPreference
    logoUrl?: string | null
    /** Shows "Paid: …" inline on each order total row (no dedicated column). */
    showPaidAmount?: boolean
    /** Shows "Remaining: …" inline on each order total row (no dedicated column). */
    showRemainingAmount?: boolean
    /** Shows the chronological order, loan, and direct settlement activity section. */
    showSettlementActivity?: boolean
    componentPositions?: Record<string, CustomTemplateComponentPosition>
    editableComponents?: boolean
    onComponentPositionChange?: (key: string, position: CustomTemplateComponentPosition) => void
}

type StatementOrder = SalesOrder | PurchaseOrder
type StatementKind = 'sales' | 'purchase'

export const PARTNER_ORDER_ITEMS_MOVABLE_COMPONENT_KEYS = {
    workspaceName: 'partnerOrderItemsWorkspaceName'
} as const

export type PartnerOrderItemsPrintRowHierarchy = 'single' | 'first' | 'middle' | 'last'

/** One atomic statement page block: a single order with all of its rows. */
export type PartnerOrderItemsPrintOrderBlock = {
    orderId: string
    orderCode: string
    orderDate: string
    rows: PartnerOrderItemsPrintRow[]
    isReturned: boolean
    isPartialPaid: boolean
    isUnpaid: boolean
}

function isRTL(lang: string) {
    const baseLang = (lang || 'en').split('-')[0]
    return baseLang === 'ar' || baseLang === 'ku'
}

function resolveLogoSrc(logoUrl?: string | null) {
    if (!logoUrl) return null
    return logoUrl.startsWith('http') ? logoUrl : platformService.convertFileSrc(logoUrl)
}

function resolvePeriodLabel(
    period: PartnerOrderItemsPrintPeriod,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (period.start || period.end) {
        return t('businessPartners.fromDateToDate', {
            defaultValue: 'from {{start}} to {{end}}',
            start: period.start ? formatDate(period.start) : '-',
            end: period.end ? formatDate(period.end) : '-'
        })
    }

    return t('businessPartners.orderItemsPrint.allTime', { defaultValue: 'All Time' })
}

function isSalesOrder(_order: StatementOrder, kind: StatementKind): _order is SalesOrder {
    return kind === 'sales'
}

function createSummary(currency: string): PartnerOrderItemsPrintCurrencySummary {
    return {
        currency,
        orderCount: 0,
        itemSubtotal: 0,
        discount: 0,
        tax: 0,
        additions: 0,
        deductions: 0,
        total: 0,
        paidAmount: 0,
        remainingAmount: 0
    }
}

/**
 * Produces a flat, auditable statement: every line retains its source order
 * code while commercial terms remain separate rows instead of being invented
 * as allocations across products.
 */
export function buildPartnerOrderItemsPrintSection(
    orders: StatementOrder[],
    kind: StatementKind
): PartnerOrderItemsPrintSection {
    const summaries = new Map<string, PartnerOrderItemsPrintCurrencySummary>()
    const rows: PartnerOrderItemsPrintRow[] = []
    const sortedOrders = orders
        .filter((order) => !order.isDeleted && order.status !== 'cancelled')
        .slice()
        .sort((left, right) => {
            const dateDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
            return dateDifference || left.orderNumber.localeCompare(right.orderNumber)
        })

    for (const order of sortedOrders) {
        const isReturned = isSalesOrder(order, kind) && (order.returnStatus === 'partial' || order.returnStatus === 'full')
        const isPartialPaid = order.paymentStatus === 'partial'
        const isUnpaid = order.paymentStatus === 'unpaid'

        const summary = summaries.get(order.currency) || createSummary(order.currency)
        summaries.set(order.currency, summary)
        summary.orderCount += 1
        summary.itemSubtotal += order.subtotal
        summary.discount += order.discount
        summary.total += order.total
        summary.paidAmount += order.paidAmount
        summary.remainingAmount += order.balanceAmount

        if (isSalesOrder(order, kind)) {
            summary.tax += order.tax
        }

        for (const item of order.items) {
            rows.push({
                id: `${order.id}:item:${item.id}`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'item',
                description: item.productName,
                note: item.note,
                unit: item.unit,
                quantity: item.quantity,
                unitPrice: item.convertedUnitPrice,
                amount: item.lineTotal,
                currency: order.currency,
                sectionKind: kind,
                isReturned,
                isPartialPaid,
                isUnpaid
            })
        }

        if (order.discount > 0) {
            rows.push({
                id: `${order.id}:discount`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'discount',
                description: 'discount',
                amount: -order.discount,
                currency: order.currency,
                sectionKind: kind,
                isReturned,
                isPartialPaid,
                isUnpaid
            })
        }

        if (isSalesOrder(order, kind) && order.tax > 0) {
            rows.push({
                id: `${order.id}:tax`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'tax',
                description: 'tax',
                amount: order.tax,
                currency: order.currency,
                sectionKind: kind,
                isReturned,
                isPartialPaid,
                isUnpaid
            })
        }

        for (const adjustment of order.orderAdjustments || []) {
            const amount = adjustment.type === 'deduction'
                ? -adjustment.convertedAmount
                : adjustment.convertedAmount
            if (!Number.isFinite(amount) || amount === 0) continue

            const summary = summaries.get(order.currency)!
            if (adjustment.type === 'addition') summary.additions += adjustment.convertedAmount
            else summary.deductions += adjustment.convertedAmount

            rows.push({
                id: `${order.id}:adjustment:${adjustment.id}`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'adjustment',
                description: adjustment.name,
                amount,
                currency: order.currency,
                adjustmentType: adjustment.type,
                sectionKind: kind,
                isReturned,
                isPartialPaid,
                isUnpaid
            })
        }

        if (order.notes?.trim()) {
            rows.push({
                id: `${order.id}:note`,
                orderId: order.id,
                orderCode: order.orderNumber,
                orderDate: order.createdAt,
                kind: 'order_note',
                description: 'order_note',
                note: order.notes.trim(),
                currency: order.currency,
                sectionKind: kind,
                isReturned,
                isPartialPaid,
                isUnpaid
            })
        }

        rows.push({
            id: `${order.id}:total`,
            orderId: order.id,
            orderCode: order.orderNumber,
            orderDate: order.createdAt,
            kind: 'order_total',
            description: 'order_total',
            amount: order.total,
            paidAmount: order.paidAmount,
            remainingAmount: order.balanceAmount,
            currency: order.currency,
            sectionKind: kind,
            isReturned,
            isPartialPaid,
            isUnpaid
        })
    }

    return {
        rows,
        summaries: Array.from(summaries.values()).sort((left, right) => left.currency.localeCompare(right.currency))
    }
}

/**
 * Groups a section's flat rows into one block per source record (rows are
 * already emitted contiguously per order by the builders; each loan repayment
 * and direct transaction is its own single-row block). Each block becomes its
 * own table on the printed statement, and the page packer treats it as an
 * atomic unit that must not be split across pages.
 */
export function buildPartnerOrderItemsPrintOrderBlocks(rows: PartnerOrderItemsPrintRow[]): PartnerOrderItemsPrintOrderBlock[] {
    const blocks: PartnerOrderItemsPrintOrderBlock[] = []

    for (const row of rows) {
        const lastBlock = blocks[blocks.length - 1]
        if (lastBlock && lastBlock.orderId === row.orderId) {
            lastBlock.rows.push(row)
        } else {
            blocks.push({
                orderId: row.orderId,
                orderCode: row.orderCode,
                orderDate: row.orderDate,
                rows: [row],
                isReturned: row.isReturned || false,
                isPartialPaid: row.isPartialPaid || false,
                isUnpaid: row.isUnpaid || false
            })
        }
    }

    return blocks
}

function compareStatementRows(left: PartnerOrderItemsPrintRow, right: PartnerOrderItemsPrintRow) {
    const dateDifference = new Date(left.orderDate).getTime() - new Date(right.orderDate).getTime()
    return dateDifference
        || left.orderCode.localeCompare(right.orderCode)
        || left.id.localeCompare(right.id)
}

/**
 * Converts partner loan/installment repayments and direct transactions into
 * statement rows. Each repayment keeps the loan number and its own `paidAt`;
 * the direction comes from the loan itself (repayments on lent loans are
 * incoming, on borrowed loans outgoing). Reversed direct transactions and
 * payments whose loan is not provided are skipped.
 */
export function buildPartnerOrderItemsPrintMoneyMovements(
    loans: Loan[],
    loanPayments: LoanPayment[],
    directTransactions: PaymentTransaction[]
): PartnerOrderItemsPrintRow[] {
    const loanById = new Map(loans.map((loan) => [loan.id, loan]))
    const rows: PartnerOrderItemsPrintRow[] = []

    for (const payment of loanPayments) {
        if (payment.isDeleted) continue
        const loan = loanById.get(payment.loanId)
        if (!loan) continue

        rows.push({
            id: `loan-payment:${payment.id}`,
            orderId: `loan-payment:${payment.id}`,
            orderCode: loan.loanNo,
            orderDate: payment.paidAt || payment.createdAt,
            kind: 'loan_repayment',
            description: 'loan_repayment',
            note: payment.note,
            amount: payment.amount,
            currency: loan.settlementCurrency,
            direction: loan.direction === 'lent' ? 'incoming' : 'outgoing',
            paymentMethod: payment.paymentMethod
        })
    }

    for (const transaction of directTransactions) {
        if (transaction.isDeleted || transaction.reversalOfTransactionId) continue

        rows.push({
            id: `direct-transaction:${transaction.id}`,
            orderId: `direct-transaction:${transaction.id}`,
            orderCode: transaction.referenceLabel || transaction.note || '',
            orderDate: transaction.paidAt || transaction.createdAt,
            kind: 'direct_transaction',
            description: 'direct_transaction',
            note: transaction.note,
            amount: transaction.amount,
            currency: transaction.currency,
            direction: transaction.direction,
            paymentMethod: transaction.paymentMethod
        })
    }

    return rows.sort(compareStatementRows)
}

function buildMoneyMovementSummaries(rows: PartnerOrderItemsPrintRow[]): PartnerOrderItemsPrintMoneyMovementSummary[] {
    const summaries = new Map<string, PartnerOrderItemsPrintMoneyMovementSummary>()

    for (const row of rows) {
        const summary = summaries.get(row.currency) ?? { currency: row.currency, count: 0, received: 0, paid: 0 }
        summaries.set(row.currency, summary)
        summary.count += 1
        const amount = row.amount ?? 0
        if (row.direction === 'incoming') summary.received += amount
        else summary.paid += amount
    }

    return Array.from(summaries.values()).sort((left, right) => left.currency.localeCompare(right.currency))
}

export type PartnerOrderItemsPrintLoanPeriodActivity =
    | 'new_loan'
    | 'opening_balance'
    | 'partially_repaid'
    | 'fully_repaid'

export type PartnerOrderItemsPrintLoanPortfolioRow = {
    loan: Loan
    linkedOrderCode?: string
    currency: string
    direction: 'lent' | 'borrowed'
    periodActivity: PartnerOrderItemsPrintLoanPeriodActivity[]
    openingBalance: number
    repayments: number
    closingBalance: number
}

function isWithinStatementPeriod(value: string, period: PartnerOrderItemsPrintPeriod) {
    if (period.start && value < period.start) return false
    if (period.end && value >= period.end) return false
    return true
}

/**
 * Builds one reconciliation row per loan instead of interleaving repayments
 * with order rows. Repayments after the selected end date are added back so a
 * historical statement shows the balance as it stood at that period's end.
 */
export function buildPartnerOrderItemsPrintLoanPortfolio(
    loans: Loan[],
    loanPayments: LoanPayment[],
    period: PartnerOrderItemsPrintPeriod,
    linkedOrderCodes: Record<string, string> = {}
): PartnerOrderItemsPrintLoanPortfolioRow[] {
    const paymentsByLoan = new Map<string, LoanPayment[]>()
    for (const payment of loanPayments) {
        if (payment.isDeleted) continue
        const payments = paymentsByLoan.get(payment.loanId) || []
        payments.push(payment)
        paymentsByLoan.set(payment.loanId, payments)
    }

    return loans
        .filter((loan) => !loan.isDeleted && loan.status !== 'cancelled')
        .map((loan) => {
            const linkedOrderCode = loan.source === 'order' && loan.orderId
                ? linkedOrderCodes[loan.orderId]?.trim() || undefined
                : undefined
            const payments = paymentsByLoan.get(loan.id) || []
            const periodPayments = payments.filter((payment) => isWithinStatementPeriod(payment.paidAt || payment.createdAt, period))
            const paymentsAfterPeriod = period.end
                ? payments.filter((payment) => (payment.paidAt || payment.createdAt) >= period.end!)
                : []
            const paymentTotal = periodPayments.reduce((sum, payment) => sum + payment.amount, 0)
            // The statement intentionally presents one applied amount so the
            // partner sees the direct Paid / Remaining relationship.
            const repayments = paymentTotal
            const closingBalance = Math.max(0, loan.balanceAmount + paymentsAfterPeriod.reduce((sum, payment) => sum + payment.amount, 0))
            const originatedInPeriod = isWithinStatementPeriod(loan.createdAt, period)
            const existedByPeriodEnd = !period.end || loan.createdAt < period.end
            const openingBalance = originatedInPeriod ? 0 : Math.max(0, closingBalance + paymentTotal)
            const periodActivity: PartnerOrderItemsPrintLoanPeriodActivity[] = []
            if (originatedInPeriod) periodActivity.push('new_loan')
            if (paymentTotal > 0) {
                periodActivity.push(closingBalance === 0 ? 'fully_repaid' : 'partially_repaid')
            } else if (openingBalance > 0) {
                periodActivity.push('opening_balance')
            }

            return {
                loan,
                linkedOrderCode,
                currency: loan.settlementCurrency,
                direction: loan.direction === 'borrowed' ? 'borrowed' as const : 'lent' as const,
                periodActivity,
                openingBalance,
                repayments,
                closingBalance,
                include: existedByPeriodEnd && (originatedInPeriod || paymentTotal > 0 || closingBalance > 0)
            }
        })
        .filter((row) => row.include)
        .sort((left, right) => {
            const dateDifference = new Date(left.loan.createdAt).getTime() - new Date(right.loan.createdAt).getTime()
            return dateDifference || left.loan.loanNo.localeCompare(right.loan.loanNo)
        })
        .map(({ include: _include, ...row }) => row)
}

export type PartnerOrderItemsPrintSettlementActivityKind =
    | 'order_payment'
    | 'direct_transaction'
    | 'loan_opened'
    | 'opening_loan_balance'
    | 'loan_repayment'
    | 'full_loan_settlement'

export type PartnerOrderItemsPrintSettlementActivity = {
    id: string
    date: string
    kind: PartnerOrderItemsPrintSettlementActivityKind
    reference: string
    direction?: 'incoming' | 'outgoing'
    amount?: number
    currency: string
    balanceAfter?: number | null
    paymentMethod?: string | null
    loanSource?: Loan['source']
    note?: string | null
}

function isOrderPaymentTransaction(transaction: PaymentTransaction) {
    return transaction.sourceType === 'sales_order' || transaction.sourceType === 'purchase_order'
}

/** Mirrors the payment transaction module: reversals reduce their source
 * transaction, while reversed rows themselves are not printed as activity. */
function getActiveSettlementTransactions(transactions: PaymentTransaction[]) {
    const reversalAmounts = new Map<string, number>()
    for (const transaction of transactions) {
        if (transaction.isDeleted || !transaction.reversalOfTransactionId) continue
        reversalAmounts.set(
            transaction.reversalOfTransactionId,
            (reversalAmounts.get(transaction.reversalOfTransactionId) || 0) + Math.abs(Number(transaction.amount || 0))
        )
    }

    return transactions
        .filter((transaction) => !transaction.isDeleted && !transaction.reversalOfTransactionId)
        .map((transaction) => ({
            ...transaction,
            amount: Math.max(0, Number(transaction.amount || 0) - (reversalAmounts.get(transaction.id) || 0))
        }))
        .filter((transaction) => transaction.amount > 0.000001)
}

function loanReference(loan: Loan, linkedOrderCodes: Record<string, string>) {
    const orderCode = loan.source === 'order' && loan.orderId
        ? linkedOrderCodes[loan.orderId]?.trim()
        : undefined
    return orderCode ? `${orderCode} · ${loan.loanNo}` : loan.loanNo
}

/**
 * Creates one chronological, auditable activity stream for order payments,
 * direct transactions, and loans. Loan balances are reconstructed at each
 * event so the partner sees the remaining balance immediately after it.
 */
export function buildPartnerOrderItemsPrintSettlementActivities(
    orders: StatementOrder[],
    loans: Loan[],
    loanPayments: LoanPayment[],
    transactions: PaymentTransaction[],
    period: PartnerOrderItemsPrintPeriod,
    linkedOrderCodes: Record<string, string> = {}
): PartnerOrderItemsPrintSettlementActivity[] {
    const activities: PartnerOrderItemsPrintSettlementActivity[] = []
    const ordersById = new Map(orders
        .filter((order) => !order.isDeleted && order.status !== 'cancelled')
        .map((order) => [order.id, order]))
    const activeTransactions = getActiveSettlementTransactions(transactions)
    const orderPaymentsByOrderId = new Map<string, PaymentTransaction[]>()

    for (const transaction of activeTransactions) {
        if (!isOrderPaymentTransaction(transaction) || !ordersById.has(transaction.sourceRecordId)) continue
        const payments = orderPaymentsByOrderId.get(transaction.sourceRecordId) || []
        payments.push(transaction)
        orderPaymentsByOrderId.set(transaction.sourceRecordId, payments)
    }

    for (const [orderId, payments] of orderPaymentsByOrderId) {
        const order = ordersById.get(orderId)
        if (!order) continue
        const sortedPayments = payments.slice().sort((left, right) => {
            const dateDifference = new Date(left.paidAt || left.createdAt).getTime() - new Date(right.paidAt || right.createdAt).getTime()
            return dateDifference || left.id.localeCompare(right.id)
        })

        for (const [index, transaction] of sortedPayments.entries()) {
            const date = transaction.paidAt || transaction.createdAt
            if (!isWithinStatementPeriod(date, period)) continue
            const laterPayments = sortedPayments.slice(index + 1)
            const balanceAfter = Math.max(0, order.balanceAmount + laterPayments.reduce((sum, payment) => sum + payment.amount, 0))
            activities.push({
                id: `order-payment:${transaction.id}`,
                date,
                kind: 'order_payment',
                reference: order.orderNumber,
                direction: transaction.direction,
                amount: transaction.amount,
                currency: transaction.currency,
                balanceAfter,
                paymentMethod: transaction.paymentMethod,
                note: transaction.note
            })
        }
    }

    for (const transaction of activeTransactions) {
        if (transaction.sourceType !== 'direct_transaction') continue
        const date = transaction.paidAt || transaction.createdAt
        if (!isWithinStatementPeriod(date, period)) continue
        activities.push({
            id: `direct-transaction:${transaction.id}`,
            date,
            kind: 'direct_transaction',
            reference: transaction.referenceLabel || transaction.note || transaction.id,
            direction: transaction.direction,
            amount: transaction.amount,
            currency: transaction.currency,
            balanceAfter: null,
            paymentMethod: transaction.paymentMethod,
            note: transaction.note
        })
    }

    const paymentsByLoan = new Map<string, LoanPayment[]>()
    for (const payment of loanPayments) {
        if (payment.isDeleted) continue
        const payments = paymentsByLoan.get(payment.loanId) || []
        payments.push(payment)
        paymentsByLoan.set(payment.loanId, payments)
    }

    for (const loan of loans.filter((loan) => !loan.isDeleted && loan.status !== 'cancelled')) {
        const payments = (paymentsByLoan.get(loan.id) || []).slice().sort((left, right) => {
            const dateDifference = new Date(left.paidAt || left.createdAt).getTime() - new Date(right.paidAt || right.createdAt).getTime()
            return dateDifference || left.id.localeCompare(right.id)
        })
        const periodPayments = payments.filter((payment) => isWithinStatementPeriod(payment.paidAt || payment.createdAt, period))
        const paymentsAfterPeriod = period.end
            ? payments.filter((payment) => (payment.paidAt || payment.createdAt) >= period.end!)
            : []
        const closingBalance = Math.max(0, loan.balanceAmount + paymentsAfterPeriod.reduce((sum, payment) => sum + payment.amount, 0))
        const originatedInPeriod = isWithinStatementPeriod(loan.createdAt, period)
        const existedByPeriodEnd = !period.end || loan.createdAt < period.end
        const openingBalance = originatedInPeriod
            ? 0
            : Math.max(0, closingBalance + periodPayments.reduce((sum, payment) => sum + payment.amount, 0))
        const reference = loanReference(loan, linkedOrderCodes)
        const loanDirection = loan.direction === 'borrowed' ? 'borrowed' as const : 'lent' as const

        if (!existedByPeriodEnd) continue

        if (originatedInPeriod) {
            activities.push({
                id: `loan-opened:${loan.id}`,
                date: loan.createdAt,
                kind: 'loan_opened',
                reference,
                direction: loanDirection === 'lent' ? 'outgoing' : 'incoming',
                amount: loan.principalAmount,
                currency: loan.settlementCurrency,
                balanceAfter: loan.principalAmount,
                loanSource: loan.source
            })
        } else if (period.start && openingBalance > 0) {
            activities.push({
                id: `loan-opening:${loan.id}:${period.start}`,
                date: period.start,
                kind: 'opening_loan_balance',
                reference,
                currency: loan.settlementCurrency,
                balanceAfter: openingBalance
            })
        }

        let runningBalance = originatedInPeriod ? loan.principalAmount : openingBalance
        for (const payment of periodPayments) {
            runningBalance = Math.max(0, runningBalance - payment.amount)
            activities.push({
                id: `loan-payment:${payment.id}`,
                date: payment.paidAt || payment.createdAt,
                kind: runningBalance === 0 ? 'full_loan_settlement' : 'loan_repayment',
                reference,
                direction: loanDirection === 'lent' ? 'incoming' : 'outgoing',
                amount: payment.amount,
                currency: loan.settlementCurrency,
                balanceAfter: runningBalance,
                paymentMethod: payment.paymentMethod,
                note: payment.note
            })
        }
    }

    const kindOrder: Record<PartnerOrderItemsPrintSettlementActivityKind, number> = {
        opening_loan_balance: 0,
        loan_opened: 1,
        order_payment: 2,
        loan_repayment: 3,
        full_loan_settlement: 4,
        direct_transaction: 5
    }
    return activities.sort((left, right) => {
        const dateDifference = new Date(left.date).getTime() - new Date(right.date).getTime()
        return dateDifference || kindOrder[left.kind] - kindOrder[right.kind] || left.id.localeCompare(right.id)
    })
}

/**
 * Builds the statement's single chronological timeline: sales and purchase
 * order blocks plus loan/installment repayments and direct transactions are
 * interleaved by their own dates, while the per-type currency summaries are
 * kept separate so they can be printed at the end of the document.
 */
export function buildPartnerOrderItemsPrintTimeline(
    salesOrders: StatementOrder[],
    purchaseOrders: StatementOrder[],
    loans: Loan[],
    loanPayments: LoanPayment[],
    directTransactions: PaymentTransaction[]
): PartnerOrderItemsPrintTimeline {
    const salesSection = buildPartnerOrderItemsPrintSection(salesOrders, 'sales')
    const purchaseSection = buildPartnerOrderItemsPrintSection(purchaseOrders, 'purchase')
    const movements = buildPartnerOrderItemsPrintMoneyMovements(loans, loanPayments, directTransactions)

    return {
        rows: [...salesSection.rows, ...purchaseSection.rows, ...movements].sort(compareStatementRows),
        salesSummary: salesSection.summaries,
        purchaseSummary: purchaseSection.summaries,
        loanRepaymentSummary: buildMoneyMovementSummaries(
            movements.filter((row) => row.kind === 'loan_repayment')
        ),
        directTransactionSummary: buildMoneyMovementSummaries(
            movements.filter((row) => row.kind === 'direct_transaction')
        )
    }
}

/**
 * Describes each consecutive row's place inside its source order. Keeping this
 * based on orderId (instead of merely the displayed code) prevents unrelated
 * orders from being visually joined if their codes ever overlap.
 */
export function getPartnerOrderItemsPrintRowHierarchy(
    rows: PartnerOrderItemsPrintRow[],
    rowIndex: number
): PartnerOrderItemsPrintRowHierarchy {
    const row = rows[rowIndex]
    if (!row) return 'single'

    const hasPreviousOrderRow = rows[rowIndex - 1]?.orderId === row.orderId
    const hasNextOrderRow = rows[rowIndex + 1]?.orderId === row.orderId

    if (!hasPreviousOrderRow && !hasNextOrderRow) return 'single'
    if (!hasPreviousOrderRow) return 'first'
    if (!hasNextOrderRow) return 'last'
    return 'middle'
}

function OrderHierarchyMarker({
    position,
    returned = false,
    partialPaid = false,
    unpaid = false,
    forceLine = false,
    lineColor
}: {
    position: PartnerOrderItemsPrintRowHierarchy
    returned?: boolean
    partialPaid?: boolean
    unpaid?: boolean
    /** Draws the connector even for single-row blocks (used by money movement rows). */
    forceLine?: boolean
    /** Overrides the status-derived color (used to color money movements by direction). */
    lineColor?: string
}) {
    if (position === 'single' && !forceLine) return null

    const verticalPosition = position === 'single' || position === 'middle'
        ? 'inset-y-0'
        : position === 'first'
            ? 'top-1/2 bottom-0'
            : 'top-0 bottom-1/2'
    const topTurn = position === 'single' || position === 'first' ? 'top-1/2' : null
    const bottomTurn = position === 'single' || position === 'last' ? 'bottom-1/2' : null
    // Matches the payment-status colors used in the Orders page.
    const resolvedLineColor = lineColor ?? (returned ? 'bg-rose-600' : partialPaid ? 'bg-sky-600' : unpaid ? 'bg-amber-600' : 'bg-emerald-600')

    return (
        <span className="pointer-events-none absolute inset-y-0 -start-4 w-3" aria-hidden="true">
            <span className={`absolute start-0 w-px ${resolvedLineColor} ${verticalPosition}`} />
            {topTurn ? <span className={`absolute start-0 h-px w-2.5 ${resolvedLineColor} ${topTurn}`} /> : null}
            {bottomTurn ? <span className={`absolute start-0 h-px w-2.5 ${resolvedLineColor} ${bottomTurn}`} /> : null}
        </span>
    )
}

function statementRowLabel(
    row: PartnerOrderItemsPrintRow,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (row.kind === 'discount') return t('businessPartners.orderItemsPrint.discount', { defaultValue: 'Discount' })
    if (row.kind === 'tax') return t('businessPartners.orderItemsPrint.tax', { defaultValue: 'Tax' })
    if (row.kind === 'order_note') return t('businessPartners.orderItemsPrint.orderNote', { defaultValue: 'Order note' })
    if (row.kind === 'order_total') return t('businessPartners.orderItemsPrint.orderTotal', { defaultValue: 'Order total' })
    return row.description
}

function statementRowNote(
    row: PartnerOrderItemsPrintRow,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (row.kind !== 'adjustment') return row.note?.trim() || '—'
    return row.adjustmentType === 'deduction'
        ? t('businessPartners.orderItemsPrint.deduction', { defaultValue: 'Deduction' })
        : t('businessPartners.orderItemsPrint.addition', { defaultValue: 'Addition' })
}

function formatQuantity(quantity?: number | null) {
    if (quantity == null) return '—'
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(quantity)
}

function CurrencyBalanceList({
    balances,
    iqdPreference
}: {
    balances: PartnerOrderItemsPrintCurrencyBalance[]
    iqdPreference: IQDDisplayPreference
}) {
    const visibleBalances = balances.filter((balance) => Math.abs(balance.amount) > 0.000001)
    if (visibleBalances.length === 0) return <strong>0</strong>

    return (
        <span className="flex flex-col gap-0.5">
            {visibleBalances
                .slice()
                .sort((left, right) => left.currency.localeCompare(right.currency))
                .map((balance) => <strong key={balance.currency}>{formatCurrency(balance.amount, balance.currency, iqdPreference)}</strong>)}
        </span>
    )
}

type PartnerOrderItemsPrintOrderSummary = Pick<
    PartnerOrderItemsPrintCurrencySummary,
    'currency' | 'orderCount' | 'total' | 'paidAmount' | 'remainingAmount'
>

function buildPartnerOrderItemsPrintOrderSummaries(
    salesSummaries: PartnerOrderItemsPrintCurrencySummary[],
    purchaseSummaries: PartnerOrderItemsPrintCurrencySummary[]
): PartnerOrderItemsPrintOrderSummary[] {
    const summaries = new Map<string, PartnerOrderItemsPrintOrderSummary>()

    for (const summary of [...salesSummaries, ...purchaseSummaries]) {
        const existing = summaries.get(summary.currency) || {
            currency: summary.currency,
            orderCount: 0,
            total: 0,
            paidAmount: 0,
            remainingAmount: 0
        }
        existing.orderCount += summary.orderCount
        existing.total += summary.total
        existing.paidAmount += summary.paidAmount
        existing.remainingAmount += summary.remainingAmount
        summaries.set(summary.currency, existing)
    }

    return Array.from(summaries.values()).sort((left, right) => left.currency.localeCompare(right.currency))
}

function OrderActivitySummary({
    summaries,
    t,
    iqdPreference
}: {
    summaries: PartnerOrderItemsPrintOrderSummary[]
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    if (summaries.length === 0) return null

    return (
        <section className="mt-3 rounded border border-slate-300 bg-slate-50 px-2 py-2 text-[9px]" data-pdf-keep-together data-order-items-order-summary>
            <div className="mb-1 font-bold">{t('businessPartners.orderItemsPrint.orderSummary', { defaultValue: 'Order Summary' })}</div>
            {summaries.map((summary, index) => (
                <div key={summary.currency}>
                    {index > 0 ? <hr className="my-1.5 border-slate-300" /> : null}
                    <div className="flex items-center justify-between gap-2 text-[8px]">
                        <strong>{summary.currency.toUpperCase()}</strong>
                        <span>{t('businessPartners.orderItemsPrint.numberOfOrders', { defaultValue: 'Number of orders' })}: <strong>{summary.orderCount}</strong></span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-2 border-t border-slate-300 pt-1 text-[10px] font-bold">
                        <span>{t('businessPartners.orderItemsPrint.totalValue', { defaultValue: 'Total value' })}: <strong>{formatCurrency(summary.total, summary.currency, iqdPreference)}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.paidAmount', { defaultValue: 'Paid amount' })}: <strong>{formatCurrency(summary.paidAmount, summary.currency, iqdPreference)}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.remaining', { defaultValue: 'Remaining' })}: <strong>{formatCurrency(summary.remainingAmount, summary.currency, iqdPreference)}</strong></span>
                    </div>
                </div>
            ))}
        </section>
    )
}

function CurrentBalanceSummary({
    summary,
    partnerName,
    workspaceName,
    t,
    iqdPreference
}: {
    summary: PartnerOrderItemsPrintBalanceSummary
    partnerName: string
    workspaceName: string
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    return (
        <section className="mt-3 rounded border-2 border-slate-600 bg-slate-50 px-3 py-2 text-[9px]" data-pdf-keep-together data-order-items-balance-summary>
            <div className="mb-2 font-bold">{t('businessPartners.orderItemsPrint.currentBalance', { defaultValue: 'Current Balance' })}</div>
            <div className="grid grid-cols-2 gap-3">
                <div className="border-e border-slate-300 pe-3">
                    <div className="font-bold">{t('businessPartners.orderItemsPrint.partnerOwesWorkspace', {
                        defaultValue: '{{partner}} owes {{workspace}}',
                        partner: partnerName,
                        workspace: workspaceName
                    })}</div>
                    <div className="text-[8px]">{t('businessPartners.receivable', { defaultValue: 'Receivable' })}</div>
                    <div className="mt-1 text-[11px] font-bold"><CurrencyBalanceList balances={summary.receivable} iqdPreference={iqdPreference} /></div>
                </div>
                <div>
                    <div className="font-bold">{t('businessPartners.orderItemsPrint.workspaceOwesPartner', {
                        defaultValue: '{{workspace}} owes {{partner}}',
                        partner: partnerName,
                        workspace: workspaceName
                    })}</div>
                    <div className="text-[8px]">{t('businessPartners.payable', { defaultValue: 'Payable' })}</div>
                    <div className="mt-1 text-[11px] font-bold"><CurrencyBalanceList balances={summary.payable} iqdPreference={iqdPreference} /></div>
                </div>
            </div>
        </section>
    )
}

function loanPeriodActivityLabel(
    activity: PartnerOrderItemsPrintLoanPeriodActivity,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (activity === 'new_loan') {
        return t('businessPartners.orderItemsPrint.newLoan', { defaultValue: 'New Loan' })
    }
    if (activity === 'opening_balance') {
        return t('businessPartners.orderItemsPrint.openingBalanceActivity', { defaultValue: 'Opening Balance' })
    }
    if (activity === 'partially_repaid') {
        return t('businessPartners.orderItemsPrint.partiallyRepaid', { defaultValue: 'Partially Repaid' })
    }
    return t('businessPartners.orderItemsPrint.fullyRepaid', { defaultValue: 'Fully Repaid' })
}

export function LoanPortfolio({
    loans,
    loanPayments,
    linkedOrderCodes,
    period,
    partnerName,
    workspaceName,
    t,
    iqdPreference
}: {
    loans: Loan[]
    loanPayments: LoanPayment[]
    linkedOrderCodes?: Record<string, string>
    period: PartnerOrderItemsPrintPeriod
    partnerName: string
    workspaceName: string
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    const rows = buildPartnerOrderItemsPrintLoanPortfolio(loans, loanPayments, period, linkedOrderCodes)
    if (rows.length === 0) return null

    return (
        <section className="mt-5" data-order-items-loan-portfolio>
            <div className="mb-2 flex items-center justify-between border-b-2 border-slate-700 pb-1">
                <h2 className="text-sm font-bold">{t('businessPartners.loans', { defaultValue: 'Loans' })}</h2>
                <span className="text-[9px]">{rows.length} {t('businessPartners.orderItemsPrint.entries', { defaultValue: 'Entries' })}</span>
            </div>
            <table className="w-full border-collapse text-[8px] leading-[1.2]">
                <thead>
                    <tr className="bg-[#dfead3]">
                        <th className="w-[17%] border border-slate-400 p-1 text-start">{t('loans.loanNo', { defaultValue: 'Loan No.' })}</th>
                        <th className="w-[15%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.periodActivity', { defaultValue: 'Period Activity' })}</th>
                        <th className="w-[15%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.direction', { defaultValue: 'Direction' })}</th>
                        <th className="w-[13%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.openingBalance', { defaultValue: 'Opening' })}</th>
                        <th className="w-[13%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.paid', { defaultValue: 'Paid' })}</th>
                        <th className="w-[13%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.remaining', { defaultValue: 'Remaining' })}</th>
                        <th className="w-[14%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.note', { defaultValue: 'Note' })}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const directionLabel = row.direction === 'lent'
                            ? t('businessPartners.orderItemsPrint.partnerOwesWorkspace', {
                                defaultValue: '{{partner}} owes {{workspace}}',
                                partner: partnerName,
                                workspace: workspaceName
                            })
                            : t('businessPartners.orderItemsPrint.workspaceOwesPartner', {
                                defaultValue: '{{workspace}} owes {{partner}}',
                                partner: partnerName,
                                workspace: workspaceName
                            })
                        const note = row.loan.source === 'order'
                            ? t('businessPartners.orderItemsPrint.orderLinkedLoanCreatedAt', {
                                defaultValue: 'This order-linked loan was created on {{date}}.',
                                date: formatDateTime(row.loan.createdAt)
                            })
                            : t('businessPartners.orderItemsPrint.loanCreatedAt', {
                                defaultValue: 'This loan was created on {{date}}.',
                                date: formatDateTime(row.loan.createdAt)
                            })

                        return (
                            <tr key={row.loan.id} data-pdf-keep-together>
                                <td className="border border-slate-300 p-1 align-top">
                                    <div className="font-bold">{row.linkedOrderCode ? `${row.linkedOrderCode} · ${row.loan.loanNo}` : row.loan.loanNo}</div>
                                    <div className="text-[7px]">{row.loan.source === 'order'
                                        ? t('businessPartners.orderItemsPrint.orderLinkedLoan', { defaultValue: 'Order-linked loan' })
                                        : formatDate(row.loan.createdAt)}</div>
                                </td>
                                <td className="border border-slate-300 p-1 align-top text-[7px]">{row.periodActivity.map((activity) => loanPeriodActivityLabel(activity, t)).join(' · ')}</td>
                                <td className="border border-slate-300 p-1 align-top">{directionLabel}</td>
                                <td className="border border-slate-300 p-1 text-end">{formatCurrency(row.openingBalance, row.currency, iqdPreference)}</td>
                                <td className="border border-slate-300 p-1 text-end">{formatCurrency(row.repayments, row.currency, iqdPreference)}</td>
                                <td className="border border-slate-300 p-1 text-end font-bold">{formatCurrency(row.closingBalance, row.currency, iqdPreference)}</td>
                                <td className="border border-slate-300 p-1 text-[7px] leading-snug">{note}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </section>
    )
}

function settlementActivityLabel(
    kind: PartnerOrderItemsPrintSettlementActivityKind,
    t: (key: string, options?: Record<string, unknown>) => string
) {
    if (kind === 'order_payment') return t('businessPartners.orderItemsPrint.orderPayment', { defaultValue: 'Order Payment' })
    if (kind === 'loan_opened') return t('businessPartners.orderItemsPrint.loanOpened', { defaultValue: 'Loan Opened' })
    if (kind === 'opening_loan_balance') return t('businessPartners.orderItemsPrint.openingLoanBalance', { defaultValue: 'Opening Loan Balance' })
    if (kind === 'loan_repayment') return t('businessPartners.orderItemsPrint.loanRepayment', { defaultValue: 'Loan Repayment' })
    if (kind === 'full_loan_settlement') return t('businessPartners.orderItemsPrint.fullLoanSettlement', { defaultValue: 'Full Loan Settlement' })
    return t('businessPartners.orderItemsPrint.directTransaction', { defaultValue: 'Direct Transaction' })
}

function SettlementActivitySection({
    orders,
    loans,
    loanPayments,
    transactions,
    period,
    linkedOrderCodes,
    t,
    iqdPreference
}: {
    orders: StatementOrder[]
    loans: Loan[]
    loanPayments: LoanPayment[]
    transactions: PaymentTransaction[]
    period: PartnerOrderItemsPrintPeriod
    linkedOrderCodes?: Record<string, string>
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    const rows = buildPartnerOrderItemsPrintSettlementActivities(
        orders,
        loans,
        loanPayments,
        transactions,
        period,
        linkedOrderCodes
    )
    if (rows.length === 0) return null

    return (
        <section className="mt-5" data-order-items-settlement-activity>
            <div className="mb-2 flex items-center justify-between border-b-2 border-slate-700 pb-1">
                <h2 className="text-sm font-bold">{t('businessPartners.orderItemsPrint.settlementActivity', { defaultValue: 'Partner Settlement Activity' })}</h2>
                <span className="text-[9px]">{rows.length} {t('businessPartners.orderItemsPrint.entries', { defaultValue: 'Entries' })}</span>
            </div>
            <table className="w-full border-collapse text-[8px] leading-[1.2]">
                <thead>
                    <tr className="bg-[#dfead3]">
                        <th className="w-[14%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.date', { defaultValue: 'Date' })}</th>
                        <th className="w-[18%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.activity', { defaultValue: 'Activity' })}</th>
                        <th className="w-[20%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.reference', { defaultValue: 'Reference' })}</th>
                        <th className="w-[14%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.amount', { defaultValue: 'Amount' })}</th>
                        <th className="w-[17%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.balanceAfter', { defaultValue: 'Balance After' })}</th>
                        <th className="w-[17%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.note', { defaultValue: 'Note' })}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const flowLabel = row.direction === 'incoming'
                            ? t('businessPartners.orderItemsPrint.received', { defaultValue: 'Received' })
                            : row.direction === 'outgoing'
                                ? t('businessPartners.orderItemsPrint.paid', { defaultValue: 'Paid' })
                                : null
                        const methodLabel = row.paymentMethod
                            ? t(`pos.${row.paymentMethod}`, { defaultValue: row.paymentMethod })
                            : null
                        const generatedNote = row.kind === 'opening_loan_balance'
                            ? t('businessPartners.orderItemsPrint.carriedForward', { defaultValue: 'Carried forward from the previous period.' })
                            : row.kind === 'loan_opened'
                                ? row.loanSource === 'order'
                                    ? t('businessPartners.orderItemsPrint.orderLinkedLoanCreatedAt', {
                                        defaultValue: 'This order-linked loan was created on {{date}}.',
                                        date: formatDateTime(row.date)
                                    })
                                    : t('businessPartners.orderItemsPrint.loanCreatedAt', {
                                        defaultValue: 'This loan was created on {{date}}.',
                                        date: formatDateTime(row.date)
                                    })
                            : row.kind === 'full_loan_settlement'
                                ? t('businessPartners.orderItemsPrint.loanFullyRepaid', { defaultValue: 'Loan fully repaid.' })
                                : row.kind === 'order_payment' && row.balanceAfter === 0
                                    ? t('businessPartners.orderItemsPrint.orderPaidInFull', { defaultValue: 'Order paid in full.' })
                                    : null
                        const note = [methodLabel, row.note?.trim(), generatedNote].filter(Boolean).join(' · ')

                        return (
                            <tr key={row.id} data-pdf-keep-together>
                                <td className="border border-slate-300 p-1 align-top whitespace-nowrap">{formatDateTime(row.date)}</td>
                                <td className="border border-slate-300 p-1 align-top">
                                    <div className="font-semibold">{settlementActivityLabel(row.kind, t)}</div>
                                    {flowLabel ? <div className="text-[7px]">{flowLabel}</div> : null}
                                </td>
                                <td className="border border-slate-300 p-1 align-top font-semibold">{row.reference}</td>
                                <td className="border border-slate-300 p-1 text-end align-top whitespace-nowrap font-semibold">
                                    {row.amount == null ? '—' : `${row.direction === 'incoming' ? '+' : row.direction === 'outgoing' ? '−' : ''}${formatCurrency(row.amount, row.currency, iqdPreference)}`}
                                </td>
                                <td className="border border-slate-300 p-1 text-end align-top whitespace-nowrap font-bold">{row.balanceAfter == null ? '—' : formatCurrency(row.balanceAfter, row.currency, iqdPreference)}</td>
                                <td className="border border-slate-300 p-1 text-[7px] leading-snug">{note || '—'}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </section>
    )
}

export function StatementSummary({
    summaries,
    kind,
    t,
    iqdPreference
}: {
    summaries: PartnerOrderItemsPrintCurrencySummary[]
    kind: StatementKind
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    if (summaries.length === 0) return null

    return (
        <div className="mt-2 space-y-2" data-pdf-keep-together data-order-items-section-summary>
            {summaries.map((summary) => (
                <div key={summary.currency} className="rounded border border-slate-300 bg-slate-50 px-2 py-2 text-[9px]">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
                        <span>{t('businessPartners.orderItemsPrint.currency', { defaultValue: 'Currency' })}: <strong>{summary.currency.toUpperCase()}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.orders', { defaultValue: 'Orders' })}: <strong>{summary.orderCount}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.itemsSubtotal', { defaultValue: 'Items subtotal' })}: <strong>{formatCurrency(summary.itemSubtotal, summary.currency, iqdPreference)}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.discount', { defaultValue: 'Discount' })}: <strong>-{formatCurrency(summary.discount, summary.currency, iqdPreference)}</strong></span>
                        {kind === 'sales' ? <span>{t('businessPartners.orderItemsPrint.tax', { defaultValue: 'Tax' })}: <strong>+{formatCurrency(summary.tax, summary.currency, iqdPreference)}</strong></span> : null}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 border-t-2 border-slate-400 pt-2 text-[10px] font-bold" data-order-items-summary-balances>
                        <span>{t('businessPartners.orderItemsPrint.total', { defaultValue: 'Total' })}: <strong>{formatCurrency(summary.total, summary.currency, iqdPreference)}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.paid', { defaultValue: 'Paid' })}: <strong>{formatCurrency(summary.paidAmount, summary.currency, iqdPreference)}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.remaining', { defaultValue: 'Remaining' })}: <strong>{formatCurrency(summary.remainingAmount, summary.currency, iqdPreference)}</strong></span>
                    </div>
                </div>
            ))}
        </div>
    )
}

type UnifiedCurrencySummary = {
    currency: string
    orderCount: number
    itemSubtotal: number
    discount: number
    tax: number
    total: number
    paidAmount: number
    remainingAmount: number
}

function mergeAllSummaries(
    salesSummaries: PartnerOrderItemsPrintCurrencySummary[],
    purchaseSummaries: PartnerOrderItemsPrintCurrencySummary[],
    loanRepaymentSummaries: PartnerOrderItemsPrintMoneyMovementSummary[],
    directTransactionSummaries: PartnerOrderItemsPrintMoneyMovementSummary[]
): UnifiedCurrencySummary[] {
    const merged = new Map<string, UnifiedCurrencySummary>()

    const getOrCreate = (currency: string): UnifiedCurrencySummary => {
        const existing = merged.get(currency)
        if (existing) return existing
        const entry: UnifiedCurrencySummary = {
            currency,
            orderCount: 0,
            itemSubtotal: 0,
            discount: 0,
            tax: 0,
            total: 0,
            paidAmount: 0,
            remainingAmount: 0
        }
        merged.set(currency, entry)
        return entry
    }

    for (const s of salesSummaries) {
        const entry = getOrCreate(s.currency)
        entry.orderCount += s.orderCount
        entry.itemSubtotal += s.itemSubtotal
        entry.discount += s.discount
        entry.tax += s.tax
        entry.total += s.total
        entry.paidAmount += s.paidAmount
        entry.remainingAmount += s.remainingAmount
    }

    for (const s of purchaseSummaries) {
        const entry = getOrCreate(s.currency)
        entry.orderCount += s.orderCount
        entry.itemSubtotal += s.itemSubtotal
        entry.discount += s.discount
        entry.tax += s.tax
        entry.total += s.total
        entry.paidAmount += s.paidAmount
        entry.remainingAmount += s.remainingAmount
    }

    for (const s of loanRepaymentSummaries) {
        const entry = getOrCreate(s.currency)
        entry.paidAmount += s.paid
        entry.remainingAmount -= s.paid
    }

    for (const s of directTransactionSummaries) {
        const entry = getOrCreate(s.currency)
        entry.paidAmount += s.paid
        entry.remainingAmount -= s.paid
    }

    return Array.from(merged.values()).sort((a, b) => a.currency.localeCompare(b.currency))
}

export function UnifiedStatementSummary({
    salesSummaries,
    purchaseSummaries,
    loanRepaymentSummaries,
    directTransactionSummaries,
    t,
    iqdPreference
}: {
    salesSummaries: PartnerOrderItemsPrintCurrencySummary[]
    purchaseSummaries: PartnerOrderItemsPrintCurrencySummary[]
    loanRepaymentSummaries: PartnerOrderItemsPrintMoneyMovementSummary[]
    directTransactionSummaries: PartnerOrderItemsPrintMoneyMovementSummary[]
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    const unified = mergeAllSummaries(salesSummaries, purchaseSummaries, loanRepaymentSummaries, directTransactionSummaries)
    if (unified.length === 0) return null

    return (
        <div className="mt-2 rounded border border-slate-300 bg-slate-50 px-2 py-2 text-[9px]" data-pdf-keep-together data-order-items-section-summary>
            {unified.map((summary, index) => (
                <div key={summary.currency}>
                    {index > 0 ? <hr className="my-1.5 border-slate-300" /> : null}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
                        <span>{t('businessPartners.orderItemsPrint.currency', { defaultValue: 'Currency' })}: <strong>{summary.currency.toUpperCase()}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.orders', { defaultValue: 'Orders' })}: <strong>{summary.orderCount}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.itemsSubtotal', { defaultValue: 'Items subtotal' })}: <strong>{formatCurrency(summary.itemSubtotal, summary.currency, iqdPreference)}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.discount', { defaultValue: 'Discount' })}: <strong>-{formatCurrency(summary.discount, summary.currency, iqdPreference)}</strong></span>
                        {summary.tax > 0 ? <span>{t('businessPartners.orderItemsPrint.tax', { defaultValue: 'Tax' })}: <strong>+{formatCurrency(summary.tax, summary.currency, iqdPreference)}</strong></span> : null}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 border-t-2 border-slate-400 pt-2 text-[10px] font-bold" data-order-items-summary-balances>
                        <span>{t('businessPartners.orderItemsPrint.total', { defaultValue: 'Total' })}: <strong>{formatCurrency(summary.total, summary.currency, iqdPreference)}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.paid', { defaultValue: 'Paid' })}: <strong>{formatCurrency(summary.paidAmount, summary.currency, iqdPreference)}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.remaining', { defaultValue: 'Remaining' })}: <strong>{formatCurrency(summary.remainingAmount, summary.currency, iqdPreference)}</strong></span>
                    </div>
                </div>
            ))}
        </div>
    )
}

function OrderBlock({
    block,
    kind,
    t,
    iqdPreference,
    showPaidAmount,
    showRemainingAmount
}: {
    block: PartnerOrderItemsPrintOrderBlock
    kind: 'sales' | 'purchase'
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
    showPaidAmount: boolean
    showRemainingAmount: boolean
}) {
    const returnedLabel = t('businessPartners.orderItemsPrint.returned', { defaultValue: 'Returned' })
    const kindLabel = kind === 'sales'
        ? t('businessPartners.orderItemsPrint.sales', { defaultValue: 'Sales' })
        : t('businessPartners.orderItemsPrint.purchase', { defaultValue: 'Purchases' })

    return (
        <div className="mt-3" data-order-statement-block>
            <div className="mb-1 flex items-center justify-between gap-2 border-b border-slate-400 pb-0.5 text-[9px] font-bold">
                <div className="flex items-center gap-2">
                    <span>{block.orderCode}</span>
                    <span className="rounded border border-slate-500 px-1 text-[7px] font-bold">{kindLabel}</span>
                    {block.isReturned ? <span className="rounded border border-red-400 px-1 text-[7px] font-bold">{returnedLabel}</span> : null}
                </div>
                <span className="font-normal">{formatDate(block.orderDate)}</span>
            </div>
            <table className="w-full border-collapse text-[8px] leading-[1.2]" data-order-items-paginated>
                <thead>
                    <tr className="bg-[#dfead3]">
                        <th className="w-[4%] border border-slate-400 p-1 text-center">#</th>
                        <th className="w-[11%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.orderCode', { defaultValue: 'Order code' })}</th>
                        <th className="w-[21%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.productRow', { defaultValue: 'Product / row' })}</th>
                        <th className="w-[22%] border border-slate-400 p-1 text-start">{t('businessPartners.orderItemsPrint.note', { defaultValue: 'Note' })}</th>
                        <th className="w-[8%] border border-slate-400 p-1 text-center">{t('businessPartners.orderItemsPrint.unit', { defaultValue: 'Unit' })}</th>
                        <th className="w-[8%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.quantity', { defaultValue: 'Qty' })}</th>
                        <th className="w-[13%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.unitPrice', { defaultValue: 'Price' })}</th>
                        <th className="w-[13%] border border-slate-400 p-1 text-end">{t('businessPartners.orderItemsPrint.amount', { defaultValue: 'Amount' })}</th>
                    </tr>
                </thead>
                <tbody>
                    {block.rows.map((row, index) => {
                        const hierarchyPosition = getPartnerOrderItemsPrintRowHierarchy(block.rows, index)

                        return row.kind === 'order_total' ? (
                            <tr
                                key={row.id}
                                className="bg-slate-200 font-bold"
                                data-pdf-keep-together
                            >
                                <td className="relative overflow-visible border border-slate-300 px-1 py-1 text-center align-top">
                                    <OrderHierarchyMarker position={hierarchyPosition} returned={row.isReturned} partialPaid={row.isPartialPaid} unpaid={row.isUnpaid} />
                                    {index + 1}
                                </td>
                                <td className="border border-slate-300 px-1 py-1 whitespace-nowrap align-top">
                                    {row.orderCode}
                                    {row.isReturned ? <span className="ms-1 rounded border border-red-400 px-1 text-[7px] font-bold">{returnedLabel}</span> : null}
                                </td>
                                <td colSpan={5} className="border border-slate-300 px-1 py-1 whitespace-nowrap align-top">
                                    {statementRowLabel(row, t)}
                                    {showPaidAmount && row.paidAmount != null ? (
                                        <span className="ms-2">
                                            {t('businessPartners.orderItemsPrint.paid', { defaultValue: 'Paid' })}: {formatCurrency(row.paidAmount, row.currency, iqdPreference)}
                                        </span>
                                    ) : null}
                                    {showRemainingAmount && row.remainingAmount != null ? (
                                        <span className="ms-2">
                                            {t('businessPartners.orderItemsPrint.remaining', { defaultValue: 'Remaining' })}: {formatCurrency(row.remainingAmount, row.currency, iqdPreference)}
                                        </span>
                                    ) : null}
                                </td>
                                <td className="border border-slate-300 px-1 py-1 text-end whitespace-nowrap align-top">{row.amount == null ? '—' : formatCurrency(row.amount, row.currency, iqdPreference)}</td>
                            </tr>
                        ) : (
                            <tr
                                key={row.id}
                                className={row.kind === 'item' ? '' : 'bg-slate-50'}
                                data-pdf-keep-together
                            >
                                <td className="relative overflow-visible border border-slate-300 p-1 text-center">
                                    <OrderHierarchyMarker position={hierarchyPosition} returned={row.isReturned} partialPaid={row.isPartialPaid} unpaid={row.isUnpaid} />
                                    {index + 1}
                                </td>
                                <td className="border border-slate-300 p-1 align-top font-semibold">
                                    <div>
                                        {row.orderCode}
                                        {row.isReturned ? <span className="ms-1 rounded border border-red-400 px-1 text-[7px] font-bold">{returnedLabel}</span> : null}
                                    </div>
                                    <div className="mt-0.5 text-[7px] font-normal">{formatDate(row.orderDate)}</div>
                                </td>
                                <td className="border border-slate-300 p-1 align-top">{statementRowLabel(row, t)}</td>
                                <td className="border border-slate-300 p-1 align-top whitespace-pre-wrap">{statementRowNote(row, t)}</td>
                                <td className="border border-slate-300 p-1 text-center">{row.unit?.trim() || '—'}</td>
                                <td className="border border-slate-300 p-1 text-end">{formatQuantity(row.quantity)}</td>
                                <td className="border border-slate-300 p-1 text-end">{row.unitPrice == null ? '—' : formatCurrency(row.unitPrice, row.currency, iqdPreference)}</td>
                                <td className="border border-slate-300 p-1 text-end font-semibold">{row.amount == null ? '—' : formatCurrency(row.amount, row.currency, iqdPreference)}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

export function MoneyMovementBlock({
    block,
    t,
    iqdPreference
}: {
    block: PartnerOrderItemsPrintOrderBlock
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    const row = block.rows[0]
    if (!row) return null

    const kindLabel = row.kind === 'loan_repayment'
        ? t('businessPartners.orderItemsPrint.loanRepayment', { defaultValue: 'Loan Repayment' })
        : t('businessPartners.orderItemsPrint.directTransaction', { defaultValue: 'Direct Transaction' })
    const isIncoming = row.direction === 'incoming'
    const directionLabel = isIncoming
        ? t('businessPartners.orderItemsPrint.received', { defaultValue: 'Received' })
        : t('businessPartners.orderItemsPrint.paid', { defaultValue: 'Paid' })
    const methodLabel = row.paymentMethod
        ? t(`pos.${row.paymentMethod}`, { defaultValue: row.paymentMethod })
        : null

    return (
        <div className="mt-3" data-order-statement-block>
            <div className="mb-1 flex items-center justify-between gap-2 border-b border-slate-400 pb-0.5 text-[9px] font-bold">
                <div className="flex items-center gap-2">
                    <span>{kindLabel}</span>
                    {row.orderCode?.trim() ? <span className="font-normal">{row.orderCode}</span> : null}
                    <span className={`rounded border px-1 text-[7px] font-bold ${isIncoming ? 'border-emerald-600 text-emerald-700' : 'border-rose-600 text-rose-700'}`}>{directionLabel}</span>
                </div>
                <span className="font-normal">{formatDate(row.orderDate)}</span>
            </div>
            <div className="relative flex items-center justify-between gap-2 border border-slate-400 bg-slate-50 px-1.5 py-1 text-[8px]">
                <OrderHierarchyMarker
                    position="single"
                    forceLine
                    lineColor={isIncoming ? 'bg-emerald-600' : 'bg-rose-600'}
                />
                <span className="flex-1">
                    {methodLabel ? <span className="font-semibold">{methodLabel}</span> : null}
                    {row.note?.trim() ? <span className="ms-2 text-[7px]">{row.note.trim()}</span> : null}
                </span>
                <span className="font-bold">{isIncoming ? '+' : '−'} {formatCurrency(row.amount ?? 0, row.currency, iqdPreference)}</span>
            </div>
        </div>
    )
}

export function MoneyMovementSummary({
    title,
    summaries,
    t,
    iqdPreference
}: {
    title: string
    summaries: PartnerOrderItemsPrintMoneyMovementSummary[]
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    if (summaries.length === 0) return null

    return (
        <div className="mt-2" data-pdf-keep-together data-order-items-section-summary>
            <div className="mb-1 text-[9px] font-bold">{title}</div>
            {summaries.map((summary) => (
                <div key={summary.currency} className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-slate-300 bg-slate-50 px-2 py-2 text-[9px] sm:grid-cols-4">
                    <span>{t('businessPartners.orderItemsPrint.currency', { defaultValue: 'Currency' })}: <strong>{summary.currency.toUpperCase()}</strong></span>
                    <span>{summary.count} {t('businessPartners.orderItemsPrint.entries', { defaultValue: 'Entries' })}</span>
                    <span>{t('businessPartners.orderItemsPrint.received', { defaultValue: 'Received' })}: <strong>+{formatCurrency(summary.received, summary.currency, iqdPreference)}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.paid', { defaultValue: 'Paid' })}: <strong>-{formatCurrency(summary.paid, summary.currency, iqdPreference)}</strong></span>
                </div>
            ))}
        </div>
    )
}

function ExcludedOrdersSection({
    salesOrders,
    purchaseOrders,
    t,
    iqdPreference
}: {
    salesOrders: SalesOrder[]
    purchaseOrders: PurchaseOrder[]
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
}) {
    const excludedOrders = [
        ...salesOrders.map((order) => ({ order, kind: 'sales' as const })),
        ...purchaseOrders.map((order) => ({ order, kind: 'purchase' as const }))
    ].filter(({ order }) => !order.isDeleted && (order.status === 'draft' || order.status === 'cancelled'))

    if (excludedOrders.length === 0) return null

    return (
        <section className="mt-4 rounded border border-dashed border-slate-400 px-2 py-2 text-[8px]" data-pdf-keep-together data-order-items-excluded-orders>
            <div className="font-bold">{t('businessPartners.orderItemsPrint.referenceOnly', { defaultValue: 'Reference Only' })}</div>
            <div className="mb-1 text-[7px]">{t('businessPartners.orderItemsPrint.notIncludedInCurrentBalance', { defaultValue: 'Draft and cancelled orders are not included in the current balance.' })}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
                {excludedOrders.map(({ order, kind }) => (
                    <span key={order.id}>
                        <strong>{kind === 'sales'
                            ? t('businessPartners.orderItemsPrint.salesOrder', { defaultValue: 'Sales order' })
                            : t('businessPartners.orderItemsPrint.purchaseOrder', { defaultValue: 'Purchase order' })} {order.orderNumber}</strong>
                        {' · '}{t(`orders.status.${order.status}`, { defaultValue: order.status })}
                        {' · '}{formatCurrency(order.total, order.currency, iqdPreference)}
                    </span>
                ))}
            </div>
        </section>
    )
}

function OrderItemsSection({
    salesOrders,
    purchaseOrders,
    t,
    iqdPreference,
    showPaidAmount,
    showRemainingAmount
}: {
    salesOrders: SalesOrder[]
    purchaseOrders: PurchaseOrder[]
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
    showPaidAmount: boolean
    showRemainingAmount: boolean
}) {
    const salesSection = buildPartnerOrderItemsPrintSection(salesOrders.filter((order) => order.status !== 'draft'), 'sales')
    const purchaseSection = buildPartnerOrderItemsPrintSection(purchaseOrders.filter((order) => order.status !== 'draft'), 'purchase')
    const orderRows = [...salesSection.rows, ...purchaseSection.rows].sort(compareStatementRows)
    if (orderRows.length === 0) return null

    const blocks = buildPartnerOrderItemsPrintOrderBlocks(orderRows)
    const orderSummaries = buildPartnerOrderItemsPrintOrderSummaries(salesSection.summaries, purchaseSection.summaries)

    return (
        <section className="mt-5" data-order-items-section>
            <div
                className="mb-2 flex items-center justify-between border-b-2 border-slate-700 pb-1"
                data-order-items-section-title-bar
                data-order-items-continuation-label={`(${t('businessPartners.orderItemsPrint.continued', { defaultValue: 'Continued' })})`}
            >
                <h2 className="text-sm font-bold">{t('businessPartners.orderItemsPrint.accountActivity', { defaultValue: 'Account Activity' })}</h2>
                <span className="text-[9px]" data-order-items-section-order-count>{blocks.length} {t('businessPartners.orderItemsPrint.entries', { defaultValue: 'Entries' })}</span>
            </div>
            {blocks.map((block) => (
                <OrderBlock
                    key={block.orderId}
                    block={block}
                    kind={block.rows[0]?.sectionKind === 'purchase' ? 'purchase' : 'sales'}
                    t={t}
                    iqdPreference={iqdPreference}
                    showPaidAmount={showPaidAmount}
                    showRemainingAmount={showRemainingAmount}
                />
            ))}
            <OrderActivitySummary summaries={orderSummaries} t={t} iqdPreference={iqdPreference} />
        </section>
    )
}

export function PartnerOrderItemsPrintTemplate({
    workspaceName,
    workspaceDescription,
    printLang,
    data,
    iqdPreference = 'IQD',
    logoUrl,
    showPaidAmount = true,
    showRemainingAmount = true,
    showSettlementActivity = true,
    componentPositions,
    editableComponents,
    onComponentPositionChange
}: PartnerOrderItemsPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const isRtl = isRTL(printLang)
    const logoSrc = resolveLogoSrc(logoUrl)
    const periodLabel = resolvePeriodLabel(data.period, t)
    const partnerLocation = [data.partner.address, data.partner.city, data.partner.country].filter(Boolean).join(', ')
    const businessName = workspaceName?.trim() || t('businessPartners.ourBusiness', { defaultValue: 'Our business' })

    return (
        <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="bg-white text-black"
            style={{ width: '210mm' }}
            data-partner-order-items-print
            data-order-print-page
            data-page-width-mm="210"
            data-page-padding-mm="10"
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
@media print {
    @page { margin: 0; size: A4; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
    [data-partner-order-items-print] tr,
    [data-partner-order-items-print] [data-pdf-keep-together] {
        break-inside: avoid;
        page-break-inside: avoid;
    }
    [data-partner-order-items-print] thead { display: table-header-group; }
}
`
                }}
            />
            <section className="bg-white" style={{ minHeight: '297mm', padding: '10mm 9mm', boxSizing: 'border-box' }}>
                <header className="grid grid-cols-3 border border-slate-500 text-[9px]" data-pdf-keep-together>
                    <div className="min-h-[32mm] border-e border-slate-500 p-2 leading-relaxed">
                        <MovableOrderPrintBlock
                            componentKey={PARTNER_ORDER_ITEMS_MOVABLE_COMPONENT_KEYS.workspaceName}
                            label={t('workspaceConfig.workspaceName', { defaultValue: 'Workspace Name' })}
                            position={componentPositions?.[PARTNER_ORDER_ITEMS_MOVABLE_COMPONENT_KEYS.workspaceName]}
                            editable={editableComponents}
                            onPositionChange={onComponentPositionChange}
                            wrapperClassName="inline-block max-w-full"
                            resizable
                        >
                            <div className="font-bold text-[11px]">{workspaceName || t('businessPartners.ourBusiness', { defaultValue: 'Our business' })}</div>
                        </MovableOrderPrintBlock>
                        {workspaceDescription?.trim() ? <div className="mt-1 whitespace-pre-wrap">{workspaceDescription.trim()}</div> : null}
                        {data.workspace?.phone?.trim() ? <div>{data.workspace.phone}</div> : null}
                        {data.workspace?.email?.trim() ? <div>{data.workspace.email}</div> : null}
                        {data.workspace?.address?.trim() ? <div>{data.workspace.address}</div> : null}
                    </div>
                    <div className="flex min-h-[32mm] items-center justify-center border-e border-slate-500 p-2">
                        {logoSrc ? (
                            <img src={logoSrc} alt="" className="max-h-[28mm] max-w-[48mm] object-contain" />
                        ) : (
                            <div className="text-center text-xs font-bold">{workspaceName || 'Atlas'}</div>
                        )}
                    </div>
                    <div className="min-h-[32mm] p-2 text-end leading-relaxed">
                        <div className="font-bold text-[11px]">{t('businessPartners.orderItemsPrint.title', { defaultValue: 'Partner Order Items Statement' })}</div>
                        <div className="mt-1"><span>{t('businessPartners.orderItemsPrint.partner', { defaultValue: 'Partner' })}: </span><strong>{data.partner.name}</strong></div>
                        {data.partner.contactName?.trim() ? <div>{data.partner.contactName}</div> : null}
                        {data.partner.phone?.trim() ? <div>{data.partner.phone}</div> : null}
                    </div>
                </header>

                <div className="mt-2 grid grid-cols-3 gap-2 border-b border-slate-300 pb-2 text-[9px]" data-pdf-keep-together>
                    <div><span>{t('businessPartners.orderItemsPrint.period', { defaultValue: 'Period' })}: </span><strong>{periodLabel}</strong></div>
                    <div><span>{t('businessPartners.orderItemsPrint.address', { defaultValue: 'Address' })}: </span>{partnerLocation || '—'}</div>
                    <div className="text-end"><span>{t('businessPartners.orderItemsPrint.printed', { defaultValue: 'Printed' })}: </span>{formatDateTime(data.generatedAt)}</div>
                </div>

                <CurrentBalanceSummary
                    summary={data.balanceSummary}
                    partnerName={data.partner.name}
                    workspaceName={businessName}
                    t={t}
                    iqdPreference={iqdPreference}
                />
                <OrderItemsSection
                    salesOrders={data.salesOrders}
                    purchaseOrders={data.purchaseOrders}
                    t={t}
                    iqdPreference={iqdPreference}
                    showPaidAmount={showPaidAmount}
                    showRemainingAmount={showRemainingAmount}
                />
                <ExcludedOrdersSection
                    salesOrders={data.salesOrders}
                    purchaseOrders={data.purchaseOrders}
                    t={t}
                    iqdPreference={iqdPreference}
                />
                {showSettlementActivity ? (
                    <SettlementActivitySection
                        orders={data.statementOrders || [...data.salesOrders, ...data.purchaseOrders]}
                        loans={data.loans || []}
                        loanPayments={data.loanPayments || []}
                        transactions={data.settlementTransactions || data.directTransactions || []}
                        linkedOrderCodes={data.linkedOrderCodes}
                        period={data.period}
                        t={t}
                        iqdPreference={iqdPreference}
                    />
                ) : null}
            </section>
        </div>
    )
}
