import { useRef, useState, useEffect } from 'react'
import { useReactToPrint } from 'react-to-print'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    Button
} from '@/ui/components'
import { CheckCircle2, Printer, Plus, Coins } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { SaleReceipt } from '../SaleReceipt'
import { type WorkspaceFeatures } from '@/workspace'

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
    const printRef = useRef<HTMLDivElement>(null)

    const [timeLeft, setTimeLeft] = useState(15)

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

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Receipt_${saleData?.invoiceid || 'POS'}`,
        onAfterPrint: () => {
            // Requirement 1: Trigger automatically after print
            onClose()
        }
    })

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-sm rounded-[2.5rem] p-0 overflow-hidden border-none shadow-2xl animate-in fade-in zoom-in duration-300">
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
                            {saleData?.sequence_id ? `#${String(saleData.sequence_id).padStart(5, '0')}` : saleData?.invoiceid}
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

                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <Button
                            variant="outline"
                            className="h-16 rounded-2xl border-2 font-bold text-lg hover:bg-muted/50 transition-all active:scale-95 flex items-center gap-2"
                            onClick={onClose}
                        >
                            <Plus className="w-5 h-5 opacity-40" />
                            {t('pos.newSale') || 'New Sale'}
                        </Button>
                        <Button
                            className="h-16 rounded-2xl font-black text-lg bg-emerald-500 hover:bg-emerald-600 shadow-xl shadow-emerald-500/20 transition-all active:scale-95 flex items-center gap-2 text-white"
                            onClick={() => handlePrint()}
                        >
                            <Printer className="w-5 h-5" />
                            {t('common.print') || 'Print'}
                        </Button>
                    </div>
                </div>

                {/* Hidden Receipt for Printing */}
                <div className="hidden">
                    <div ref={printRef} className="p-4 w-[80mm] mx-auto bg-white text-black">
                        {saleData && (
                            <SaleReceipt
                                data={saleData}
                                features={features}
                            />
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
