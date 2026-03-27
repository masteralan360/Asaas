import type {
    BudgetAllocation,
    BusinessPartner,
    CurrencyCode,
    ExpenseItem,
    ExpenseSeries,
    Loan,
    LoanInstallment,
    LoanPayment,
    TravelAgencySale
} from '@/local-db/models'
import type { DividendItem, MonthKey, PayrollItem } from '@/lib/budget'
import { getDaysInMonth } from '@/lib/budget'
import { convertToStoreBase } from '@/lib/currency'
import {
    getRevenueAnalysisTotals,
    isRecordInDateRange,
    type RevenueAnalysisRecord
} from '@/lib/revenueAnalysis'
import { getTravelSaleCost, getTravelSaleNet, getTravelSaleRevenue } from '@/lib/travelAgency'
import { formatOriginLabel } from '@/lib/utils'

export interface FinanceRates {
    usd_iqd: number
    eur_iqd: number
    try_iqd: number
}

export interface FinanceBreakdownRow {
    label: string
    valueBase: number
    secondaryValueBase: number
    count: number
}

export interface FinanceTrendPoint {
    dateKey: string
    label: string
    revenueBase: number
    costBase: number
    profitBase: number
    spendBase: number
    commissionBase: number
}

export interface FinanceSalesRecordRow {
    key: string
    recordId: string
    source: RevenueAnalysisRecord['source']
    referenceCode: string
    date: string
    origin: string
    member: string
    partner: string
    revenueBase: number
    costBase: number
    profitBase: number
    margin: number
}

export interface FinanceSalesAnalytics {
    totals: {
        revenueBase: number
        costBase: number
        profitBase: number
        margin: number
        recordCount: number
    }
    trend: FinanceTrendPoint[]
    productRows: FinanceBreakdownRow[]
    originRows: FinanceBreakdownRow[]
    partnerRows: FinanceBreakdownRow[]
    memberRows: FinanceBreakdownRow[]
    recordRows: FinanceSalesRecordRow[]
}

export interface FinanceExpenseRow {
    item: ExpenseItem
    series: ExpenseSeries | null
}

export interface FinanceSpendAnalytics {
    totals: {
        operationalTotalBase: number
        operationalPaidBase: number
        payrollTotalBase: number
        payrollPaidBase: number
        dividendTotalBase: number
        totalAllocatedBase: number
        totalPaidBase: number
        totalOutstandingBase: number
        budgetLimitBase: number
        usageRatio: number
        burnRate: number
        monthNetProfitBase: number
        surplusAfterDistributionBase: number
        projectedRunRateBase: number
        overdueCount: number
        overdueBase: number
    }
    categoryRows: FinanceBreakdownRow[]
    departmentRows: FinanceBreakdownRow[]
    dividendRows: FinanceBreakdownRow[]
}

export interface FinanceLoanRow {
    loanId: string
    loanNo: string
    borrowerName: string
    linkedPartyName: string
    direction: string
    status: string
    balanceBase: number
    principalBase: number
    nextDueDate: string | null
    overdue: boolean
}

export interface FinanceInstallmentRow {
    loanId: string
    loanNo: string
    borrowerName: string
    linkedPartyName: string
    dueDate: string
    balanceBase: number
    status: string
    overdue: boolean
}

export interface FinanceLoanAnalytics {
    totals: {
        outstandingBase: number
        collectedBase: number
        dueSoonBase: number
        overdueBase: number
        activeCount: number
        dueSoonCount: number
        overdueCount: number
    }
    directionRows: FinanceBreakdownRow[]
    partnerRows: FinanceBreakdownRow[]
    loanRows: FinanceLoanRow[]
    installmentRows: FinanceInstallmentRow[]
    paymentTrend: FinanceTrendPoint[]
}

export interface FinancePartnerExposureRow {
    partnerId: string
    partnerName: string
    role: string
    receivableBase: number
    payableBase: number
    loanExposureBase: number
    netExposureBase: number
}

export interface FinanceTravelCommissionRow {
    label: string
    revenueBase: number
    costBase: number
    commissionBase: number
    count: number
}

export interface FinancePartnerCommissionAnalytics {
    totals: {
        receivableBase: number
        payableBase: number
        loanExposureBase: number
        netExposureBase: number
        travelRevenueBase: number
        travelCostBase: number
        travelCommissionBase: number
        completedTravelSalesCount: number
    }
    partnerRows: FinancePartnerExposureRow[]
    supplierRows: FinanceTravelCommissionRow[]
    groupRows: FinanceTravelCommissionRow[]
    commissionTrend: FinanceTrendPoint[]
}

type GroupAccumulator = {
    label: string
    valueBase: number
    secondaryValueBase: number
    count: number
}

function toBase(
    amount: number | undefined | null,
    currency: string | undefined | null,
    baseCurrency: CurrencyCode,
    rates: FinanceRates
) {
    return convertToStoreBase(amount, currency || baseCurrency, baseCurrency, rates)
}

function toDateKey(date: string) {
    return new Date(date).toISOString().slice(0, 10)
}

function toDayLabel(date: string) {
    return toDateKey(date).slice(-2)
}

function upsertGroup(
    groups: Map<string, GroupAccumulator>,
    label: string,
    valueBase: number,
    secondaryValueBase = 0,
    count = 1
) {
    const safeLabel = label.trim() || 'Unassigned'
    const current = groups.get(safeLabel)
    if (current) {
        current.valueBase += valueBase
        current.secondaryValueBase += secondaryValueBase
        current.count += count
        return
    }

    groups.set(safeLabel, {
        label: safeLabel,
        valueBase,
        secondaryValueBase,
        count
    })
}

function normalizeBreakdownRows(groups: Map<string, GroupAccumulator>) {
    return Array.from(groups.values()).sort((left, right) => right.valueBase - left.valueBase)
}

function isPendingStatus(status: string | undefined | null) {
    return status !== 'paid'
}

function getMemberLabel(record: RevenueAnalysisRecord) {
    if (record.source !== 'sale') {
        return 'Unassigned'
    }

    const value = record.cashier?.trim()
    return value || 'Unassigned'
}

function getPartnerLabel(record: RevenueAnalysisRecord) {
    const value = record.partyName?.trim()
    return value || 'Unassigned'
}

export function getDepartmentLabel(role?: string | null) {
    if (!role) {
        return 'Uncategorized'
    }

    const [department] = role.split(':')
    return department?.trim() || 'Uncategorized'
}

export function calculateBudgetLimitBase(
    allocation: BudgetAllocation | undefined,
    monthNetProfitBase: number,
    baseCurrency: CurrencyCode,
    rates: FinanceRates
) {
    if (!allocation) {
        return monthNetProfitBase
    }

    const value = allocation.allocationValue || 0
    const limitInCurrency = allocation.allocationType === 'percentage'
        ? (monthNetProfitBase * value) / 100
        : value

    return toBase(limitInCurrency, allocation.currency, baseCurrency, rates)
}

export function buildSalesAnalytics(
    records: RevenueAnalysisRecord[],
    baseCurrency: CurrencyCode,
    rates: FinanceRates
): FinanceSalesAnalytics {
    const productGroups = new Map<string, GroupAccumulator>()
    const originGroups = new Map<string, GroupAccumulator>()
    const partnerGroups = new Map<string, GroupAccumulator>()
    const memberGroups = new Map<string, GroupAccumulator>()
    const trendMap = new Map<string, FinanceTrendPoint>()

    let revenueBase = 0
    let costBase = 0
    let profitBase = 0

    const recordRows: FinanceSalesRecordRow[] = records.map((record) => {
        const totals = getRevenueAnalysisTotals(record)
        const currentRevenueBase = toBase(totals.revenue, record.currency, baseCurrency, rates)
        const currentCostBase = toBase(totals.cost, record.currency, baseCurrency, rates)
        const currentProfitBase = toBase(totals.profit, record.currency, baseCurrency, rates)
        const dateKey = toDateKey(record.date)
        const member = getMemberLabel(record)
        const partner = getPartnerLabel(record)
        const origin = formatOriginLabel(record.origin)

        revenueBase += currentRevenueBase
        costBase += currentCostBase
        profitBase += currentProfitBase

        const trendPoint = trendMap.get(dateKey) || {
            dateKey,
            label: dateKey,
            revenueBase: 0,
            costBase: 0,
            profitBase: 0,
            spendBase: 0,
            commissionBase: 0
        }
        trendPoint.revenueBase += currentRevenueBase
        trendPoint.costBase += currentCostBase
        trendPoint.profitBase += currentProfitBase
        trendMap.set(dateKey, trendPoint)

        upsertGroup(originGroups, origin, currentRevenueBase, currentProfitBase)
        upsertGroup(partnerGroups, partner, currentRevenueBase, currentProfitBase)
        upsertGroup(memberGroups, member, currentRevenueBase, currentProfitBase)

        for (const item of record.items) {
            const netQuantity = Math.max(0, (item.quantity || 0) - (item.returnedQuantity || 0))
            if (netQuantity <= 0) {
                continue
            }

            const itemRevenueBase = toBase(item.unitPrice * netQuantity, record.currency, baseCurrency, rates)
            const itemCostBase = toBase(item.costPrice * netQuantity, record.currency, baseCurrency, rates)
            const itemProfitBase = itemRevenueBase - itemCostBase

            upsertGroup(
                productGroups,
                item.productName || 'Unknown Product',
                itemRevenueBase,
                itemProfitBase,
                netQuantity
            )
        }

        return {
            key: record.key,
            recordId: record.id,
            source: record.source,
            referenceCode: record.referenceCode,
            date: record.date,
            origin,
            member,
            partner,
            revenueBase: currentRevenueBase,
            costBase: currentCostBase,
            profitBase: currentProfitBase,
            margin: currentRevenueBase > 0 ? (currentProfitBase / currentRevenueBase) * 100 : 0
        }
    })

    return {
        totals: {
            revenueBase,
            costBase,
            profitBase,
            margin: revenueBase > 0 ? (profitBase / revenueBase) * 100 : 0,
            recordCount: records.length
        },
        trend: Array.from(trendMap.values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
        productRows: normalizeBreakdownRows(productGroups),
        originRows: normalizeBreakdownRows(originGroups),
        partnerRows: normalizeBreakdownRows(partnerGroups),
        memberRows: normalizeBreakdownRows(memberGroups),
        recordRows: recordRows.sort((left, right) => right.date.localeCompare(left.date))
    }
}

export function buildMonthlyFinanceTrend(input: {
    monthRevenueRecords: RevenueAnalysisRecord[]
    expenseRows: FinanceExpenseRow[]
    payrollItems: PayrollItem[]
    dividendItems: DividendItem[]
    selectedMonth: MonthKey
    baseCurrency: CurrencyCode
    rates: FinanceRates
}) {
    const {
        monthRevenueRecords,
        expenseRows,
        payrollItems,
        dividendItems,
        selectedMonth,
        baseCurrency,
        rates
    } = input

    const points = new Map<string, FinanceTrendPoint>()
    const days = getDaysInMonth(selectedMonth)

    for (let day = 1; day <= days; day += 1) {
        const label = String(day).padStart(2, '0')
        points.set(label, {
            dateKey: `${selectedMonth}-${label}`,
            label,
            revenueBase: 0,
            costBase: 0,
            profitBase: 0,
            spendBase: 0,
            commissionBase: 0
        })
    }

    for (const record of monthRevenueRecords) {
        const totals = getRevenueAnalysisTotals(record)
        const label = toDayLabel(record.date)
        const point = points.get(label)
        if (!point) {
            continue
        }

        point.revenueBase += toBase(totals.revenue, record.currency, baseCurrency, rates)
        point.costBase += toBase(totals.cost, record.currency, baseCurrency, rates)
        point.profitBase += toBase(totals.profit, record.currency, baseCurrency, rates)
    }

    for (const row of expenseRows) {
        const label = row.item.dueDate.slice(-2)
        const point = points.get(label)
        if (!point) {
            continue
        }

        point.spendBase += toBase(row.item.amount, row.item.currency, baseCurrency, rates)
        point.profitBase -= toBase(row.item.amount, row.item.currency, baseCurrency, rates)
    }

    for (const item of payrollItems) {
        const label = item.dueDate.slice(-2)
        const point = points.get(label)
        if (!point) {
            continue
        }

        point.spendBase += toBase(item.amount, item.currency, baseCurrency, rates)
        point.profitBase -= toBase(item.amount, item.currency, baseCurrency, rates)
    }

    for (const item of dividendItems) {
        const label = item.dueDate.slice(-2)
        const point = points.get(label)
        if (!point) {
            continue
        }

        point.spendBase += toBase(item.amount, item.currency, baseCurrency, rates)
        point.profitBase -= toBase(item.amount, item.currency, baseCurrency, rates)
    }

    return Array.from(points.values())
}

export function buildSpendAnalytics(input: {
    expenseRows: FinanceExpenseRow[]
    payrollItems: PayrollItem[]
    dividendItems: DividendItem[]
    budgetAllocation?: BudgetAllocation
    monthNetProfitBase: number
    selectedMonth: MonthKey
    baseCurrency: CurrencyCode
    rates: FinanceRates
    today?: Date
}) {
    const {
        expenseRows,
        payrollItems,
        dividendItems,
        budgetAllocation,
        monthNetProfitBase,
        selectedMonth,
        baseCurrency,
        rates,
        today = new Date()
    } = input

    const categoryGroups = new Map<string, GroupAccumulator>()
    const departmentGroups = new Map<string, GroupAccumulator>()
    const dividendGroups = new Map<string, GroupAccumulator>()
    const todayKey = today.toISOString().slice(0, 10)

    let operationalTotalBase = 0
    let operationalPaidBase = 0
    let payrollTotalBase = 0
    let payrollPaidBase = 0
    let dividendTotalBase = 0
    let overdueCount = 0
    let overdueBase = 0

    for (const row of expenseRows) {
        const valueBase = toBase(row.item.amount, row.item.currency, baseCurrency, rates)
        const category = row.series?.category?.trim() || 'Uncategorized'

        operationalTotalBase += valueBase
        if (row.item.status === 'paid') {
            operationalPaidBase += valueBase
        }

        if (isPendingStatus(row.item.status) && row.item.dueDate < todayKey) {
            overdueCount += 1
            overdueBase += valueBase
        }

        upsertGroup(categoryGroups, category, valueBase, row.item.status === 'paid' ? valueBase : 0)
    }

    for (const item of payrollItems) {
        const valueBase = toBase(item.amount, item.currency, baseCurrency, rates)
        const department = getDepartmentLabel(item.employee.role)

        payrollTotalBase += valueBase
        if (item.status === 'paid') {
            payrollPaidBase += valueBase
        }

        if (isPendingStatus(item.status) && item.dueDate < todayKey) {
            overdueCount += 1
            overdueBase += valueBase
        }

        upsertGroup(departmentGroups, department, valueBase, item.status === 'paid' ? valueBase : 0)
    }

    for (const item of dividendItems) {
        const valueBase = toBase(item.amount, item.currency, baseCurrency, rates)
        dividendTotalBase += valueBase

        if (isPendingStatus(item.status) && item.dueDate < todayKey) {
            overdueCount += 1
            overdueBase += valueBase
        }

        upsertGroup(dividendGroups, item.employee.name, valueBase, item.baseAmount, 1)
    }

    const totalAllocatedBase = operationalTotalBase + payrollTotalBase
    const totalPaidBase = operationalPaidBase + payrollPaidBase
    const totalOutstandingBase = totalAllocatedBase - totalPaidBase
    const budgetLimitBase = calculateBudgetLimitBase(budgetAllocation, monthNetProfitBase, baseCurrency, rates)
    const usageRatio = budgetLimitBase > 0 ? (totalAllocatedBase / budgetLimitBase) * 100 : 0
    const burnRate = budgetLimitBase > 0 ? (totalPaidBase / budgetLimitBase) * 100 : 0
    const surplusAfterDistributionBase = monthNetProfitBase - totalAllocatedBase - dividendTotalBase

    const isCurrentMonth = selectedMonth === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const elapsedDays = Math.max(1, isCurrentMonth ? today.getDate() : getDaysInMonth(selectedMonth))
    const projectedRunRateBase = isCurrentMonth
        ? (totalPaidBase / elapsedDays) * getDaysInMonth(selectedMonth)
        : totalPaidBase

    return {
        totals: {
            operationalTotalBase,
            operationalPaidBase,
            payrollTotalBase,
            payrollPaidBase,
            dividendTotalBase,
            totalAllocatedBase,
            totalPaidBase,
            totalOutstandingBase,
            budgetLimitBase,
            usageRatio,
            burnRate,
            monthNetProfitBase,
            surplusAfterDistributionBase,
            projectedRunRateBase,
            overdueCount,
            overdueBase
        },
        categoryRows: normalizeBreakdownRows(categoryGroups),
        departmentRows: normalizeBreakdownRows(departmentGroups),
        dividendRows: normalizeBreakdownRows(dividendGroups)
    } satisfies FinanceSpendAnalytics
}

function isLoanOverdue(loan: Loan, todayKey: string) {
    if (loan.balanceAmount <= 0) {
        return false
    }

    if (loan.status === 'overdue') {
        return true
    }

    return !!loan.nextDueDate && loan.nextDueDate < todayKey
}

export function buildLoanAnalytics(input: {
    loans: Loan[]
    installments: LoanInstallment[]
    payments: LoanPayment[]
    baseCurrency: CurrencyCode
    rates: FinanceRates
    dateRange: string
    customDates: { start: string | null; end: string | null }
    today?: Date
}) {
    const {
        loans,
        installments,
        payments,
        baseCurrency,
        rates,
        dateRange,
        customDates,
        today = new Date()
    } = input

    const todayKey = today.toISOString().slice(0, 10)
    const dueSoonLimit = new Date(today)
    dueSoonLimit.setDate(dueSoonLimit.getDate() + 7)
    const dueSoonLimitKey = dueSoonLimit.toISOString().slice(0, 10)
    const directionGroups = new Map<string, GroupAccumulator>()
    const partnerGroups = new Map<string, GroupAccumulator>()
    const paymentTrendMap = new Map<string, FinanceTrendPoint>()
    const loanMap = new Map(loans.map((loan) => [loan.id, loan]))

    let outstandingBase = 0
    let collectedBase = 0
    let dueSoonBase = 0
    let overdueBase = 0
    let activeCount = 0
    let dueSoonCount = 0
    let overdueCount = 0

    const loanRows: FinanceLoanRow[] = loans
        .filter((loan) => !loan.isDeleted)
        .map((loan) => {
            const balanceBase = toBase(loan.balanceAmount, loan.settlementCurrency, baseCurrency, rates)
            const principalBase = toBase(loan.principalAmount, loan.settlementCurrency, baseCurrency, rates)
            const overdue = isLoanOverdue(loan, todayKey)
            const direction = loan.direction === 'borrowed'
                ? 'Borrowed'
                : loan.direction === 'lent'
                    ? 'Lent'
                    : 'Unspecified'
            const partnerName = loan.linkedPartyName?.trim() || 'Unassigned'

            if (loan.balanceAmount > 0) {
                outstandingBase += balanceBase
                activeCount += 1
                upsertGroup(directionGroups, direction, balanceBase, principalBase)
                upsertGroup(partnerGroups, partnerName, balanceBase, principalBase)
            }

            return {
                loanId: loan.id,
                loanNo: loan.loanNo,
                borrowerName: loan.borrowerName,
                linkedPartyName: partnerName,
                direction,
                status: overdue ? 'Overdue' : (loan.status || 'Active'),
                balanceBase,
                principalBase,
                nextDueDate: loan.nextDueDate || null,
                overdue
            }
        })
        .sort((left, right) => right.balanceBase - left.balanceBase)

    const installmentRows: FinanceInstallmentRow[] = installments
        .filter((item) => !item.isDeleted && item.balanceAmount > 0)
        .map((item) => {
            const loan = loanMap.get(item.loanId)
            const balanceBase = toBase( item.balanceAmount, loan?.settlementCurrency, baseCurrency, rates)
            const overdue = item.dueDate < todayKey

            if (item.dueDate >= todayKey && item.dueDate <= dueSoonLimitKey) {
                dueSoonBase += balanceBase
                dueSoonCount += 1
            }

            if (overdue) {
                overdueBase += balanceBase
                overdueCount += 1
            }

            return {
                loanId: item.loanId,
                loanNo: loan?.loanNo || item.loanId,
                borrowerName: loan?.borrowerName || 'Unknown',
                linkedPartyName: loan?.linkedPartyName?.trim() || 'Unassigned',
                dueDate: item.dueDate,
                balanceBase,
                status: item.status,
                overdue
            }
        })
        .sort((left, right) => {
            if (left.overdue !== right.overdue) {
                return left.overdue ? -1 : 1
            }
            return left.dueDate.localeCompare(right.dueDate)
        })

    for (const payment of payments.filter((item) => !item.isDeleted)) {
        if (!isRecordInDateRange(payment.paidAt, dateRange, customDates, today)) {
            continue
        }

        const loan = loanMap.get(payment.loanId)
        const collectedPaymentBase = toBase(payment.amount, loan?.settlementCurrency, baseCurrency, rates)
        const dateKey = toDateKey(payment.paidAt)
        const trendPoint = paymentTrendMap.get(dateKey) || {
            dateKey,
            label: dateKey,
            revenueBase: 0,
            costBase: 0,
            profitBase: 0,
            spendBase: 0,
            commissionBase: 0
        }
        trendPoint.revenueBase += collectedPaymentBase
        paymentTrendMap.set(dateKey, trendPoint)
        collectedBase += collectedPaymentBase
    }

    return {
        totals: {
            outstandingBase,
            collectedBase,
            dueSoonBase,
            overdueBase,
            activeCount,
            dueSoonCount,
            overdueCount
        },
        directionRows: normalizeBreakdownRows(directionGroups),
        partnerRows: normalizeBreakdownRows(partnerGroups),
        loanRows,
        installmentRows,
        paymentTrend: Array.from(paymentTrendMap.values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey))
    } satisfies FinanceLoanAnalytics
}

function getTravelDateKey(sale: TravelAgencySale) {
    return sale.paidAt || sale.saleDate || sale.createdAt
}

export function buildPartnerCommissionAnalytics(input: {
    partners: BusinessPartner[]
    travelSales: TravelAgencySale[]
    baseCurrency: CurrencyCode
    rates: FinanceRates
    dateRange: string
    customDates: { start: string | null; end: string | null }
    today?: Date
}) {
    const {
        partners,
        travelSales,
        baseCurrency,
        rates,
        dateRange,
        customDates,
        today = new Date()
    } = input

    let receivableBase = 0
    let payableBase = 0
    let loanExposureBase = 0
    let netExposureBase = 0

    const partnerRows: FinancePartnerExposureRow[] = partners
        .filter((partner) => !partner.isDeleted && !partner.mergedIntoBusinessPartnerId)
        .map((partner) => {
            const receivable = toBase(partner.receivableBalance, partner.defaultCurrency, baseCurrency, rates)
            const payable = toBase(partner.payableBalance, partner.defaultCurrency, baseCurrency, rates)
            const loanExposure = toBase(partner.loanOutstandingBalance, partner.defaultCurrency, baseCurrency, rates)
            const netExposure = toBase(partner.netExposure, partner.defaultCurrency, baseCurrency, rates)

            receivableBase += receivable
            payableBase += payable
            loanExposureBase += loanExposure
            netExposureBase += netExposure

            return {
                partnerId: partner.id,
                partnerName: partner.name,
                role: partner.role,
                receivableBase: receivable,
                payableBase: payable,
                loanExposureBase: loanExposure,
                netExposureBase: netExposure
            }
        })
        .sort((left, right) => Math.abs(right.netExposureBase) - Math.abs(left.netExposureBase))

    const supplierGroups = new Map<string, { label: string; revenueBase: number; costBase: number; commissionBase: number; count: number }>()
    const groupGroups = new Map<string, { label: string; revenueBase: number; costBase: number; commissionBase: number; count: number }>()
    const commissionTrendMap = new Map<string, FinanceTrendPoint>()

    let travelRevenueBase = 0
    let travelCostBase = 0
    let travelCommissionBase = 0
    let completedTravelSalesCount = 0

    for (const sale of travelSales) {
        if (sale.isDeleted || sale.status !== 'completed') {
            continue
        }

        const activityDate = getTravelDateKey(sale)
        if (!isRecordInDateRange(activityDate, dateRange, customDates, today)) {
            continue
        }

        const revenueBase = toBase(getTravelSaleRevenue(sale), sale.currency, baseCurrency, rates)
        const costBase = toBase(getTravelSaleCost(sale), sale.currency, baseCurrency, rates)
        const commissionBase = toBase(getTravelSaleNet(sale), sale.currency, baseCurrency, rates)
        const supplierLabel = sale.supplierName?.trim() || 'Unassigned'
        const groupLabel = sale.groupName?.trim() || sale.saleNumber
        const dateKey = toDateKey(activityDate)
        const trendPoint = commissionTrendMap.get(dateKey) || {
            dateKey,
            label: dateKey,
            revenueBase: 0,
            costBase: 0,
            profitBase: 0,
            spendBase: 0,
            commissionBase: 0
        }

        trendPoint.revenueBase += revenueBase
        trendPoint.costBase += costBase
        trendPoint.commissionBase += commissionBase
        trendPoint.profitBase += commissionBase
        commissionTrendMap.set(dateKey, trendPoint)

        const supplier = supplierGroups.get(supplierLabel) || {
            label: supplierLabel,
            revenueBase: 0,
            costBase: 0,
            commissionBase: 0,
            count: 0
        }
        supplier.revenueBase += revenueBase
        supplier.costBase += costBase
        supplier.commissionBase += commissionBase
        supplier.count += 1
        supplierGroups.set(supplierLabel, supplier)

        const group = groupGroups.get(groupLabel) || {
            label: groupLabel,
            revenueBase: 0,
            costBase: 0,
            commissionBase: 0,
            count: 0
        }
        group.revenueBase += revenueBase
        group.costBase += costBase
        group.commissionBase += commissionBase
        group.count += 1
        groupGroups.set(groupLabel, group)

        travelRevenueBase += revenueBase
        travelCostBase += costBase
        travelCommissionBase += commissionBase
        completedTravelSalesCount += 1
    }

    const mapTravelRows = (rows: Map<string, { label: string; revenueBase: number; costBase: number; commissionBase: number; count: number }>) =>
        Array.from(rows.values()).sort((left, right) => right.commissionBase - left.commissionBase)

    return {
        totals: {
            receivableBase,
            payableBase,
            loanExposureBase,
            netExposureBase,
            travelRevenueBase,
            travelCostBase,
            travelCommissionBase,
            completedTravelSalesCount
        },
        partnerRows,
        supplierRows: mapTravelRows(supplierGroups),
        groupRows: mapTravelRows(groupGroups),
        commissionTrend: Array.from(commissionTrendMap.values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey))
    } satisfies FinancePartnerCommissionAnalytics
}
