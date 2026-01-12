import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import { Sale } from '@/types'
import { formatCurrency, formatDateTime, formatSnapshotTime } from '@/lib/utils'
import { useWorkspace } from '@/workspace'
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    SaleReceipt
} from '@/ui/components'
import {
    Receipt,
    Eye,
    Loader2,
    Trash2,
    Printer
} from 'lucide-react'

export function Sales() {
    const { user } = useAuth()
    const { t } = useTranslation()
    const { features } = useWorkspace()
    const [sales, setSales] = useState<Sale[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
    const [printingSale, setPrintingSale] = useState<Sale | null>(null)
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

    const fetchSales = async () => {
        setIsLoading(true)
        try {
            // Fetch sales with items and product info
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
        }
    }, [user?.workspaceId])

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Receipt className="w-6 h-6 text-primary" />
                        {t('sales.title') || 'Sales History'}
                    </h1>
                    <p className="text-muted-foreground">
                        {t('sales.subtitle') || 'View past transactions'}
                    </p>
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
                                {sales.map((sale) => (
                                    <TableRow key={sale.id}>
                                        <TableCell className="text-start font-mono text-sm">
                                            {formatDateTime(sale.created_at)}
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
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Sale Details Modal */}
            <Dialog open={!!selectedSale} onOpenChange={() => setSelectedSale(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{t('sales.details') || 'Sale Details'}</DialogTitle>
                    </DialogHeader>
                    {selectedSale && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-muted-foreground">{t('sales.date')}:</span>
                                    <div className="font-medium">{formatDateTime(selectedSale.created_at)}</div>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">{t('sales.cashier')}:</span>
                                    <div className="font-medium">{selectedSale.cashier_name}</div>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">{t('sales.id')}:</span>
                                    <div className="font-mono text-xs text-muted-foreground">{selectedSale.id}</div>
                                </div>
                                {selectedSale.exchange_rates && selectedSale.exchange_rates.length > 0 ? (
                                    <div className="col-span-2 space-y-2">
                                        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">
                                            {t('settings.exchangeRate.title')} {t('common.snapshots')}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            {selectedSale.exchange_rates.map((rate: any, idx: number) => (
                                                <div key={idx} className="p-2 bg-muted/30 rounded border border-border/50 flex flex-col gap-0.5">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[10px] font-bold text-primary/70">{rate.pair}</span>
                                                        <span className="text-[9px] text-muted-foreground italic uppercase">{rate.source}</span>
                                                    </div>
                                                    <div className="text-sm font-black">
                                                        100 {rate.pair.split('/')[0]} = {formatCurrency(rate.rate, rate.pair.split('/')[1].toLowerCase() as any, features.iqd_display_preference)}
                                                    </div>
                                                    <div className="text-[9px] text-muted-foreground opacity-70">
                                                        {formatSnapshotTime(rate.timestamp)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : selectedSale.exchange_rate > 0 && (
                                    <div className="p-3 bg-muted/30 rounded-lg col-span-2 flex items-center justify-between border border-border/50">
                                        <div className="space-y-0.5">
                                            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                                                {t('settings.exchangeRate.title')} ({selectedSale.exchange_source})
                                            </div>
                                            <div className="text-sm font-black">
                                                100 USD = {formatCurrency(selectedSale.exchange_rate, 'iqd', features.iqd_display_preference)}
                                            </div>
                                        </div>
                                        <div className="text-[10px] text-muted-foreground text-right">
                                            {formatSnapshotTime(selectedSale.exchange_rate_timestamp)}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="text-start">{t('products.table.name')}</TableHead>
                                            <TableHead className="text-end">{t('common.quantity')}</TableHead>
                                            <TableHead className="text-end">{t('common.price')}</TableHead>
                                            <TableHead className="text-end">{t('common.total')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {selectedSale.items?.map((item) => {
                                            const isConverted = item.original_currency && item.settlement_currency && item.original_currency !== item.settlement_currency
                                            const hasNegotiated = item.negotiated_price !== undefined && item.negotiated_price !== null
                                            const displayUnitPrice = item.converted_unit_price || item.unit_price
                                            const originalUnitPrice = item.original_unit_price || item.unit_price

                                            return (
                                                <TableRow key={item.id}>
                                                    <TableCell className="text-start">
                                                        <div className="font-medium">{item.product_name}</div>
                                                        <div className="text-xs text-muted-foreground">{item.product_sku}</div>
                                                        {hasNegotiated && (
                                                            <div className="text-[10px] text-emerald-600 font-medium">
                                                                {t('pos.negotiatedPrice') || 'Negotiated'}
                                                            </div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-end font-mono">
                                                        {item.quantity}
                                                    </TableCell>
                                                    <TableCell className="text-end">
                                                        <div className="flex flex-col items-end">
                                                            {/* Show negotiated/effective price */}
                                                            <span className={hasNegotiated ? "font-medium text-emerald-600" : "font-medium"}>
                                                                {formatCurrency(displayUnitPrice, selectedSale.settlement_currency || 'usd', features.iqd_display_preference)}
                                                            </span>
                                                            {/* Show original price if negotiated OR converted */}
                                                            {(hasNegotiated || isConverted) && (
                                                                <span className="text-[10px] text-muted-foreground line-through opacity-60">
                                                                    {formatCurrency(originalUnitPrice, item.original_currency || 'usd', features.iqd_display_preference)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-end font-bold">
                                                        <div className="flex flex-col items-end">
                                                            <span className={hasNegotiated ? "text-emerald-600" : ""}>
                                                                {formatCurrency(displayUnitPrice * item.quantity, selectedSale.settlement_currency || 'usd', features.iqd_display_preference)}
                                                            </span>
                                                            {(hasNegotiated || isConverted) && (
                                                                <span className="text-[10px] text-muted-foreground line-through opacity-50">
                                                                    {formatCurrency(originalUnitPrice * item.quantity, item.original_currency || 'usd', features.iqd_display_preference)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>

                            <div className="flex justify-between items-center pt-4 border-t">
                                <div className="text-lg font-bold uppercase tracking-tight opacity-70">
                                    {t('sales.total')} ({selectedSale.settlement_currency || 'usd'})
                                </div>
                                <div className="text-3xl font-black text-primary">
                                    {formatCurrency(selectedSale.total_amount, selectedSale.settlement_currency || 'usd', features.iqd_display_preference)}
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

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
