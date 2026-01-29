import { useState, useEffect } from 'react'
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
    SaleDetailsModal
} from '@/ui/components'
import {
    TrendingUp,
    DollarSign,
    BarChart3,
    Loader2,
    Info
} from 'lucide-react'

export function Revenue() {
    const { user } = useAuth()
    const { t } = useTranslation()
    const { features } = useWorkspace()
    const [sales, setSales] = useState<Sale[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null)

    const fetchSales = async () => {
        setIsLoading(true)
        try {
            const { data, error } = await supabase
                .from('sales')
                .select(`
                    *,
                    items:sale_items(
                        *,
                        product:product_id(name, sku)
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
                    profilesMap = profiles.reduce((acc: any, curr: any) => ({
                        ...acc,
                        [curr.id]: curr.name
                    }), {})
                }
            }

            const formattedSales = (data || []).map((sale: any) => ({
                ...sale,
                cashier_name: profilesMap[sale.cashier_id] || 'Staff',
                items: sale.items?.map((item: any) => ({
                    ...item,
                    product_name: item.product?.name || 'Unknown Product',
                    product_sku: item.product?.sku || ''
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

    // Calculations
    const calculateStats = () => {
        const statsByCurrency: Record<string, { revenue: number, cost: number, salesCount: number }> = {}
        const saleStats: any[] = []

        sales.forEach(sale => {
            // Skip returned sales from revenue calculations
            if (sale.is_returned) return

            const currency = sale.settlement_currency || 'usd'
            if (!statsByCurrency[currency]) {
                statsByCurrency[currency] = { revenue: 0, cost: 0, salesCount: 0 }
            }
            statsByCurrency[currency].salesCount++

            let saleRevenue = 0
            let saleCost = 0

            sale.items?.forEach((item: SaleItem) => {
                // Effective quantity for this item
                const netQuantity = item.quantity - (item.returned_quantity || 0)

                // If the item is fully returned, skip it
                if (netQuantity <= 0) return

                // Use the values already converted to settlement currency or the original ones if same
                const itemRevenue = item.converted_unit_price * netQuantity
                const itemCost = (item.converted_cost_price || 0) * netQuantity

                saleRevenue += itemRevenue
                saleCost += itemCost
            })

            statsByCurrency[currency].revenue += saleRevenue
            statsByCurrency[currency].cost += saleCost

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
                hasPartialReturn: sale.items?.some(item => (item.returned_quantity || 0) > 0 && !item.is_returned)
            })
        })

        return {
            statsByCurrency,
            saleStats: saleStats.slice(0, 50)
        }
    }

    const stats = calculateStats()

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

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card className="bg-primary/5 border-primary/20">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-primary flex items-center gap-2">
                                <DollarSign className="w-4 h-4" />
                                {t('revenue.grossRevenue')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {Object.entries(stats.statsByCurrency).map(([curr, data]) => (
                                <div key={curr}>
                                    <div className="text-2xl font-bold">{formatCurrency(data.revenue, curr, features.iqd_display_preference)}</div>
                                </div>
                            ))}
                            {Object.keys(stats.statsByCurrency).length === 0 && <div className="text-2xl font-bold">{formatCurrency(0, 'usd')}</div>}
                        </CardContent>
                    </Card>

                    <Card className="bg-orange-500/5 border-orange-500/20">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-orange-600 flex items-center gap-2">
                                <BarChart3 className="w-4 h-4" />
                                {t('revenue.totalCost')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {Object.entries(stats.statsByCurrency).map(([curr, data]) => (
                                <div key={curr}>
                                    <div className="text-2xl font-bold">{formatCurrency(data.cost, curr, features.iqd_display_preference)}</div>
                                </div>
                            ))}
                            {Object.keys(stats.statsByCurrency).length === 0 && <div className="text-2xl font-bold">{formatCurrency(0, 'usd')}</div>}
                        </CardContent>
                    </Card>

                    <Card className="bg-emerald-500/5 border-emerald-500/20">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-emerald-600 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4" />
                                {t('revenue.netProfit')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {Object.entries(stats.statsByCurrency).map(([curr, data]) => (
                                <div key={curr}>
                                    <div className="text-2xl font-bold text-emerald-600">
                                        {formatCurrency(data.revenue - data.cost, curr, features.iqd_display_preference)}
                                    </div>
                                </div>
                            ))}
                            {Object.keys(stats.statsByCurrency).length === 0 && <div className="text-2xl font-bold text-emerald-600">{formatCurrency(0, 'usd')}</div>}
                        </CardContent>
                    </Card>

                    <Card className="bg-purple-500/5 border-purple-500/20">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-purple-600 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4" />
                                {t('revenue.profitMargin')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {Object.entries(stats.statsByCurrency).map(([curr, data]) => {
                                const margin = data.revenue > 0 ? ((data.revenue - data.cost) / data.revenue) * 100 : 0
                                return (
                                    <div key={curr}>
                                        <div className="text-2xl font-bold text-purple-600">
                                            {margin.toFixed(1)}% <span className="text-xs uppercase opacity-60">({curr})</span>
                                        </div>
                                    </div>
                                )
                            })}
                            {Object.keys(stats.statsByCurrency).length === 0 && <div className="text-2xl font-bold text-purple-600">0.0%</div>}
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
            </div>
        </TooltipProvider>
    )
}
