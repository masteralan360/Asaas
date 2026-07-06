import type { DateRangeType } from '@/context/DateRangeContext'

export interface DateRangeCustomDates {
    start: string
    end: string
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function toValidDate(value: Date | string | null | undefined) {
    if (!value) return null
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value
    }

    const dateOnlyMatch = DATE_ONLY_PATTERN.exec(value)
    const date = dateOnlyMatch
        ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
        : new Date(value)

    return Number.isNaN(date.getTime()) ? null : date
}

export function isDateInDateRange(
    value: Date | string | null | undefined,
    dateRange: DateRangeType,
    customDates: DateRangeCustomDates,
    now = new Date()
) {
    if (dateRange === 'allTime' || (dateRange === 'custom' && !customDates.start && !customDates.end)) {
        return true
    }

    const date = toValidDate(value)
    if (!date) {
        return false
    }

    if (dateRange === 'today') {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
        return date >= startOfDay
    }

    if (dateRange === 'month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
        return date >= startOfMonth
    }

    if (dateRange === 'custom' && (customDates.start || customDates.end)) {
        const start = toValidDate(customDates.start)
        if (start) start.setHours(0, 0, 0, 0)

        const end = toValidDate(customDates.end)
        if (end) end.setHours(23, 59, 59, 999)

        if (start && date < start) return false
        if (end && date > end) return false
    }

    return true
}
