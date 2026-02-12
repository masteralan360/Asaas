import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, Download, X, Loader2 } from 'lucide-react'
import Spreadsheet from "react-spreadsheet"
import { cn } from '@/lib/utils'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button
} from '@/ui/components'
import { exportToExcel, mapSalesForExport, mapRevenueForExport } from '@/lib/excelExport'
import { supabase } from '@/auth/supabase'

interface ExportPreviewModalProps {
    isOpen: boolean
    onClose: () => void
    filters?: {
        dateRange: string
        customDates: { start: string | null; end: string | null }
        selectedCashier: string
    }
    type?: 'sales' | 'revenue'
}

export function ExportPreviewModal({
    isOpen,
    onClose,
    filters,
    type = 'sales'
}: ExportPreviewModalProps) {
    const { t } = useTranslation()
    const [isExporting, setIsExporting] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [data, setData] = useState<any[]>([])

    useEffect(() => {
        if (isOpen && filters) {
            fetchExportData()
        } else if (!isOpen) {
            setData([]) // Clear data on close
        }
    }, [isOpen, filters])

    const fetchExportData = async () => {
        setIsLoading(true)
        try {
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
            const { dateRange, customDates, selectedCashier } = filters!

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
            if (selectedCashier && selectedCashier !== 'all') {
                query = query.eq('cashier_id', selectedCashier)
            }

            const { data: salesData, error } = await query.order('created_at', { ascending: false })

            if (error) throw error

            // Fetch profiles for cashiers
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

            const formattedSales = (salesData || []).map((sale: any) => ({
                ...sale,
                sequenceId: sale.sequence_id,
                cashier_name: profilesMap[sale.cashier_id] || 'Staff',
                items: sale.items?.map((item: any) => ({
                    ...item,
                    product_name: item.product?.name || 'Unknown Product',
                    product_sku: item.product?.sku || ''
                }))
            }))

            setData(formattedSales)

        } catch (error) {
            console.error('Error fetching export data:', error)
        } finally {
            setIsLoading(false)
        }
    }

    // Map data based on type to the format for XLSX (objects with headers)
    const exportData = useMemo(() => {
        if (!data) return []
        if (type === 'revenue') return mapRevenueForExport(data, t)
        return mapSalesForExport(data, t)
    }, [data, t, type])

    // Map sales to react-spreadsheet format (Matrix of cells)
    const spreadsheetData = useMemo(() => {
        if (exportData.length === 0) return []

        const headers = Object.keys(exportData[0]).map(header => ({ value: header, readOnly: true }))
        const rows = exportData.map(row =>
            Object.values(row).map(val => ({ value: String(val ?? '') }))
        )

        return [headers, ...rows]
    }, [exportData])

    const handleExport = async () => {
        setIsExporting(true)
        try {
            // Give a small delay for UI feedback
            await new Promise(resolve => setTimeout(resolve, 500))
            const success = await exportToExcel(exportData, `Sales_Export_${new Date().toISOString().split('T')[0]}`)

            // Only close the modal if the download was successful (not cancelled in Tauri)
            if (success) {
                onClose()
            }
        } catch (error) {
            console.error('Export failed:', error)
        } finally {
            setIsExporting(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={cn(
                "max-w-5xl w-[95vw] overflow-hidden p-0 rounded-[2.5rem]",
                "dark:bg-zinc-950/90 backdrop-blur-2xl border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in fade-in zoom-in duration-300"
            )}>
                <div className="relative p-8 flex flex-col space-y-6 max-h-[90vh]">
                    {/* Background Glow */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-24 bg-primary/10 blur-[100px] -z-10" />

                    {/* Header */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                            <FileSpreadsheet className="w-7 h-7 text-primary" />
                        </div>
                        <div className="flex-1">
                            <DialogHeader>
                                <DialogTitle className="text-2xl font-black text-foreground tracking-tight">
                                    {t('sales.export.previewTitle') || 'Export Preview'}
                                </DialogTitle>
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
                            </DialogHeader>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="rounded-full hover:bg-muted"
                        >
                            <X className="w-5 h-5" />
                        </Button>
                    </div>

                    {/* Spreadsheet Container */}
                    <div className="flex-1 overflow-auto rounded-2xl border border-border/50 bg-background/50 p-2 min-h-[300px]">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
                                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                <span>{t('sales.export.preparingData') || 'Preparing data for export...'}</span>
                            </div>
                        ) : spreadsheetData.length > 0 ? (
                            <div className="inline-block min-w-full">
                                <Spreadsheet
                                    data={spreadsheetData}
                                    className="asaas-spreadsheet text-sm font-medium"
                                />
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                {t('common.noData') || 'No data to display'}
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <DialogFooter className="pt-2">
                        <div className="w-full flex justify-end gap-4">
                            <Button
                                variant="ghost"
                                onClick={onClose}
                                disabled={isExporting}
                                className="h-12 px-8 rounded-2xl font-bold bg-secondary/30 hover:bg-secondary/50 border border-transparent hover:border-border/50 transition-all font-inter"
                            >
                                {t('common.cancel') || 'Cancel'}
                            </Button>
                            <Button
                                onClick={handleExport}
                                disabled={isExporting || isLoading || data.length === 0}
                                className={cn(
                                    "h-12 px-8 rounded-2xl font-black shadow-lg transition-all active:scale-95 flex gap-2 items-center justify-center font-inter",
                                    "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20 border-t border-white/10"
                                )}
                            >
                                {isExporting ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        <Download className="w-4 h-4" />
                                        {t('sales.export.downloadBtn')}
                                    </>
                                )}
                            </Button>
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
