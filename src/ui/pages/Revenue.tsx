import { useState, useEffect, useMemo } from 'react'
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
    MetricDetailModal
} from '@/ui/components'
import type { MetricType } from '@/ui/components/MetricDetailModal'
import {
    TrendingUp,
    DollarSign,
    Loader2,
    Info,
    ArrowRight,
    Package,
    Percent
} from 'lucide-react'

export function Revenue() {
    const { user } = useAuth()
    const { t } = useTranslation()
    const { features } = useWorkspace()
    const [sales, setSales] = useState<Sale[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
    const [selectedMetric, setSelectedMetric] = useState<MetricType | null>(null)
    const [isMetricModalOpen, setIsMetricModalOpen] = useState(false)

    const openMetricModal = (type: MetricType) => {
        setSelectedMetric(type)
        setIsMetricModalOpen(true)
    }

    const fetchSales = async () => {
        setIsLoading(true)
        try {
            const { data, error } = await supabase
                .from('sales')
                .select(`
                    *,
                    items:sale_items(
                        *,
                        product:product_id(name, sku, category, cost_price)
                    )
                `)
                .order('created_at', { ascending: false })

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
    }, [user?.workspaceId])

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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <TooltipProvider>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <TrendingUp className="w-6 h-6 text-primary" />
                        {t('revenue.title')}
                    </h1>
                    <p className="text-muted-foreground">{t('revenue.subtitle')}</p>
                </div>

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

                {/* Sale Profitability Table */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-primary" />
                            {t('revenue.listTitle') || 'Recent Sales Profit Analysis'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isMobile() ? (
                            <div className="grid grid-cols-1 gap-4">
                                {stats.saleStats.map((sale, idx) => (
                                    <div
                                        key={sale.id || idx}
                                        className="p-4 rounded-[2rem] border border-border bg-card shadow-sm space-y-4"
                                        onClick={() => {
                                            const originalSale = sales.find(s => s.id === sale.id)
                                            if (originalSale) setSelectedSale(originalSale)
                                        }}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="space-y-1">
                                                <div className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-wider">
                                                    {formatDateTime(sale.date)}
                                                </div>
                                                <div className="flex items-center gap-2">
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
                                                    {sale.hasPartialReturn && (
                                                        <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-orange-500/10 text-orange-600 border border-orange-500/20 uppercase">
                                                            {t('sales.return.partialReturn')}
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
                                ))}
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
                                    {stats.saleStats.map((sale, idx) => (
                                        <TableRow key={sale.id || idx}>
                                            <TableCell className="text-start font-mono text-xs">
                                                {formatDateTime(sale.date)}
                                            </TableCell>
                                            <TableCell className="text-start">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => {
                                                            const originalSale = sales.find(s => s.id === sale.id)
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
                                                                    const originalSale = sales.find(s => s.id === sale.id)
                                                                    if (originalSale) setSelectedSale(originalSale)
                                                                }}
                                                            />
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {t('revenue.viewDetails') || 'View Sale Details'}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                    {sale.hasPartialReturn && (
                                                        <span className="ms-2 px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-orange-500/10 text-orange-600 border border-orange-500/20 uppercase">
                                                            {t('sales.return.partialReturn')}
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
                                    ))}
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
            </div>
        </TooltipProvider>
    )
}
