import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useReactToPrint } from 'react-to-print'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button,
    useToast,
    PdfViewer,
    A4InvoiceTemplate,
    SaleReceiptBase
} from '@/ui/components'
import { Printer, X, Maximize2, Minimize2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { saveInvoiceFromSnapshot } from '@/local-db/hooks'
import { useAuth } from '@/auth'
import { db, type Invoice } from '@/local-db'
import { generateInvoicePdf, type PrintFormat } from '@/services/pdfGenerator'
import { assetManager } from '@/lib/assetManager'
import { isOnline } from '@/lib/network'
import { type WorkspaceFeatures } from '@/workspace'
import { supabase } from '@/auth/supabase'

interface PrintPreviewModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm?: () => void
    title?: string
    children?: ReactNode
    showSaveButton?: boolean
    saveButtonText?: string
    invoiceData?: Omit<Invoice, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'invoiceid'>
    pdfData?: any // UniversalInvoice
    features?: WorkspaceFeatures
    workspaceName?: string | null
}

type PdfBlobs = {
    a4?: Blob
    receipt?: Blob
}

export function PrintPreviewModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    children,
    showSaveButton = true,
    saveButtonText,
    invoiceData,
    pdfData,
    features,
    workspaceName
}: PrintPreviewModalProps) {
    const { t, i18n } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const workspaceId = user?.workspaceId

    // Generate a stable ID for new invoices to ensure QR code consistency
    // If pdfData.id exists (history), we use that. If not (new sale), we generate one.
    const [tempId, setTempId] = useState<string>('')

    // The actual ID to be used for generation and saving
    const effectiveId = useMemo(() => pdfData?.id || tempId, [pdfData?.id, tempId])

    useEffect(() => {
        if (isOpen && !pdfData?.id) {
            setTempId(crypto.randomUUID())
        }
    }, [isOpen, pdfData?.id])

    const [isExpanded, setIsExpanded] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)
    const [pdfError, setPdfError] = useState<string | null>(null)
    const [pdfBlobs, setPdfBlobs] = useState<PdfBlobs>({})
    const [pdfUrl, setPdfUrl] = useState<string | null>(null)
    const htmlPrintRef = useRef<HTMLDivElement>(null)
    const templatePrintRef = useRef<HTMLDivElement>(null)

    const hasPdfData = !!(pdfData && features)
    const printFormat: PrintFormat = (invoiceData?.printFormat || 'a4') as PrintFormat
    const isTauri = useMemo(() => {
        if (typeof window === 'undefined') return false
        const w = window as any
        return !!(w.__TAURI_INTERNALS__ || w.__TAURI__)
    }, [])

    const translations = useMemo(() => ({
        date: t('sales.print.date') || 'Date',
        number: t('sales.print.number') || 'Invoice #',
        soldTo: t('sales.print.soldTo') || 'Sold To',
        soldBy: t('sales.print.soldBy') || 'Sold By',
        qty: t('sales.print.qty') || 'Qty',
        productName: t('sales.print.productName') || 'Product',
        description: t('sales.print.description') || 'Description',
        price: t('sales.print.price') || 'Price',
        discount: t('sales.print.discount') || 'Discount',
        total: t('sales.print.total') || 'Total',
        subtotal: t('sales.print.subtotal') || 'Subtotal',
        terms: t('sales.print.terms') || 'Terms & Conditions',
        exchangeRates: t('sales.print.exchangeRates') || 'Exchange Rates',
        posSystem: t('sales.print.posSystem') || 'POS System',
        generated: t('sales.print.generated') || 'Generated',
        id: t('sales.print.id') || 'ID',
        cashier: t('sales.print.cashier') || 'Cashier',
        paymentMethod: t('sales.print.paymentMethod') || 'Payment Method',
        name: t('sales.print.name') || 'Name',
        quantity: t('sales.print.quantity') || 'Qty',
        thankYou: t('sales.print.thankYou') || 'Thank You',
        keepRecord: t('sales.print.keepRecord') || 'Please keep this for your records',
        snapshots: t('sales.print.snapshots') || 'Snapshots'
    }), [t, i18n.language])

    const handleHtmlPrint = useReactToPrint({
        contentRef: htmlPrintRef,
        documentTitle: title || 'Print_Preview',
        onAfterPrint: () => {
            if (onConfirm) onConfirm()
        }
    })

    const handleTemplatePrint = useReactToPrint({
        contentRef: templatePrintRef,
        documentTitle: title || 'Print_Preview',
        onAfterPrint: () => {
            if (onConfirm) onConfirm()
        }
    })

    const buildPdfBlobs = useCallback(async (requestedFormat?: PrintFormat): Promise<{ a4?: Blob; receipt?: Blob }> => {
        if (!pdfData || !features) {
            throw new Error('Missing PDF data or features')
        }

        const format = requestedFormat || printFormat;
        const blob = await generateInvoicePdf({
            data: { ...pdfData, id: effectiveId },
            format: format,
            workspaceId: workspaceId || '',
            features: {
                ...features,
                logo_url: features.logo_url || undefined
            },
            workspaceName: workspaceName || workspaceId || '',
            translations
        })

        return { [format]: blob }
    }, [features, pdfData, translations, workspaceId, workspaceName, effectiveId, printFormat])

    const ensurePdfBlobs = useCallback(async (requestedFormat?: PrintFormat): Promise<{ a4?: Blob; receipt?: Blob }> => {
        const format = requestedFormat || printFormat;
        if (pdfBlobs[format]) {
            return pdfBlobs
        }
        const blobs = await buildPdfBlobs(format)
        setPdfBlobs(prev => ({ ...prev, ...blobs }))
        return { ...pdfBlobs, ...blobs }
    }, [buildPdfBlobs, pdfBlobs, printFormat])

    const printPdfUrl = (url: string) => {
        return new Promise<void>((resolve, reject) => {
            const iframe = document.createElement('iframe')
            iframe.style.position = 'fixed'
            iframe.style.right = '0'
            iframe.style.bottom = '0'
            iframe.style.width = '0'
            iframe.style.height = '0'
            iframe.style.border = '0'
            iframe.src = url

            iframe.onload = () => {
                try {
                    iframe.contentWindow?.focus()
                    iframe.contentWindow?.print()
                    setTimeout(() => {
                        iframe.remove()
                        resolve()
                    }, 500)
                } catch (error) {
                    iframe.remove()
                    reject(error)
                }
            }

            iframe.onerror = () => {
                iframe.remove()
                reject(new Error('Failed to load PDF for printing'))
            }

            document.body.appendChild(iframe)
        })
    }

    useEffect(() => {
        if (!isOpen) {
            setPdfBlobs({})
            setPdfError(null)
            setPdfUrl(null)
            setIsGenerating(false)
            return
        }

        if (!hasPdfData) {
            return
        }

        let cancelled = false
        setIsGenerating(true)
        setPdfError(null)

        buildPdfBlobs(printFormat)
            .then((blobs) => {
                if (cancelled) return
                setPdfBlobs(prev => ({ ...prev, ...blobs }))
            })
            .catch((error) => {
                if (cancelled) return
                console.error('Failed to generate PDF preview:', error)
                setPdfError('Failed to generate PDF preview')
            })
            .finally(() => {
                if (cancelled) return
                setIsGenerating(false)
            })

        return () => {
            cancelled = true
        }
    }, [isOpen, hasPdfData, buildPdfBlobs, t])

    useEffect(() => {
        const activeBlob = printFormat === 'receipt' ? pdfBlobs.receipt : pdfBlobs.a4
        if (!activeBlob) {
            setPdfUrl(null)
            return
        }

        const url = URL.createObjectURL(activeBlob)
        setPdfUrl(url)

        return () => {
            URL.revokeObjectURL(url)
        }
    }, [printFormat, pdfBlobs.a4, pdfBlobs.receipt])

    const handlePrintAndSave = async () => {
        if (isSaving) return

        if (!hasPdfData) {
            handleHtmlPrint()
            return
        }

        setIsSaving(true)
        try {
            const blobs = await ensurePdfBlobs(printFormat)
            const activeBlob = printFormat === 'receipt' ? blobs.receipt : blobs.a4

            if (!activeBlob) throw new Error('Failed to generate PDF')

            let savedInvoice: Invoice | null = null
            if (invoiceData && workspaceId) {
                const snapshotData: any = {
                    ...invoiceData,
                    printFormat: printFormat
                }

                if (printFormat === 'a4') {
                    snapshotData.pdfBlobA4 = activeBlob
                } else {
                    snapshotData.pdfBlobReceipt = activeBlob
                }

                savedInvoice = await saveInvoiceFromSnapshot(workspaceId, snapshotData, effectiveId)

                const confirmedInvoice = await db.invoices.get(effectiveId)
                if (confirmedInvoice) {
                    savedInvoice = confirmedInvoice
                }
            }

            if (savedInvoice && isOnline() && assetManager) {
                try {
                    const finalBlob = await generateInvoicePdf({
                        data: { ...pdfData, ...savedInvoice, id: savedInvoice.id, invoiceid: savedInvoice.invoiceid, sequenceId: savedInvoice.sequenceId },
                        format: printFormat,
                        workspaceId: workspaceId || '',
                        features: {
                            ...features,
                            logo_url: features?.logo_url || undefined
                        },
                        workspaceName: workspaceName || workspaceId || '',
                        translations
                    })

                    const path = `${workspaceId}/printed-invoices/${printFormat === 'a4' ? 'A4' : 'receipts'}/${savedInvoice.id}.pdf`

                    await assetManager.uploadInvoicePdf(savedInvoice.id, finalBlob, printFormat, path)

                    const upsertData: any = {
                        id: savedInvoice.id,
                        user_id: user?.id,
                        workspace_id: workspaceId,
                        invoiceid: savedInvoice.invoiceid,
                        total_amount: savedInvoice.totalAmount,
                        total: savedInvoice.totalAmount,
                        settlement_currency: savedInvoice.settlementCurrency,
                        print_format: printFormat,
                        updated_at: new Date().toISOString()
                    }

                    if (printFormat === 'a4') {
                        upsertData.r2_path_a4 = path
                    } else {
                        upsertData.r2_path_receipt = path
                    }

                    const { error: upsertError } = await supabase.from('invoices').upsert(upsertData)

                    if (upsertError) throw upsertError

                    const dbUpdate: any = {
                        syncStatus: 'synced',
                        lastSyncedAt: new Date().toISOString()
                    }

                    if (printFormat === 'a4') {
                        dbUpdate.r2PathA4 = path
                        dbUpdate.pdfBlobA4 = undefined
                    } else {
                        dbUpdate.r2PathReceipt = path
                        dbUpdate.pdfBlobReceipt = undefined
                    }

                    await db.invoices.update(savedInvoice.id, dbUpdate)
                } catch (uploadError) {
                    console.error('PDF upload failed, marking invoice as pending:', uploadError)
                    await db.invoices.update(savedInvoice.id, {
                        syncStatus: 'pending',
                        lastSyncedAt: null
                    })
                    toast({
                        title: t('print.saveError') || 'Save Failed',
                        description: 'PDF upload failed. It will retry when online.',
                        variant: 'destructive'
                    })
                }
            }

            if (savedInvoice) {
                toast({
                    title: t('print.saveSuccess') || 'Invoice Saved',
                    description: t('print.saveSuccessDesc') || 'A record of this invoice has been added to history.'
                })
            }

            if (isTauri) {
                handleTemplatePrint()
                return
            }

            const previewUrl = pdfUrl
            if (previewUrl) {
                await printPdfUrl(previewUrl)
            } else {
                const tempUrl = URL.createObjectURL(activeBlob)
                try {
                    await printPdfUrl(tempUrl)
                } finally {
                    URL.revokeObjectURL(tempUrl)
                }
            }

            if (onConfirm) onConfirm()
        } catch (error) {
            console.error('Error saving invoice snapshot:', error)
            toast({
                title: t('print.saveError') || 'Save Failed',
                description: t('print.saveErrorDesc') || 'Could not save invoice record.',
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    const actionLabel = saveButtonText
        || (invoiceData ? (t('print.printAndSave') || 'Print & Save') : (t('common.print') || 'Print'))

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                className={cn(
                    "flex flex-col transition-all duration-300",
                    isExpanded
                        ? "max-w-[95vw] max-h-[95vh] w-[95vw] h-[95vh]"
                        : "max-w-2xl max-h-[80vh]"
                )}
            >
                <DialogHeader className="flex flex-row items-center justify-between shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <Printer className="w-5 h-5 text-primary" />
                        {title || t('print.previewTitle') || 'Print Preview'}
                    </DialogTitle>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="h-8 w-8"
                    >
                        {isExpanded ? (
                            <Minimize2 className="w-4 h-4" />
                        ) : (
                            <Maximize2 className="w-4 h-4" />
                        )}
                    </Button>
                </DialogHeader>

                <div
                    className={cn(
                        "flex-1 min-h-0 border rounded-lg bg-white dark:bg-zinc-900 transition-all",
                        hasPdfData ? "overflow-hidden" : "overflow-auto",
                        !isExpanded && "hover:ring-2 hover:ring-primary/50"
                    )}
                    onClick={() => !isExpanded && setIsExpanded(true)}
                >
                    {hasPdfData ? (
                        <div className="w-full h-full">
                            {isGenerating && (
                                <div className="flex items-center justify-center h-full">
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {'Generating PDF...'}
                                    </div>
                                </div>
                            )}
                            {!isGenerating && pdfError && (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    {pdfError}
                                </div>
                            )}
                            {!isGenerating && !pdfError && pdfUrl && (
                                <PdfViewer
                                    file={pdfUrl}
                                    className="h-full w-full overflow-auto"
                                    onLoadError={(error) => {
                                        console.error('Failed to load PDF preview:', error)
                                        setPdfError('Failed to load PDF preview')
                                    }}
                                />
                            )}
                        </div>
                    ) : (
                        <div
                            ref={htmlPrintRef}
                            className="print:p-0 [print-color-adjust:exact] -webkit-print-color-adjust:exact p-4"
                        >
                            {children}
                        </div>
                    )}
                </div>

                {!isExpanded && (
                    <p className="text-xs text-muted-foreground text-center mt-2">
                        {t('print.clickToExpand') || 'Click preview to expand'}
                    </p>
                )}

                <DialogFooter className="shrink-0 pt-4">
                    <Button variant="outline" onClick={onClose}>
                        <X className="w-4 h-4 mr-2" />
                        {t('common.cancel')}
                    </Button>
                    {showSaveButton && (
                        <Button onClick={handlePrintAndSave} disabled={isSaving || isGenerating}>
                            {isSaving || isGenerating ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Printer className="w-4 h-4 mr-2" />
                            )}
                            {actionLabel}
                        </Button>
                    )}
                </DialogFooter>

                {hasPdfData && (
                    <div className="fixed left-[-10000px] top-0">
                        <div ref={templatePrintRef} className="bg-white text-black">
                            {printFormat === 'receipt' ? (
                                <div className="w-[80mm]">
                                    <SaleReceiptBase
                                        data={pdfData}
                                        features={features}
                                        workspaceName={workspaceName || workspaceId || 'Asaas'}
                                        workspaceId={workspaceId || undefined}
                                    />
                                </div>
                            ) : (
                                <A4InvoiceTemplate
                                    data={pdfData}
                                    features={features}
                                    workspaceId={workspaceId || undefined}
                                />
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
