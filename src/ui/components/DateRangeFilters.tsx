import { useTranslation } from 'react-i18next'
import { Calendar } from 'lucide-react'
import { Button, Input } from '@/ui/components'
import { useDateRange } from '@/context/DateRangeContext'
import { cn } from '@/lib/utils'

interface DateRangeFiltersProps {
    className?: string
}

export function DateRangeFilters({ className }: DateRangeFiltersProps) {
    const { t } = useTranslation()
    const { dateRange, customDates, setDateRange, setCustomDates } = useDateRange()

    return (
        <div className={cn("flex flex-wrap items-center gap-3", className)}>
            <div className="bg-secondary/50 p-1 rounded-lg flex items-center gap-1 shadow-sm border border-border/50">
                <Button
                    variant={dateRange === 'today' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setDateRange('today')}
                    className={cn("text-xs h-8 px-4 transition-all duration-200", dateRange === 'today' && "shadow-sm")}
                    type="button"
                >
                    {t('performance.filters.today')}
                </Button>
                <Button
                    variant={dateRange === 'month' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setDateRange('month')}
                    className={cn("text-xs h-8 px-4 transition-all duration-200", dateRange === 'month' && "shadow-sm")}
                    type="button"
                >
                    {t('performance.filters.thisMonth')}
                </Button>
                <Button
                    variant={dateRange === 'custom' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setDateRange('custom')}
                    className={cn("text-xs h-8 px-4 gap-1.5 transition-all duration-200", dateRange === 'custom' && "shadow-sm")}
                    type="button"
                >
                    <Calendar className="w-3.5 h-3.5" />
                    {t('performance.filters.custom')}
                </Button>
            </div>

            {dateRange === 'custom' && (
                <div className="flex items-center gap-2 bg-secondary/30 p-1 px-3 rounded-lg border border-border/50 animate-in fade-in slide-in-from-left-2 duration-300">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">{t('performance.filters.start')}</span>
                        <Input
                            type="date"
                            value={customDates.start}
                            onChange={(e) => setCustomDates(prev => ({ ...prev, start: e.target.value }))}
                            className="h-8 text-xs w-36 bg-background/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50 transition-all font-mono"
                        />
                    </div>
                    <div className="w-px h-4 bg-border/50 mx-1" />
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">{t('performance.filters.end')}</span>
                        <Input
                            type="date"
                            value={customDates.end}
                            onChange={(e) => setCustomDates(prev => ({ ...prev, end: e.target.value }))}
                            className="h-8 text-xs w-36 bg-background/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50 transition-all font-mono"
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
