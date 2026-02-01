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

interface PrintPreviewModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm?: () => void
    title?: string
    children: ReactNode
    showSaveButton?: boolean
    saveButtonText?: string
    invoiceData?: Omit<Invoice, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'invoiceid'>

}

export function PrintPreviewModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    children,
    showSaveButton = true,
    saveButtonText,
    invoiceData
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
                await saveInvoiceFromSnapshot(workspaceId, invoiceData)
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
                            !isExpanded && "scale-[0.6] origin-top-left w-[166%]"
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
