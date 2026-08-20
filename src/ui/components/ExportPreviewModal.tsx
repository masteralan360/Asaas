import { lazy, Suspense, useCallback, useState, useMemo, useEffect } from 'react'
import { EntireColumnsSelection, type CellBase, type Matrix, type Selection } from 'react-spreadsheet'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, Download, ArrowLeft, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/workspace'
import { db } from '@/local-db'
import { Button } from '@/ui/components/button'
import { exportToExcel, mapFinanceForExport, mapSalesForExport, mapRevenueForExport } from '@/lib/excelExport'
import { supabase } from '@/auth/supabase'
import { useHideCosts, useViewOwnRecordScope } from '@/permissions'
import { getDateRangeBounds } from '@/lib/dateRangeFilters'

const SpreadsheetPreview = lazy(() =>
    import('react-spreadsheet').then((module) => ({ default: module.default }))
)

type PreviewCell = CellBase<string | number | boolean | null | undefined>
type PreviewMatrix = Matrix<PreviewCell>

function getSelectedColumnRange(selection: Selection | null, columnCount: number) {
    if (!(selection instanceof EntireColumnsSelection) || columnCount === 0) {
        return null
    }

    const start = Math.max(0, Math.min(selection.start, selection.end))
    const end = Math.min(columnCount - 1, Math.max(selection.start, selection.end))

    return start <= end ? { start, end } : null
}

function matrixToExportRows(matrix: PreviewMatrix) {
    const headerRow = matrix[0] || []
    const headers = headerRow.map((cell) => String(cell?.value ?? '').trim())
    const activeColumns = headers
        .map((header, index) => ({ header, index }))
        .filter(({ header }) => header.length > 0)

    if (activeColumns.length === 0) {
        return []
    }

    return matrix.slice(1).map((row) => Object.fromEntries(
        activeColumns.map(({ header, index }) => [header, row?.[index]?.value ?? ''])
    ))
}

interface ExportPreviewModalProps {
    isOpen: boolean
    onClose: () => void
    filters?: {
        dateRange: string
        customDates: { start: string | null; end: string | null }
        selectedCashier: string
    }
    type?: 'sales' | 'revenue' | 'finance' | 'products' | 'inventory-product-summary'
    records?: any[]
}

export function ExportPreviewModal({
    isOpen,
    onClose,
    filters,
    type = 'sales',
    records
}: ExportPreviewModalProps) {
    const { t } = useTranslation()
    const { activeWorkspace, isLocalMode } = useWorkspace()
    const hideCosts = useHideCosts()
    const salesViewOwnScope = useViewOwnRecordScope('sales.view_own')
    const [isExporting, setIsExporting] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [data, setData] = useState<any[]>([])
    const [previewData, setPreviewData] = useState<PreviewMatrix>([])
    const [selectedPreviewCells, setSelectedPreviewCells] = useState<Selection | null>(null)

    useEffect(() => {
        if (isOpen && (type === 'revenue' || type === 'finance' || type === 'products' || type === 'inventory-product-summary') && records) {
            setData(records)
            setIsLoading(false)
        } else if (isOpen && filters) {
            fetchExportData()
        } else if (!isOpen) {
            setData([])
        }
    }, [
        activeWorkspace?.id,
        filters,
        hideCosts,
        isLocalMode,
        isOpen,
        records,
        salesViewOwnScope.isRestricted,
        salesViewOwnScope.userId,
        type,
    ])

    const fetchExportData = async () => {
        setIsLoading(true)
        try {
            if (isLocalMode && activeWorkspace?.id) {
                const localSales = await db.sales.where('workspaceId').equals(activeWorkspace.id).toArray()
                const localUsers = await db.users.where('workspaceId').equals(activeWorkspace.id).toArray()
                const localSaleIds = localSales.map((sale) => sale.id)
                const localSaleItems = !hideCosts && localSaleIds.length > 0
                    ? await db.sale_items.where('saleId').anyOf(localSaleIds).toArray()
                    : []
                const saleItemsBySaleId = localSaleItems.reduce<Record<string, typeof localSaleItems>>((acc, item) => {
                    if (!acc[item.saleId]) {
                        acc[item.saleId] = []
                    }
                    acc[item.saleId].push(item)
                    return acc
                }, {})
                const profilesMap = localUsers.reduce<Record<string, string>>((acc, member) => {
                    acc[member.id] = member.name
                    return acc
                }, {})

                const { dateRange, customDates, selectedCashier } = filters || {
                    dateRange: 'today',
                    customDates: { start: null, end: null },
                    selectedCashier: 'all'
                }
                const { start, end } = getDateRangeBounds(dateRange as Parameters<typeof getDateRangeBounds>[0], {
                    start: customDates.start || '',
                    end: customDates.end || ''
                })

                const filteredSales = localSales.filter((sale) => {
                    if (salesViewOwnScope.isRestricted && sale.cashierId !== salesViewOwnScope.userId) {
                        return false
                    }
                    const saleDate = new Date(sale.createdAt)
                    if (start && saleDate < start) return false
                    if (end && saleDate >= end) return false
                    if (selectedCashier && selectedCashier !== 'all' && sale.cashierId !== selectedCashier) {
                        return false
                    }
                    return true
                })

                const formattedSales = filteredSales
                    .filter((sale: any) => !sale.isReturned)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((sale: any) => {
                        const saleItems = saleItemsBySaleId[sale.id] || []
                        const saleRevenue = sale.totalAmount || 0
                        const saleCost = saleItems.reduce((acc: number, item: any) => {
                            const costPrice = item.convertedCostPrice || item.costPrice || 0
                            const quantity = item.quantity || 0
                            const returnedQuantity = item.returnedQuantity || 0
                            const netQuantity = Math.max(0, quantity - returnedQuantity)
                            return acc + (costPrice * netQuantity)
                        }, 0)
                        const exportSale = {
                            ...sale,
                            sequenceId: sale.sequenceId,
                            cashier_name: profilesMap[sale.cashierId] || 'Staff',
                            revenue: saleRevenue,
                            cost: saleCost,
                            profit: saleRevenue - saleCost,
                            margin: saleRevenue > 0 ? ((saleRevenue - saleCost) / saleRevenue) * 100 : 0,
                            date: sale.createdAt,
                            cashier: profilesMap[sale.cashierId] || 'Staff',
                            currency: sale.settlementCurrency || 'usd',
                            total_amount: sale.totalAmount,
                            settlement_currency: sale.settlementCurrency,
                            items: saleItems.map((item: any) => ({
                                ...item,
                                product_name: item.productName || 'Unknown Product',
                                product_sku: item.productSku || ''
                            }))
                        }
                        if (!hideCosts) return exportSale
                        const { cost, profit, margin, items, ...safeSale } = exportSale
                        return safeSale
                    })
                setData(formattedSales)
                return
            }

            let query = supabase
                .from('sales')
                .select(hideCosts
                    ? 'id, sequence_id, cashier_id, created_at, is_returned, total_amount, settlement_currency, payment_method, notes, origin'
                    : `
                        *,
                        items:sale_items(
                            *,
                            product:product_id(name, sku, can_be_returned, return_rules)
                        )
                    `)

            const { dateRange, customDates, selectedCashier } = filters || {
                dateRange: 'today',
                customDates: { start: null, end: null },
                selectedCashier: 'all'
            }
            const { start, end } = getDateRangeBounds(dateRange as Parameters<typeof getDateRangeBounds>[0], {
                start: customDates.start || '',
                end: customDates.end || ''
            })

            if (activeWorkspace?.id) {
                query = query.eq('workspace_id', activeWorkspace.id)
            }

            if (start) query = query.gte('created_at', start.toISOString())
            if (end) query = query.lt('created_at', end.toISOString())

            if (selectedCashier && selectedCashier !== 'all') {
                query = query.eq('cashier_id', selectedCashier)
            }

            const { data: salesData, error } = await query.order('created_at', { ascending: false })
            if (error) throw error

            const cashierIds = Array.from(new Set((salesData || []).map((s: any) => s.cashier_id).filter(Boolean)))
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

            const formattedSales = (salesData || [])
                .filter((sale: any) => !sale.is_returned)
                .map((sale: any) => {
                    const saleRevenue = sale.total_amount || 0
                    const saleCost = (sale.items || []).reduce((acc: number, item: any) => {
                        const costPrice = item.converted_cost_price || item.cost_price || 0
                        const quantity = item.quantity || 0
                        const returnedQuantity = item.returned_quantity || 0
                        const netQuantity = Math.max(0, quantity - returnedQuantity)
                        return acc + (costPrice * netQuantity)
                    }, 0)
                    const exportSale = {
                        ...sale,
                        sequenceId: sale.sequence_id,
                        cashier_name: profilesMap[sale.cashier_id] || 'Staff',
                        revenue: saleRevenue,
                        cost: saleCost,
                        profit: saleRevenue - saleCost,
                        margin: saleRevenue > 0 ? ((saleRevenue - saleCost) / saleRevenue) * 100 : 0,
                        date: sale.created_at,
                        cashier: profilesMap[sale.cashier_id] || 'Staff',
                        currency: sale.settlement_currency || 'usd',
                        items: sale.items?.map((item: any) => ({
                            ...item,
                            product_name: item.product?.name || 'Unknown Product',
                            product_sku: item.product?.sku || ''
                        }))
                    }
                    if (!hideCosts) return exportSale
                    const { cost, profit, margin, items, ...safeSale } = exportSale
                    return safeSale
                })
            setData(formattedSales)
        } catch (error) {
            console.error('Error fetching export data:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const exportData = useMemo(() => {
        if (!data) return []
        if (type === 'finance') return mapFinanceForExport(data)
        if (type === 'products' || type === 'inventory-product-summary') return mapFinanceForExport(data)
        if (type === 'revenue') return mapRevenueForExport(data, t, !hideCosts)
        return mapSalesForExport(data, t)
    }, [data, hideCosts, t, type])

    const spreadsheetData = useMemo<PreviewMatrix>(() => {
        if (exportData.length === 0) return []
        const headers = Object.keys(exportData[0]).map(header => ({ value: header, readOnly: true }))
        const rows = exportData.map(row =>
            Object.values(row).map(val => ({ value: String(val ?? '') }))
        )
        return [headers, ...rows]
    }, [exportData])

    useEffect(() => {
        if (!isOpen) {
            setPreviewData([])
            setSelectedPreviewCells(null)
            return
        }

        setPreviewData(spreadsheetData)
        setSelectedPreviewCells(null)
    }, [isOpen, spreadsheetData])

    const previewExportData = useMemo(() => matrixToExportRows(previewData), [previewData])

    const handlePreviewKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key !== 'Delete') {
            return
        }

        const target = event.target as HTMLElement | null
        if (target?.closest('input, textarea, [contenteditable="true"]')) {
            return
        }

        const columnRange = getSelectedColumnRange(selectedPreviewCells, previewData[0]?.length ?? 0)
        if (!columnRange) {
            return
        }

        event.preventDefault()
        event.stopPropagation()

        setPreviewData((current) => current.map((row) =>
            row?.filter((_, columnIndex) => columnIndex < columnRange.start || columnIndex > columnRange.end) ?? []
        ))
        setSelectedPreviewCells(null)
    }, [previewData, selectedPreviewCells])

    const handleExport = async () => {
        setIsExporting(true)
        try {
            await new Promise(resolve => setTimeout(resolve, 500))
            const prefix = type === 'revenue'
                ? 'Revenue_Export'
                : type === 'finance'
                    ? 'Finance_Export'
                    : type === 'inventory-product-summary'
                        ? 'Inventory_Product_Summary'
                        : type === 'products'
                        ? 'Products_Export'
                        : 'Sales_Export'
            const success = await exportToExcel(previewExportData, `${prefix}_${new Date().toISOString().split('T')[0]}`)
            if (success) {
                onClose()
            }
        } catch (error) {
            console.error('Export failed:', error)
        } finally {
            setIsExporting(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="space-y-6 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="rounded-full hover:bg-muted shrink-0"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                        <FileSpreadsheet className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight">
                            {t('sales.export.previewTitle') || 'Export Preview'}
                        </h1>
                        <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider">
                            {isLoading ? (
                                <span className="flex items-center gap-2">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    {t('common.loading') || 'Loading...'}
                                </span>
                            ) : (
                                `${data.length} ${t('sales.export.recordsCount') || 'Records ready for export'}`
                            )}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        disabled={isExporting}
                        className="h-10 px-6 rounded-xl font-bold"
                    >
                        {t('common.cancel') || 'Cancel'}
                    </Button>
                    <Button
                        onClick={handleExport}
                        disabled={isExporting || isLoading || previewExportData.length === 0}
                        className={cn(
                            "h-10 px-6 rounded-xl font-black shadow-lg transition-all active:scale-95 flex gap-2 items-center justify-center",
                            "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20 border-t border-white/10"
                        )}
                    >
                        {isExporting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Download className="w-4 h-4" />
                        )}
                        {t('sales.export.downloadBtn')}
                    </Button>
                </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-background/50 p-4">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground gap-3">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        <span className="text-sm font-semibold">{t('sales.export.preparingData') || 'Preparing data for export...'}</span>
                    </div>
                ) : previewData.length > 0 && (previewData[0]?.length ?? 0) > 0 ? (
                    <div className="overflow-auto">
                        <div className="inline-block min-w-full">
                            <Suspense
                                fallback={(
                                    <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
                                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                        <span className="text-sm font-semibold">{t('common.loading') || 'Loading...'}</span>
                                    </div>
                                )}
                            >
                                <SpreadsheetPreview
                                    data={previewData}
                                    onChange={setPreviewData}
                                    onSelect={setSelectedPreviewCells}
                                    onKeyDown={handlePreviewKeyDown}
                                    className="atlas-spreadsheet text-sm font-medium"
                                />
                            </Suspense>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center py-20 text-muted-foreground">
                        {t('common.noData') || 'No data to display'}
                    </div>
                )}
            </div>

            {previewData.length > 0 && (previewData[0]?.length ?? 0) > 0 && (
                <div className="text-xs text-muted-foreground font-medium text-center">
                    {Math.max(0, previewData.length - 1)} rows &middot; {previewData[0]?.length ?? 0} columns
                </div>
            )}
        </div>
    )
}
