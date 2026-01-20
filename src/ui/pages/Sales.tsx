import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import { Sale } from '@/types'
import { formatCurrency, formatDateTime, formatCompactDateTime, cn } from '@/lib/utils'
import { useWorkspace } from '@/workspace'
import { isMobile } from '@/lib/platform'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Button,
    SaleReceipt,
    SaleDetailsModal,
    ReturnConfirmationModal,
    ReturnDeclineModal,
    ReturnRulesDisplayModal,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/components'
import { SaleItem } from '@/types'
import {
    Receipt,
    Eye,
    Loader2,
    Trash2,
    Printer,
    RotateCcw,
    Calendar,
    Filter
} from 'lucide-react'

export function Sales() {
    const { user } = useAuth()
    const { t } = useTranslation()
    const { features } = useWorkspace()
    const [sales, setSales] = useState<Sale[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
    const [printingSale, setPrintingSale] = useState<Sale | null>(null)
    const [returnModalOpen, setReturnModalOpen] = useState(false)
    const [saleToReturn, setSaleToReturn] = useState<Sale | null>(null)
    const [dateRange, setDateRange] = useState<'today' | 'month' | 'custom'>('month')
    const [customDates, setCustomDates] = useState({ start: '', end: '' })
    const [selectedCashier, setSelectedCashier] = useState<string>('all')
    const [availableCashiers, setAvailableCashiers] = useState<Array<{ id: string; name: string }>>([])
    const [rulesQueue, setRulesQueue] = useState<Array<{ productName: string; rules: string }>>([])
    const [currentRuleIndex, setCurrentRuleIndex] = useState(-1)
    const [showDeclineModal, setShowDeclineModal] = useState(false)
    const [nonReturnableProducts, setNonReturnableProducts] = useState<string[]>([])
    const [filteredReturnItems, setFilteredReturnItems] = useState<SaleItem[]>([])
    const printRef = useRef<HTMLDivElement>(null)

    const handlePrint = () => {
        if (!printRef.current) return

        const content = printRef.current.innerHTML
        const iframe = document.createElement('iframe')

        iframe.style.position = 'absolute'
        iframe.style.width = '0px'
        iframe.style.height = '0px'
        iframe.style.border = 'none'

        document.body.appendChild(iframe)

        const doc = iframe.contentWindow?.document
        if (doc) {
            // Gather all styles from the main document (Tailwind, local styles, etc.)
            const styles = Array.from(document.querySelectorAll("style, link[rel='stylesheet']"))
                .map(node => node.outerHTML)
                .join("")

            doc.open()
            doc.write(`
                <html dir="${document.dir}">
                    <head>
                        <title>Print Receipt</title>
                        ${styles}
                        <style>
                            @media print {
                                @page { size: 80mm auto; margin: 0; }
                                body { margin: 0; padding: 10px; }
                                html, body { height: auto; overflow: visible; }
                            }
                            body { 
                                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; 
                                background: white;
                            }
                        </style>
                    </head>
                    <body>
                        ${content}
                    </body>
                </html>
            `)
            doc.close()

            // Wait for resources (styles/images) to load
            const print = () => {
                iframe.contentWindow?.focus()
                iframe.contentWindow?.print()
                setPrintingSale(null)
                // Cleanup
                setTimeout(() => {
                    if (document.body.contains(iframe)) {
                        document.body.removeChild(iframe)
                    }
                }, 1000)
            }

            if (iframe.contentWindow) {
                // Try onload
                iframe.contentWindow.onload = print
                // Fallback timeout in case onload doesn't fire
                setTimeout(() => {
                    if (document.body.contains(iframe)) {
                        print()
                    }
                }, 1500)
            }
        }
    }

    const onPrintClick = (sale: Sale) => {
        setPrintingSale(sale)
    }

    useEffect(() => {
        if (printingSale) {
            // Small timeout to ensure DOM is ready and styles are applied
            setTimeout(() => {
                if (printRef.current) {
                    handlePrint()
                }
            }, 100)
        }
    }, [printingSale])

    const handleDeleteSale = async (id: string) => {
        if (!confirm(t('common.messages.deleteConfirm') || 'Are you sure you want to delete this sale? Inventory will be restored.')) return

        try {
            const { error } = await supabase.rpc('delete_sale', { p_sale_id: id })
            if (error) throw error

            setSales(sales.filter(s => s.id !== id))
            if (selectedSale?.id === id) setSelectedSale(null)
        } catch (err: any) {
            console.error('Error deleting sale:', err)
            alert('Failed to delete sale: ' + (err.message || 'Unknown error'))
        }
    }

    const [isWholeSaleReturn, setIsWholeSaleReturn] = useState(false)

    const finalizeReturn = (sale: Sale, items: SaleItem[], isWholeSale: boolean, isPartial: boolean = false) => {
        const filteredSale = { ...sale, items, _isWholeSaleReturn: isWholeSale, _isPartialReturn: isPartial } as any

        const rules = items
            .filter(item => item.product && item.product.return_rules)
            .map(item => ({
                productName: item.product?.name || item.product_name || 'Product',
                rules: item.product?.return_rules || ''
            }))

        if (rules.length > 0) {
            setSaleToReturn(filteredSale)
            setRulesQueue(rules)
            setCurrentRuleIndex(0)
        } else {
            setSaleToReturn(filteredSale)
            setReturnModalOpen(true)
        }
        setShowDeclineModal(false)
    }

    const initiateReturn = (sale: Sale, isWholeSale: boolean) => {
        const itemsToCheck = sale.items || []
        const nonReturnableItems = itemsToCheck.filter(item => item.product && item.product.can_be_returned === false)
        const returnableItems = itemsToCheck.filter(item => !item.product || item.product.can_be_returned !== false)

        const nonReturnableNames = nonReturnableItems.map(item => item.product?.name || item.product_name || 'Unknown Product')

        if (nonReturnableNames.length > 0) {
            setNonReturnableProducts(nonReturnableNames)
            setSaleToReturn(sale)
            setIsWholeSaleReturn(isWholeSale)

            if (returnableItems.length > 0) {
                setFilteredReturnItems(returnableItems)
                setShowDeclineModal(true)
            } else {
                setFilteredReturnItems([])
                setShowDeclineModal(true)
            }
            return
        }

        finalizeReturn(sale, itemsToCheck, isWholeSale, false)
    }

    const handleNextRule = () => {
        if (currentRuleIndex < rulesQueue.length - 1) {
            setCurrentRuleIndex(currentRuleIndex + 1)
        } else {
            // All rules reviewed, proceed to confirmation
            setCurrentRuleIndex(-1)
            setRulesQueue([])
            setReturnModalOpen(true)
        }
    }

    const handleCancelRules = () => {
        setCurrentRuleIndex(-1)
        setRulesQueue([])
        setSaleToReturn(null)
    }

    const handleBackRule = () => {
        if (currentRuleIndex > 0) {
            setCurrentRuleIndex(currentRuleIndex - 1)
        }
    }

    const handleReturnSale = (sale: Sale) => {
        initiateReturn(sale, true)
    }

    const handleReturnItem = (item: SaleItem) => {
        // For individual item returns, we need to create a mock sale object
        // with just this item for the return modal
        const mockSale: Sale & { _isWholeSaleReturn?: boolean } = {
            ...selectedSale!,
            items: [item],
            _isWholeSaleReturn: false
        }
        initiateReturn(mockSale, false)
    }

    const handleReturnConfirm = async (reason: string, quantity?: number) => {
        if (!saleToReturn) return

        try {
            let error
            const isPartialReturn = (saleToReturn as any)._isPartialReturn
            const isIndividualItemReturn = saleToReturn?.items?.length === 1 && !(saleToReturn as any)._isWholeSaleReturn && !isPartialReturn

            if (isIndividualItemReturn || isPartialReturn) {
                // Partial or Individual Item Return
                const itemsToReturn = saleToReturn.items || []
                if (itemsToReturn.length === 0) return

                const itemIds = itemsToReturn.map(i => i.id)
                // Use provided quantity for single item return, otherwise use full item quantity
                const quantities = itemsToReturn.map(i =>
                    quantity && itemsToReturn.length === 1 ? quantity : (i.quantity - (i.returned_quantity || 0))
                )

                const { data, error: itemError } = await supabase.rpc('return_sale_items', {
                    p_sale_item_ids: itemIds,
                    p_return_quantities: quantities,
                    p_return_reason: reason
                })
                error = itemError

                if (!error && data?.success) {
                    const returnValue = data.return_value || 0

                    const updateSale = (s: Sale) => {
                        if (s.id !== saleToReturn.id) return s
                        const updatedItems = s.items?.map(i => {
                            const returnedIdx = itemIds.indexOf(i.id)
                            if (returnedIdx === -1) return i

                            const q = quantities[returnedIdx]
                            const newReturnedQty = (i.returned_quantity || 0) + q
                            return {
                                ...i,
                                returned_quantity: newReturnedQty,
                                is_returned: newReturnedQty >= i.quantity,
                                return_reason: reason,
                                returned_at: new Date().toISOString()
                            }
                        })

                        return {
                            ...s,
                            total_amount: s.total_amount - returnValue,
                            is_returned: updatedItems?.every(i => i.is_returned) || false,
                            items: updatedItems
                        }
                    }

                    setSales(prev => prev.map(updateSale))
                    if (selectedSale?.id === saleToReturn.id) {
                        setSelectedSale(updateSale(selectedSale))
                    }
                }
            } else {
                // Whole Sale Return
                const { data, error: saleError } = await supabase.rpc('return_whole_sale', {
                    p_sale_id: saleToReturn.id,
                    p_return_reason: reason
                })
                error = saleError

                if (!error && data?.success) {
                    const updateSale = (s: Sale) => {
                        if (s.id !== saleToReturn.id) return s
                        return {
                            ...s,
                            is_returned: true,
                            total_amount: 0,
                            return_reason: reason,
                            returned_at: new Date().toISOString(),
                            items: s.items?.map(i => ({
                                ...i,
                                is_returned: true,
                                returned_quantity: i.quantity,
                                return_reason: reason,
                                returned_at: new Date().toISOString()
                            }))
                        }
                    }

                    setSales(prev => prev.map(updateSale))
                    if (selectedSale?.id === saleToReturn.id) {
                        setSelectedSale(updateSale(selectedSale))
                    }
                }
            }

            if (error) throw error

            // Close modal and refresh
            setReturnModalOpen(false)
            setSaleToReturn(null)
            await fetchSales()
        } catch (err: any) {
            console.error('Error returning sale:', err)
            alert('Failed to return sale: ' + (err.message || 'Unknown error'))
        }
    }

    const fetchCashiers = async () => {
        try {
            const { data, error } = await supabase
                .from('sales')
                .select('cashier_id')
                .not('cashier_id', 'is', null)

            if (error) throw error

            const uniqueCashierIds = [...new Set(data?.map(s => s.cashier_id))]

            if (uniqueCashierIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, name')
                    .in('id', uniqueCashierIds)

                if (profiles) {
                    setAvailableCashiers(profiles)
                }
            }
        } catch (err) {
            console.error('Error fetching cashiers:', err)
        }
    }

    const fetchSales = async () => {
        setIsLoading(true)
        try {
            // Build query with date range filtering
            let query = supabase
                .from('sales')
                .select(`
                    *,
                    items:sale_items(
                        *,
                        product:product_id(name, sku, can_be_returned, return_rules)
                    )
                `)

            // Apply date range filters
            const now = new Date()
            if (dateRange === 'today') {
                const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString()
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

            // Apply cashier filter
            if (selectedCashier !== 'all') {
                query = query.eq('cashier_id', selectedCashier)
            }

            const { data, error } = await query.order('created_at', { ascending: false })

            if (error) throw error

            // Fetch profiles for cashiers
            const cashierIds = Array.from(new Set(data.map((s: any) => s.cashier_id).filter(Boolean)))
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

            const formattedSales = data.map((sale: any) => ({
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
            console.error('Error fetching sales:', err)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        if (user?.workspaceId) {
            fetchSales()
            fetchCashiers()
        }
    }, [user?.workspaceId, dateRange, customDates, selectedCashier])

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Receipt className="w-6 h-6 text-primary" />
                        {t('sales.title') || 'Sales History'}
                        {isLoading && (
                            <Loader2 className="w-4 h-4 animate-spin text-primary/50 ml-1" />
                        )}
                    </h1>
                    <p className="text-muted-foreground">
                        {t('sales.subtitle') || 'View past transactions'}
                    </p>
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

                    {availableCashiers.length > 0 && (
                        <div className="flex items-center gap-2 bg-secondary/30 p-1 px-3 rounded-lg border border-border/50">
                            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">
                                {t('sales.filters.cashier') || 'Cashier'}:
                            </span>
                            <Select value={selectedCashier} onValueChange={setSelectedCashier}>
                                <SelectTrigger className="h-8 text-xs w-40 bg-background/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50 transition-all">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">
                                        {t('sales.filters.allCashiers') || 'All Cashiers'}
                                    </SelectItem>
                                    {availableCashiers.map((cashier) => (
                                        <SelectItem key={cashier.id} value={cashier.id}>
                                            {cashier.name || 'Unknown'}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

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

            <Card>
                <CardHeader>
                    <CardTitle>{t('sales.listTitle') || 'Recent Sales'}</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : sales.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {t('common.noData')}
                        </div>
                    ) : isMobile() ? (
                        <div className="grid grid-cols-1 gap-4">
                            {sales.map((sale) => {
                                const returnedItemsCount = sale.items?.filter(item => item.is_returned).length || 0
                                const partialReturnedItemsCount = sale.items?.filter(item => (item.returned_quantity || 0) > 0 && !item.is_returned).length || 0
                                const totalReturnedQuantity = sale.items?.reduce((sum, item) => {
                                    if (item.is_returned) return sum + (item.quantity || 0)
                                    if ((item.returned_quantity || 0) > 0) return sum + (item.returned_quantity || 0)
                                    return sum
                                }, 0) || 0
                                const hasAnyReturn = returnedItemsCount > 0 || partialReturnedItemsCount > 0

                                return (
                                    <div
                                        key={sale.id}
                                        className={cn(
                                            "p-4 rounded-[2rem] border border-border shadow-sm space-y-4 transition-all active:scale-[0.98]",
                                            sale.is_returned ? 'bg-destructive/5 border-destructive/20' : hasAnyReturn ? 'bg-orange-500/5' : 'bg-card'
                                        )}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="space-y-2">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-wider">
                                                        {formatCompactDateTime(sale.created_at)}
                                                    </span>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {sale.is_returned && (
                                                            <span className="px-2 py-0.5 text-[9px] font-bold bg-destructive/10 text-destructive rounded-full border border-destructive/20 uppercase">
                                                                {t('sales.return.returnedStatus') || 'RETURNED'}
                                                            </span>
                                                        )}
                                                        {hasAnyReturn && !sale.is_returned && (
                                                            <span className="px-2 py-0.5 text-[9px] font-bold bg-orange-500/10 text-orange-600 rounded-full border border-orange-500/20 uppercase">
                                                                -{totalReturnedQuantity} {t('sales.return.returnedLabel') || 'returned'}
                                                            </span>
                                                        )}
                                                        <span className="px-2 py-0.5 text-[9px] font-bold bg-secondary text-secondary-foreground rounded-full uppercase">
                                                            {sale.origin}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-sm font-bold text-foreground/80">
                                                    {t('sales.cashier')}: <span className="text-primary font-black">{sale.cashier_name}</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xl font-black text-primary leading-none">
                                                    {formatCurrency(sale.total_amount, sale.settlement_currency || 'usd', features.iqd_display_preference)}
                                                </div>
                                                <div className="text-[10px] font-bold text-primary/40 uppercase tracking-widest mt-1">
                                                    {sale.settlement_currency || 'usd'}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-3 border-t border-border/50 gap-2">
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    className="h-10 px-4 rounded-xl font-bold flex gap-2"
                                                    onClick={() => setSelectedSale(sale)}
                                                >
                                                    <Eye className="w-4 h-4" />
                                                    {t('common.view')}
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-10 w-10 rounded-xl"
                                                    onClick={() => onPrintClick(sale)}
                                                >
                                                    <Printer className="w-4 h-4" />
                                                </Button>
                                            </div>
                                            <div className="flex gap-1">
                                                {!sale.is_returned && (user?.role === 'admin' || user?.role === 'staff') && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-10 w-10 rounded-xl text-orange-600 hover:bg-orange-50"
                                                        onClick={() => handleReturnSale(sale)}
                                                    >
                                                        <RotateCcw className="w-4 h-4" />
                                                    </Button>
                                                )}
                                                {user?.role === 'admin' && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-10 w-10 rounded-xl text-destructive hover:bg-destructive/5"
                                                        onClick={() => handleDeleteSale(sale.id)}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                )}
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
                                    <TableHead className="text-start">{t('sales.cashier') || 'Cashier'}</TableHead>
                                    <TableHead className="text-start">{t('sales.origin') || 'Origin'}</TableHead>
                                    <TableHead className="text-end">{t('sales.total') || 'Total'}</TableHead>
                                    <TableHead className="text-end">{t('common.actions')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sales.map((sale) => {
                                    const returnedItemsCount = sale.items?.filter(item => item.is_returned).length || 0
                                    const partialReturnedItemsCount = sale.items?.filter(item => (item.returned_quantity || 0) > 0 && !item.is_returned).length || 0
                                    const totalReturnedQuantity = sale.items?.reduce((sum, item) => {
                                        if (item.is_returned) return sum + (item.quantity || 0)
                                        if ((item.returned_quantity || 0) > 0) return sum + (item.returned_quantity || 0)
                                        return sum
                                    }, 0) || 0
                                    const hasAnyReturn = returnedItemsCount > 0 || partialReturnedItemsCount > 0

                                    return (
                                        <TableRow
                                            key={sale.id}
                                            className={sale.is_returned ? 'bg-destructive/10 border-destructive/20' : hasAnyReturn ? 'bg-orange-500/10 border-orange-500/20 dark:bg-orange-500/5 dark:border-orange-500/10' : ''}
                                        >
                                            <TableCell className="text-start font-mono text-sm">
                                                <div className="flex items-center gap-2">
                                                    {formatDateTime(sale.created_at)}
                                                    {sale.is_returned && (
                                                        <span className="px-2 py-0.5 text-[10px] font-bold bg-destructive/20 text-destructive dark:bg-destructive/30 dark:text-destructive-foreground rounded-full border border-destructive/30">
                                                            {(t('sales.return.returnedStatus') || 'RETURNED').toUpperCase()}
                                                        </span>
                                                    )}
                                                    {hasAnyReturn && !sale.is_returned && (
                                                        <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400 border border-orange-200 dark:border-orange-500/30">
                                                            -{totalReturnedQuantity} {t('sales.return.returnedLabel') || 'returned'}
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-start">
                                                {sale.cashier_name}
                                            </TableCell>
                                            <TableCell className="text-start">
                                                <span className="px-2 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground uppercase">
                                                    {sale.origin}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-end font-bold">
                                                {formatCurrency(sale.total_amount, sale.settlement_currency || 'usd', features.iqd_display_preference)}
                                            </TableCell>
                                            <TableCell className="text-end">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setSelectedSale(sale)}
                                                    title={t('sales.details') || "View Details"}
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => onPrintClick(sale)}
                                                    title={t('common.print') || "Print Receipt"}
                                                >
                                                    <Printer className="w-4 h-4" />
                                                </Button>
                                                {!sale.is_returned && (user?.role === 'admin' || user?.role === 'staff') && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleReturnSale(sale)}
                                                        title={t('sales.return') || "Return Sale"}
                                                        className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                                    >
                                                        <RotateCcw className="w-4 h-4" />
                                                    </Button>
                                                )}
                                                {user?.role === 'admin' && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                        onClick={() => handleDeleteSale(sale.id)}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                )}
                                                {/* Return badge moved to date cell */}
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
                onReturnItem={handleReturnItem}
            />

            {/* Return Decline Modal */}
            <ReturnDeclineModal
                isOpen={showDeclineModal}
                onClose={() => {
                    setShowDeclineModal(false)
                    setFilteredReturnItems([])
                    setSaleToReturn(null)
                }}
                products={nonReturnableProducts}
                returnableProducts={filteredReturnItems.map(item => item.product?.name || item.product_name || 'Product')}
                onContinue={filteredReturnItems.length > 0 ? () => {
                    if (saleToReturn) {
                        finalizeReturn(saleToReturn, filteredReturnItems, isWholeSaleReturn, true)
                    }
                } : undefined}
            />

            {/* Return Rules Sequence */}
            {rulesQueue.length > 0 && currentRuleIndex >= 0 && (
                <ReturnRulesDisplayModal
                    isOpen={true}
                    onClose={handleCancelRules}
                    productName={rulesQueue[currentRuleIndex].productName}
                    rules={rulesQueue[currentRuleIndex].rules}
                    isLast={currentRuleIndex === rulesQueue.length - 1}
                    onContinue={handleNextRule}
                    onBack={handleBackRule}
                    showBack={currentRuleIndex > 0}
                />
            )}

            {/* Return Confirmation Modal */}
            <ReturnConfirmationModal
                isOpen={returnModalOpen}
                onClose={() => setReturnModalOpen(false)}
                onConfirm={handleReturnConfirm}
                title={saleToReturn ? t('sales.return.confirmTitle') || 'Return Sale' : ''}
                message={saleToReturn ? (t('sales.return.confirmMessage') || 'Are you sure you want to return this sale?') : ''}
                isItemReturn={saleToReturn?.items?.length === 1 && saleToReturn?.items?.[0]?.quantity > 1 && selectedSale?.items?.filter(i => i.product_id === saleToReturn?.items?.[0]?.product_id).length === 1}
                maxQuantity={saleToReturn?.items?.[0]?.quantity || 1}
                itemName={saleToReturn?.items?.[0]?.product_name || ''}
            />

            {/* Hidden Print Component - using opacity/position instead of display:none to ensure it renders for print */}
            <div style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
                <div ref={printRef}>
                    {printingSale && (
                        <SaleReceipt
                            sale={printingSale}
                            features={features}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
