import React, { useMemo } from 'react'
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/ui/components'
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    BarChart,
    Bar,
    Legend
} from 'recharts'
import { formatCurrency, cn } from '@/lib/utils'
import { DollarSign, TrendingUp, BarChart3, PieChart as PieChartIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react'

export type MetricType = 'grossRevenue' | 'totalCost' | 'netProfit' | 'profitMargin'

interface MetricDetailModalProps {
    isOpen: boolean
    onClose: () => void
    metricType: MetricType | null
    currency: string
    iqdPreference: 'IQD' | 'د.ع'
    data: {
        revenue: number
        cost: number
        salesCount: number
        dailyTrend: Record<string, { revenue: number, cost: number, profit: number }>
        categoryRevenue: Record<string, number>
        productPerformance: Record<string, { name: string, revenue: number, cost: number, quantity: number }>
    } | null
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']

const METRIC_COLORS: Record<MetricType, { stroke: string, fill: string, gradient: string }> = {
    grossRevenue: { stroke: '#3b82f6', fill: '#3b82f6', gradient: 'colorRevenue' },
    totalCost: { stroke: '#f97316', fill: '#f97316', gradient: 'colorCost' },
    netProfit: { stroke: '#10b981', fill: '#10b981', gradient: 'colorProfit' },
    profitMargin: { stroke: '#8b5cf6', fill: '#8b5cf6', gradient: 'colorMargin' }
}

export function MetricDetailModal({ isOpen, onClose, metricType, currency, iqdPreference, data }: MetricDetailModalProps) {
    const { t } = useTranslation()

    const trendData = useMemo(() => {
        if (!data?.dailyTrend) return []
        return Object.entries(data.dailyTrend)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, values]) => ({
                date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                ...values,
                margin: values.revenue > 0 ? ((values.revenue - values.cost) / values.revenue) * 100 : 0
            }))
    }, [data?.dailyTrend])

    const categoryData = useMemo(() => {
        if (!data?.categoryRevenue) return []
        return Object.entries(data.categoryRevenue)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
    }, [data?.categoryRevenue])

    const topProducts = useMemo(() => {
        if (!data?.productPerformance) return []
        return Object.entries(data.productPerformance)
            .map(([id, stats]) => ({
                id,
                ...stats,
                profit: stats.revenue - stats.cost,
                margin: stats.revenue > 0 ? ((stats.revenue - stats.cost) / stats.revenue) * 100 : 0
            }))
            .sort((a, b) => {
                if (metricType === 'profitMargin') return b.margin - a.margin
                if (metricType === 'totalCost') return b.cost - a.cost
                return b.revenue - a.revenue
            })
            .slice(0, 5)
    }, [data?.productPerformance, metricType])

    if (!metricType || !data) return null

    const getMetricTitle = () => {
        switch (metricType) {
            case 'grossRevenue': return t('revenue.grossRevenue')
            case 'totalCost': return t('revenue.totalCost')
            case 'netProfit': return t('revenue.netProfit')
            case 'profitMargin': return t('revenue.profitMargin')
            default: return ''
        }
    }

    const getMetricIcon = () => {
        switch (metricType) {
            case 'grossRevenue': return <DollarSign className="w-5 h-5 text-blue-500" />
            case 'totalCost': return <BarChart3 className="w-5 h-5 text-orange-500" />
            case 'netProfit': return <TrendingUp className="w-5 h-5 text-emerald-500" />
            case 'profitMargin': return <PieChartIcon className="w-5 h-5 text-purple-500" />
        }
    }

    const getPrimaryValue = () => {
        switch (metricType) {
            case 'grossRevenue': return formatCurrency(data.revenue, currency, iqdPreference)
            case 'totalCost': return formatCurrency(data.cost, currency, iqdPreference)
            case 'netProfit': return formatCurrency(data.revenue - data.cost, currency, iqdPreference)
            case 'profitMargin':
                const margin = data.revenue > 0 ? ((data.revenue - data.cost) / data.revenue) * 100 : 0
                return `${margin.toFixed(1)}%`
        }
    }

    const activeColors = METRIC_COLORS[metricType]

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-5xl p-0 bg-background/95 backdrop-blur-3xl border-border/50 overflow-hidden rounded-[2.5rem] shadow-2xl">
                <div className="p-6 md:p-8 space-y-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
                    <DialogHeader className="flex flex-row items-center justify-between space-y-0">
                        <div className="flex items-center gap-4">
                            <div className={cn(
                                "p-4 rounded-2xl shadow-inner",
                                metricType === 'grossRevenue' && "bg-blue-500/10",
                                metricType === 'totalCost' && "bg-orange-500/10",
                                metricType === 'netProfit' && "bg-emerald-500/10",
                                metricType === 'profitMargin' && "bg-purple-500/10"
                            )}>
                                {getMetricIcon()}
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-black tracking-tight">{getMetricTitle()}</DialogTitle>
                                <DialogDescription className="text-sm font-semibold text-muted-foreground/80">
                                    {t('revenue.detailedAnalysis')}
                                </DialogDescription>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className={cn(
                                "text-3xl font-black tabular-nums tracking-tighter",
                                metricType === 'grossRevenue' && "text-blue-600 dark:text-blue-400",
                                metricType === 'totalCost' && "text-orange-600 dark:text-orange-400",
                                metricType === 'netProfit' && "text-emerald-600 dark:text-emerald-400",
                                metricType === 'profitMargin' && "text-purple-600 dark:text-purple-400"
                            )}>
                                {getPrimaryValue()}
                            </div>
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-70">
                                {t('revenue.targetCurrency')} ({currency.toUpperCase()})
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Primary Trend Chart */}
                        <Card className="lg:col-span-2 bg-card/40 border-border/30 backdrop-blur-md overflow-hidden rounded-[2.5rem] shadow-sm">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/70 flex items-center gap-2">
                                    <TrendingUp className="w-3.5 h-3.5" />
                                    {t('revenue.trendTitle')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="h-[320px] p-0 pr-6 pb-6">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorMargin" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>

                                        <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="currentColor" className="text-border/50" />
                                        <XAxis
                                            dataKey="date"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }}
                                            className="text-muted-foreground/60"
                                            dy={10}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }}
                                            className="text-muted-foreground/60"
                                            tickFormatter={(val) => metricType === 'profitMargin' ? `${val}%` : formatCurrency(val, currency, iqdPreference).split(' ')[0]}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'hsl(var(--card))',
                                                borderRadius: '20px',
                                                border: '1px solid hsl(var(--border))',
                                                boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                                                padding: '12px'
                                            }}
                                            itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                                            labelStyle={{ fontSize: '10px', fontWeight: 'black', textTransform: 'uppercase', marginBottom: '4px', opacity: 0.6 }}
                                            formatter={(value: any) => [
                                                metricType === 'profitMargin' ? `${Number(value).toFixed(1)}%` : formatCurrency(value, currency, iqdPreference),
                                                getMetricTitle()
                                            ]}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey={metricType === 'profitMargin' ? 'margin' : metricType === 'netProfit' ? 'profit' : metricType === 'totalCost' ? 'cost' : 'revenue'}
                                            stroke={activeColors.stroke}
                                            strokeWidth={4}
                                            fillOpacity={1}
                                            fill={`url(#${activeColors.gradient})`}
                                            animationDuration={1500}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        {/* Category Breakdown */}
                        <Card className="bg-card/40 border-border/30 backdrop-blur-md overflow-hidden rounded-[2.5rem] shadow-sm">
                            <CardHeader className="pb-0">
                                <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/70 flex items-center gap-2">
                                    <PieChartIcon className="w-3.5 h-3.5" />
                                    {t('revenue.categorySplit')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="h-[320px] flex items-center justify-center p-4">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={categoryData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={65}
                                            outerRadius={85}
                                            paddingAngle={8}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {categoryData.map((entry, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={COLORS[index % COLORS.length]}
                                                    className="hover:opacity-80 transition-opacity cursor-pointer"
                                                />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'hsl(var(--card))',
                                                borderRadius: '20px',
                                                border: '1px solid hsl(var(--border))',
                                                padding: '12px'
                                            }}
                                            formatter={(value: any) => formatCurrency(value, currency, iqdPreference)}
                                        />
                                        <Legend
                                            verticalAlign="bottom"
                                            align="center"
                                            iconType="circle"
                                            wrapperStyle={{ fontSize: '11px', fontWeight: 800, paddingTop: '20px' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        {/* Top Performers Table */}
                        <Card className="lg:col-span-3 bg-card/40 border-border/30 backdrop-blur-md overflow-hidden rounded-[2.5rem] shadow-sm">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/70">
                                    {metricType === 'totalCost' ? t('revenue.highestCost') : t('revenue.topPerforming')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent border-border/40">
                                            <TableHead className="pl-8 text-[10px] font-black uppercase tracking-widest">{t('products.name')}</TableHead>
                                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest">{t('inventory.quantity')}</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">{t('revenue.table.revenue')}</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">{t('revenue.table.cost')}</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">{t('revenue.table.profit')}</TableHead>
                                            <TableHead className="text-right pr-8 text-[10px] font-black uppercase tracking-widest">{t('revenue.table.margin')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {topProducts.map((p, idx) => (
                                            <TableRow key={p.id} className="hover:bg-primary/5 transition-colors border-border/40 group">
                                                <TableCell className="font-bold pl-8 py-4 group-hover:text-primary transition-colors">{p.name}</TableCell>
                                                <TableCell className="text-center font-black tabular-nums">{p.quantity}</TableCell>
                                                <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(p.revenue, currency, iqdPreference)}</TableCell>
                                                <TableCell className="text-right tabular-nums text-muted-foreground font-medium">{formatCurrency(p.cost, currency, iqdPreference)}</TableCell>
                                                <TableCell className="text-right tabular-nums font-black text-emerald-600 dark:text-emerald-400">
                                                    {formatCurrency(p.profit, currency, iqdPreference)}
                                                </TableCell>
                                                <TableCell className="text-right pr-8">
                                                    <span className={cn(
                                                        "px-3 py-1 rounded-xl text-[11px] font-black shadow-sm",
                                                        p.margin > 20 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" :
                                                            p.margin > 0 ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20" :
                                                                "bg-destructive/10 text-destructive border border-destructive/20"
                                                    )}>
                                                        {p.margin.toFixed(1)}%
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
