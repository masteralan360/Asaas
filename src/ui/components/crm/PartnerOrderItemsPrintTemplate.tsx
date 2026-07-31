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
    salesOrders: SalesOrder[]
    purchaseOrders: PurchaseOrder[]
    /** Loans linked to the partner (used to resolve repayment currency, number and direction). */
    loans?: Loan[]
    /** Partner loan/installment repayments, already period-filtered by paidAt. */
    loanPayments?: LoanPayment[]
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

function isMoneyMovementBlock(block: PartnerOrderItemsPrintOrderBlock) {
    const firstKind = block.rows[0]?.kind
    return firstKind === 'loan_repayment' || firstKind === 'direct_transaction'
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

function StatementSummary({
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
                <div key={summary.currency} className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-slate-300 bg-slate-50 px-2 py-2 text-[9px] sm:grid-cols-4">
                    <span>{t('businessPartners.orderItemsPrint.currency', { defaultValue: 'Currency' })}: <strong>{summary.currency.toUpperCase()}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.orders', { defaultValue: 'Orders' })}: <strong>{summary.orderCount}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.itemsSubtotal', { defaultValue: 'Items subtotal' })}: <strong>{formatCurrency(summary.itemSubtotal, summary.currency, iqdPreference)}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.discount', { defaultValue: 'Discount' })}: <strong>-{formatCurrency(summary.discount, summary.currency, iqdPreference)}</strong></span>
                    {kind === 'sales' ? <span>{t('businessPartners.orderItemsPrint.tax', { defaultValue: 'Tax' })}: <strong>+{formatCurrency(summary.tax, summary.currency, iqdPreference)}</strong></span> : null}
                    <span>{t('businessPartners.orderItemsPrint.additions', { defaultValue: 'Additions' })}: <strong>+{formatCurrency(summary.additions, summary.currency, iqdPreference)}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.deductions', { defaultValue: 'Deductions' })}: <strong>-{formatCurrency(summary.deductions, summary.currency, iqdPreference)}</strong></span>
                    <span className="font-bold">{t('businessPartners.orderItemsPrint.total', { defaultValue: 'Total' })}: <strong>{formatCurrency(summary.total, summary.currency, iqdPreference)}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.paid', { defaultValue: 'Paid' })}: <strong>{formatCurrency(summary.paidAmount, summary.currency, iqdPreference)}</strong></span>
                    <span>{t('businessPartners.orderItemsPrint.remaining', { defaultValue: 'Remaining' })}: <strong>{formatCurrency(summary.remainingAmount, summary.currency, iqdPreference)}</strong></span>
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
    additions: number
    deductions: number
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
            additions: 0,
            deductions: 0,
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
        entry.additions += s.additions
        entry.deductions += s.deductions
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
        entry.additions += s.additions
        entry.deductions += s.deductions
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

function UnifiedStatementSummary({
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
                        <span>{t('businessPartners.orderItemsPrint.additions', { defaultValue: 'Additions' })}: <strong>+{formatCurrency(summary.additions, summary.currency, iqdPreference)}</strong></span>
                        <span>{t('businessPartners.orderItemsPrint.deductions', { defaultValue: 'Deductions' })}: <strong>-{formatCurrency(summary.deductions, summary.currency, iqdPreference)}</strong></span>
                        <span className="font-bold">{t('businessPartners.orderItemsPrint.total', { defaultValue: 'Total' })}: <strong>{formatCurrency(summary.total, summary.currency, iqdPreference)}</strong></span>
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

function MoneyMovementBlock({
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

function MoneyMovementSummary({
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

function OrderItemsSection({
    timeline,
    t,
    iqdPreference,
    showPaidAmount,
    showRemainingAmount
}: {
    timeline: PartnerOrderItemsPrintTimeline
    t: (key: string, options?: Record<string, unknown>) => string
    iqdPreference: IQDDisplayPreference
    showPaidAmount: boolean
    showRemainingAmount: boolean
}) {
    if (timeline.rows.length === 0) return null

    const blocks = buildPartnerOrderItemsPrintOrderBlocks(timeline.rows)

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
                isMoneyMovementBlock(block) ? (
                    <MoneyMovementBlock
                        key={block.orderId}
                        block={block}
                        t={t}
                        iqdPreference={iqdPreference}
                    />
                ) : (
                    <OrderBlock
                        key={block.orderId}
                        block={block}
                        kind={block.rows[0]?.sectionKind === 'purchase' ? 'purchase' : 'sales'}
                        t={t}
                        iqdPreference={iqdPreference}
                        showPaidAmount={showPaidAmount}
                        showRemainingAmount={showRemainingAmount}
                    />
                )
            ))}
            <UnifiedStatementSummary
                salesSummaries={timeline.salesSummary}
                purchaseSummaries={timeline.purchaseSummary}
                loanRepaymentSummaries={timeline.loanRepaymentSummary}
                directTransactionSummaries={timeline.directTransactionSummary}
                t={t}
                iqdPreference={iqdPreference}
            />
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
    const timeline = buildPartnerOrderItemsPrintTimeline(
        data.salesOrders,
        data.purchaseOrders,
        data.loans || [],
        data.loanPayments || [],
        data.directTransactions || []
    )

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

                <OrderItemsSection
                    timeline={timeline}
                    t={t}
                    iqdPreference={iqdPreference}
                    showPaidAmount={showPaidAmount}
                    showRemainingAmount={showRemainingAmount}
                />
            </section>
        </div>
    )
}
