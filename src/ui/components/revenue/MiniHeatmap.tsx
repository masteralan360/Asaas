import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Sale } from '@/types'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components'

interface MiniHeatmapProps {
    sales: Sale[]
}

export function MiniHeatmap({ sales }: MiniHeatmapProps) {
    const { t, i18n } = useTranslation()

    const { heatmapData, maxHeatmapVal } = useMemo(() => {
        // Initialize heatmap matrix: 7 days x 24 hours
        // JS Date: 0=Sun, 1=Mon, ..., 6=Sat
        const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0))
        let maxVal = 0

        sales.forEach(sale => {
            if (sale.is_returned) return
            const dateObj = new Date(sale.created_at)
            const hour = dateObj.getHours()
            const day = dateObj.getDay()

            heatmap[day][hour]++
            if (heatmap[day][hour] > maxVal) maxVal = heatmap[day][hour]
        })

        return {
            heatmapData: heatmap,
            maxHeatmapVal: maxVal
        }
    }, [sales])

    // Generate day labels based on locale
    const dayLabels = useMemo(() => {
        const labels = []
        // 0=Sun to 6=Sat
        for (let i = 0; i < 7; i++) {
            const d = new Date(2025, 0, 5 + i)
            labels.push(d.toLocaleDateString(i18n.language, { weekday: 'narrow' }))
        }
        return labels
    }, [i18n.language])

    // Order: Mon(1) -> Sun(0)
    const orderedDayIndices = [1, 2, 3, 4, 5, 6, 0]

    if (!sales || sales.length === 0) {
        return <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">{t('common.noData') || 'No data'}</div>
    }

    return (
        <div className="w-full overflow-x-auto pb-2">
            <div className="min-w-[300px] select-none">
                <div className="grid grid-cols-[20px_repeat(24,1fr)] gap-y-0.5 gap-x-[1px]">
                    {/* Header Row (Hours - Simplified) */}
                    <div className="col-start-1"></div>
                    {Array.from({ length: 12 }).map((_, i) => {
                        const h = i * 2 // Show every 2nd hour label
                        return (
                            <div key={`header-${h}`} className="col-span-2 text-[8px] font-bold text-muted-foreground/50 text-center">
                                {h}
                            </div>
                        )
                    })}

                    {/* Data Rows */}
                    {orderedDayIndices.map((dayIndex) => {
                        const dayName = dayLabels[dayIndex]
                        const dayFull = new Date(2025, 0, 5 + dayIndex).toLocaleDateString(i18n.language, { weekday: 'long' })
                        const dayData = heatmapData[dayIndex]

                        return (
                            <div key={`day-${dayIndex}`} className="contents group">
                                {/* Day Label */}
                                <div className="flex items-center justify-center text-[9px] font-bold text-muted-foreground/80 uppercase">
                                    {dayName}
                                </div>

                                {/* 24 Hour Cells */}
                                {dayData.map((count, hour) => {
                                    let bgClass = 'bg-secondary/20'
                                    const intensity = maxHeatmapVal > 0 ? count / maxHeatmapVal : 0

                                    if (count > 0) {
                                        if (intensity > 0.8) bgClass = 'bg-red-600 dark:bg-red-500'
                                        else if (intensity > 0.6) bgClass = 'bg-red-500/80'
                                        else if (intensity > 0.4) bgClass = 'bg-red-500/60'
                                        else if (intensity > 0.2) bgClass = 'bg-red-500/40'
                                        else bgClass = 'bg-red-500/20'
                                    }

                                    return (
                                        <TooltipProvider key={`cell-${dayIndex}-${hour}`}>
                                            <Tooltip delayDuration={0}>
                                                <TooltipTrigger asChild>
                                                    <div className={cn(
                                                        "h-3 rounded-[1px] transition-all hover:scale-110 hover:z-10 cursor-crosshair",
                                                        bgClass,
                                                        count === 0 && "hover:bg-secondary/40"
                                                    )} />
                                                </TooltipTrigger>
                                                <TooltipContent
                                                    side="top"
                                                    className="bg-popover text-popover-foreground text-[10px] font-bold px-2 py-1 border-border shadow-md"
                                                >
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-muted-foreground uppercase text-[9px]">{dayFull} {hour}:00</span>
                                                        <span className="text-foreground">{count} {t('revenue.salesCount') || 'Sales'}</span>
                                                    </div>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )
                                })}
                            </div>
                        )
                    })}
                </div>

                <div className="mt-3 flex items-center justify-center gap-2 text-[9px] text-muted-foreground font-medium">
                    <span>{t('revenue.less') || 'Less'}</span>
                    <div className="flex gap-[1px]">
                        <div className="w-2 h-2 bg-red-500/20 rounded-[0.5px]"></div>
                        <div className="w-2 h-2 bg-red-500/40 rounded-[0.5px]"></div>
                        <div className="w-2 h-2 bg-red-500/60 rounded-[0.5px]"></div>
                        <div className="w-2 h-2 bg-red-500/80 rounded-[0.5px]"></div>
                        <div className="w-2 h-2 bg-red-500 rounded-[0.5px]"></div>
                    </div>
                    <span>{t('revenue.more') || 'More'}</span>
                </div>
            </div>
        </div>
    )
}
