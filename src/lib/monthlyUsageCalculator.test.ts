import { describe, expect, it } from 'vitest'
import {
    calculateMonthlyUsage,
    DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN,
    getRecommendedUsagePlan,
    toMonthlyOccurrences,
    type MonthlyUsageCalculatorInput
} from './monthlyUsageCalculator'

const baseInput: MonthlyUsageCalculatorInput = {
    hoursPerDay: 8,
    activeDaysPerWeek: 6,
    teamMembers: 1,
    storageLocations: 1,
    products: 1000,
    historySize: 'fresh',
    batchTracking: false,
    usesPos: true,
    usesWholesale: true,
    usesPurchasing: false,
    usesLoans: true,
    usesInvoices: true,
    averagePosItems: 3,
    averageWholesaleItems: 12,
    averagePurchaseItems: 10,
    posSales: { amount: 50, frequency: 'daily' },
    posPaymentProfile: 'paidNow',
    wholesaleOrders: { amount: 10, frequency: 'weekly' },
    wholesalePaymentProfile: 'mixed',
    purchaseOrders: { amount: 0, frequency: 'weekly' },
    manualLoans: { amount: 5, frequency: 'monthly' },
    loanPayments: { amount: 20, frequency: 'weekly' },
    savedInvoices: { amount: 20, frequency: 'monthly' },
    advancedEnabled: false,
    newOrChangedProductsPerMonth: 0,
    returnProfile: 'few',
    stockOperations: { amount: 0, frequency: 'weekly' },
    historyReviewFrequency: 'occasional',
    reportReviewFrequency: 'occasional',
    uploads: { amount: 0, frequency: 'monthly' },
    uploadSizeProfile: 'medium'
}

describe('monthly usage calculator', () => {
    it('normalizes frequency and sanitizes invalid amounts', () => {
        expect(toMonthlyOccurrences({ amount: 10, frequency: 'daily' }, 6)).toBeCloseTo(260.89, 1)
        expect(toMonthlyOccurrences({ amount: 10, frequency: 'weekly' }, 6)).toBeCloseTo(43.48, 1)
        expect(toMonthlyOccurrences({ amount: 10, frequency: 'monthly' }, 6)).toBe(10)
        expect(toMonthlyOccurrences({ amount: Number.POSITIVE_INFINITY, frequency: 'monthly' }, 6)).toBe(0)
        expect(toMonthlyOccurrences({ amount: -5, frequency: 'monthly' }, 6)).toBe(0)
    })

    it('keeps upload/download and breakdown totals internally consistent', () => {
        const estimate = calculateMonthlyUsage(baseInput)
        const breakdownUpload = estimate.breakdown.reduce((sum, item) => sum + item.uploadedBytes, 0)
        const breakdownDownload = estimate.breakdown.reduce((sum, item) => sum + item.downloadedBytes, 0)

        expect(estimate.uploadedBytes).toBeCloseTo(breakdownUpload)
        expect(estimate.downloadedBytes).toBeCloseTo(breakdownDownload)
        expect(estimate.typicalMonthBytes).toBeCloseTo(breakdownUpload + breakdownDownload)
        expect(estimate.firstMonthBytes).toBeGreaterThan(estimate.typicalMonthBytes)
        expect(estimate.lowMonthBytes).toBeLessThan(estimate.typicalMonthBytes)
        expect(estimate.busyMonthBytes).toBeGreaterThan(estimate.typicalMonthBytes)
    })

    it('scales POS transfer and sale-item children with basket size', () => {
        const small = calculateMonthlyUsage({ ...baseInput, averagePosItems: 1 })
        const large = calculateMonthlyUsage({ ...baseInput, averagePosItems: 10 })

        expect(large.breakdown.find((item) => item.key === 'pos')!.bytes)
            .toBeGreaterThan(small.breakdown.find((item) => item.key === 'pos')!.bytes)
        expect(large.generatedRecords.find((item) => item.key === 'saleItems')!.count)
            .toBeGreaterThan(small.generatedRecords.find((item) => item.key === 'saleItems')!.count)
    })

    it('includes full batch-table refreshes after relevant workflows', () => {
        const withoutBatches = calculateMonthlyUsage({ ...baseInput, batchTracking: false })
        const withBatches = calculateMonthlyUsage({ ...baseInput, batchTracking: true })

        expect(withBatches.downloadedBytes).toBeGreaterThan(withoutBatches.downloadedBytes * 2)
    })

    it('models embedded wholesale lines and financed-order linked loans', () => {
        const paid = calculateMonthlyUsage({
            ...baseInput,
            wholesaleOrders: { amount: 20, frequency: 'monthly' },
            wholesalePaymentProfile: 'paidNow'
        })
        const financed = calculateMonthlyUsage({
            ...baseInput,
            wholesaleOrders: { amount: 20, frequency: 'monthly' },
            wholesalePaymentProfile: 'oftenLater'
        })

        expect(paid.generatedRecords.find((item) => item.key === 'orderLines')?.count).toBe(240)
        expect(financed.monthlyOccurrences.linkedLoans).toBeGreaterThan(0)
        expect(financed.breakdown.find((item) => item.key === 'credit')!.bytes)
            .toBeGreaterThan(paid.breakdown.find((item) => item.key === 'credit')!.bytes)
    })

    it('supports purchasing and scales it with embedded product lines', () => {
        const few = calculateMonthlyUsage({
            ...baseInput,
            usesPurchasing: true,
            purchaseOrders: { amount: 10, frequency: 'monthly' },
            averagePurchaseItems: 2
        })
        const many = calculateMonthlyUsage({
            ...baseInput,
            usesPurchasing: true,
            purchaseOrders: { amount: 10, frequency: 'monthly' },
            averagePurchaseItems: 20
        })

        expect(many.generatedRecords.find((item) => item.key === 'purchaseLines')?.count).toBe(200)
        expect(many.breakdown.find((item) => item.key === 'orders')!.bytes)
            .toBeGreaterThan(few.breakdown.find((item) => item.key === 'orders')!.bytes)
    })

    it('expands every loan and every payment through the hidden six-row schedule', () => {
        const withoutPayments = calculateMonthlyUsage({
            ...baseInput,
            manualLoans: { amount: 10, frequency: 'monthly' },
            loanPayments: { amount: 0, frequency: 'monthly' }
        })
        const withPayments = calculateMonthlyUsage({
            ...baseInput,
            manualLoans: { amount: 10, frequency: 'monthly' },
            loanPayments: { amount: 10, frequency: 'monthly' }
        })

        expect(withoutPayments.generatedRecords.find((item) => item.key === 'scheduledInstallments')?.count)
            .toBe(10 * DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN + Math.round(withoutPayments.monthlyOccurrences.linkedLoans * DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN))
        expect(withPayments.breakdown.find((item) => item.key === 'credit')!.uploadedBytes)
            .toBeGreaterThan(withoutPayments.breakdown.find((item) => item.key === 'credit')!.uploadedBytes)
    })

    it('counts saved invoice PDFs twice on upload and generic files in both directions', () => {
        const none = calculateMonthlyUsage({
            ...baseInput,
            savedInvoices: { amount: 0, frequency: 'monthly' },
            advancedEnabled: true,
            uploads: { amount: 0, frequency: 'monthly' }
        })
        const files = calculateMonthlyUsage({
            ...baseInput,
            savedInvoices: { amount: 10, frequency: 'monthly' },
            advancedEnabled: true,
            uploads: { amount: 10, frequency: 'monthly' },
            uploadSizeProfile: 'large'
        })

        expect(files.breakdown.find((item) => item.key === 'invoicesAndFiles')!.uploadedBytes)
            .toBeGreaterThan(50 * 1024 * 1024)
        expect(files.downloadedBytes).toBeGreaterThan(none.downloadedBytes)
    })

    it('makes existing history materially increase first sync and repeated reviews', () => {
        const fresh = calculateMonthlyUsage({ ...baseInput, historySize: 'fresh' })
        const large = calculateMonthlyUsage({
            ...baseInput,
            historySize: 'large',
            advancedEnabled: true,
            historyReviewFrequency: 'daily'
        })

        expect(large.firstMonthBytes).toBeGreaterThan(fresh.firstMonthBytes)
        expect(large.breakdown.find((item) => item.key === 'reports')!.bytes)
            .toBeGreaterThan(fresh.breakdown.find((item) => item.key === 'reports')!.bytes)
    })

    it('more users increase reads without changing business operation counts', () => {
        const one = calculateMonthlyUsage({ ...baseInput, teamMembers: 1 })
        const five = calculateMonthlyUsage({ ...baseInput, teamMembers: 5 })

        expect(five.downloadedBytes).toBeGreaterThan(one.downloadedBytes)
        expect(five.monthlyOccurrences.posSales).toBe(one.monthlyOccurrences.posSales)
    })

    it('ignores advanced values while the optional section is off', () => {
        const left = calculateMonthlyUsage({
            ...baseInput,
            advancedEnabled: false,
            uploads: { amount: 0, frequency: 'monthly' },
            returnProfile: 'none'
        })
        const right = calculateMonthlyUsage({
            ...baseInput,
            advancedEnabled: false,
            uploads: { amount: 10000, frequency: 'daily' },
            returnProfile: 'many'
        })

        expect(right.typicalMonthBytes).toBe(left.typicalMonthBytes)
    })

    it('selects plans using first/busy usage plus headroom through unlimited', () => {
        const estimate = calculateMonthlyUsage(baseInput)
        expect(estimate.recommendedUsageBytes).toBeCloseTo(estimate.recommendationBasisBytes * 1.2)
        expect(getRecommendedUsagePlan(100 * 1024 * 1024).id).toBe('free')
        expect(getRecommendedUsagePlan(100 * 1024 * 1024 + 1).id).toBe('starter')
        expect(getRecommendedUsagePlan(50 * 1024 ** 3).id).toBe('unlimited')
    })
})

