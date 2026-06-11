import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    Button
} from '@/ui/components'
import { Receipt, FileText, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/workspace'
import {
    getStoredCustomTemplateLabel,
    type StoredCustomTemplateRow
} from '@/lib/customTemplates'

interface PrintSelectionModalProps {
    isOpen: boolean
    onClose: () => void
    onSelect: (format: 'receipt' | 'a4', template?: StoredCustomTemplateRow) => void
    a4Variant: 'standard' | 'refund'
    receiptTemplates?: StoredCustomTemplateRow[]
}

export function PrintSelectionModal({
    isOpen,
    onClose,
    onSelect,
    a4Variant,
    receiptTemplates = []
}: PrintSelectionModalProps) {
    const { t } = useTranslation()
    const { hasCapability } = useWorkspace()
    const canUseA4Invoices = hasCapability('a4PdfInvoices')

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Printer className="w-5 h-5 text-primary" />
                        {t('common.print') || 'Select Print Format'}
                    </DialogTitle>
                </DialogHeader>
                <div className="grid max-h-[65vh] grid-cols-1 gap-4 overflow-y-auto py-4 sm:grid-cols-2">
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

                    {receiptTemplates.map((template) => (
                        <Button
                            key={template.id}
                            variant="outline"
                            className="relative h-32 flex-col gap-3 text-center transition-all hover:border-primary hover:bg-primary/5"
                            onClick={() => onSelect('receipt', template)}
                        >
                            {template.primary && (
                                <span className="absolute end-2 top-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                                    {t('customTemplates.primary', { defaultValue: 'Primary' })}
                                </span>
                            )}
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                <Receipt className="h-6 w-6 text-primary" />
                            </div>
                            <div className="space-y-1">
                                <div className="max-w-40 truncate font-bold">
                                    {getStoredCustomTemplateLabel(template)}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {t('customTemplates.customReceipt', { defaultValue: 'Custom Receipt' })}
                                </div>
                            </div>
                        </Button>
                    ))}

                    {canUseA4Invoices && (
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
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
