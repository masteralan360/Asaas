import React, { createContext, useContext, useState, useEffect } from 'react'

export type DateRangeType = 'today' | 'month' | 'custom'

interface CustomDates {
    start: string
    end: string
}

interface DateRangeContextType {
    dateRange: DateRangeType
    customDates: CustomDates
    setDateRange: (range: DateRangeType) => void
    setCustomDates: (dates: CustomDates | ((prev: CustomDates) => CustomDates)) => void
}

const DateRangeContext = createContext<DateRangeContextType | undefined>(undefined)

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
    const [dateRange, setDateRange] = useState<DateRangeType>(() => {
        // Migration: check for previous local page-specific settings first, then default to 'month'
        const cached = localStorage.getItem('global_date_range') ||
            localStorage.getItem('revenue_date_range') ||
            localStorage.getItem('sales_date_range')
        return (cached as DateRangeType) || 'month'
    })

    const [customDates, setCustomDates] = useState<CustomDates>(() => {
        const cached = localStorage.getItem('global_custom_dates') ||
            localStorage.getItem('revenue_custom_dates') ||
            localStorage.getItem('sales_custom_dates')
        return cached ? JSON.parse(cached) : { start: '', end: '' }
    })

    useEffect(() => {
        localStorage.setItem('global_date_range', dateRange)
    }, [dateRange])

    useEffect(() => {
        localStorage.setItem('global_custom_dates', JSON.stringify(customDates))
    }, [customDates])

    return (
        <DateRangeContext.Provider value={{ dateRange, customDates, setDateRange, setCustomDates }}>
            {children}
        </DateRangeContext.Provider>
    )
}

export function useDateRange() {
    const context = useContext(DateRangeContext)
    if (context === undefined) {
        throw new Error('useDateRange must be used within a DateRangeProvider')
    }
    return context
}
