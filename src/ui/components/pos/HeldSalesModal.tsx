import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/ui/components/dialog'
import { Button } from '@/ui/components/button'
import { ShoppingBag, Trash2, RotateCcw, Clock } from 'lucide-react'
import { formatCurrency, formatCompactDateTime } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export interface HeldSale {
    id: string
    items: any[]
    rates: {
        usd_iqd: number
        eur_iqd: number
        usd_eur: number
        try_iqd: number
        sources: Record<string, string>
    }
    settlementCurrency: string
    paymentType: 'cash' | 'digital' | 'loan'
    digitalProvider?: string
    timestamp: string
    total: number
}

interface HeldSalesModalProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    heldSales: HeldSale[]
    onRestore: (sale: HeldSale) => void
    onDelete: (id: string) => void
    iqdPreference: 'IQD' | 'د.ع'
}

export function HeldSalesModal({
    isOpen,
    onOpenChange,
    heldSales,
    onRestore,
    onDelete,
    iqdPreference
}: HeldSalesModalProps) {
    const { t } = useTranslation()

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden rounded-2xl border-none shadow-2xl">
                <DialogHeader className="p-6 bg-muted/30 border-b">
                    <DialogTitle className="flex items-center gap-3 text-xl">
                        <div className="p-2 bg-primary/10 rounded-xl">
                            <ShoppingBag className="w-5 h-5 text-primary" />
                        </div>
                        {t('pos.heldSales', 'Held Sales')}
                        <span className="ml-2 px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full font-bold">
                            {heldSales.length}
                        </span>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 p-6 overflow-y-auto">
                    {heldSales.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-4 opacity-40">
                            <ShoppingBag className="w-16 h-16" />
                            <p className="text-lg font-medium">{t('pos.noHeldSales', 'No held sales found.')}</p>
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {[...heldSales].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((sale) => (
                                <div
                                    key={sale.id}
                                    className="group relative bg-card hover:bg-accent/5 rounded-2xl border border-border/50 p-5 transition-all duration-300 hover:shadow-lg flex items-center justify-between gap-4"
                                >
                                    <div className="flex flex-col gap-1.5 min-w-0">
                                        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground/70">
                                            <Clock className="w-3 h-3" />
                                            {formatCompactDateTime(sale.timestamp)}
                                        </div>
                                        <div className="font-bold text-lg text-foreground truncate">
                                            {sale.items.length} {t('pos.items', 'items')}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold px-2 py-0.5 bg-secondary text-secondary-foreground rounded-lg uppercase tracking-wider">
                                                {sale.settlementCurrency}
                                            </span>
                                            <span className="text-sm font-black text-primary">
                                                {formatCurrency(sale.total, sale.settlementCurrency, iqdPreference)}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-10 w-10 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive transition-all"
                                            onClick={() => onDelete(sale.id)}
                                            title={t('common.delete', 'Delete')}
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            className="rounded-xl h-10 px-5 font-bold shadow-sm transition-all active:scale-95 flex items-center gap-2"
                                            onClick={() => onRestore(sale)}
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                            {t('pos.restore', 'Restore')}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 bg-muted/20 border-t flex justify-end">
                    <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
                        {t('common.close', 'Close')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
