import { useTranslation } from 'react-i18next'
import { Calendar } from 'lucide-react'
import { Button, DateTimePicker } from '@/ui/components'
import { useDateRange } from '@/context/DateRangeContext'
import type { DateRangeType } from '@/context/DateRangeContext'
import { cn, parseLocalDateValue, formatLocalDateValue } from '@/lib/utils'

type CustomDates = {
    start: string
    end: string
}

interface DateRangeFiltersProps {
    className?: string
    label?: string
    labelDotClassName?: string
    allTimeButtonClassName?: string
    showAllTime?: boolean
    showYesterday?: boolean
    dateRange?: DateRangeType
    customDates?: CustomDates
    onDateRangeChange?: (range: DateRangeType) => void
    onCustomDatesChange?: (dates: CustomDates) => void
}

export function DateRangeFilters({
    className,
    label,
    labelDotClassName,
    allTimeButtonClassName,
    showAllTime = true,
    showYesterday = false,
    dateRange: controlledDateRange,
    customDates: controlledCustomDates,
    onDateRangeChange,
    onCustomDatesChange
}: DateRangeFiltersProps) {
    const { t } = useTranslation()
    const {
        dateRange: contextDateRange,
        customDates: contextCustomDates,
        setDateRange: setContextDateRange,
        setCustomDates: setContextCustomDates
    } = useDateRange()
    const dateRange = controlledDateRange ?? contextDateRange
    const customDates = controlledCustomDates ?? contextCustomDates
    const setDateRange = onDateRangeChange ?? setContextDateRange
    const updateCustomDates = (next: Partial<CustomDates>) => {
        if (onCustomDatesChange) {
            onCustomDatesChange({ ...customDates, ...next })
            return
        }
        setContextCustomDates((current) => ({ ...current, ...next }))
    }

    return (
        <div className={cn("relative rounded-2xl border border-border/70 bg-background/95 p-2.5 shadow-sm", className)}>
            {label && (
                <div className="mb-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                    <span className={cn("h-2 w-2 rounded-full bg-primary", labelDotClassName)} />
                    {label}
                </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
                <div className="bg-secondary/50 p-1 rounded-lg flex items-center gap-1 shadow-sm border border-border/50">
                    <Button
                        variant={dateRange === 'today' ? 'default' : 'ghost'}
                        size="sm"
                        allowViewer={true}
                        onClick={() => setDateRange('today')}
                        className={cn("text-xs h-8 px-4 transition-all duration-200", dateRange === 'today' && "shadow-sm")}
                        type="button"
                    >
{t('performance.filters.today')}
                    </Button>
                    {showYesterday && (
                        <Button
                            variant={dateRange === 'yesterday' ? 'default' : 'ghost'}
                            size="sm"
                            allowViewer={true}
                            onClick={() => setDateRange('yesterday')}
                            className={cn("text-xs h-8 px-4 transition-all duration-200", dateRange === 'yesterday' && "shadow-sm")}
                            type="button"
                        >
                            {t('performance.filters.yesterday')}
                        </Button>
                    )}
                    <Button
                        variant={dateRange === 'month' ? 'default' : 'ghost'}
                        size="sm"
                        allowViewer={true}
                        onClick={() => setDateRange('month')}
                        className={cn("text-xs h-8 px-4 transition-all duration-200", dateRange === 'month' && "shadow-sm")}
                        type="button"
                    >
                        {t('performance.filters.thisMonth')}
                    </Button>
                    <Button
                        variant={dateRange === 'lastMonth' ? 'default' : 'ghost'}
                        size="sm"
                        allowViewer={true}
                        onClick={() => setDateRange('lastMonth')}
                        className={cn("text-xs h-8 px-4 transition-all duration-200", dateRange === 'lastMonth' && "shadow-sm")}
                        type="button"
                    >
                        {t('performance.filters.lastMonth')}
                    </Button>
                    {showAllTime && (
                        <Button
                            variant={dateRange === 'allTime' ? 'default' : 'ghost'}
                            size="sm"
                            allowViewer={true}
                            onClick={() => setDateRange('allTime')}
                            className={cn("text-xs h-8 px-4 transition-all duration-200", allTimeButtonClassName, dateRange === 'allTime' && "shadow-sm")}
                            type="button"
                        >
                            {t('performance.filters.allTime') || 'All Time'}
                        </Button>
                    )}
                    <Button
                        variant={dateRange === 'custom' ? 'default' : 'ghost'}
                        size="sm"
                        allowViewer={true}
                        onClick={() => setDateRange('custom')}
                        className={cn("text-xs h-8 px-2.5 transition-all duration-200", dateRange === 'custom' && "shadow-sm")}
                        type="button"
                        title={t('performance.filters.custom')}
                    >
                        <Calendar className="w-3.5 h-3.5" />
                    </Button>
                </div>

                {dateRange === 'custom' && (
                    <div className="flex items-center gap-2 bg-secondary/30 p-1 px-3 rounded-lg border border-border/50 animate-in fade-in slide-in-from-left-2 duration-300">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">{t('performance.filters.start')}</span>
                            <DateTimePicker
                                mode="date"
                                date={parseLocalDateValue(customDates.start)}
                                setDate={(value) => updateCustomDates({ start: value ? formatLocalDateValue(value) : '' })}
                                buttonClassName="h-8 text-xs w-36 bg-background/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50 transition-all font-mono"
                                placeholder="dd/mm/yy"
                            />
                        </div>
                        <div className="w-px h-4 bg-border/50 mx-1" />
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">{t('performance.filters.end')}</span>
                            <DateTimePicker
                                mode="date"
                                date={parseLocalDateValue(customDates.end)}
                                setDate={(value) => updateCustomDates({ end: value ? formatLocalDateValue(value) : '' })}
                                buttonClassName="h-8 text-xs w-36 bg-background/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50 transition-all font-mono"
                                placeholder="dd/mm/yy"
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
