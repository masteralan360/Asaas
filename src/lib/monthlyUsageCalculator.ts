export type UsageFrequency = 'daily' | 'weekly' | 'monthly'
export type UploadSizeProfile = 'small' | 'medium' | 'large'
export type WorkspaceHistorySize = 'fresh' | 'small' | 'medium' | 'large'
export type PaymentProfile = 'paidNow' | 'mixed' | 'oftenLater'
export type ReviewFrequency = 'occasional' | 'daily' | 'frequent'
export type ReturnProfile = 'none' | 'few' | 'some' | 'many'

export type UsageActivity = {
    amount: number
    frequency: UsageFrequency
}

export type MonthlyUsageCalculatorInput = {
    hoursPerDay: number
    activeDaysPerWeek: number
    teamMembers: number
    storageLocations: number
    products: number
    historySize: WorkspaceHistorySize
    batchTracking: boolean
    usesPos: boolean
    usesWholesale: boolean
    usesPurchasing: boolean
    usesLoans: boolean
    usesInvoices: boolean
    averagePosItems: number
    averageWholesaleItems: number
    averagePurchaseItems: number
    posSales: UsageActivity
    posPaymentProfile: PaymentProfile
    wholesaleOrders: UsageActivity
    wholesalePaymentProfile: PaymentProfile
    purchaseOrders: UsageActivity
    manualLoans: UsageActivity
    loanPayments: UsageActivity
    savedInvoices: UsageActivity
    advancedEnabled: boolean
    newOrChangedProductsPerMonth: number
    returnProfile: ReturnProfile
    stockOperations: UsageActivity
    historyReviewFrequency: ReviewFrequency
    reportReviewFrequency: ReviewFrequency
    uploads: UsageActivity
    uploadSizeProfile: UploadSizeProfile
}

export type UsageBreakdownKey =
    | 'workspace'
    | 'catalog'
    | 'pos'
    | 'orders'
    | 'credit'
    | 'invoicesAndFiles'
    | 'operations'
    | 'reports'

export type UsageBreakdownItem = {
    key: UsageBreakdownKey
    uploadedBytes: number
    downloadedBytes: number
    bytes: number
}

export type GeneratedRecordKey =
    | 'sales'
    | 'saleItems'
    | 'salesOrders'
    | 'orderLines'
    | 'purchaseOrders'
    | 'purchaseLines'
    | 'loans'
    | 'scheduledInstallments'
    | 'loanPayments'
    | 'invoices'
    | 'invoiceVersions'
    | 'inventoryUpdates'
    | 'paymentEntries'
    | 'partnerSummaryUpdates'

export type GeneratedRecordEstimate = {
    key: GeneratedRecordKey
    count: number
}

export type UsagePlanId =
    | 'free'
    | 'starter'
    | 'basic'
    | 'business'
    | 'professional'
    | 'advanced'
    | 'unlimited'

export type UsagePlan = {
    id: UsagePlanId
    limitBytes: number | null
}

export type MonthlyUsageEstimate = {
    typicalMonthBytes: number
    lowMonthBytes: number
    busyMonthBytes: number
    firstMonthBytes: number
    onboardingBytes: number
    uploadedBytes: number
    downloadedBytes: number
    recommendationBasisBytes: number
    recommendedUsageBytes: number
    averageWorkingDayBytes: number
    monthlyOccurrences: {
        posSales: number
        wholesaleOrders: number
        purchaseOrders: number
        manualLoans: number
        linkedLoans: number
        loanPayments: number
        savedInvoices: number
        returns: number
        stockOperations: number
        uploads: number
    }
    breakdown: UsageBreakdownItem[]
    generatedRecords: GeneratedRecordEstimate[]
    recommendedPlan: UsagePlan
}

const KIB = 1024
const MIB = 1024 * KIB
const GIB = 1024 * MIB
const WEEKS_PER_MONTH = 365.25 / 12 / 7
const BUSY_ACTIVITY_FACTOR = 1.35
const LOW_ACTIVITY_FACTOR = 0.75
const PLAN_HEADROOM_FACTOR = 1.2
const ASSUMED_INVOICE_PDF_BYTES = 300 * KIB
const ASSUMED_BATCHES_PER_PRODUCT = 2

// Visible in the result assumptions; users are never asked to understand or enter it.
export const DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN = 6

export const MONTHLY_USAGE_PLANS: UsagePlan[] = [
    { id: 'free', limitBytes: 100 * MIB },
    { id: 'starter', limitBytes: 1 * GIB },
    { id: 'basic', limitBytes: 2.5 * GIB },
    { id: 'business', limitBytes: 5 * GIB },
    { id: 'professional', limitBytes: 10 * GIB },
    { id: 'advanced', limitBytes: 20 * GIB },
    { id: 'unlimited', limitBytes: null }
]

export const UPLOAD_SIZE_BYTES: Record<UploadSizeProfile, number> = {
    small: 0.5 * MIB,
    medium: 2 * MIB,
    large: 5 * MIB
}

export const HISTORY_RECORD_ASSUMPTIONS: Record<WorkspaceHistorySize, number> = {
    fresh: 0,
    small: 500,
    medium: 5_000,
    large: 25_000
}

const FINANCED_SHARE: Record<PaymentProfile, number> = {
    paidNow: 0,
    mixed: 0.1,
    oftenLater: 0.3
}

const PAID_TRANSACTION_SHARE: Record<PaymentProfile, number> = {
    paidNow: 1,
    mixed: 0.65,
    oftenLater: 0.25
}

const RETURN_SHARE: Record<ReturnProfile, number> = {
    none: 0,
    few: 0.01,
    some: 0.05,
    many: 0.12
}

function finiteNonNegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0
}

function atLeastOne(value: number): number {
    return Math.max(1, finiteNonNegative(value))
}

function transfer(uploadedBytes: number, downloadedBytes: number) {
    const uploaded = finiteNonNegative(uploadedBytes)
    const downloaded = finiteNonNegative(downloadedBytes)
    return {
        uploadedBytes: uploaded,
        downloadedBytes: downloaded,
        bytes: uploaded + downloaded
    }
}

export function toMonthlyOccurrences(
    activity: UsageActivity,
    activeDaysPerWeek: number
): number {
    const amount = finiteNonNegative(activity.amount)
    const activeDays = Math.min(7, finiteNonNegative(activeDaysPerWeek))

    if (activity.frequency === 'daily') return amount * activeDays * WEEKS_PER_MONTH
    if (activity.frequency === 'weekly') return amount * WEEKS_PER_MONTH
    return amount
}

export function getRecommendedUsagePlan(requiredBytes: number): UsagePlan {
    return MONTHLY_USAGE_PLANS.find((plan) => (
        plan.limitBytes === null || finiteNonNegative(requiredBytes) <= plan.limitBytes
    )) ?? MONTHLY_USAGE_PLANS.at(-1)!
}

function reviewCount(
    frequency: ReviewFrequency,
    members: number,
    monthlyWorkingDays: number
): number {
    if (frequency === 'daily') return members * monthlyWorkingDays
    if (frequency === 'frequent') return members * monthlyWorkingDays * 3
    return members * WEEKS_PER_MONTH * 2
}

function rounded(value: number): number {
    return Math.max(0, Math.round(value))
}

export function calculateMonthlyUsage(input: MonthlyUsageCalculatorInput): MonthlyUsageEstimate {
    const activeDays = Math.min(7, atLeastOne(input.activeDaysPerWeek))
    const hours = Math.min(24, Math.max(0.5, finiteNonNegative(input.hoursPerDay)))
    const members = atLeastOne(input.teamMembers)
    const storages = atLeastOne(input.storageLocations)
    const products = finiteNonNegative(input.products)
    const posItems = atLeastOne(input.averagePosItems)
    const wholesaleItems = atLeastOne(input.averageWholesaleItems)
    const purchaseItems = atLeastOne(input.averagePurchaseItems)
    const existingHistoryRecords = HISTORY_RECORD_ASSUMPTIONS[input.historySize]
    const monthlyWorkingDays = activeDays * WEEKS_PER_MONTH

    const posSales = input.usesPos ? toMonthlyOccurrences(input.posSales, activeDays) : 0
    const wholesaleOrders = input.usesWholesale ? toMonthlyOccurrences(input.wholesaleOrders, activeDays) : 0
    const purchaseOrders = input.usesPurchasing ? toMonthlyOccurrences(input.purchaseOrders, activeDays) : 0
    const manualLoans = input.usesLoans ? toMonthlyOccurrences(input.manualLoans, activeDays) : 0
    const loanPayments = input.usesLoans ? toMonthlyOccurrences(input.loanPayments, activeDays) : 0
    const savedInvoices = input.usesInvoices ? toMonthlyOccurrences(input.savedInvoices, activeDays) : 0
    const posLinkedLoans = posSales * FINANCED_SHARE[input.posPaymentProfile]
    const orderLinkedLoans = wholesaleOrders * FINANCED_SHARE[input.wholesalePaymentProfile]
    const linkedLoans = posLinkedLoans + orderLinkedLoans
    const totalLoans = manualLoans + linkedLoans
    const returns = posSales * (input.advancedEnabled ? RETURN_SHARE[input.returnProfile] : RETURN_SHARE.few)
    const stockOperations = input.advancedEnabled
        ? toMonthlyOccurrences(input.stockOperations, activeDays)
        : Math.max(0, storages - 1) * WEEKS_PER_MONTH
    const uploads = input.advancedEnabled ? toMonthlyOccurrences(input.uploads, activeDays) : 0
    const changedProducts = input.advancedEnabled
        ? finiteNonNegative(input.newOrChangedProductsPerMonth)
        : Math.min(products, Math.max(5, products * 0.02))

    const saleItems = posSales * posItems
    const orderLines = wholesaleOrders * wholesaleItems
    const purchaseLines = purchaseOrders * purchaseItems
    const scheduleRows = totalLoans * DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN
    const batchRows = input.batchTracking ? products * ASSUMED_BATCHES_PER_PRODUCT : 0

    // Fixed recurring reads: workspace/version checks and periodic catalog refreshes.
    // Hours affect how often modules are revisited, not the number of complete business operations.
    const workspaceSessions = members * monthlyWorkingDays * Math.min(1.8, 0.7 + hours / 16)
    const workspace = transfer(0, workspaceSessions * 125 * KIB)
    const catalogSnapshotBytes = 42 * KIB
        + storages * 1.4 * KIB
        + products * 1.45 * KIB
        + batchRows * 0.78 * KIB
    const catalogRefreshes = members * WEEKS_PER_MONTH * (1 + hours / 16)
    const productWrites = changedProducts * (4.8 * KIB + 1.4 * KIB)
    const catalog = transfer(
        productWrites,
        catalogRefreshes * catalogSnapshotBytes + changedProducts * 2.4 * KIB
    )

    // POS is one metered RPC at checkout, followed by later child-row synchronization.
    // Batch-enabled checkouts also trigger a full active stock-batch download.
    const posRpcUpload = posSales * 5.2 * KIB + saleItems * 2.3 * KIB
    const posSyncDownload = posSales * 4.2 * KIB + saleItems * 2.4 * KIB
    const posBatchRefresh = input.batchTracking
        ? posSales * Math.max(8 * KIB, batchRows * 0.78 * KIB)
        : 0
    const pos = transfer(posRpcUpload, posSyncDownload + posBatchRefresh)

    // Order lines are embedded in their parent payload. Completion can also write affected
    // products, partner summaries, and payment transactions. Purchase Orders use the same model.
    const paidSalesOrders = wholesaleOrders * PAID_TRANSACTION_SHARE[input.wholesalePaymentProfile]
    const orderUpload = wholesaleOrders * (13 * KIB + wholesaleItems * 4.1 * KIB)
        + orderLines * 2.2 * KIB
        + paidSalesOrders * 3.2 * KIB
        + wholesaleOrders * 2.8 * KIB
    const purchaseUpload = purchaseOrders * (13 * KIB + purchaseItems * 4.1 * KIB)
        + purchaseLines * 2.5 * KIB
        + purchaseOrders * 5.5 * KIB
    const orderDownload = wholesaleOrders * (7 * KIB + wholesaleItems * 2.2 * KIB)
        + purchaseOrders * (7 * KIB + purchaseItems * 2.2 * KIB)
        + (input.batchTracking ? (wholesaleOrders + purchaseOrders) * batchRows * 0.78 * KIB : 0)
    const orders = transfer(orderUpload + purchaseUpload, orderDownload)

    // Every loan contains a hidden six-row schedule. Each payment uploads the loan, payment,
    // transaction, partner summary, and all schedule rows again.
    const loanHeaderUpload = totalLoans * 5.5 * KIB
    const scheduleUpload = scheduleRows * 1.55 * KIB
    const manualOriginationUpload = manualLoans * 3.2 * KIB
    const paymentUpload = loanPayments * (
        5.5 * KIB
        + DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN * 1.55 * KIB
        + 3.4 * KIB
        + 3.2 * KIB
        + 2.8 * KIB
    )
    const loanSyncDownload = totalLoans * 4.8 * KIB + scheduleRows * 1.4 * KIB + loanPayments * 4.5 * KIB
    const existingLoanRows = existingHistoryRecords * 0.03
    const financedOrderFullRefresh = orderLinkedLoans * (
        (existingLoanRows + totalLoans) * 4.8 * KIB
        + (existingLoanRows * DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN + scheduleRows) * 1.4 * KIB
    )
    const credit = transfer(
        loanHeaderUpload + scheduleUpload + manualOriginationUpload + paymentUpload,
        loanSyncDownload + financedOrderFullRefresh
    )

    // A saved invoice writes metadata and uploads the PDF twice: immutable version + latest alias.
    const invoiceMetadataUpload = savedInvoices * 6.5 * KIB
    const invoicePdfUpload = savedInvoices * ASSUMED_INVOICE_PDF_BYTES * 2
    const genericUploadBytes = uploads * UPLOAD_SIZE_BYTES[input.uploadSizeProfile]
    const invoicesAndFiles = transfer(
        invoiceMetadataUpload + invoicePdfUpload + genericUploadBytes,
        savedInvoices * ASSUMED_INVOICE_PDF_BYTES * 0.5 + genericUploadBytes * 0.5
    )

    const operations = transfer(
        returns * (15 * KIB + posItems * 3.4 * KIB) + stockOperations * 12 * KIB,
        returns * (12 * KIB + posItems * 2.8 * KIB) + stockOperations * 10 * KIB
    )

    const historyFrequency = input.advancedEnabled ? input.historyReviewFrequency : 'occasional'
    const reportFrequency = input.advancedEnabled ? input.reportReviewFrequency : 'occasional'
    const historyViews = reviewCount(historyFrequency, members, monthlyWorkingDays)
    const reportViews = reviewCount(reportFrequency, members, monthlyWorkingDays)
    const currentRecords = posSales + saleItems + wholesaleOrders + purchaseOrders + totalLoans + scheduleRows
    const versionCheckBytes = 45 * KIB + Math.min(existingHistoryRecords + currentRecords, 100_000) * 95
    const reportPayloadBytes = 190 * KIB
        + Math.min(products, 10_000) * 55
        + Math.min(currentRecords, 20_000) * 35
    const reports = transfer(0, historyViews * versionCheckBytes + reportViews * reportPayloadBytes)

    const breakdown: UsageBreakdownItem[] = [
        { key: 'workspace', ...workspace },
        { key: 'catalog', ...catalog },
        { key: 'pos', ...pos },
        { key: 'orders', ...orders },
        { key: 'credit', ...credit },
        { key: 'invoicesAndFiles', ...invoicesAndFiles },
        { key: 'operations', ...operations },
        { key: 'reports', ...reports }
    ]

    const uploadedBytes = breakdown.reduce((sum, item) => sum + item.uploadedBytes, 0)
    const downloadedBytes = breakdown.reduce((sum, item) => sum + item.downloadedBytes, 0)
    const typicalMonthBytes = uploadedBytes + downloadedBytes
    const fixedRecurringBytes = workspace.bytes + catalog.bytes + reports.bytes
    const variableActivityBytes = typicalMonthBytes - fixedRecurringBytes
    const lowMonthBytes = fixedRecurringBytes + variableActivityBytes * LOW_ACTIVITY_FACTOR
    const busyMonthBytes = fixedRecurringBytes + variableActivityBytes * BUSY_ACTIVITY_FACTOR

    const initialCatalogUpload = input.historySize === 'fresh'
        ? storages * 3 * KIB + products * 6.2 * KIB
        : 0
    const initialHistoryDownload = members * existingHistoryRecords * 5.5 * KIB
    const initialCatalogDownload = members * catalogSnapshotBytes
    const onboardingBytes = initialCatalogUpload + initialHistoryDownload + initialCatalogDownload
    const firstMonthBytes = typicalMonthBytes + onboardingBytes
    const recommendationBasisBytes = Math.max(firstMonthBytes, busyMonthBytes)
    const recommendedUsageBytes = recommendationBasisBytes * PLAN_HEADROOM_FACTOR

    const partnerSummaryUpdates = wholesaleOrders + purchaseOrders + totalLoans + loanPayments
    const paymentEntries = paidSalesOrders + purchaseOrders + manualLoans + loanPayments
    const generatedRecords: GeneratedRecordEstimate[] = [
        { key: 'sales', count: rounded(posSales) },
        { key: 'saleItems', count: rounded(saleItems) },
        { key: 'salesOrders', count: rounded(wholesaleOrders) },
        { key: 'orderLines', count: rounded(orderLines) },
        { key: 'purchaseOrders', count: rounded(purchaseOrders) },
        { key: 'purchaseLines', count: rounded(purchaseLines) },
        { key: 'loans', count: rounded(totalLoans) },
        { key: 'scheduledInstallments', count: rounded(scheduleRows) },
        { key: 'loanPayments', count: rounded(loanPayments) },
        { key: 'invoices', count: rounded(savedInvoices) },
        { key: 'invoiceVersions', count: rounded(savedInvoices) },
        {
            key: 'inventoryUpdates',
            count: rounded(saleItems + orderLines + purchaseLines + returns * posItems + stockOperations * 2)
        },
        { key: 'paymentEntries', count: rounded(paymentEntries) },
        { key: 'partnerSummaryUpdates', count: rounded(partnerSummaryUpdates) }
    ]

    return {
        typicalMonthBytes,
        lowMonthBytes,
        busyMonthBytes,
        firstMonthBytes,
        onboardingBytes,
        uploadedBytes,
        downloadedBytes,
        recommendationBasisBytes,
        recommendedUsageBytes,
        averageWorkingDayBytes: typicalMonthBytes / Math.max(1, monthlyWorkingDays),
        monthlyOccurrences: {
            posSales,
            wholesaleOrders,
            purchaseOrders,
            manualLoans,
            linkedLoans,
            loanPayments,
            savedInvoices,
            returns,
            stockOperations,
            uploads
        },
        breakdown,
        generatedRecords,
        recommendedPlan: getRecommendedUsagePlan(recommendedUsageBytes)
    }
}

