import { useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { useInvoices, type Invoice } from '@/local-db'
import { formatCurrency, formatDateTime, formatDate, formatOriginLabel } from '@/lib/utils'
import { formatLocalizedMonthYear } from '@/lib/monthDisplay'
import { platformService } from '@/services/platformService'
import { getStoredLocalInvoicePdfPath } from '@/services/localInvoiceStorage'
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
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
} from '@/ui/components'
import { FileText, Search, Eye, Upload, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'
import { useDateRange } from '@/context/DateRangeContext'
import { DateRangeFilters } from '@/ui/components/DateRangeFilters'
import { r2Service } from '@/services/r2Service'
import { UploadFilesTab } from './UploadFile'
import { setInvoicePreviewSource } from '@/lib/pdfPreviewStore'

const UPLOAD_FILES_ROUTE = '/invoices-history/upload-files'

export function InvoicesHistory() {
    const [location, setLocation] = useLocation()
    const { user } = useAuth()
    const { invoices, refreshInvoices } = useInvoices(user?.workspaceId)
    const { features } = useWorkspace()
    const { t, i18n } = useTranslation()
    const { dateRange, customDates } = useDateRange()
    const [search, setSearch] = useState('')
    const [isLoadingPdf, setIsLoadingPdf] = useState(false)
    const [downloadError, setDownloadError] = useState<string | null>(null)

    const activeTab = location === UPLOAD_FILES_ROUTE ? 'uploads' : 'history'
    const historyInvoices = useMemo(
        () => invoices.filter((invoice) => invoice.origin !== 'upload'),
        [invoices],
    )
    const uploadedFilesCount = invoices.length - historyInvoices.length

    const filteredInvoices = useMemo(() => {
        return historyInvoices
            .filter((invoice) => {
                const matchesSearch = invoice.invoiceid.toLowerCase().includes(search.toLowerCase())
                const invoiceDate = new Date(invoice.createdAt)
                const now = new Date()

                if (dateRange === 'today') {
                    const startOfDay = new Date(now.setHours(0, 0, 0, 0))
                    return matchesSearch && invoiceDate >= startOfDay
                }

                if (dateRange === 'month') {
                    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
                    return matchesSearch && invoiceDate >= startOfMonth
                }

                if (dateRange === 'custom' && (customDates.start || customDates.end)) {
                    const start = customDates.start ? new Date(customDates.start) : null
                    if (start) start.setHours(0, 0, 0, 0)
                    const end = customDates.end ? new Date(customDates.end) : null
                    if (end) end.setHours(23, 59, 59, 999)
                    if (start && invoiceDate < start) return false
                    if (end && invoiceDate > end) return false
                    return matchesSearch
                }

                return matchesSearch
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }, [customDates.end, customDates.start, dateRange, historyInvoices, search])

    const getDateDisplay = () => {
        if (dateRange === 'today') {
            return formatDate(new Date())
        }

        if (dateRange === 'month') {
            return formatLocalizedMonthYear(new Date(), i18n.language)
        }

        if (dateRange === 'custom') {
            if (filteredInvoices.length > 0) {
                const dates = filteredInvoices.map((invoice) => new Date(invoice.createdAt).getTime())
                const minDate = new Date(Math.min(...dates))
                const maxDate = new Date(Math.max(...dates))
                return `${t('performance.filters.from') || 'From'} ${formatDate(minDate)} ${t('performance.filters.to') || 'To'} ${formatDate(maxDate)}`
            }

            if (customDates.start || customDates.end) {
                const parts = []
                if (customDates.start) parts.push(`${t('performance.filters.from') || 'From'} ${formatDate(customDates.start)}`)
                if (customDates.end) parts.push(`${t('performance.filters.to') || 'To'} ${formatDate(customDates.end)}`)
                return parts.join(' ')
            }
        }

        if (dateRange === 'allTime') {
            if (historyInvoices.length > 0) {
                const dates = historyInvoices.map((invoice) => new Date(invoice.createdAt).getTime())
                const minDate = new Date(Math.min(...dates))
                const maxDate = new Date(Math.max(...dates))
                return `${t('performance.filters.from') || 'From'} ${formatDate(minDate)} ${t('performance.filters.to') || 'To'} ${formatDate(maxDate)}`
            }

            return t('performance.filters.allTime') || 'All Time'
        }

        return ''
    }

    const handleView = async (invoice: Invoice, format: 'a4' | 'receipt') => {
        setIsLoadingPdf(true)
        setDownloadError(null)

        try {
            const localPath = getStoredLocalInvoicePdfPath(invoice, format)
            const pdfBlob = format === 'a4' ? invoice.pdfBlobA4 : invoice.pdfBlobReceipt
            const r2Path = format === 'a4' ? invoice.r2PathA4 : invoice.r2PathReceipt

            let url: string | null = null

            if (localPath) {
                const exists = await platformService.exists(localPath)
                if (exists) {
                    try {
                        const content = await platformService.readFile(localPath)
                        // Use Data URL (base64) which is often more compatible for framing in WebView2 than blob: or asset:
                        const base64 = platformService.uint8ArrayToBase64(content)
                        url = `data:application/pdf;base64,${base64}`
                        console.log('[InvoicesHistory] Successfully created Data URL from local file')
                    } catch (err) {
                        console.error('[InvoicesHistory] Failed to read local PDF as data URL:', err)
                        url = platformService.convertFileSrc(localPath)
                    }
                }
            }

            if (!url && pdfBlob) {
                url = URL.createObjectURL(pdfBlob)
            }

            if (!url && r2Path) {
                if (!navigator.onLine) {
                    setDownloadError(t('invoices.offlineError') || 'You must be online to view invoice PDFs.')
                    return
                }
                url = r2Service.getUrl(r2Path)
            }

            if (!url) {
                setDownloadError(t('invoices.pdfNotAvailable') || 'PDF not available.')
                return
            }

            setInvoicePreviewSource({
                url,
                title: `${t('invoices.viewInvoice') || 'Invoice'} ${invoice.invoiceid}`
            })
            setLocation('/pdf-preview')
        } catch (error) {
            console.error('[InvoicesHistory] Failed to load PDF:', error)
            setDownloadError(t('invoices.pdfLoadError') || 'Failed to load PDF')
        } finally {
            setIsLoadingPdf(false)
        }
    }

    return (
        <Tabs
            value={activeTab}
            onValueChange={(value) => {
                setLocation(value === 'uploads' ? UPLOAD_FILES_ROUTE : '/invoices-history')
            }}
            className="space-y-6"
        >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="flex items-center gap-2 text-2xl font-bold">
                            <FileText className="h-6 w-6 text-primary" />
                            {t('invoices.historyTitle') || 'Invoices History'}
                        </h1>
                        {activeTab === 'history' && getDateDisplay() && (
                            <div className="animate-pop-in rounded-lg bg-primary px-3 py-1 text-sm font-bold text-primary-foreground shadow-sm">
                                {getDateDisplay()}
                            </div>
                        )}
                    </div>
                    <p className="text-muted-foreground">
                        {activeTab === 'history'
                            ? (t('invoices.historySubtitle', { count: historyInvoices.length }) || `${historyInvoices.length} historical records`)
                            : `${uploadedFilesCount} uploaded PDF file${uploadedFilesCount === 1 ? '' : 's'}`}
                    </p>
                </div>

                <TabsList className="grid h-auto w-full max-w-[380px] grid-cols-2 rounded-2xl bg-secondary/50 p-1">
                    <TabsTrigger value="history" className="gap-2 rounded-xl font-bold">
                        <FileText className="h-4 w-4" />
                        History
                    </TabsTrigger>
                    <TabsTrigger value="uploads" className="gap-2 rounded-xl font-bold">
                        <Upload className="h-4 w-4" />
                        Upload Files
                    </TabsTrigger>
                </TabsList>
            </div>

            <TabsContent value="history" className="mt-0 space-y-6">
                <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                    <div className="flex w-full max-w-md items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                allowViewer={true}
                                placeholder={t('invoices.searchPlaceholder') || 'Search by ID...'}
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                className="pl-10 rounded-xl"
                            />
                        </div>
                        <Button
                            variant="outline"
                            size="icon"
                            allowViewer={true}
                            className="shrink-0 rounded-xl"
                            onClick={() => refreshInvoices()}
                            title={t('common.refresh') || 'Refresh'}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                    <DateRangeFilters />
                </div>

                <Card className="overflow-hidden rounded-2xl border-2 shadow-sm">
                    <CardHeader className="border-b bg-muted/30">
                        <CardTitle className="flex items-center gap-2 text-lg font-bold">
                            <FileText className="h-5 w-5 text-primary/70" />
                            {t('invoices.listTitle') || 'Historical Records'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {filteredInvoices.length === 0 ? (
                            <div className="bg-muted/5 py-12 text-center text-muted-foreground">
                                <FileText className="mx-auto mb-4 h-12 w-12 opacity-10" />
                                {historyInvoices.length === 0 ? t('common.noData') : t('common.noResults')}
                            </div>
                        ) : (
                            <Table>
                                <TableHeader className="bg-muted/20">
                                    <TableRow className="border-b hover:bg-transparent">
                                        <TableHead className="py-4 font-bold">{t('invoices.table.created')}</TableHead>
                                        <TableHead className="font-bold">{t('invoices.table.invoiceid')}</TableHead>
                                        <TableHead className="text-center font-bold">{t('invoices.table.createdBy') || 'Created By'}</TableHead>
                                        <TableHead className="text-center font-bold">{t('invoices.table.origin') || 'Origin'}</TableHead>
                                        <TableHead className="text-right font-bold">{t('invoices.table.total')}</TableHead>
                                        <TableHead className="pr-6 text-right font-bold">{t('common.actions')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredInvoices.map((invoice) => (
                                        <TableRow key={invoice.id} className="group transition-colors hover:bg-muted/30">
                                            <TableCell className="py-4 pl-4 text-xs font-medium text-muted-foreground">
                                                {formatDateTime(invoice.createdAt)}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs font-bold text-primary">
                                                {invoice.sequenceId ? `#${String(invoice.sequenceId).padStart(5, '0')}` : invoice.invoiceid}
                                            </TableCell>
                                            <TableCell className="text-center text-xs font-medium">
                                                {invoice.createdByName || invoice.createdBy || 'Unknown'}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span className="rounded-lg bg-secondary/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-secondary-foreground">
                                                    {formatOriginLabel(invoice.origin)}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right font-black tabular-nums">
                                                {formatCurrency(invoice.totalAmount, invoice.settlementCurrency || 'usd', features.iqd_display_preference)}
                                            </TableCell>
                                            <TableCell className="pr-6 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {(invoice.localPathA4 || invoice.pdfBlobA4 || invoice.r2PathA4) && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            allowViewer={true}
                                                            className="flex items-center gap-2 rounded-xl px-3 transition-all hover:bg-primary/10 hover:text-primary"
                                                            onClick={() => {
                                                                void handleView(invoice, 'a4')
                                                            }}
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                            <span className="font-mono text-xs font-bold">A4</span>
                                                        </Button>
                                                    )}
                                                    {(invoice.localPathReceipt || invoice.pdfBlobReceipt || invoice.r2PathReceipt) && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            allowViewer={true}
                                                            className="flex items-center gap-2 rounded-xl px-3 transition-all hover:bg-primary/10 hover:text-primary"
                                                            onClick={() => {
                                                                void handleView(invoice, 'receipt')
                                                            }}
                                                        >
                                                            <FileText className="h-4 w-4" />
                                                            <span className="font-mono text-xs font-bold">Receipt</span>
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="uploads" className="mt-0">
                <UploadFilesTab
                    invoices={invoices}
                    onPreview={(invoice) => {
                        void handleView(invoice, 'a4')
                    }}
                />
            </TabsContent>

            {isLoadingPdf && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
                    <div className="text-center">
                        <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <p className="text-muted-foreground">{t('common.loading') || 'Loading...'}</p>
                    </div>
                </div>
            )}
            {downloadError && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
                    <div className="rounded-lg border bg-card p-6 text-center shadow-lg max-w-sm">
                        <p className="text-sm text-muted-foreground mb-4">{downloadError}</p>
                        <Button variant="outline" size="sm" onClick={() => setDownloadError(null)}>
                            {t('common.close') || 'Close'}
                        </Button>
                    </div>
                </div>
            )}
        </Tabs>
    )
}
