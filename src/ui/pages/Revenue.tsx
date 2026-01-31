import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import { Sale, SaleItem } from '@/types'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { isMobile } from '@/lib/platform'
import { useWorkspace } from '@/workspace'
import {
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
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
    SaleDetailsModal,
    MetricDetailModal,
    TopProductsModal,
    SalesOverviewModal,
    PeakTradingModal,
    ReturnsAnalysisModal
} from '@/ui/components'
import type { MetricType } from '@/ui/components/MetricDetailModal'
import {
    TrendingUp,
    DollarSign,
    Loader2,
    Info,
    ArrowRight,
    Package,
    Percent,
    BarChart3,
    Clock,
    RotateCcw,
    Calendar,
    Printer
} from 'lucide-react'
import { Button, Input } from '@/ui/components'

import { useReactToPrint } from 'react-to-print'

export function Revenue() {
    const { user } = useAuth()
    const { t } = useTranslation()
    const { features } = useWorkspace()
    const [sales, setSales] = useState<Sale[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
    const [selectedMetric, setSelectedMetric] = useState<MetricType | null>(null)
    const [isMetricModalOpen, setIsMetricModalOpen] = useState(false)
    const [isTopProductsOpen, setIsTopProductsOpen] = useState(false)
    const [isSalesOverviewOpen, setIsSalesOverviewOpen] = useState(false)
    const [isPeakTradingOpen, setIsPeakTradingOpen] = useState(false)
    const [isReturnsOpen, setIsReturnsOpen] = useState(false)
    const [dateRange, setDateRange] = useState<'today' | 'month' | 'custom'>('month')
    const [customDates, setCustomDates] = useState({ start: '', end: '' })

    const listRef = useRef<HTMLDivElement>(null)

    const handlePrintList = useReactToPrint({
        contentRef: listRef,
        documentTitle: `Revenue_List_${new Date().toISOString().split('T')[0]}`,
    })

    const openMetricModal = (type: MetricType) => {
        setSelectedMetric(type)
        setIsMetricModalOpen(true)
    }

    const fetchSales = async () => {
        setIsLoading(true)
        try {
            let query = supabase
                .from('sales')
                .select(`
                    *,
                    items:sale_items(
                        *,
                        product:product_id(name, sku, category, cost_price)
                    )
                `)
                .eq('workspace_id', user?.workspaceId)

            const now = new Date()
            if (dateRange === 'today') {
                const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString()
                query = query.gte('created_at', startOfDay)
            } else if (dateRange === 'month') {
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
                query = query.gte('created_at', startOfMonth)
            } else if (dateRange === 'custom' && customDates.start && customDates.end) {
                const start = new Date(customDates.start)
                start.setHours(0, 0, 0, 0)
                const end = new Date(customDates.end)
                end.setHours(23, 59, 59, 999)
                query = query.gte('created_at', start.toISOString()).lte('created_at', end.toISOString())
            }

            const { data, error } = await query.order('created_at', { ascending: false })

            if (error) throw error

            // Fetch profiles for cashiers
            const cashierIds = Array.from(new Set((data || []).map((s: any) => s.cashier_id).filter(Boolean)))
            let profilesMap: Record<string, string> = {}

            if (cashierIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, name')
                    .in('id', cashierIds)

                if (profiles) {
                    profilesMap = profiles.reduce((acc: Record<string, string>, curr: { id: string, name: string }) => ({
                        ...acc,
                        [curr.id]: curr.name
                    }), {})
                }
            }


            const formattedSales: Sale[] = (data || []).map((sale: any) => ({
                ...sale,
                cashier_name: profilesMap[sale.cashier_id || ''] || 'Staff',
                items: sale.items?.map((item: any) => ({
                    ...item,
                    product_name: item.product?.name || 'Unknown Product',
                    product_sku: item.product?.sku || '',
                    product_category: item.product?.category || 'Uncategorized'
                }))
            }))

            setSales(formattedSales)
        } catch (err) {
            console.error('Error fetching sales for revenue:', err)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        if (user?.workspaceId) {
            fetchSales()
        }
    }, [user?.workspaceId, dateRange, customDates])

    const calculateStats = (salesData: Sale[], defaultCurrency: string) => {
        const statsByCurrency: Record<string, {
            revenue: number,
            cost: number,
            salesCount: number,
            dailyTrend: Record<string, { revenue: number, cost: number, profit: number }>,
            categoryRevenue: Record<string, number>,
            productPerformance: Record<string, { name: string, revenue: number, cost: number, quantity: number }>
        }> = {}
        const saleStats: {
            id: string,
            date: string,
            revenue: number,
            cost: number,
            profit: number,
            margin: number,
            currency: string,
            origin: string,
            cashier: string,
            hasPartialReturn?: boolean
        }[] = []

        salesData.forEach(sale => {
            if (sale.is_returned) return

            const currency = sale.settlement_currency || defaultCurrency
            if (!statsByCurrency[currency]) {
                statsByCurrency[currency] = {
                    revenue: 0,
                    cost: 0,
                    salesCount: 0,
                    dailyTrend: {},
                    categoryRevenue: {},
                    productPerformance: {}
                }
            }
            statsByCurrency[currency].salesCount++

            let saleRevenue = 0
            let saleCost = 0
            const date = new Date(sale.created_at).toISOString().split('T')[0]

            if (!statsByCurrency[currency].dailyTrend[date]) {
                statsByCurrency[currency].dailyTrend[date] = { revenue: 0, cost: 0, profit: 0 }
            }

            sale.items?.forEach((item: SaleItem) => {
                const netQuantity = item.quantity - (item.returned_quantity || 0)
                if (netQuantity <= 0) return

                const itemRevenue = item.converted_unit_price * netQuantity
                const itemCost = (item.converted_cost_price || 0) * netQuantity

                saleRevenue += itemRevenue
                saleCost += itemCost

                // Category tracking
                const cat = item.product_category || 'Uncategorized'
                statsByCurrency[currency].categoryRevenue[cat] = (statsByCurrency[currency].categoryRevenue[cat] || 0) + itemRevenue

                // Product performance tracking
                const prodId = item.product_id
                if (!statsByCurrency[currency].productPerformance[prodId]) {
                    statsByCurrency[currency].productPerformance[prodId] = {
                        name: item.product_name || 'Unknown Product',
                        revenue: 0,
                        cost: 0,
                        quantity: 0
                    }
                }
                statsByCurrency[currency].productPerformance[prodId].revenue += itemRevenue
                statsByCurrency[currency].productPerformance[prodId].cost += itemCost
                statsByCurrency[currency].productPerformance[prodId].quantity += netQuantity
            })

            statsByCurrency[currency].revenue += saleRevenue
            statsByCurrency[currency].cost += saleCost
            statsByCurrency[currency].dailyTrend[date].revenue += saleRevenue
            statsByCurrency[currency].dailyTrend[date].cost += saleCost
            statsByCurrency[currency].dailyTrend[date].profit += (saleRevenue - saleCost)

            saleStats.push({
                id: sale.id,
                date: sale.created_at,
                revenue: saleRevenue,
                cost: saleCost,
                profit: saleRevenue - saleCost,
                margin: saleRevenue > 0 ? ((saleRevenue - saleCost) / saleRevenue) * 100 : 0,
                currency: currency,
                origin: sale.origin,
                cashier: sale.cashier_name || 'Staff',
                hasPartialReturn: sale.has_partial_return
            })
        })

        return {
            statsByCurrency,
            saleStats: saleStats.slice(0, 50)
        }
    }

    const stats = useMemo(() => {
        if (!sales) return { statsByCurrency: {}, saleStats: [] }
        const { statsByCurrency, saleStats } = calculateStats(sales, features.default_currency || 'usd')
        return { statsByCurrency, saleStats }
    }, [sales, features.default_currency])

    const currencySettings = useMemo(() => ({
        currency: Object.keys(stats.statsByCurrency)[0] || features.default_currency || 'usd',
        iqdPreference: features.iqd_display_preference
    }), [stats.statsByCurrency, features.default_currency, features.iqd_display_preference])

    const primaryStats = useMemo(() => stats.statsByCurrency[currencySettings.currency] || {
        revenue: 0,
        cost: 0,
        salesCount: 0,
        dailyTrend: {},
        categoryRevenue: {},
        productPerformance: {}
    }, [stats.statsByCurrency, currencySettings.currency])

    // Only show global loader on initial fetch
    if (isLoading && sales.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground animate-pulse">
                        {t('common.loading') || 'Loading analytics...'}
                    </p>
                </div>
            </div>
        )
    }

    return (
        <TooltipProvider>
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div>
                            <h1 className="text-2xl font-bold flex items-center gap-2">
                                <TrendingUp className="w-6 h-6 text-primary" />
                                {t('revenue.title')}
                                {isLoading && (
                                    <Loader2 className="w-4 h-4 animate-spin text-primary/50 ml-1" />
                                )}
                            </h1>
                            <p className="text-muted-foreground">{t('revenue.subtitle')}</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div className="bg-secondary/50 p-1 rounded-lg flex items-center gap-1 shadow-sm border border-border/50">
                            <Button
                                variant={dateRange === 'today' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setDateRange('today')}
                                className={cn("text-xs h-8 px-4 transition-all duration-200", dateRange === 'today' && "shadow-sm")}
                            >
                                {t('performance.filters.today')}
                            </Button>
                            <Button
                                variant={dateRange === 'month' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setDateRange('month')}
                                className={cn("text-xs h-8 px-4 transition-all duration-200", dateRange === 'month' && "shadow-sm")}
                            >
                                {t('performance.filters.thisMonth')}
                            </Button>
                            <Button
                                variant={dateRange === 'custom' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setDateRange('custom')}
                                className={cn("text-xs h-8 px-4 gap-1.5 transition-all duration-200", dateRange === 'custom' && "shadow-sm")}
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
                </div>

                <div className="space-y-6">

                    {/* KPI Cards Section */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Gross Revenue */}
                        <Card
                            className="bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-blue-500/10 hover:shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)] active:scale-95 group relative overflow-hidden rounded-3xl"
                            onClick={() => openMetricModal('grossRevenue')}
                        >
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="w-4 h-4 text-blue-500" />
                            </div>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-black text-blue-600 dark:text-blue-400 flex items-center gap-2 uppercase tracking-widest">
                                    <DollarSign className="w-4 h-4" />
                                    {t('revenue.grossRevenue')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1">
                                    {Object.entries(stats.statsByCurrency).map(([curr, s]) => (
                                        <div key={curr} className="text-2xl font-black tracking-tighter tabular-nums text-blue-700 dark:text-blue-300 leading-none">
                                            {formatCurrency(s.revenue, curr as any, currencySettings.iqdPreference)}
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[10px] font-bold text-blue-600/60 dark:text-blue-400/60 uppercase tracking-wider mt-1">
                                    {Object.values(stats.statsByCurrency).reduce((acc, s) => acc + s.salesCount, 0)} {t('pos.totalItems')}
                                </p>
                            </CardContent>
                        </Card>

                        {/* Total Cost */}
                        <Card
                            className="bg-orange-500/5 dark:bg-orange-500/10 border-orange-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-orange-500/10 hover:shadow-[0_0_20px_-5px_rgba(249,115,22,0.3)] active:scale-95 group relative overflow-hidden rounded-3xl"
                            onClick={() => openMetricModal('totalCost')}
                        >
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="w-4 h-4 text-orange-500" />
                            </div>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-black text-orange-600 dark:text-orange-400 flex items-center gap-2 uppercase tracking-widest">
                                    <Package className="w-4 h-4" />
                                    {t('revenue.totalCost')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1">
                                    {Object.entries(stats.statsByCurrency).map(([curr, s]) => (
                                        <div key={curr} className="text-2xl font-black tracking-tighter tabular-nums text-orange-700 dark:text-orange-300 leading-none">
                                            {formatCurrency(s.cost, curr as any, currencySettings.iqdPreference)}
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[10px] font-bold text-orange-600/60 dark:text-orange-400/60 uppercase tracking-wider mt-1">
                                    {((Object.values(stats.statsByCurrency).reduce((acc, s) => acc + s.cost, 0) / (Object.values(stats.statsByCurrency).reduce((acc, s) => acc + s.revenue, 0) || 1)) * 100).toFixed(1)}% {t('revenue.table.cost')}
                                </p>
                            </CardContent>
                        </Card>

                        {/* Net Profit */}
                        <Card
                            className="bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-emerald-500/10 hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)] active:scale-95 group relative overflow-hidden rounded-3xl"
                            onClick={() => openMetricModal('netProfit')}
                        >
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="w-4 h-4 text-emerald-500" />
                            </div>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-2 uppercase tracking-widest">
                                    <TrendingUp className="w-4 h-4" />
                                    {t('revenue.netProfit')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1">
                                    {Object.entries(stats.statsByCurrency).map(([curr, s]) => (
                                        <div key={curr} className="text-2xl font-black tracking-tighter tabular-nums text-emerald-700 dark:text-emerald-300 leading-none">
                                            {formatCurrency(s.revenue - s.cost, curr as any, currencySettings.iqdPreference)}
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[10px] font-bold text-emerald-600/60 dark:text-emerald-400/60 uppercase tracking-wider mt-1">
                                    {t('revenue.detailedAnalysis')}
                                </p>
                            </CardContent>
                        </Card>

                        {/* Profit Margin */}
                        <Card
                            className="bg-purple-500/5 dark:bg-purple-500/10 border-purple-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-purple-500/10 hover:shadow-[0_0_20px_-5px_rgba(139,92,246,0.3)] active:scale-95 group relative overflow-hidden rounded-3xl"
                            onClick={() => openMetricModal('profitMargin')}
                        >
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="w-4 h-4 text-purple-500" />
                            </div>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-black text-purple-600 dark:text-purple-400 flex items-center gap-2 uppercase tracking-widest">
                                    <Percent className="w-4 h-4" />
                                    {t('revenue.profitMargin')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black tracking-tighter tabular-nums text-purple-700 dark:text-purple-300">
                                    {((primaryStats.revenue - primaryStats.cost) / (primaryStats.revenue || 1) * 100).toFixed(1)}%
                                </div>
                                <div className="w-full bg-purple-500/10 rounded-full h-1.5 mt-2">
                                    <div
                                        className="bg-purple-500 h-1.5 rounded-full transition-all duration-1000"
                                        style={{ width: `${Math.min(((primaryStats.revenue - primaryStats.cost) / (primaryStats.revenue || 1)) * 100, 100)}%` }}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Analytics Quick Actions */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Top Products */}
                        <Card
                            className="bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-emerald-500/10 hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)] active:scale-95 group relative overflow-hidden rounded-3xl"
                            onClick={() => setIsTopProductsOpen(true)}
                        >
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="w-4 h-4 text-emerald-500" />
                            </div>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-2 uppercase tracking-widest">
                                    <Package className="w-4 h-4" />
                                    {t('revenue.topProducts') || 'Top Products'}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-xs text-muted-foreground font-medium">
                                    {t('revenue.topProductsDesc') || 'Best sellers by revenue, quantity, or cost'}
                                </p>
                            </CardContent>
                        </Card>

                        {/* Sales Overview */}
                        <Card
                            className="bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-blue-500/10 hover:shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)] active:scale-95 group relative overflow-hidden rounded-3xl"
                            onClick={() => setIsSalesOverviewOpen(true)}
                        >
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="w-4 h-4 text-blue-500" />
                            </div>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-black text-blue-600 dark:text-blue-400 flex items-center gap-2 uppercase tracking-widest">
                                    <BarChart3 className="w-4 h-4" />
                                    {t('revenue.salesOverview') || 'Sales Overview'}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-xs text-muted-foreground font-medium">
                                    {t('revenue.salesOverviewDesc') || 'Revenue, cost & profit combined'}
                                </p>
                            </CardContent>
                        </Card>

                        {/* Peak Times */}
                        <Card
                            className="bg-violet-500/5 dark:bg-violet-500/10 border-violet-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-violet-500/10 hover:shadow-[0_0_20px_-5px_rgba(139,92,246,0.3)] active:scale-95 group relative overflow-hidden rounded-3xl"
                            onClick={() => setIsPeakTradingOpen(true)}
                        >
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="w-4 h-4 text-violet-500" />
                            </div>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-black text-violet-600 dark:text-violet-400 flex items-center gap-2 uppercase tracking-widest">
                                    <Clock className="w-4 h-4" />
                                    {t('revenue.peakTimes') || 'Peak Times'}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-xs text-muted-foreground font-medium">
                                    {t('revenue.peakTimesDesc') || 'Busiest hours of the day'}
                                </p>
                            </CardContent>
                        </Card>

                        {/* Returns */}
                        <Card
                            className="bg-red-500/5 dark:bg-red-500/10 border-red-500/20 cursor-pointer hover:scale-[1.02] transition-all hover:bg-red-500/10 hover:shadow-[0_0_20px_-5px_rgba(239,68,68,0.3)] active:scale-95 group relative overflow-hidden rounded-3xl"
                            onClick={() => setIsReturnsOpen(true)}
                        >
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight className="w-4 h-4 text-red-500" />
                            </div>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-black text-red-600 dark:text-red-400 flex items-center gap-2 uppercase tracking-widest">
                                    <RotateCcw className="w-4 h-4" />
                                    {t('revenue.returns') || 'Returns'}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-xs text-muted-foreground font-medium">
                                    {t('revenue.returnsDesc') || 'Track refunds and product returns'}
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sale Profitability Table */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-primary" />
                                {t('revenue.listTitle') || 'Recent Sales Profit Analysis'}
                            </CardTitle>
                            {user?.role === 'admin' && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePrintList()}
                                    className="gap-2 h-8 text-xs bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary transition-all duration-200"
                                >
                                    <Printer className="w-3.5 h-3.5" />
                                    {t('revenue.printList') || 'Print Revenue List'}
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent ref={listRef} className="print:p-0 [print-color-adjust:exact] -webkit-print-color-adjust:exact">
                            {isMobile() ? (
                                <div className="grid grid-cols-1 gap-4">
                                    {stats.saleStats.map((sale, idx) => {
                                        const originalSale = sales.find(s => s.id === sale.id)
                                        const isFullyReturned = originalSale ? (originalSale.is_returned || (originalSale.items && originalSale.items.length > 0 && originalSale.items.every((item: any) =>
                                            item.is_returned || (item.returned_quantity || 0) >= item.quantity
                                        ))) : false

                                        const returnedItemsCount = originalSale?.items?.filter((item: any) => item.is_returned).length || 0
                                        const partialReturnedItemsCount = originalSale?.items?.filter((item: any) => (item.returned_quantity || 0) > 0 && !item.is_returned).length || 0
                                        const hasAnyReturn = returnedItemsCount > 0 || partialReturnedItemsCount > 0
                                        const totalReturnedQuantity = originalSale?.items?.reduce((sum: number, item: any) => {
                                            if (item.is_returned) return sum + (item.quantity || 0)
                                            if ((item.returned_quantity || 0) > 0) return sum + (item.returned_quantity || 0)
                                            return sum
                                        }, 0) || 0

                                        return (
                                            <div
                                                key={sale.id || idx}
                                                className={cn(
                                                    "p-4 rounded-[2rem] border border-border shadow-sm space-y-4",
                                                    isFullyReturned ? 'bg-destructive/5 border-destructive/20' : hasAnyReturn ? 'bg-orange-500/5 border-orange-500/20 dark:bg-orange-500/5 dark:border-orange-500/10' : 'bg-card'
                                                )}
                                                onClick={() => {
                                                    if (originalSale) setSelectedSale(originalSale)
                                                }}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="space-y-1">
                                                        <div className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-wider">
                                                            {formatDateTime(sale.date)}
                                                        </div>
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-xs font-mono font-black text-primary">
                                                                #{sale.id.split('-')[0]}
                                                            </span>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer" />
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    {t('revenue.viewDetails') || 'View Sale Details'}
                                                                </TooltipContent>
                                                            </Tooltip>

                                                            {isFullyReturned && (
                                                                <span className="px-1.5 py-0.5 text-[8px] font-bold bg-destructive/20 text-destructive dark:bg-destructive/30 dark:text-destructive-foreground rounded-full border border-destructive/30 uppercase">
                                                                    {t('sales.return.returnedStatus') || 'RETURNED'}
                                                                </span>
                                                            )}

                                                            {!isFullyReturned && hasAnyReturn && (
                                                                <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-orange-500/10 text-orange-600 border border-orange-500/20 uppercase whitespace-nowrap">
                                                                    -{totalReturnedQuantity} {t('sales.return.returnedLabel') || 'returned'}
                                                                </span>
                                                            )}

                                                            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-secondary uppercase">
                                                                {sale.origin}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className={cn(
                                                            "px-2 py-1 rounded-full text-xs font-black",
                                                            sale.margin > 20 ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" :
                                                                sale.margin > 0 ? "bg-orange-500/10 text-orange-600 border border-orange-500/20" :
                                                                    "bg-destructive/10 text-destructive border border-destructive/20"
                                                        )}>
                                                            {sale.margin.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/50">
                                                    <div className="space-y-0.5 text-start">
                                                        <div className="text-[9px] uppercase font-bold text-muted-foreground tracking-tight">{t('revenue.table.revenue')}</div>
                                                        <div className="text-sm font-black text-foreground">
                                                            {formatCurrency(sale.revenue, sale.currency, features.iqd_display_preference)}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-0.5 text-center">
                                                        <div className="text-[9px] uppercase font-bold text-muted-foreground tracking-tight">{t('revenue.table.cost')}</div>
                                                        <div className="text-sm font-bold text-muted-foreground">
                                                            {formatCurrency(sale.cost, sale.currency, features.iqd_display_preference)}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-0.5 text-end">
                                                        <div className="text-[9px] uppercase font-bold text-muted-foreground tracking-tight">{t('revenue.table.profit')}</div>
                                                        <div className="text-sm font-black text-emerald-600">
                                                            {formatCurrency(sale.profit, sale.currency, features.iqd_display_preference)}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="text-start">{t('sales.date') || 'Date'}</TableHead>
                                            <TableHead className="text-start">{t('sales.id') || 'Sale ID'}</TableHead>
                                            <TableHead className="text-start">{t('sales.origin') || 'Origin'}</TableHead>
                                            <TableHead className="text-end">{t('revenue.table.revenue')}</TableHead>
                                            <TableHead className="text-end">{t('revenue.table.cost')}</TableHead>
                                            <TableHead className="text-end">{t('revenue.table.profit')}</TableHead>
                                            <TableHead className="text-end">{t('revenue.table.margin')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {stats.saleStats.map((sale, idx) => {
                                            const originalSale = sales.find(s => s.id === sale.id)
                                            const isFullyReturned = originalSale ? (originalSale.is_returned || (originalSale.items && originalSale.items.length > 0 && originalSale.items.every((item: any) =>
                                                item.is_returned || (item.returned_quantity || 0) >= item.quantity
                                            ))) : false

                                            const returnedItemsCount = originalSale?.items?.filter((item: any) => item.is_returned).length || 0
                                            const partialReturnedItemsCount = originalSale?.items?.filter((item: any) => (item.returned_quantity || 0) > 0 && !item.is_returned).length || 0
                                            const hasAnyReturn = returnedItemsCount > 0 || partialReturnedItemsCount > 0
                                            const totalReturnedQuantity = originalSale?.items?.reduce((sum: number, item: any) => {
                                                if (item.is_returned) return sum + (item.quantity || 0)
                                                if ((item.returned_quantity || 0) > 0) return sum + (item.returned_quantity || 0)
                                                return sum
                                            }, 0) || 0

                                            return (
                                                <TableRow key={sale.id || idx} className={cn(
                                                    isFullyReturned ? 'bg-red-500/10 dark:bg-red-500/20 border-red-500/20' :
                                                        hasAnyReturn ? 'bg-orange-500/10 border-orange-500/20 dark:bg-orange-500/5 dark:border-orange-500/10' : '',
                                                    "print:bg-opacity-100"
                                                )}>
                                                    <TableCell className="text-start font-mono text-xs">
                                                        {formatDateTime(sale.date)}
                                                    </TableCell>
                                                    <TableCell className="text-start">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    if (originalSale) setSelectedSale(originalSale)
                                                                }}
                                                                className="font-mono text-[10px] text-primary hover:underline"
                                                            >
                                                                {sale.id.split('-')[0]}
                                                            </button>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Info
                                                                        className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                                                                        onClick={() => {
                                                                            if (originalSale) setSelectedSale(originalSale)
                                                                        }}
                                                                    />
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    {t('revenue.viewDetails') || 'View Sale Details'}
                                                                </TooltipContent>
                                                            </Tooltip>

                                                            {isFullyReturned && (
                                                                <span className="px-1.5 py-0.5 text-[8px] font-bold bg-destructive/20 text-destructive dark:bg-destructive/30 dark:text-destructive-foreground rounded-full border border-destructive/30 uppercase">
                                                                    {t('sales.return.returnedStatus') || 'RETURNED'}
                                                                </span>
                                                            )}

                                                            {!isFullyReturned && hasAnyReturn && (
                                                                <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-orange-500/10 text-orange-600 border border-orange-500/20 uppercase whitespace-nowrap">
                                                                    -{totalReturnedQuantity} {t('sales.return.returnedLabel') || 'returned'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-start">
                                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-secondary uppercase">
                                                            {sale.origin}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-end font-medium">
                                                        {formatCurrency(sale.revenue, sale.currency, features.iqd_display_preference)}
                                                    </TableCell>
                                                    <TableCell className="text-end text-muted-foreground">
                                                        {formatCurrency(sale.cost, sale.currency, features.iqd_display_preference)}
                                                    </TableCell>
                                                    <TableCell className="text-end font-bold text-emerald-600">
                                                        {formatCurrency(sale.profit, sale.currency, features.iqd_display_preference)}
                                                    </TableCell>
                                                    <TableCell className="text-end">
                                                        <span className={cn(
                                                            "px-2 py-0.5 rounded-full text-[10px] font-bold",
                                                            sale.margin > 20 ? "bg-emerald-500/10 text-emerald-600" :
                                                                sale.margin > 0 ? "bg-orange-500/10 text-orange-600" :
                                                                    "bg-destructive/10 text-destructive"
                                                        )}>
                                                            {sale.margin.toFixed(1)}%
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>

                    {/* Sale Details Modal */}
                    <SaleDetailsModal
                        isOpen={!!selectedSale}
                        onClose={() => setSelectedSale(null)}
                        sale={selectedSale}
                    />

                    {/* Metric Analytics Deep-Dive Modal */}
                    <MetricDetailModal
                        isOpen={isMetricModalOpen}
                        onClose={() => setIsMetricModalOpen(false)}
                        metricType={selectedMetric}
                        currency={Object.keys(stats.statsByCurrency)[0] || features.default_currency || 'usd'}
                        iqdPreference={features.iqd_display_preference}
                        data={stats.statsByCurrency}
                    />

                    {/* Top Products Modal */}
                    <TopProductsModal
                        isOpen={isTopProductsOpen}
                        onClose={() => setIsTopProductsOpen(false)}
                        data={stats.statsByCurrency}
                        iqdPreference={features.iqd_display_preference}
                    />

                    {/* Sales Overview Modal */}
                    <SalesOverviewModal
                        isOpen={isSalesOverviewOpen}
                        onClose={() => setIsSalesOverviewOpen(false)}
                        data={stats.statsByCurrency}
                        iqdPreference={features.iqd_display_preference}
                    />

                    {/* Peak Trading Times Modal */}
                    <PeakTradingModal
                        isOpen={isPeakTradingOpen}
                        onClose={() => setIsPeakTradingOpen(false)}
                        sales={sales}
                    />

                    {/* Returns Analysis Modal */}
                    <ReturnsAnalysisModal
                        isOpen={isReturnsOpen}
                        onClose={() => setIsReturnsOpen(false)}
                        sales={sales}
                        iqdPreference={features.iqd_display_preference}
                        defaultCurrency={features.default_currency || 'usd'}
                    />
                </div>
            </div>
        </TooltipProvider>
    )
}
