import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
} from '@/ui/components'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell
} from 'recharts'
import { Clock, Activity, CalendarDays, Grid3X3 } from 'lucide-react'
import { Sale } from '@/types'
import { cn } from '@/lib/utils'

interface PeakTradingModalProps {
    isOpen: boolean
    onClose: () => void
    sales: Sale[]
}

export function PeakTradingModal({ isOpen, onClose, sales }: PeakTradingModalProps) {
    const { t, i18n } = useTranslation()
    const isRtl = i18n.dir() === 'rtl'
    const [activeTab, setActiveTab] = useState('hourly')

    const { hourlyData, heatmapData, maxHeatmapVal } = useMemo(() => {
        // Initialize hourly counts (0-23)
        const hourlyCount: number[] = new Array(24).fill(0)

        // Initialize heatmap matrix: 7 days x 24 hours
        // JS Date: 0=Sun, 1=Mon, ..., 6=Sat
        // We want strict ordering. Let's stick to 0=Sun to 6=Sat index for simplicity.
        const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0))

        let maxVal = 0

        sales.forEach(sale => {
            if (sale.is_returned) return
            const dateObj = new Date(sale.created_at)
            const hour = dateObj.getHours()
            const day = dateObj.getDay()

            // Hourly Total
            hourlyCount[hour]++

            // Heatmap Cell
            heatmap[day][hour]++
            if (heatmap[day][hour] > maxVal) maxVal = heatmap[day][hour]
        })

        const maxHourly = Math.max(...hourlyCount)

        const hourlyMapped = hourlyCount.map((count, hour) => ({
            hour: hour.toString().padStart(2, '0') + ':00',
            count,
            isPeak: count === maxHourly && maxHourly > 0
        }))

        return {
            hourlyData: hourlyMapped,
            heatmapData: heatmap,
            maxHeatmapVal: maxVal
        }
    }, [sales])

    const peakHour = useMemo(() => {
        const peak = hourlyData.find(d => d.isPeak)
        return peak?.hour || 'N/A'
    }, [hourlyData])

    const totalSales = useMemo(() => {
        return hourlyData.reduce((sum, d) => sum + d.count, 0)
    }, [hourlyData])

    // Generate day labels based on locale
    const dayLabels = useMemo(() => {
        const labels = []
        // 0=Sun to 6=Sat
        for (let i = 0; i < 7; i++) {
            // Create a dummy date for that day of week. 
            // Jan 5 2025 is a Sunday. Jan 5 + i = Day i.
            const d = new Date(2025, 0, 5 + i)
            labels.push(d.toLocaleDateString(i18n.language, { weekday: 'short' }))
        }
        return labels
    }, [i18n.language])

    // Reorder days if needed (e.g. start Monday). 
    // Standard JS getDay() is Sun=0. Let's display Sun->Sat for consistency or Mon->Sun.
    // Most business analytics prefer Mon-Sun. Let's do Mon(1) -> Sun(0) mapping visually?
    // User image shows Mon -> Sun.
    // Let's reorder: Mon(1), Tue(2), Wed(3), Thu(4), Fri(5), Sat(6), Sun(0).
    const orderedDayIndices = [1, 2, 3, 4, 5, 6, 0]

    if (!sales) return null

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={cn(
                "max-w-4xl p-0 bg-background/95 backdrop-blur-3xl overflow-hidden rounded-[2.5rem] shadow-2xl transition-all duration-500",
                "border-[3px] border-violet-500/50 shadow-violet-500/10"
            )}>
                <div className="p-6 md:p-8 space-y-6 max-h-[90vh] overflow-y-auto custom-scrollbar [print-color-adjust:exact] -webkit-print-color-adjust:exact">
                    <DialogHeader className="flex flex-row items-center justify-between space-y-0">
                        <div className="flex items-center gap-4">
                            <div className="p-4 rounded-2xl shadow-inner bg-violet-500/10">
                                <Clock className="w-5 h-5 text-violet-500" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-black tracking-tight">
                                    {t('revenue.peakTimes')}
                                </DialogTitle>
                                <DialogDescription className="text-sm font-semibold text-muted-foreground/80">
                                    {t('revenue.peakTimesDesc')}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <Card className="bg-violet-500/10 border-violet-500/20 rounded-2xl">
                            <CardContent className="p-4 flex items-center gap-3">
                                <Activity className="w-6 h-6 text-violet-500" />
                                <div>
                                    <p className="text-xs font-bold uppercase text-muted-foreground">{t('revenue.peakHour') || 'Peak Hour'}</p>
                                    <p className="text-2xl font-black text-violet-600 dark:text-violet-400 tabular-nums">
                                        {peakHour}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="bg-slate-500/10 border-slate-500/20 rounded-2xl">
                            <CardContent className="p-4 flex items-center gap-3">
                                <Clock className="w-6 h-6 text-slate-500" />
                                <div>
                                    <p className="text-xs font-bold uppercase text-muted-foreground">{t('revenue.totalTransactions') || 'Total Transactions'}</p>
                                    <p className="text-2xl font-black text-foreground tabular-nums">
                                        {totalSales}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <div className="flex items-center justify-between mb-4">
                            <TabsList className="grid w-full max-w-[400px] grid-cols-2 h-10 rounded-xl bg-secondary/50 p-1">
                                <TabsTrigger value="hourly" className="rounded-lg text-xs font-bold uppercase tracking-wide data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-300">
                                    <Activity className="w-3.5 h-3.5 mr-2" />
                                    {t('revenue.hourly')}
                                </TabsTrigger>
                                <TabsTrigger value="heatmap" className="rounded-lg text-xs font-bold uppercase tracking-wide data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-300">
                                    <Grid3X3 className="w-3.5 h-3.5 mr-2" />
                                    {t('revenue.heatmap')}
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        {/* Hourly Content */}
                        <TabsContent value="hourly" className="mt-0 focus-visible:outline-none">
                            <Card className="bg-card/40 border-border/30 backdrop-blur-md overflow-hidden rounded-[2rem] shadow-sm">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/70 flex items-center gap-2">
                                        <Activity className="w-3.5 h-3.5" />
                                        {t('revenue.hourlyDistribution') || 'Hourly Distribution'}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-4">
                                    <ResponsiveContainer width="100%" height={350}>
                                        <BarChart data={hourlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorBarPeak" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
                                                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.5} />
                                                </linearGradient>
                                                <linearGradient id="colorBarNormal" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.6} />
                                                    <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.2} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
                                            <XAxis
                                                dataKey="hour"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fontSize: 9, fontWeight: 700, fill: 'currentColor' }}
                                                className="text-muted-foreground"
                                                interval={1}
                                                reversed={isRtl}
                                            />
                                            <YAxis
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }}
                                                className="text-muted-foreground"
                                                allowDecimals={false}
                                                orientation={isRtl ? 'right' : 'left'}
                                            />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: 'hsl(var(--popover))',
                                                    borderRadius: '20px',
                                                    border: '1px solid hsl(var(--border))',
                                                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                                                    padding: '12px',
                                                    color: 'hsl(var(--popover-foreground))'
                                                }}
                                                itemStyle={{ fontSize: '11px', fontWeight: 'bold', padding: '2px 0', color: 'inherit' }}
                                                labelStyle={{ fontSize: '10px', fontWeight: 'black', textTransform: 'uppercase', marginBottom: '8px', opacity: 0.6 }}
                                                cursor={{ fill: 'hsl(var(--accent))', opacity: 0.1 }}
                                                formatter={(value: any) => [value, t('revenue.transactions') || 'Transactions']}
                                            />
                                            <Bar
                                                dataKey="count"
                                                radius={[6, 6, 0, 0]}
                                                animationDuration={1500}
                                            >
                                                {hourlyData.map((entry, index) => (
                                                    <Cell
                                                        key={`cell-${index}`}
                                                        fill={entry.isPeak ? 'url(#colorBarPeak)' : 'url(#colorBarNormal)'}
                                                    />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* Heatmap Content */}
                        <TabsContent value="heatmap" className="mt-0 focus-visible:outline-none">
                            <Card className="bg-card/40 border-border/30 backdrop-blur-md overflow-hidden rounded-[2rem] shadow-sm">
                                <CardHeader className="pb-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2 text-muted-foreground">
                                            <CalendarDays className="w-4 h-4" />
                                            <span className="text-xs font-bold uppercase tracking-wider">{t('revenue.weeklyHeatmap') || 'Weekly Heatmap'}</span>
                                        </div>
                                        <div className="flex items-center space-x-2 text-[10px] font-medium text-muted-foreground mr-4">
                                            <span className="uppercase">{t('revenue.less') || 'Less'}</span>
                                            <div className="flex space-x-[1px]">
                                                <div className="w-2.5 h-2.5 bg-red-500/10 rounded-[1px]"></div>
                                                <div className="w-2.5 h-2.5 bg-red-500/30 rounded-[1px]"></div>
                                                <div className="w-2.5 h-2.5 bg-red-500/50 rounded-[1px]"></div>
                                                <div className="w-2.5 h-2.5 bg-red-500/70 rounded-[1px]"></div>
                                                <div className="w-2.5 h-2.5 bg-red-500 rounded-[1px]"></div>
                                            </div>
                                            <span className="uppercase">{t('revenue.more') || 'More'}</span>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="overflow-x-auto">
                                    <div className="min-w-[600px] select-none">
                                        {/* Grid Container */}
                                        <div className="grid grid-cols-[40px_repeat(24,1fr)] gap-y-1 gap-x-[1px]">

                                            {/* Header Row (Hours) */}
                                            <div className="col-start-1"></div> {/* Empty corner */}
                                            {Array.from({ length: 24 }).map((_, h) => (
                                                <div key={`header-${h}`} className="text-[9px] font-black text-muted-foreground/50 text-center uppercase">
                                                    {h % 2 === 0 ? `${h.toString().padStart(2, '0')}h` : ''}
                                                </div>
                                            ))}

                                            {/* Data Rows (Days) */}
                                            {orderedDayIndices.map((dayIndex) => {
                                                const dayName = dayLabels[dayIndex]
                                                const dayData = heatmapData[dayIndex]

                                                return (
                                                    <div key={`day-${dayIndex}`} className="contents group">
                                                        {/* Day Label */}
                                                        <div className="flex items-center justify-end pr-2 text-[10px] font-bold text-muted-foreground/80 uppercase tracking-tight">
                                                            {dayName}
                                                        </div>

                                                        {/* 24 Hour Cells */}
                                                        {dayData.map((count, hour) => {
                                                            let bgClass = 'bg-secondary/20 hover:bg-secondary/40' // default empty
                                                            const intensity = maxHeatmapVal > 0 ? count / maxHeatmapVal : 0

                                                            if (count > 0) {
                                                                // Red Scale to match user request
                                                                if (intensity > 0.8) bgClass = 'bg-red-600 dark:bg-red-500 hover:opacity-90'
                                                                else if (intensity > 0.6) bgClass = 'bg-red-500/80 hover:bg-red-500'
                                                                else if (intensity > 0.4) bgClass = 'bg-red-500/60 hover:bg-red-500/80'
                                                                else if (intensity > 0.2) bgClass = 'bg-red-500/40 hover:bg-red-500/60'
                                                                else bgClass = 'bg-red-500/20 hover:bg-red-500/40'
                                                            }

                                                            return (
                                                                <div
                                                                    key={`cell-${dayIndex}-${hour}`}
                                                                    className={cn(
                                                                        "h-8 rounded-sm transition-all duration-200 cursor-help relative group/cell",
                                                                        bgClass
                                                                    )}
                                                                >
                                                                    {/* Tooltip */}
                                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover/cell:block z-50 whitespace-nowrap pointer-events-none">
                                                                        <div className="bg-popover text-popover-foreground text-[10px] font-bold px-2 py-1 rounded-md shadow-lg border border-border flex items-center gap-1">
                                                                            <span>{dayName} {hour}:00</span>
                                                                            <span className="text-muted-foreground">•</span>
                                                                            <span className="text-primary">{count} {t('revenue.salesCount') || 'Sales'}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </DialogContent>
        </Dialog>
    )
}

