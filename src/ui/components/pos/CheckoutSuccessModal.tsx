import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactToPrint } from 'react-to-print'
import {
    Dialog,
    DialogContent,
    DialogTitle,
    Button,
    SaleReceiptBase,
    useToast
} from '@/ui/components'
import { CheckCircle2, Printer, Coins } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import { triggerInvoiceSync } from '@/services/invoiceSyncService'
import { disableInvoiceQrInLocalMode } from '@/services/localInvoiceStorage'
import { printService } from '@/services/printService'
import { isSupabaseConfigured, useAuth } from '@/auth'
import { useWorkspace, type WorkspaceFeatures } from '@/workspace'
import { Textarea } from '@/ui/components/textarea'
import { supabase } from '@/auth/supabase'
import { db, listLocalCustomTemplates, replaceMirroredCustomTemplates, type LocalCustomTemplateRow } from '@/local-db'
import { useDebounce } from '@/lib/hooks'
import { normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import {
    SALES_HISTORY_RECEIPT_TEMPLATE_KEY,
    buildCustomTemplateLayoutPdf,
    getCustomTemplateTarget,
    readCustomTemplateLayout,
    renderCustomTemplateLayoutElement,
    type StoredCustomTemplateRow
} from '@/lib/customTemplates'

interface CheckoutSuccessModalProps {
    isOpen: boolean
    onClose: () => void
    saleData: any // Universal format expected by SaleReceipt
    features: WorkspaceFeatures
}

export function CheckoutSuccessModal({
    isOpen,
    onClose,
    saleData,
    features
}: CheckoutSuccessModalProps) {
    const { t } = useTranslation()
    const { user } = useAuth()
    const { workspaceName, activeWorkspace, isLocalMode, isHybridMode } = useWorkspace()
    const { toast } = useToast()

    const [timeLeft, setTimeLeft] = useState(15)
    const [isPaused, setIsPaused] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [note, setNote] = useState(saleData?.notes || '')
    const debouncedNote = useDebounce(note, 1000)
    const printRef = useRef<HTMLDivElement>(null)
    const [primaryReceiptTemplate, setPrimaryReceiptTemplate] = useState<StoredCustomTemplateRow | null>(null)
    const [isLoadingPrimaryReceiptTemplate, setIsLoadingPrimaryReceiptTemplate] = useState(false)
    const printFeatures = useMemo(
        () => disableInvoiceQrInLocalMode(activeWorkspace?.id || user?.workspaceId, features),
        [activeWorkspace?.id, features, user?.workspaceId]
    )

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Receipt_${saleData?.invoiceid || saleData?.id || 'Sale'}`,
        onAfterPrint: () => {
            // Optional: Close modal after print? No, leave it for the timer or manual close
        }
    })

    useEffect(() => {
        const workspaceId = activeWorkspace?.id || user?.workspaceId
        if (!isOpen || !workspaceId || (!isLocalMode && !isSupabaseConfigured)) {
            setPrimaryReceiptTemplate(null)
            setIsLoadingPrimaryReceiptTemplate(false)
            return
        }

        let cancelled = false
        setIsLoadingPrimaryReceiptTemplate(true)
        void (async () => {
            try {
                if (isLocalMode) {
                    const templates = await listLocalCustomTemplates(workspaceId, {
                        moduleTypeKey: SALES_HISTORY_RECEIPT_TEMPLATE_KEY,
                        activeOnly: true,
                        primaryOnly: true
                    })
                    if (!cancelled) setPrimaryReceiptTemplate((templates[0] || null) as StoredCustomTemplateRow | null)
                } else {
                    const { data, error } = await runSupabaseAction('checkoutSuccess.primaryReceiptTemplate.fetch', () =>
                        supabase
                            .from('custom_templates')
                            .select('id, workspace_id, module_type_key, label, layout_json, active, primary, created_by, updated_by, created_at, updated_at')
                            .eq('workspace_id', workspaceId)
                            .eq('module_type_key', SALES_HISTORY_RECEIPT_TEMPLATE_KEY)
                            .order('primary', { ascending: false })
                            .order('updated_at', { ascending: false })
                    )
                    if (error) throw normalizeSupabaseActionError(error)
                    const cloudTemplates = (data || []) as LocalCustomTemplateRow[]
                    if (isHybridMode) {
                        await replaceMirroredCustomTemplates(workspaceId, cloudTemplates, {
                            moduleTypeKey: SALES_HISTORY_RECEIPT_TEMPLATE_KEY
                        })
                    }
                    const primaryTemplate = cloudTemplates.find((template) => template.active && template.primary) || null
                    if (!cancelled) setPrimaryReceiptTemplate(primaryTemplate as StoredCustomTemplateRow | null)
                }
            } catch (templateError) {
                console.error('[CheckoutSuccessModal] Failed to load primary receipt template:', templateError)
                if (!cancelled) {
                    if (isHybridMode) {
                        try {
                            const mirroredTemplates = await listLocalCustomTemplates(workspaceId, {
                                moduleTypeKey: SALES_HISTORY_RECEIPT_TEMPLATE_KEY,
                                activeOnly: true,
                                primaryOnly: true
                            })
                            setPrimaryReceiptTemplate((mirroredTemplates[0] || null) as StoredCustomTemplateRow | null)
                        } catch {
                            setPrimaryReceiptTemplate(null)
                        }
                    } else {
                        setPrimaryReceiptTemplate(null)
                    }
                }
            } finally {
                if (!cancelled) setIsLoadingPrimaryReceiptTemplate(false)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [activeWorkspace?.id, isHybridMode, isLocalMode, isOpen, user?.workspaceId])

    const primaryReceiptTarget = useMemo(
        () => getCustomTemplateTarget(SALES_HISTORY_RECEIPT_TEMPLATE_KEY),
        []
    )
    const primaryReceiptLayout = useMemo(
        () => readCustomTemplateLayout(primaryReceiptTemplate),
        [primaryReceiptTemplate]
    )
    const buildPrimaryReceiptPdf = useCallback(async () => {
        if (!primaryReceiptTarget || !primaryReceiptLayout || !saleData) {
            throw new Error('Primary receipt template is not available.')
        }

        return buildCustomTemplateLayoutPdf({
            target: primaryReceiptTarget,
            layout: primaryReceiptLayout,
            values: {},
            options: {
                workspaceId: activeWorkspace?.id || user?.workspaceId,
                workspaceName,
                features: printFeatures,
                receiptData: saleData
            },
            effectiveId: saleData.id
        })
    }, [activeWorkspace?.id, primaryReceiptLayout, primaryReceiptTarget, printFeatures, saleData, user?.workspaceId, workspaceName])

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

    // Auto-save note
    useEffect(() => {
        const saveNote = async () => {
            if (!saleData?.id || debouncedNote === (saleData.notes || '')) return

            try {
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
    }, [debouncedNote, isLocalMode, saleData?.id, saleData?.notes])

    const handlePrintAndUpload = async () => {
        if (isProcessing || !saleData || !user) {
            // If already processing or missing data, just close or do nothing
            onClose()
            return
        }

        setIsProcessing(true)
        try {
            // 1. Trigger background sync (non-blocking for UI)
            triggerInvoiceSync({
                saleData,
                features: printFeatures,
                workspaceName: workspaceName || user?.workspaceId || 'Atlas',
                workspaceId: activeWorkspace?.id || user.workspaceId,
                user: {
                    id: user.id,
                    name: user.name || 'System'
                },
                format: 'receipt',
                pdfBuilder: primaryReceiptLayout ? buildPrimaryReceiptPdf : undefined
            });

            // 2. Prefer native thermal printing when enabled and configured on this device.
            let handledByThermalPrinter = false
            if (features.thermal_printing && !primaryReceiptLayout) {
                try {
                    handledByThermalPrinter = await printService.silentPrintReceipt({
                        saleData,
                        features: printFeatures,
                        workspaceName: workspaceName || user?.workspaceId || 'Atlas',
                        workspaceId: activeWorkspace?.id || user.workspaceId
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

            // 3. Fall back to the original browser print flow when thermal printing is disabled or unavailable.
            if (!handledByThermalPrinter) {
                handlePrint()
            }

            // Note: We don't onClose() immediately here because handlePrint() 
            // is async in nature (browser dialog), but we want to stay in 
            // success modal until user is done. If we want to auto-close 
            // after print, we'd use onAfterPrint in the hook.
            // For now, let the timer handle auto-close or manual New Sale.
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
                            size="lg"
                            className="w-full text-lg h-14 bg-[#23c55e] hover:bg-[#1ea34d] text-white rounded-xl shadow-lg shadow-green-500/20 transition-all active:scale-95 group"
                            onClick={handlePrintAndUpload}
                            disabled={isProcessing || isLoadingPrimaryReceiptTemplate}
                        >
                            <Printer className="w-6 h-6 mr-3 group-hover:rotate-12 transition-transform" />
                            {isProcessing || isLoadingPrimaryReceiptTemplate ? t('common.loading') : t('pos.printReceipt')}
                        </Button>

                        <Button
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

                {/* Hidden SaleReceipt for printing */}
                <div className="hidden">
                    <div ref={printRef} className="bg-white">
                        {saleData && (
                            primaryReceiptTarget && primaryReceiptLayout
                                ? renderCustomTemplateLayoutElement({
                                    target: primaryReceiptTarget,
                                    layout: primaryReceiptLayout,
                                    values: {},
                                    options: {
                                        workspaceId: activeWorkspace?.id || user?.workspaceId,
                                        workspaceName,
                                        features: printFeatures,
                                        receiptData: saleData
                                    },
                                    effectiveId: saleData.id
                                })
                                : (
                                    <SaleReceiptBase
                                        data={saleData}
                                        features={printFeatures}
                                        workspaceName={workspaceName || user?.workspaceId || 'Atlas'}
                                        workspaceId={activeWorkspace?.id || user?.workspaceId}
                                    />
                                )
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
