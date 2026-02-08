import { useState, useRef, ReactNode } from 'react'
import { useReactToPrint } from 'react-to-print'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button,
    useToast
} from '@/ui/components'
import { Printer, X, Maximize2, Minimize2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { saveInvoiceFromSnapshot } from '@/local-db/hooks'
import { useAuth } from '@/auth'
import { Invoice } from '@/local-db/models'

import { generateInvoicePdf } from '@/services/pdfGenerator'
import { assetManager } from '@/lib/assetManager'
import { WorkspaceFeatures } from '@/workspace'
import { supabase } from '@/auth/supabase'

interface PrintPreviewModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm?: () => void
    title?: string
    children: ReactNode
    showSaveButton?: boolean
    saveButtonText?: string
    invoiceData?: Omit<Invoice, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'invoiceid'>
    pdfData?: any // UniversalInvoice
    features?: WorkspaceFeatures
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
    features
}: PrintPreviewModalProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const workspaceId = user?.workspaceId
    const [isExpanded, setIsExpanded] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const printRef = useRef<HTMLDivElement>(null)

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: title || 'Print_Preview',
        onAfterPrint: () => {
            if (onConfirm) onConfirm()
        }
    })

    const handlePrintAndSave = async () => {
        // Trigger OS Print Dialog first (or concurrently)
        handlePrint()

        // If we have invoice data, save it as a snapshot
        if (invoiceData && workspaceId) {
            setIsSaving(true)
            try {
                // Generate PDFs if we have the data
                let pdfBlobA4: Blob | undefined
                let pdfBlobReceipt: Blob | undefined

                if (pdfData && features) {
                    try {
                        const translations = {
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
                        }

                        // Generate blobs
                        const [blobA4, blobReceipt] = await Promise.all([
                            generateInvoicePdf({
                                data: pdfData,
                                format: 'a4',
                                features: {
                                    ...features,
                                    logo_url: features.logo_url || undefined
                                },
                                translations
                            }),
                            generateInvoicePdf({
                                data: pdfData,
                                format: 'receipt',
                                features: {
                                    ...features,
                                    logo_url: features.logo_url || undefined
                                },
                                workspaceName: workspaceId,
                                translations
                            })
                        ])

                        pdfBlobA4 = blobA4
                        pdfBlobReceipt = blobReceipt

                        // Upload if online
                        if (navigator.onLine && assetManager && (features as any)?.enable_r2_storage) {
                            // We need an ID for the path. invoiceData doesn't have ID yet (it's created in saveInvoiceFromSnapshot).
                            // This is a problem. saveInvoiceFromSnapshot calls createInvoice which generates ID.
                            // We can generate ID here? Or let createInvoice do it?
                            // createInvoice receives `id` in data if provided?
                            // hooks.ts createInvoice generates ID: `const id = generateId()`.
                            // It overrides data.id? 
                            // `const invoice: Invoice = { ...data, id, ... }`
                            // So createInvoice enforces its own ID generation.

                            // We CANNOT upload to the correct path without the ID.
                            // So we must rely on `createInvoice` (which saves blobs) and then `AssetManager` background sync?
                            // BUT user wants immediate upload.
                            // This means `saveInvoiceFromSnapshot` must support returning the ID or we must Generate ID here.
                        }
                    } catch (genErr) {
                        console.error('Failed to generate PDF for upload:', genErr)
                    }
                }

                // WAIT. If I can't know the ID, I can't upload to the correct path.
                // UNLESS I modify `saveInvoiceFromSnapshot` to accept a pre-generated ID?
                // Or I replicate `createInvoice` logic here?
                // `createInvoice` accepts `data` which excludes `id`.
                // If I modify `createInvoice` to accept optional `id`.

                // Alternative: Save first (getting ID), then upload, then update?
                // `saveInvoiceFromSnapshot` returns `Promise<Invoice>`.

                const savedInvoice = await saveInvoiceFromSnapshot(workspaceId, {
                    ...invoiceData,
                    pdfBlobA4,
                    pdfBlobReceipt
                })

                // Now we have the ID and the blobs are saved in local DB.
                // If online, we can upload NOW and update local/remote.
                if (navigator.onLine && assetManager && (features as any)?.enable_r2_storage && pdfBlobA4 && pdfBlobReceipt) {
                    // Upload
                    const [pathA4, pathReceipt] = await Promise.all([
                        assetManager.uploadInvoicePdf(savedInvoice.id, pdfBlobA4, 'a4'),
                        assetManager.uploadInvoicePdf(savedInvoice.id, pdfBlobReceipt, 'receipt')
                    ])

                    if (pathA4 && pathReceipt) {
                        // Update Supabase
                        await supabase.from('invoices').update({
                            r2_path_a4: pathA4,
                            r2_path_receipt: pathReceipt,
                            print_format: 'a4'
                        }).eq('id', savedInvoice.id)
                    }
                }

                toast({
                    title: t('print.saveSuccess') || 'Invoice Saved',
                    description: t('print.saveSuccessDesc') || 'A record of this invoice has been added to history.',
                })
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
    }

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

                {/* Preview Container */}
                <div
                    className={cn(
                        "flex-1 overflow-auto border rounded-lg bg-white dark:bg-zinc-900 p-4 cursor-pointer transition-all",
                        !isExpanded && "hover:ring-2 hover:ring-primary/50"
                    )}
                    onClick={() => !isExpanded && setIsExpanded(true)}
                >
                    <div
                        ref={printRef}
                        className={cn(
                            "print:p-0 [print-color-adjust:exact] -webkit-print-color-adjust:exact",
                            !isExpanded && (
                                document.dir === 'rtl'
                                    ? "scale-[0.6] origin-top-right w-[166%]"
                                    : "scale-[0.6] origin-top-left w-[166%]"
                            )
                        )}
                    >
                        {children}
                    </div>
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
                        <Button onClick={handlePrintAndSave} disabled={isSaving}>
                            {isSaving ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Printer className="w-4 h-4 mr-2" />
                            )}
                            {saveButtonText || t('print.printAndSave') || 'Print & Save'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
