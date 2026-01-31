import { useState, useMemo } from 'react'
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
} from '@/ui/components'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts'
import { formatCurrency, cn } from '@/lib/utils'
import { Package, DollarSign, Hash, TrendingDown } from 'lucide-react'

type FilterType = 'revenue' | 'quantity' | 'cost'

interface ProductPerformance {
    name: string
    revenue: number
    cost: number
    quantity: number
}

interface TopProductsModalProps {
    isOpen: boolean
    onClose: () => void
    data: Record<string, {
        productPerformance: Record<string, ProductPerformance>
    }> | null
    iqdPreference: 'IQD' | 'د.ع'
}

const FILTER_CONFIG: Record<FilterType, { icon: React.ReactNode, color: string, gradient: string }> = {
    revenue: { icon: <DollarSign className="w-4 h-4" />, color: '#10b981', gradient: 'colorRevenue' },
    quantity: { icon: <Hash className="w-4 h-4" />, color: '#3b82f6', gradient: 'colorQuantity' },
    cost: { icon: <TrendingDown className="w-4 h-4" />, color: '#f97316', gradient: 'colorCost' },
}

export function TopProductsModal({ isOpen, onClose, data, iqdPreference }: TopProductsModalProps) {
    const { t, i18n } = useTranslation()
    const isRtl = i18n.dir() === 'rtl'
    const [activeFilter, setActiveFilter] = useState<FilterType>('revenue')

    const activeCurrencies = useMemo(() => data ? Object.keys(data) : [], [data])

    const chartData = useMemo(() => {
        if (!data) return []

        // Aggregate product performance across all currencies
        const aggregated: Record<string, { name: string, revenue: number, cost: number, quantity: number }> = {}

        Object.values(data).forEach(currData => {
            Object.entries(currData.productPerformance).forEach(([id, perf]) => {
                if (!aggregated[id]) {
                    aggregated[id] = { name: perf.name, revenue: 0, cost: 0, quantity: 0 }
                }
                aggregated[id].revenue += perf.revenue
                aggregated[id].cost += perf.cost
                aggregated[id].quantity += perf.quantity
            })
        })

        return Object.values(aggregated)
            .sort((a, b) => b[activeFilter] - a[activeFilter])
            .slice(0, 10)
            .map(item => ({
                name: item.name.length > 20 ? item.name.substring(0, 18) + '...' : item.name,
                fullName: item.name,
                value: item[activeFilter],
                revenue: item.revenue,
                cost: item.cost,
                quantity: item.quantity
            }))
    }, [data, activeFilter])

    if (!data) return null

    const config = FILTER_CONFIG[activeFilter]

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={cn(
                "max-w-4xl p-0 bg-background/95 backdrop-blur-3xl overflow-hidden rounded-[2.5rem] shadow-2xl transition-all duration-500",
                "border-[3px] border-emerald-500/50 shadow-emerald-500/10"
            )}>
                <div className="p-6 md:p-8 space-y-6 max-h-[90vh] overflow-y-auto custom-scrollbar [print-color-adjust:exact] -webkit-print-color-adjust:exact">
                    <DialogHeader className="flex flex-row items-center justify-between space-y-0">
                        <div className="flex items-center gap-4">
                            <div className="p-4 rounded-2xl shadow-inner bg-emerald-500/10">
                                <Package className="w-5 h-5 text-emerald-500" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-black tracking-tight">
                                    {t('revenue.topProducts') || 'Top Products'}
                                </DialogTitle>
                                <DialogDescription className="text-sm font-semibold text-muted-foreground/80">
                                    {t('revenue.productPerformance') || 'Product performance analysis'}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    {/* Filter Tabs */}
                    <div className="flex gap-2 p-1 bg-muted/50 rounded-2xl w-fit">
                        {(['revenue', 'quantity', 'cost'] as FilterType[]).map(filter => (
                            <button
                                key={filter}
                                onClick={() => setActiveFilter(filter)}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300",
                                    activeFilter === filter
                                        ? "bg-background shadow-md text-foreground"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {FILTER_CONFIG[filter].icon}
                                {t(`revenue.filter.${filter}`) || filter.charAt(0).toUpperCase() + filter.slice(1)}
                            </button>
                        ))}
                    </div>

                    {/* Chart */}
                    <Card className="bg-card/40 border-border/30 backdrop-blur-md overflow-hidden rounded-[2rem] shadow-sm">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/70 flex items-center gap-2">
                                {config.icon}
                                {t('revenue.top10') || 'Top 10 Products'}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4">
                            <ResponsiveContainer width="100%" height={400}>
                                <BarChart
                                    data={chartData}
                                    layout="vertical"
                                    margin={{ top: 5, right: isRtl ? 120 : 30, left: isRtl ? 30 : 120, bottom: 5 }}
                                >
                                    <defs>
                                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="1" y2="0">
                                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.8} />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity={0.4} />
                                        </linearGradient>
                                        <linearGradient id="colorQuantity" x1="0" y1="0" x2="1" y2="0">
                                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8} />
                                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.4} />
                                        </linearGradient>
                                        <linearGradient id="colorCost" x1="0" y1="0" x2="1" y2="0">
                                            <stop offset="0%" stopColor="#f97316" stopOpacity={0.8} />
                                            <stop offset="100%" stopColor="#f97316" stopOpacity={0.4} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                                    <XAxis
                                        type="number"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }}
                                        className="text-muted-foreground/60"
                                        tickFormatter={(val) => activeFilter === 'quantity' ? val : val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                                        reversed={isRtl}
                                    />
                                    <YAxis
                                        type="category"
                                        dataKey="name"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={(props: any) => (
                                            <text
                                                x={props.x + (isRtl ? 10 : -10)}
                                                y={props.y}
                                                dy={4}
                                                textAnchor="end"
                                                fill="currentColor"
                                                fontSize={11}
                                                fontWeight={600}
                                                className="fill-muted-foreground/80"
                                            >
                                                {props.payload.value}
                                            </text>
                                        )}
                                        width={120}
                                        orientation={isRtl ? 'right' : 'left'}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'hsl(var(--card))',
                                            borderRadius: '20px',
                                            border: '1px solid hsl(var(--border))',
                                            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                                            padding: '12px'
                                        }}
                                        itemStyle={{ fontSize: '11px', fontWeight: 'bold', padding: '2px 0' }}
                                        labelStyle={{ fontSize: '10px', fontWeight: 'black', textTransform: 'uppercase', marginBottom: '8px', opacity: 0.6 }}
                                        formatter={(value: any) => {
                                            if (activeFilter === 'quantity') {
                                                return [value, t('revenue.filter.quantity') || 'Quantity']
                                            }
                                            return [formatCurrency(value, activeCurrencies[0] as any, iqdPreference), t(`revenue.filter.${activeFilter}`)]
                                        }}
                                        labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                                    />
                                    <Bar
                                        dataKey="value"
                                        fill={`url(#${config.gradient})`}
                                        radius={[0, 8, 8, 0]}
                                        animationDuration={1500}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            </DialogContent>
        </Dialog>
    )
}
