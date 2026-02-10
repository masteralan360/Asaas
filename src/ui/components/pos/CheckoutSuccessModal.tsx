import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactToPrint } from 'react-to-print'
import {
    Dialog,
    DialogContent,
    DialogTitle,
    Button,
    SaleReceiptBase
} from '@/ui/components'
import { CheckCircle2, Printer, Coins } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { triggerInvoiceSync } from '@/services/invoiceSyncService'
import { printService } from '@/services/printService'
import { useAuth } from '@/auth'
import { useWorkspace, type WorkspaceFeatures } from '@/workspace'

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
    const { workspaceName, activeWorkspace } = useWorkspace()

    const [timeLeft, setTimeLeft] = useState(15)
    const [isProcessing, setIsProcessing] = useState(false)
    const printRef = useRef<HTMLDivElement>(null)

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Receipt_${saleData?.invoiceid || saleData?.id || 'Sale'}`,
        onAfterPrint: () => {
            // Optional: Close modal after print? No, leave it for the timer or manual close
        }
    })

    useEffect(() => {
        if (!isOpen) {
            setTimeLeft(15)
            return
        }

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer)
                    onClose()
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => clearInterval(timer)
    }, [isOpen, onClose])

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
                features,
                workspaceName: workspaceName || user?.workspaceId || 'Asaas',
                workspaceId: activeWorkspace?.id || user.workspaceId,
                user: {
                    id: user.id,
                    name: user.name || 'System'
                },
                format: 'receipt'
            });

            // 2. Trigger print using react-to-print
            handlePrint();

            // 3. Trigger silent print structure (placeholder for future native drivers)
            printService.silentPrintReceipt(saleData);

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
            <DialogContent className="max-w-sm rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl animate-in fade-in zoom-in duration-300">
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

                    {/* Requirement 2: Space for Change Due logic */}
                    <div className="bg-muted/30 rounded-3xl p-6 flex flex-col gap-4 border border-border/50">
                        <div className="flex items-center justify-between group opacity-40">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-background rounded-xl border border-border shadow-sm">
                                    <Coins className="w-4 h-4 text-muted-foreground" />
                                </div>
                                <span className="font-bold text-sm text-muted-foreground">Change Due</span>
                            </div>
                            <span className="font-black text-lg font-mono">--</span>
                        </div>
                        <p className="text-[10px] text-center text-muted-foreground font-medium uppercase tracking-tighter opacity-30">
                            Cash payment details will appear here
                        </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-3">
                        <Button
                            size="lg"
                            className="w-full text-lg h-14 bg-[#23c55e] hover:bg-[#1ea34d] text-white rounded-xl shadow-lg shadow-green-500/20 transition-all active:scale-95 group"
                            onClick={handlePrintAndUpload}
                            disabled={isProcessing}
                        >
                            <Printer className="w-6 h-6 mr-3 group-hover:rotate-12 transition-transform" />
                            {isProcessing ? t('common.loading') : t('pos.printReceipt')}
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
                            <SaleReceiptBase
                                data={saleData}
                                features={features}
                                workspaceName={workspaceName || user?.workspaceId || 'Asaas'}
                                workspaceId={activeWorkspace?.id || user?.workspaceId}
                            />
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
