import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogTitle,
    Button,
    useToast
} from '@/ui/components'
import { CheckCircle2, Printer, Coins } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import { triggerInvoiceSync } from '@/services/invoiceSyncService'
import { disableInvoiceQrInLocalMode } from '@/services/localInvoiceStorage'
import { generateInvoicePdf } from '@/services/pdfGenerator'
import { printPdfBlob } from '@/services/pdfPrintService'
import { renderPdfPageToPngDataUrl } from '@/services/pdfRasterizer'
import { printService } from '@/services/printService'
import { isSupabaseConfigured, useAuth } from '@/auth'
import { useWorkspace, type WorkspaceFeatures } from '@/workspace'
import { Textarea } from '@/ui/components/textarea'
import { supabase } from '@/auth/supabase'
import { db } from '@/local-db'
import { fetchCachedCustomTemplates } from '@/lib/cachedCustomTemplates'
import { useDebounce } from '@/lib/hooks'
import { normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import {
    SALES_HISTORY_RECEIPT_TEMPLATE_KEY,
    buildCustomTemplateLayoutPdf,
    getCustomTemplateTarget,
    isCustomTemplatePrintLanguageCompatible,
    readCustomTemplateLayout,
    resolveCustomTemplatePrintLanguage,
    type StoredCustomTemplateRow
} from '@/lib/customTemplates'

interface CheckoutSuccessModalProps {
    isOpen: boolean
    onClose: () => void
    saleData: any // Universal format expected by SaleReceipt
    features: WorkspaceFeatures
    tutorialDisablePrint?: boolean
    /** Uses a source-specific receipt while retaining the normal POS direct-print flow. */
    receiptPdfBuilder?: () => Promise<Blob>
    /** Persists the note to the underlying source record instead of the POS sales table. */
    onSaveNote?: (note: string) => Promise<void> | void
}

export function CheckoutSuccessModal({
    isOpen,
    onClose,
    saleData,
    features,
    tutorialDisablePrint = false,
    receiptPdfBuilder,
    onSaveNote
}: CheckoutSuccessModalProps) {
    const { t, i18n } = useTranslation()
    const { user } = useAuth()
    const { workspaceName, activeWorkspace, isLocalMode } = useWorkspace()
    const { toast } = useToast()

    const [timeLeft, setTimeLeft] = useState(15)
    const [isPaused, setIsPaused] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [note, setNote] = useState(saleData?.notes || '')
    const [noteSourceId, setNoteSourceId] = useState<string | null>(saleData?.id || null)
    const debouncedNote = useDebounce(note, 1000)
    const [primaryReceiptTemplate, setPrimaryReceiptTemplate] = useState<StoredCustomTemplateRow | null>(null)
    const [isLoadingPrimaryReceiptTemplate, setIsLoadingPrimaryReceiptTemplate] = useState(false)
    const printFeatures = useMemo(
        () => disableInvoiceQrInLocalMode(activeWorkspace?.id || user?.workspaceId, features),
        [activeWorkspace?.id, features, user?.workspaceId]
    )
    const currentTemplatePrintLanguage = resolveCustomTemplatePrintLanguage(
        printFeatures.print_lang,
        i18n.language
    )

    useEffect(() => {
        const workspaceId = activeWorkspace?.id || user?.workspaceId
        if (receiptPdfBuilder || !isOpen || !workspaceId || (!isLocalMode && !isSupabaseConfigured)) {
            setPrimaryReceiptTemplate(null)
            setIsLoadingPrimaryReceiptTemplate(false)
            return
        }

        let cancelled = false
        setIsLoadingPrimaryReceiptTemplate(true)
        void (async () => {
            try {
                const templates = await fetchCachedCustomTemplates(workspaceId, {
                    moduleTypeKey: SALES_HISTORY_RECEIPT_TEMPLATE_KEY,
                    activeOnly: true,
                    primaryOnly: true,
                })
                const primaryTemplate = templates.find((template) =>
                    isCustomTemplatePrintLanguageCompatible(
                        template as StoredCustomTemplateRow,
                        currentTemplatePrintLanguage,
                    )
                ) || null
                if (!cancelled) setPrimaryReceiptTemplate(primaryTemplate as StoredCustomTemplateRow | null)
            } catch (templateError) {
                console.error('[CheckoutSuccessModal] Failed to load primary receipt template:', templateError)
                if (!cancelled) setPrimaryReceiptTemplate(null)
            } finally {
                if (!cancelled) setIsLoadingPrimaryReceiptTemplate(false)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [activeWorkspace?.id, currentTemplatePrintLanguage, isLocalMode, isOpen, receiptPdfBuilder, user?.workspaceId])

    const primaryReceiptTarget = useMemo(
        () => getCustomTemplateTarget(SALES_HISTORY_RECEIPT_TEMPLATE_KEY),
        []
    )
    const primaryReceiptLayout = useMemo(
        () => primaryReceiptTemplate
            && isCustomTemplatePrintLanguageCompatible(primaryReceiptTemplate, currentTemplatePrintLanguage)
            ? readCustomTemplateLayout(primaryReceiptTemplate)
            : null,
        [currentTemplatePrintLanguage, primaryReceiptTemplate]
    )
    const buildCheckoutReceiptPdf = useCallback(async () => {
        if (!saleData) {
            throw new Error('Receipt data is not available.')
        }

        if (receiptPdfBuilder) {
            return receiptPdfBuilder()
        }

        const workspaceId = activeWorkspace?.id || user?.workspaceId || ''
        const resolvedWorkspaceName = workspaceName || workspaceId || 'Atlas'

        if (primaryReceiptTarget && primaryReceiptLayout) {
            return buildCustomTemplateLayoutPdf({
                target: primaryReceiptTarget,
                layout: primaryReceiptLayout,
                values: {},
                options: {
                    workspaceId,
                    workspaceName,
                    features: printFeatures,
                    receiptData: saleData
                },
                effectiveId: saleData.id
            })
        }

        return generateInvoicePdf({
            data: { ...saleData },
            format: 'receipt',
            features: printFeatures,
            workspaceName: resolvedWorkspaceName,
            workspaceId
        })
    }, [activeWorkspace?.id, primaryReceiptLayout, primaryReceiptTarget, printFeatures, receiptPdfBuilder, saleData, user?.workspaceId, workspaceName])

    useEffect(() => {
        if (!isOpen) {
            setTimeLeft(15)
            setIsPaused(false)
            return
        }

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (isPaused) return prev
                if (prev <= 1) {
                    clearInterval(timer)
                    onClose()
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => clearInterval(timer)
    }, [isOpen, onClose, isPaused])

    useEffect(() => {
        if (isOpen) {
            setNote(saleData?.notes || '')
            setNoteSourceId(saleData?.id || null)
        }
    }, [isOpen, saleData?.id, saleData?.notes])

    // Auto-save note
    useEffect(() => {
        const saveNote = async () => {
            if (!saleData?.id || noteSourceId !== saleData.id || debouncedNote === (saleData.notes || '')) return

            try {
                if (onSaveNote) {
                    await onSaveNote(debouncedNote)
                    return
                }

                // Update Local DB
                await db.sales.update(saleData.id, { notes: debouncedNote })

                if (isLocalMode) {
                    return
                }

                // Update Supabase
                const { error } = await runSupabaseAction('checkoutSuccess.saveNote', () =>
                    supabase
                        .from('sales')
                        .update({ notes: debouncedNote })
                        .eq('id', saleData.id)
                )

                if (error) throw normalizeSupabaseActionError(error)

                console.log('[CheckoutSuccessModal] Note auto-saved:', debouncedNote)
            } catch (err) {
                console.error('[CheckoutSuccessModal] Failed to auto-save note:', err)
            }
        }

        saveNote()
    }, [debouncedNote, isLocalMode, noteSourceId, onSaveNote, saleData?.id, saleData?.notes])

    const handlePrintAndUpload = async () => {
        if (isProcessing || !saleData) {
            // If already processing or missing data, just close or do nothing
            onClose()
            return
        }

        setIsProcessing(true)
        try {
            if (!user) {
                onClose()
                return
            }

            const workspaceId = activeWorkspace?.id || user.workspaceId
            const resolvedWorkspaceName = workspaceName || workspaceId || 'Atlas'
            let receiptPdfPromise: Promise<Blob> | null = null
            const getReceiptPdf = () => {
                receiptPdfPromise ||= buildCheckoutReceiptPdf()
                return receiptPdfPromise
            }

            // 1. Trigger background sync with the same receipt PDF used for printing.
            triggerInvoiceSync({
                saleData,
                features: printFeatures,
                workspaceName: resolvedWorkspaceName,
                workspaceId,
                user: {
                    id: user.id,
                    name: user.name || 'System'
                },
                format: 'receipt',
                pdfBuilder: getReceiptPdf
            });

            // 2. Prefer native thermal printing when enabled and configured on this device.
            let handledByThermalPrinter = false
            if (features.thermal_printing) {
                try {
                    const maxWidth = await printService.getThermalPrinterMaxWidth(workspaceId)
                    const receiptPdf = await getReceiptPdf()
                    const imageBase64 = await renderPdfPageToPngDataUrl(receiptPdf, { maxWidthPx: maxWidth })

                    handledByThermalPrinter = await printService.silentPrintImage({
                        imageBase64,
                        workspaceId,
                        maxWidth
                    })
                } catch (thermalError) {
                    console.error('[CheckoutSuccessModal] Thermal print failed:', thermalError)
                    toast({
                        title: t('settings.printing.thermalPrintErrorTitle', { defaultValue: 'Thermal printing failed' }),
                        description: t('settings.printing.thermalPrintErrorDesc', {
                            defaultValue: 'Falling back to the regular receipt print flow for this sale.'
                        }),
                        variant: 'destructive'
                    })
                }
            }

            // 3. Fall back to regular PDF printing when thermal printing is disabled or unavailable.
            if (!handledByThermalPrinter) {
                await printPdfBlob(await getReceiptPdf(), {
                    title: `Receipt_${saleData?.invoiceid || saleData?.id || 'Sale'}`
                })
            }

            // Keep the success modal open; the timer or manual New Sale action closes it.
        } catch (error) {
            console.error('[CheckoutSuccessModal] Failed to start background sync or print:', error)
            // Even if there's an error, we want to close the modal to not block the user
            onClose();
        } finally {
            setIsProcessing(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                data-tour-id="tutorial-pos-success-modal"
                onOpenAutoFocus={(e) => e.preventDefault()}
                className="max-w-sm rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl animate-in fade-in zoom-in duration-300"
            >
                <DialogTitle className="sr-only">
                    {t('pos.saleSuccessful') || 'Sale Successful'}
                </DialogTitle>
                <div className="bg-emerald-500 p-6 flex flex-col items-center justify-center text-white gap-3 relative overflow-hidden">
                    {/* Timer Corner */}
                    <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/10 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10">
                        <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                        <span className="text-[10px] font-black font-mono tracking-widest">{timeLeft}S</span>
                    </div>

                    {/* Decorative background pattern */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl" />
                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full -ml-12 -mb-12 blur-2xl" />

                    <div className="p-3 bg-white/20 backdrop-blur-md rounded-full animate-in zoom-in duration-500">
                        <CheckCircle2 className="w-16 h-16" />
                    </div>
                    <div className="text-center space-y-0.5">
                        <h2 className="text-xl font-black tracking-tight">
                            {t('pos.saleSuccessful') || 'Sale Successful'}
                        </h2>
                        <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest">
                            {saleData?.sequenceId ? `#${String(saleData.sequenceId).padStart(5, '0')}` : saleData?.invoiceid}
                        </p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-muted-foreground text-sm font-bold uppercase tracking-widest opacity-50">
                            Total Amount
                        </span>
                        <div className="text-4xl font-black text-foreground">
                            {saleData ? formatCurrency(saleData.total_amount, saleData.settlement_currency, features.iqd_display_preference) : '-'}
                        </div>
                    </div>

                    {/* Note Section (Replaces Change Due) */}
                    <div className={cn(
                        "bg-muted/30 rounded-3xl p-4 flex flex-col gap-2 border transition-all duration-300 group",
                        isPaused ? "border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.1)]" : "border-border/50"
                    )}>
                        <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-background rounded-lg border border-border shadow-sm">
                                    <Coins className="w-3.5 h-3.5 text-muted-foreground" />
                                </div>
                                <span className="font-bold text-xs text-muted-foreground uppercase tracking-tight">
                                    {t('sales.notes.title') || 'Sale Note'}
                                </span>
                            </div>

                            {isPaused && (
                                <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-500/20 animate-in fade-in slide-in-from-right-2">
                                    <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
                                    <span className="text-[9px] font-black uppercase tracking-widest leading-none">{t('sales.notes.paused')}</span>
                                </div>
                            )}
                        </div>

                        <Textarea
                            placeholder={t('sales.notes.placeholder') || "Add a private note to this sale..."}
                            value={note}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
                            onFocus={() => setIsPaused(true)}
                            className="bg-background/50 border-none shadow-none resize-none min-h-[80px] rounded-2xl text-sm focus-visible:ring-1 focus-visible:ring-emerald-500/20 placeholder:text-muted-foreground/30 font-medium"
                        />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-3">
                        <Button
                            data-tour-id="tutorial-pos-print-receipt"
                            size="lg"
                            className={cn(
                                "w-full text-lg h-14 rounded-xl transition-all active:scale-95 group",
                                tutorialDisablePrint
                                    ? "bg-muted text-muted-foreground border border-border shadow-none cursor-not-allowed hover:bg-muted"
                                    : "bg-[#23c55e] hover:bg-[#1ea34d] text-white shadow-lg shadow-green-500/20"
                            )}
                            onClick={handlePrintAndUpload}
                            disabled={isProcessing || isLoadingPrimaryReceiptTemplate || tutorialDisablePrint}
                        >
                            <Printer className={cn("w-6 h-6 mr-3 transition-transform", !tutorialDisablePrint && "group-hover:rotate-12")} />
                            {isProcessing || isLoadingPrimaryReceiptTemplate ? t('common.loading') : t('pos.printReceipt')}
                        </Button>

                        <Button
                            data-tour-id="tutorial-pos-success-continue"
                            variant="outline"
                            size="lg"
                            className="w-full text-lg h-14 border-2 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 transition-all active:scale-95"
                            onClick={onClose}
                            disabled={isProcessing}
                        >
                            {t('pos.continueSale')}
                        </Button>
                    </div>
                </div>

            </DialogContent>
        </Dialog>
    )
}
