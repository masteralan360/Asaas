import { describe, expect, it } from 'vitest'
import {
    calculateMonthlyUsage,
    DECIMAL_GB,
    DEFAULT_SCHEDULED_INSTALLMENTS_PER_LOAN,
    getRecommendedUsagePlan,
    MONTHLY_USAGE_PLANS,
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
        const breakdownUpload = estimate.breakdown.reduce((sum, item) => sum + item.actualUploadedBytes, 0)
        const breakdownDownload = estimate.breakdown.reduce((sum, item) => sum + item.actualDownloadedBytes, 0)

        expect(estimate.actualUploadedBytes).toBeCloseTo(breakdownUpload)
        expect(estimate.actualDownloadedBytes).toBeCloseTo(breakdownDownload)
        expect(estimate.actualTypicalTransferBytes).toBeCloseTo(breakdownUpload + breakdownDownload)
        expect(estimate.chargedTypicalUsageBytes).toBe(Math.trunc(estimate.actualTypicalTransferBytes) * 10)
        expect(estimate.actualFirstMonthTransferBytes).toBeGreaterThan(estimate.actualTypicalTransferBytes)
        expect(estimate.actualLowTransferBytes).toBeLessThan(estimate.actualTypicalTransferBytes)
        expect(estimate.actualBusyTransferBytes).toBeGreaterThan(estimate.actualTypicalTransferBytes)
    })

    it('scales POS transfer and sale-item children with basket size', () => {
        const small = calculateMonthlyUsage({ ...baseInput, averagePosItems: 1 })
        const large = calculateMonthlyUsage({ ...baseInput, averagePosItems: 10 })

        expect(large.breakdown.find((item) => item.key === 'pos')!.actualTransferBytes)
            .toBeGreaterThan(small.breakdown.find((item) => item.key === 'pos')!.actualTransferBytes)
        expect(large.generatedRecords.find((item) => item.key === 'saleItems')!.count)
            .toBeGreaterThan(small.generatedRecords.find((item) => item.key === 'saleItems')!.count)
    })

    it('includes full batch-table refreshes after relevant workflows', () => {
        const withoutBatches = calculateMonthlyUsage({ ...baseInput, batchTracking: false })
        const withBatches = calculateMonthlyUsage({ ...baseInput, batchTracking: true })

        expect(withBatches.actualDownloadedBytes).toBeGreaterThan(withoutBatches.actualDownloadedBytes * 2)
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
        expect(financed.breakdown.find((item) => item.key === 'credit')!.actualTransferBytes)
            .toBeGreaterThan(paid.breakdown.find((item) => item.key === 'credit')!.actualTransferBytes)
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
        expect(many.breakdown.find((item) => item.key === 'orders')!.actualTransferBytes)
            .toBeGreaterThan(few.breakdown.find((item) => item.key === 'orders')!.actualTransferBytes)
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
        expect(withPayments.breakdown.find((item) => item.key === 'credit')!.actualUploadedBytes)
            .toBeGreaterThan(withoutPayments.breakdown.find((item) => item.key === 'credit')!.actualUploadedBytes)
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

        expect(files.breakdown.find((item) => item.key === 'invoicesAndFiles')!.actualUploadedBytes)
            .toBeGreaterThan(50 * 1024 * 1024)
        expect(files.actualDownloadedBytes).toBeGreaterThan(none.actualDownloadedBytes)
    })

    it('makes existing history materially increase first sync and repeated reviews', () => {
        const fresh = calculateMonthlyUsage({ ...baseInput, historySize: 'fresh' })
        const large = calculateMonthlyUsage({
            ...baseInput,
            historySize: 'large',
            advancedEnabled: true,
            historyReviewFrequency: 'daily'
        })

        expect(large.actualFirstMonthTransferBytes).toBeGreaterThan(fresh.actualFirstMonthTransferBytes)
        expect(large.breakdown.find((item) => item.key === 'reports')!.actualTransferBytes)
            .toBeGreaterThan(fresh.breakdown.find((item) => item.key === 'reports')!.actualTransferBytes)
    })

    it('more users increase reads without changing business operation counts', () => {
        const one = calculateMonthlyUsage({ ...baseInput, teamMembers: 1 })
        const five = calculateMonthlyUsage({ ...baseInput, teamMembers: 5 })

        expect(five.actualDownloadedBytes).toBeGreaterThan(one.actualDownloadedBytes)
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

        expect(right.actualTypicalTransferBytes).toBe(left.actualTypicalTransferBytes)
    })

    it('selects plans using charged first/busy usage plus headroom', () => {
        const estimate = calculateMonthlyUsage(baseInput)
        expect(estimate.chargedRecommendedUsageBytes)
            .toBeCloseTo(estimate.chargedRecommendationBasisBytes * 1.2)
        expect(estimate.recommendedPlan)
            .toEqual(getRecommendedUsagePlan(estimate.chargedRecommendedUsageBytes))
    })

    it('uses decimal charged allowances of 1, 6, 15, 30, 60, and 120 GB', () => {
        expect(MONTHLY_USAGE_PLANS.map((plan) => plan.limitBytes)).toEqual([
            1 * DECIMAL_GB,
            6 * DECIMAL_GB,
            15 * DECIMAL_GB,
            30 * DECIMAL_GB,
            60 * DECIMAL_GB,
            120 * DECIMAL_GB,
            null
        ])

        for (let index = 0; index < MONTHLY_USAGE_PLANS.length - 1; index += 1) {
            const plan = MONTHLY_USAGE_PLANS[index]
            expect(getRecommendedUsagePlan(plan.limitBytes!).id).toBe(plan.id)
            expect(getRecommendedUsagePlan(plan.limitBytes! + 1).id)
                .toBe(MONTHLY_USAGE_PLANS[index + 1].id)
        }
    })

    it('makes 100 MB actual consume exactly the free 1 GB charged allowance', () => {
        expect(100_000_000 * 10).toBe(MONTHLY_USAGE_PLANS[0].limitBytes)
    })
})

