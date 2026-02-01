import { useState } from 'react'
import { useInvoices, type Invoice } from '@/local-db'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Input,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Button,
    PrintPreviewModal,
    A4InvoiceTemplate,
    SaleReceipt
} from '@/ui/components'
import { FileText, Search, Printer, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'
import { mapInvoiceToUniversal } from '@/lib/mappings'



export function InvoicesHistory() {
    const { user } = useAuth()
    const invoices = useInvoices(user?.workspaceId)
    const { features } = useWorkspace()
    const { t } = useTranslation()
    const [search, setSearch] = useState('')
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
    const [printFormat, setPrintFormat] = useState<'a4' | 'receipt'>('a4')
    const [showPrintPreview, setShowPrintPreview] = useState(false)

    const handleView = (invoice: Invoice, format: 'a4' | 'receipt') => {
        setPrintFormat(format)
        setSelectedInvoice(invoice)
        setShowPrintPreview(true)
    }

    const filteredInvoices = invoices.filter(
        (i) =>
            i.invoiceid.toLowerCase().includes(search.toLowerCase())
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="w-6 h-6 text-primary" />
                        {t('invoices.historyTitle') || 'Invoices History'}
                    </h1>
                    <p className="text-muted-foreground">
                        {t('invoices.historySubtitle', { count: invoices.length }) || `${invoices.length} historical records`}
                    </p>
                </div>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder={t('invoices.searchPlaceholder') || "Search by ID..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 rounded-xl"
                />
            </div>

            {/* Invoices Table */}
            <Card className="rounded-[2rem] overflow-hidden border-2 shadow-sm">
                <CardHeader className="bg-muted/30 border-b">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <FileText className="w-5 h-5 text-primary/70" />
                        {t('invoices.listTitle') || "Historical Records"}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {filteredInvoices.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground bg-muted/5">
                            <FileText className="w-12 h-12 mx-auto mb-4 opacity-10" />
                            {invoices.length === 0 ? t('common.noData') : t('common.noResults')}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="bg-muted/20">
                                <TableRow className="hover:bg-transparent border-b">
                                    <TableHead className="font-bold py-4">{t('invoices.table.created')}</TableHead>
                                    <TableHead className="font-bold">{t('invoices.table.invoiceid')}</TableHead>
                                    <TableHead className="font-bold text-center">{t('invoices.table.createdBy') || 'Created By'}</TableHead>
                                    <TableHead className="font-bold text-center">{t('invoices.table.origin') || 'Origin'}</TableHead>
                                    <TableHead className="text-right font-bold">{t('invoices.table.total')}</TableHead>
                                    <TableHead className="text-right font-bold pr-6">{t('common.actions')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredInvoices.map((invoice) => (
                                    <TableRow key={invoice.id} className="group hover:bg-muted/30 transition-colors">
                                        <TableCell className="text-muted-foreground text-xs font-medium py-4 pl-4">
                                            {formatDateTime(invoice.createdAt)}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs font-bold text-primary">
                                            {invoice.invoiceid}
                                        </TableCell>

                                        <TableCell className="text-center text-xs font-medium">
                                            {invoice.createdByName || invoice.createdBy || 'Unknown'}
                                        </TableCell>

                                        <TableCell className="text-center">
                                            <span className="px-2 py-0.5 rounded-lg text-[9px] font-bold bg-secondary/50 text-secondary-foreground uppercase tracking-widest">
                                                {invoice.origin || 'Pos'}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-black tabular-nums">
                                            {formatCurrency(invoice.total, invoice.currency || 'usd', features.iqd_display_preference)}
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="rounded-xl hover:bg-primary/10 hover:text-primary transition-all flex items-center gap-2 px-3"
                                                    onClick={() => handleView(invoice, 'a4')}
                                                >
                                                    <Eye className="w-4 h-4" />
                                                    <span className="text-xs font-bold font-mono">A4</span>
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="rounded-xl hover:bg-primary/10 hover:text-primary transition-all flex items-center gap-2 px-3"
                                                    onClick={() => handleView(invoice, 'receipt')}
                                                >
                                                    <Printer className="w-4 h-4" />
                                                    <span className="text-xs font-bold font-mono">Receipt</span>
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Print Preview Modal */}
            <PrintPreviewModal
                isOpen={showPrintPreview}
                onClose={() => {
                    setShowPrintPreview(false)
                    setSelectedInvoice(null)
                }}
                showSaveButton={false} // Already saved in history
                title={printFormat === 'a4' ? (t('sales.print.a4') || 'A4 Invoice') : (t('sales.print.receipt') || 'Receipt')}
            >
                {selectedInvoice && (
                    printFormat === 'a4' ? (
                        <A4InvoiceTemplate
                            data={mapInvoiceToUniversal(selectedInvoice)}
                            features={features}
                        />
                    ) : (
                        <SaleReceipt
                            data={mapInvoiceToUniversal(selectedInvoice)}
                            features={features}
                        />
                    )
                )}
            </PrintPreviewModal>
        </div>
    )
}
