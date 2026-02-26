import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    Button
} from '@/ui/components'
import { Receipt, FileText, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PrintSelectionModalProps {
    isOpen: boolean
    onClose: () => void
    onSelect: (format: 'receipt' | 'a4') => void
    a4Variant: 'standard' | 'refund'
}

export function PrintSelectionModal({ isOpen, onClose, onSelect, a4Variant }: PrintSelectionModalProps) {
    const { t } = useTranslation()

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Printer className="w-5 h-5 text-primary" />
                        {t('common.print') || 'Select Print Format'}
                    </DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 py-4">
                    <Button
                        variant="outline"
                        className="h-32 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-all text-center"
                        onClick={() => onSelect('receipt')}
                    >
                        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                            <Receipt className="w-6 h-6 text-foreground" />
                        </div>
                        <div className="space-y-1">
                            <div className="font-bold">{t('sales.print.receipt') || 'Thermal Receipt'}</div>
                            <div className="text-xs text-muted-foreground">{t('sales.print.receiptdesc') || 'Detailed full-page document'}</div>
                        </div>
                    </Button>

                    <Button
                        variant="outline"
                        className="h-32 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-all text-center"
                        onClick={() => onSelect('a4')}
                    >
                        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                            <FileText className="w-6 h-6 text-foreground" />
                        </div>
                        <div className="space-y-1">
                            <div className="font-bold">
                                {a4Variant === 'refund'
                                    ? (t('sales.print.a4Refund') || 'A4 Refund Invoice')
                                    : (t('sales.print.a4') || 'A4 Invoice')}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {a4Variant === 'refund'
                                    ? (t('sales.print.a4RefundDesc') || 'Refund-focused full-page A4')
                                    : (t('sales.print.a4desc') || 'Detailed full-page document')}
                            </div>
                        </div>
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
