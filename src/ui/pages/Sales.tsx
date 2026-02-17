import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import { Sale } from '@/types'
import { mapSaleToUniversal } from '@/lib/mappings'
import { formatCurrency, formatDateTime, formatCompactDateTime, formatDate, cn } from '@/lib/utils'

import { db, useSales, toUISale } from '@/local-db'
import { useWorkspace } from '@/workspace'
import { isMobile } from '@/lib/platform'
import { useDateRange } from '@/context/DateRangeContext'
import { DateRangeFilters } from '@/ui/components/DateRangeFilters'
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
    SaleDetailsModal,
    ReturnConfirmationModal,
    ReturnDeclineModal,
    ReturnRulesDisplayModal,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    PrintSelectionModal,
    DeleteConfirmationModal,
    PrintPreviewModal,
    SalesNoteModal,
    ExportPreviewModal,
    useToast,
    AppPagination
} from '@/ui/components'
import { SaleItem } from '@/types'
import {
    Receipt,
    Eye,
    Loader2,
    Trash2,
    Printer,
    RotateCcw,
    Filter,
    StickyNote,
    FileSpreadsheet
} from 'lucide-react'

export function Sales() {
    const { user } = useAuth()
    const { t } = useTranslation()
    const { features, workspaceName, activeWorkspace } = useWorkspace()
    const { toast } = useToast()
    const rawSales = useSales(user?.workspaceId)
    const allSales = useMemo(() => rawSales.map(toUISale), [rawSales])
    const isLoading = rawSales === undefined
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
    const [printingSale, setPrintingSale] = useState<Sale | null>(null)
    const [returnModalOpen, setReturnModalOpen] = useState(false)
    const [saleToReturn, setSaleToReturn] = useState<Sale | null>(null)
    const { dateRange, customDates } = useDateRange()
    const [selectedCashier, setSelectedCashier] = useState<string>(() => {
        return localStorage.getItem('sales_selected_cashier') || 'all'
    })
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null)
    const [currentPage, setCurrentPage] = useState(1)
    const pageSize = 20

    // Client-side filtering: date range + cashier
    const filteredSales = useMemo(() => {
        let result = allSales
        const now = new Date()

        if (dateRange === 'today') {
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
            result = result.filter(s => new Date(s.created_at) >= startOfDay)
        } else if (dateRange === 'month') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            result = result.filter(s => new Date(s.created_at) >= startOfMonth)
        } else if (dateRange === 'custom' && customDates.start && customDates.end) {
            const start = new Date(customDates.start)
            start.setHours(0, 0, 0, 0)
            const end = new Date(customDates.end)
            end.setHours(23, 59, 59, 999)
            result = result.filter(s => {
                const d = new Date(s.created_at)
                return d >= start && d <= end
            })
        }

        if (selectedCashier !== 'all') {
            result = result.filter(s => s.cashier_id === selectedCashier)
        }

        // Sort by created_at descending
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

        return result
    }, [allSales, dateRange, customDates, selectedCashier])

    const totalCount = filteredSales.length

    // Client-side pagination
    const sales = useMemo(() => {
        const from = (currentPage - 1) * pageSize
        return filteredSales.slice(from, from + pageSize)
    }, [filteredSales, currentPage, pageSize])

    // Derive available cashiers from local data
    const availableCashiers = useMemo(() => {
        const map = new Map<string, string>()
        allSales.forEach(s => {
            if (s.cashier_id && s.cashier_name && s.cashier_name !== 'Staff') {
                map.set(s.cashier_id, s.cashier_name)
            }
        })
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
    }, [allSales])

    const getEffectiveTotal = (sale: Sale) => {
        // If the sale itself is marked returned
        if (sale.is_returned) return 0

        // If items are present, calculate sum of remaining (non-returned) value
        if (sale.items && sale.items.length > 0) {
            // Check if all items are fully returned (fail-safe)
            const allItemsReturned = sale.items.every(item =>
                item.is_returned || (item.returned_quantity || 0) >= item.quantity
            )
            if (allItemsReturned) return 0

            return sale.items.reduce((sum, item) => {
                const quantity = item.quantity || 0
                const returnedQty = item.returned_quantity || 0
                const remainingQty = Math.max(0, quantity - returnedQty)

                if (remainingQty <= 0) return sum

                // Use converted_unit_price as it's already in the settlement currency
                // Revenue.tsx uses: itemRevenue = item.converted_unit_price * netQuantity
                const unitPrice = item.converted_unit_price || item.unit_price || 0

                return sum + (unitPrice * remainingQty)
            }, 0)
        }

        return sale.total_amount
    }

    const getDateDisplay = () => {
        if (dateRange === 'today') {
            return formatDate(new Date())
        }
        if (dateRange === 'month') {
            const now = new Date()
            return new Intl.DateTimeFormat('en-GB', {
                month: 'short',
                year: 'numeric'
            }).format(now)
        }
        if (dateRange === 'custom') {
            if (sales && sales.length > 0) {
                const dates = sales.map(s => new Date(s.created_at).getTime())
                const minDate = new Date(Math.min(...dates))
                const maxDate = new Date(Math.max(...dates))
                return `${t('performance.filters.from')} ${formatDate(minDate)} ${t('performance.filters.to')} ${formatDate(maxDate)}`
            }
            if (customDates.start && customDates.end) {
                return `${t('performance.filters.from')} ${formatDate(customDates.start)} ${t('performance.filters.to')} ${formatDate(customDates.end)}`
            }
        }
        if (dateRange === 'allTime') {
            if (sales && sales.length > 0) {
                const dates = sales.map(s => new Date(s.created_at).getTime())
                const minDate = new Date(Math.min(...dates))
                const maxDate = new Date(Math.max(...dates))
                return `${t('performance.filters.allTime')}, ${t('performance.filters.from')} ${formatDate(minDate)} ${t('performance.filters.to')} ${formatDate(maxDate)}`
            }
            return t('performance.filters.allTime') || 'All Time'
        }
        return ''
    }

    const [rulesQueue, setRulesQueue] = useState<Array<{ productName: string; rules: string }>>([])
    const [currentRuleIndex, setCurrentRuleIndex] = useState(-1)
    const [showDeclineModal, setShowDeclineModal] = useState(false)
    const [nonReturnableProducts, setNonReturnableProducts] = useState<string[]>([])
    const [filteredReturnItems, setFilteredReturnItems] = useState<SaleItem[]>([])
    const [printFormat, setPrintFormat] = useState<'receipt' | 'a4'>(() => {
        return (localStorage.getItem('sales_print_format') as 'receipt' | 'a4') || 'receipt'
    })


    useEffect(() => {
        localStorage.setItem('sales_selected_cashier', selectedCashier)
    }, [selectedCashier])

    useEffect(() => {
        localStorage.setItem('sales_print_format', printFormat)
    }, [printFormat])
    const [showPrintModal, setShowPrintModal] = useState(false)
    const [saleToPrintSelection, setSaleToPrintSelection] = useState<Sale | null>(null)
    const [showPrintPreview, setShowPrintPreview] = useState(false)
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false)
    const [selectedSaleForNote, setSelectedSaleForNote] = useState<Sale | null>(null)
    const [isExportModalOpen, setIsExportModalOpen] = useState(false)



    const onPrintClick = (sale: Sale) => {
        setSaleToPrintSelection(sale)
        setShowPrintModal(true)
    }

    const handlePrintSelection = (format: 'receipt' | 'a4') => {
        setPrintFormat(format)
        setShowPrintModal(false)
        if (saleToPrintSelection) {
            setPrintingSale(saleToPrintSelection)
            setShowPrintPreview(true) // Open preview instead of printing directly
        }
    }

    const handleConfirmPrint = () => {
        // PrintPreviewModal handles PDF rendering/printing internally
        setShowPrintPreview(false)
        setPrintingSale(null)
        setSaleToPrintSelection(null)
    }

    const handleDeleteSale = (sale: Sale) => {
        setSaleToDelete(sale)
        setDeleteModalOpen(true)
    }

    const confirmDeleteSale = async () => {
        if (!saleToDelete) return
        try {
            const { error } = await supabase.rpc('delete_sale', { p_sale_id: saleToDelete.id })
            if (error) throw error

            // Update local-db immediately for instant UI feedback
            await db.sales.delete(saleToDelete.id)
            await db.sale_items.where('saleId').equals(saleToDelete.id).delete()

            if (selectedSale?.id === saleToDelete.id) setSelectedSale(null)
            setDeleteModalOpen(false)
            setSaleToDelete(null)
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

                    // Update local-db for instant UI reactivity
                    const existingLocal = await db.sales.get(saleToReturn.id)
                    if (existingLocal) {
                        const updatedSale = updateSale({ ...existingLocal, items: (existingLocal as any)._enrichedItems } as any)
                            ; (existingLocal as any)._enrichedItems = updatedSale.items
                            ; (existingLocal as any).totalAmount = updatedSale.total_amount
                            ; (existingLocal as any).isReturned = updatedSale.is_returned
                        await db.sales.put(existingLocal)
                    }
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

                    // Update local-db for instant UI reactivity
                    const existingLocal = await db.sales.get(saleToReturn.id)
                    if (existingLocal) {
                        ; (existingLocal as any).isReturned = true
                            ; (existingLocal as any).totalAmount = 0
                            ; (existingLocal as any).returnReason = reason
                            ; (existingLocal as any).returnedAt = new Date().toISOString()
                        const updatedItems = ((existingLocal as any)._enrichedItems || []).map((i: any) => ({
                            ...i,
                            is_returned: true,
                            returned_quantity: i.quantity,
                            return_reason: reason,
                            returned_at: new Date().toISOString()
                        }))
                            ; (existingLocal as any)._enrichedItems = updatedItems
                        await db.sales.put(existingLocal)
                    }
                    if (selectedSale?.id === saleToReturn.id) {
                        setSelectedSale(updateSale(selectedSale))
                    }
                }
            }

            if (error) throw error

            // Close modal and refresh — local-db handles reactivity via useLiveQuery
            setReturnModalOpen(false)
            setSaleToReturn(null)
        } catch (err: any) {
            console.error('Error returning sale:', err)
            alert('Failed to return sale: ' + (err.message || 'Unknown error'))
        }
    }

    const handleSaveNote = async (note: string) => {
        if (!selectedSaleForNote) return

        const now = new Date().toISOString()
        const isCurrentlyOnline = navigator.onLine

        try {
            // Update local-db for instant UI reactivity (useLiveQuery will pick it up)
            await db.sales.update(selectedSaleForNote.id, {
                notes: note,
                updatedAt: now,
                syncStatus: 'pending'
            })

            if (isCurrentlyOnline) {
                // 2. ONLINE: Write to Supabase first
                const { error } = await supabase
                    .from('sales')
                    .update({
                        notes: note,
                        updated_at: now
                    })
                    .eq('id', selectedSaleForNote.id)

                if (error) {
                    console.error('Supabase update failed, falling back to offline sync:', error)
                    // Fallback to offline mutation if online request fails
                    await db.offline_mutations.add({
                        id: crypto.randomUUID(),
                        workspaceId: activeWorkspace?.id || selectedSaleForNote.workspace_id,
                        entityType: 'sales',
                        entityId: selectedSaleForNote.id,
                        operation: 'update',
                        payload: { notes: note, updated_at: now },
                        status: 'pending',
                        createdAt: now
                    })

                    await db.sales.update(selectedSaleForNote.id, {
                        notes: note,
                        updatedAt: now,
                        syncStatus: 'pending'
                    })

                    toast({
                        title: t('sales.notes.saved') || 'Note Saved',
                        description: t('sales.notes.savedOffline') || 'Note saved locally and will sync when online.',
                    })
                } else {
                    // Success: Update Dexie as synced
                    await db.sales.update(selectedSaleForNote.id, {
                        notes: note,
                        updatedAt: now,
                        syncStatus: 'synced',
                        lastSyncedAt: now
                    })

                    toast({
                        title: t('sales.notes.saved') || 'Note Saved',
                        description: t('sales.notes.savedOnline') || 'Note saved to cloud.',
                    })
                }
            } else {
                // 3. OFFLINE: Local mutation
                await db.sales.update(selectedSaleForNote.id, {
                    notes: note,
                    updatedAt: now,
                    syncStatus: 'pending'
                })

                await db.offline_mutations.add({
                    id: crypto.randomUUID(),
                    workspaceId: activeWorkspace?.id || selectedSaleForNote.workspace_id,
                    entityType: 'sales',
                    entityId: selectedSaleForNote.id,
                    operation: 'update',
                    payload: { notes: note, updated_at: now },
                    status: 'pending',
                    createdAt: now
                })

                toast({
                    title: t('sales.notes.saved') || 'Note Saved',
                    description: t('sales.notes.savedOffline') || 'Note saved locally and will sync when online.',
                })
            }
        } catch (error) {
            console.error('Error saving note:', error)
            toast({
                title: t('common.error') || 'Error',
                description: t('sales.notes.error') || 'Failed to save note.',
                variant: 'destructive',
            })
        }
    }

    // Reset to page 1 when filters change
    useEffect(() => {
        setCurrentPage(1)
    }, [dateRange, customDates, selectedCashier])

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Receipt className="w-6 h-6 text-primary" />
                            {t('sales.title') || 'Sales History'}
                            {isLoading && (
                                <Loader2 className="w-4 h-4 animate-spin text-primary/50 ml-1" />
                            )}
                        </h1>
                        {getDateDisplay() && (
                            <div className="px-3 py-1 text-sm font-bold bg-primary text-primary-foreground rounded-lg shadow-sm animate-pop-in">
                                {getDateDisplay()}
                            </div>
                        )}
                    </div>
                    <p className="text-muted-foreground">
                        {t('sales.subtitle') || 'View past transactions'}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <DateRangeFilters />

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
                </div>
            </div>

            <Card className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                    <div className="flex flex-col gap-1">
                        <CardTitle>{t('sales.listTitle') || 'Recent Sales'}</CardTitle>
                        {totalCount > 0 && (
                            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em] opacity-70">
                                {t('sales.pagination.total', { count: totalCount }) || `${totalCount} Sales Found`}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-4">
                        <AppPagination
                            currentPage={currentPage}
                            totalCount={totalCount}
                            pageSize={pageSize}
                            onPageChange={setCurrentPage}
                            className="w-auto"
                        />
                        <Button
                            onClick={() => setIsExportModalOpen(true)}
                            disabled={sales.length === 0}
                            className={cn(
                                "h-10 px-6 rounded-full font-black transition-all flex gap-3 items-center group relative overflow-hidden",
                                "bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400",
                                "hover:bg-emerald-100 dark:hover:bg-emerald-500/20 hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)] hover:scale-[1.02] active:scale-95",
                                "uppercase tracking-widest text-[10px]"
                            )}
                        >
                            <FileSpreadsheet className="w-4 h-4 transition-transform group-hover:rotate-12" />
                            <span className="hidden sm:inline">
                                {t('sales.export.button')}
                            </span>
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 dark:via-white/5 to-transparent -translate-x-full group-hover:animate-shimmer" />
                        </Button>
                    </div>
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
                                const isFullyReturned = sale.is_returned || (sale.items && sale.items.length > 0 && sale.items.every((item: SaleItem) =>
                                    item.is_returned || (item.returned_quantity || 0) >= item.quantity
                                ))
                                const returnedItemsCount = sale.items?.filter((item: SaleItem) => item.is_returned).length || 0
                                const partialReturnedItemsCount = sale.items?.filter((item: SaleItem) => (item.returned_quantity || 0) > 0 && !item.is_returned).length || 0
                                const totalReturnedQuantity = sale.items?.reduce((sum: number, item: SaleItem) => {
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
                                            isFullyReturned ? 'bg-destructive/5 border-destructive/20' : hasAnyReturn ? 'bg-orange-500/5' : 'bg-card'
                                        )}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="space-y-2">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-wider">
                                                            {formatCompactDateTime(sale.created_at)}
                                                        </span>
                                                        {sale.sequenceId ? (
                                                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-primary/10 text-primary rounded border border-primary/20">
                                                                #{String(sale.sequenceId).padStart(5, '0')}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] text-muted-foreground/50 font-mono">
                                                                #{sale.id.slice(0, 8)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {isFullyReturned && (
                                                            <span className="px-2 py-0.5 text-[9px] font-bold bg-destructive/10 text-destructive rounded-full border border-destructive/20 uppercase">
                                                                {t('sales.return.returnedStatus') || 'RETURNED'}
                                                            </span>
                                                        )}
                                                        {sale.system_review_status === 'flagged' && (
                                                            <span className="px-2 py-0.5 text-[9px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400 rounded-full border border-orange-200 dark:border-orange-500/30 uppercase flex items-center gap-1">
                                                                ⚠️ {t('sales.flagged') || 'FLAGGED'}
                                                            </span>
                                                        )}
                                                        {hasAnyReturn && !isFullyReturned && (
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
                                                    {formatCurrency(getEffectiveTotal(sale), sale.settlement_currency || 'usd', features.iqd_display_preference)}
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
                                                {!isFullyReturned && (user?.role === 'admin' || user?.role === 'staff') && (
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
                                                        onClick={() => handleDeleteSale(sale)}
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
                                    <TableHead className="w-[80px]">{t('sales.id') || '#'}</TableHead>
                                    <TableHead className="text-start">{t('sales.date') || 'Date'}</TableHead>
                                    <TableHead className="text-start">{t('sales.cashier') || 'Cashier'}</TableHead>
                                    <TableHead className="text-start">{t('sales.origin') || 'Origin'}</TableHead>
                                    <TableHead className="text-start">{t('sales.notes.title') || 'Notes'}</TableHead>
                                    <TableHead className="text-end">{t('sales.total') || 'Total'}</TableHead>
                                    <TableHead className="text-end">{t('common.actions')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sales.map((sale) => {
                                    const isFullyReturned = sale.is_returned || (sale.items && sale.items.length > 0 && sale.items.every((item: SaleItem) =>
                                        item.is_returned || (item.returned_quantity || 0) >= item.quantity
                                    ))
                                    const returnedItemsCount = sale.items?.filter((item: SaleItem) => item.is_returned).length || 0
                                    const partialReturnedItemsCount = sale.items?.filter((item: SaleItem) => (item.returned_quantity || 0) > 0 && !item.is_returned).length || 0
                                    const totalReturnedQuantity = sale.items?.reduce((sum: number, item: SaleItem) => {
                                        if (item.is_returned) return sum + (item.quantity || 0)
                                        if ((item.returned_quantity || 0) > 0) return sum + (item.returned_quantity || 0)
                                        return sum
                                    }, 0) || 0
                                    const hasAnyReturn = returnedItemsCount > 0 || partialReturnedItemsCount > 0

                                    return (
                                        <TableRow
                                            key={sale.id}
                                            className={isFullyReturned ? 'bg-destructive/10 border-destructive/20' : hasAnyReturn ? 'bg-orange-500/10 border-orange-500/20 dark:bg-orange-500/5 dark:border-orange-500/10' : ''}
                                        >
                                            <TableCell className="font-mono text-sm font-bold text-primary">
                                                {sale.sequenceId ? (
                                                    <span>#{String(sale.sequenceId).padStart(5, '0')}</span>
                                                ) : (
                                                    <span className="text-muted-foreground/40 text-xs">#{sale.id.slice(0, 4)}...</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-start font-mono text-sm">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-muted-foreground">
                                                        {formatDateTime(sale.created_at)}
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        {isFullyReturned && (
                                                            <span className="px-2 py-0.5 text-[10px] font-bold bg-destructive/20 text-destructive dark:bg-destructive/30 dark:text-destructive-foreground rounded-full border border-destructive/30">
                                                                {(t('sales.return.returnedStatus') || 'RETURNED').toUpperCase()}
                                                            </span>
                                                        )}
                                                        {sale.system_review_status === 'flagged' && (
                                                            <span className="px-2 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400 rounded-full border border-orange-200 dark:border-orange-500/30 flex items-center gap-1" title={sale.system_review_reason || ''}>
                                                                ⚠️ {(t('sales.flagged') || 'FLAGGED').toUpperCase()}
                                                            </span>
                                                        )}
                                                        {hasAnyReturn && !isFullyReturned && (
                                                            <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400 border border-orange-200 dark:border-orange-500/30">
                                                                -{totalReturnedQuantity} {t('sales.return.returnedLabel') || 'returned'}
                                                            </div>
                                                        )}
                                                    </div>
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
                                            <TableCell className="text-start">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setSelectedSaleForNote(sale)
                                                        setIsNoteModalOpen(true)
                                                    }}
                                                    className={cn(
                                                        "text-xs font-medium h-8 px-3 rounded-lg flex items-center gap-2 transition-all",
                                                        sale.notes
                                                            ? "bg-primary/5 text-primary hover:bg-primary/10 border border-primary/20"
                                                            : "text-muted-foreground hover:bg-muted"
                                                    )}
                                                >
                                                    <StickyNote className={cn("w-3.5 h-3.5", sale.notes ? "fill-primary/20" : "")} />
                                                    {sale.notes ? (t('sales.notes.viewNote') || 'View Notes..') : (t('sales.notes.addNote') || 'Add Note')}
                                                </Button>
                                            </TableCell>

                                            <TableCell className="text-end font-bold">
                                                {formatCurrency(getEffectiveTotal(sale), sale.settlement_currency || 'usd', features.iqd_display_preference)}
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
                                                        onClick={() => handleDeleteSale(sale)}
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
                onReturnSale={handleReturnSale}
                onDownloadInvoice={onPrintClick}
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

            {/* Sales Note Modal */}
            <SalesNoteModal
                isOpen={isNoteModalOpen}
                onClose={() => {
                    setIsNoteModalOpen(false)
                    setSelectedSaleForNote(null)
                }}
                sale={selectedSaleForNote}
                onSave={handleSaveNote}
            />

            <ExportPreviewModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                filters={{
                    dateRange,
                    customDates,
                    selectedCashier
                }}
            />

            <PrintSelectionModal
                isOpen={showPrintModal}
                onClose={() => setShowPrintModal(false)}
                onSelect={handlePrintSelection}
            />

            <DeleteConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => {
                    setDeleteModalOpen(false)
                    setSaleToDelete(null)
                }}
                onConfirm={confirmDeleteSale}
                itemName={saleToDelete ? (saleToDelete.sequenceId ? `#${String(saleToDelete.sequenceId).padStart(5, '0')}` : `#${saleToDelete.id.slice(0, 8)}`) : ''}
                isLoading={isLoading}
                title={t('sales.confirmDelete')}
                description={t('sales.deleteWarning')}
            />

            {/* Print Preview Modal */}
            <PrintPreviewModal
                isOpen={showPrintPreview}
                onClose={() => {
                    setShowPrintPreview(false)
                    setPrintingSale(null)
                    setSaleToPrintSelection(null)
                }}
                onConfirm={handleConfirmPrint}
                title={printFormat === 'a4' ? (t('sales.print.a4') || 'A4 Invoice') : (t('sales.print.receipt') || 'Receipt')}
                features={features}
                workspaceName={workspaceName}
                pdfData={printingSale ? mapSaleToUniversal(printingSale) : undefined}
                invoiceData={printingSale ? {
                    sequenceId: printingSale.sequenceId,
                    totalAmount: printingSale.total_amount,
                    settlementCurrency: (printingSale.settlement_currency || 'usd') as any,
                    origin: printingSale.origin || 'pos',
                    cashierName: printingSale.cashier_name,
                    createdByName: user?.name || 'Unknown',
                    printFormat: printFormat
                } : undefined}
            />
        </div>
    )
}
