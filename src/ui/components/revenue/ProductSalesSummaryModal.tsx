import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Hash, Package, ShoppingCart } from 'lucide-react'
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/ui/components'
import { cn } from '@/lib/utils'
import type { RevenueProductSalesSummary } from '@/lib/revenueAnalysis'

interface ProductSalesSummaryModalProps {
    isOpen: boolean
    onClose: () => void
    summary: RevenueProductSalesSummary
}

export function ProductSalesSummaryModal({ isOpen, onClose, summary }: ProductSalesSummaryModalProps) {
    const { t, i18n } = useTranslation()
    const quantityFormatter = useMemo(
        () => new Intl.NumberFormat(i18n.language),
        [i18n.language]
    )

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className={cn(
                'max-w-2xl p-0 bg-background/95 backdrop-blur-3xl overflow-hidden rounded-[2.5rem] shadow-2xl transition-all duration-500',
                'border-[3px] border-primary/40 shadow-primary/10'
            )}>
                <div className="p-6 md:p-8 space-y-6">
                    <DialogHeader className="flex flex-row items-center gap-4 space-y-0">
                        <div className="p-4 rounded-2xl shadow-inner bg-primary/10 text-primary">
                            <Package className="w-5 h-5" />
                        </div>
                        <div>
                            <DialogTitle className="text-2xl font-black tracking-tight">
                                {t('revenue.productSales')}
                            </DialogTitle>
                            <DialogDescription className="text-sm font-semibold text-muted-foreground/80">
                                {t('revenue.productSalesDesc')}
                            </DialogDescription>
                        </div>
                    </DialogHeader>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Card className="border-border/40 bg-card/60 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-[10px] font-black text-blue-500 flex items-center gap-2 uppercase tracking-[0.2em]">
                                    <ShoppingCart className="w-3.5 h-3.5" />
                                    {t('revenue.salesCount')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-black tracking-tighter tabular-nums">
                                    {quantityFormatter.format(summary.totalSales)}
                                </div>
                                <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    {t('revenue.totalTransactions')}
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="border-border/40 bg-card/60 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-[10px] font-black text-emerald-500 flex items-center gap-2 uppercase tracking-[0.2em]">
                                    <Package className="w-3.5 h-3.5" />
                                    {t('revenue.productsSold')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-black tracking-tighter tabular-nums">
                                    {quantityFormatter.format(summary.productsSold)}
                                </div>
                                <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    {t('revenue.distinctProducts')}
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="border-border/40 bg-card/60 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-[10px] font-black text-purple-600 flex items-center gap-2 uppercase tracking-[0.2em]">
                                    <Hash className="w-3.5 h-3.5" />
                                    {t('revenue.unitsSold')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-black tracking-tighter tabular-nums">
                                    {quantityFormatter.format(summary.unitsSold)}
                                </div>
                                <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    {t('revenue.netUnitsSold')}
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
