import type { Employee, Expense } from '@/local-db/models'
import { formatCurrency } from '@/lib/utils'

interface MonthlyFinancials {
    profit?: Record<string, number>
}

export interface DividendReminderMeta {
    amount: number
    currency: string
    displayAmount: string
    formula?: string
}

interface BuildDividendReminderMetaMapParams {
    expenses: Expense[]
    employees: Employee[]
    selectedDate: Date
    monthlyFinancials: MonthlyFinancials
    baseCurrency: string
    iqdPreference?: string
    convertToStoreBase: (amount: number | undefined | null, from: string | undefined | null) => number
}

const normalizeExpenseField = (value?: string | null) => (value || '').trim().toLowerCase()

const isRecurringOccurrenceMatch = (
    recurringTemplate: Expense,
    expenseRecord: Expense,
    monthStart: Date,
    monthEnd: Date
): boolean => {
    if (!recurringTemplate || !expenseRecord || expenseRecord.type !== 'one-time') return false

    const expenseDueDate = new Date(expenseRecord.dueDate)
    if (isNaN(expenseDueDate.getTime()) || expenseDueDate < monthStart || expenseDueDate > monthEnd) return false

    if (expenseRecord.category !== recurringTemplate.category) return false
    if (normalizeExpenseField(expenseRecord.description) !== normalizeExpenseField(recurringTemplate.description)) return false
    if (normalizeExpenseField(expenseRecord.subcategory) !== normalizeExpenseField(recurringTemplate.subcategory)) return false

    const recurringDay = new Date(recurringTemplate.dueDate).getDate()
    if (isNaN(recurringDay)) return false

    const projectedDay = Math.min(
        recurringDay,
        new Date(expenseDueDate.getFullYear(), expenseDueDate.getMonth() + 1, 0).getDate()
    )

    return expenseDueDate.getDate() === projectedDay
}

export function buildDividendReminderMetaMap({
    expenses,
    employees,
    selectedDate,
    monthlyFinancials,
    baseCurrency,
    iqdPreference,
    convertToStoreBase
}: BuildDividendReminderMetaMapParams): Map<string, DividendReminderMeta> {
    const year = selectedDate.getFullYear()
    const month = selectedDate.getMonth()
    const monthStart = new Date(year, month, 1)
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59)

    const recurringTemplates = expenses.filter(exp => exp.type === 'recurring')
    const monthExpenses = expenses.filter(exp => {
        const dueDate = new Date(exp.dueDate)
        if (exp.type !== 'one-time') return false
        if (exp.category === 'payroll' && exp.employeeId) return false
        return dueDate >= monthStart && dueDate <= monthEnd
    })

    const virtualRecurringExpenses = recurringTemplates.filter(template => {
        const hasMaterializedOccurrence = monthExpenses.some(exp =>
            isRecurringOccurrenceMatch(template, exp, monthStart, monthEnd)
        )
        return !hasMaterializedOccurrence
    })

    const operationalTotal = [...monthExpenses, ...virtualRecurringExpenses].reduce(
        (sum, exp) => sum + convertToStoreBase(exp.amount, exp.currency),
        0
    )

    const personnelTotal = employees.reduce((sum, emp) => {
        if (!emp.salary || emp.salary <= 0) return sum
        return sum + convertToStoreBase(emp.salary, emp.salaryCurrency || 'usd')
    }, 0)

    const totalProfitFromRevenue = Object.entries(monthlyFinancials.profit || {}).reduce(
        (sum, [currency, amount]) => sum + convertToStoreBase(amount, currency),
        0
    )

    const profitPool = Math.max(0, totalProfitFromRevenue - operationalTotal - personnelTotal)
    const metaMap = new Map<string, DividendReminderMeta>()

    employees.forEach(emp => {
        if (!emp.hasDividends || !emp.dividendAmount || emp.dividendAmount <= 0 || emp.isFired) return

        const configuredValue = emp.dividendAmount
        const amount = emp.dividendType === 'fixed'
            ? configuredValue
            : profitPool * (configuredValue / 100)
        const currency = emp.dividendType === 'fixed'
            ? (emp.dividendCurrency || 'usd')
            : baseCurrency

        metaMap.set(emp.id, {
            amount,
            currency,
            displayAmount: formatCurrency(amount, currency as any, iqdPreference as any),
            formula: emp.dividendType === 'percentage' ? `${configuredValue}%` : undefined
        })
    })

    return metaMap
}
