import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button
} from '@/ui/components'
import { Info, ArrowRight } from 'lucide-react'

interface ReturnRulesDisplayModalProps {
    isOpen: boolean
    onClose: () => void
    productName: string
    rules: string
    isLast: boolean
    onContinue: () => void
    onBack: () => void
    showBack: boolean
}

export function ReturnRulesDisplayModal({
    isOpen,
    onClose,
    productName,
    rules,
    isLast,
    onContinue,
    onBack,
    showBack
}: ReturnRulesDisplayModalProps) {
    const { t } = useTranslation()

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-300">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <Info className="w-6 h-6 text-primary" />
                        <span className="truncate">{productName} - {t('products.form.returnRulesTitle') || 'Return Rules'}</span>
                    </DialogTitle>
                </DialogHeader>
                <div className="py-8">
                    <div className="bg-muted/50 p-6 rounded-2xl border border-border/50 shadow-inner">
                        <p className="text-lg leading-relaxed whitespace-pre-wrap text-foreground font-medium">
                            {rules}
                        </p>
                    </div>
                    {!isLast && (
                        <p className="text-xs text-muted-foreground mt-6 text-center uppercase font-bold tracking-widest opacity-60">
                            {t('sales.return.moreRulesFollowing') || 'More rules follow for other items'}
                        </p>
                    )}
                </div>
                <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between items-center px-0">
                    <Button variant="ghost" onClick={onClose} className="text-muted-foreground order-3 sm:order-1">
                        {t('common.cancel') || 'Cancel'}
                    </Button>
                    <div className="flex gap-2 w-full sm:w-auto order-1 sm:order-2">
                        {showBack && (
                            <Button variant="outline" onClick={onBack} className="flex-1 sm:flex-none">
                                {t('common.back') || 'Back'}
                            </Button>
                        )}
                        <Button onClick={onContinue} className="group flex-1 sm:flex-none">
                            {isLast ? (t('common.continue') || 'Continue') : (t('common.next') || 'Next')}
                            {!isLast && <ArrowRight className="w-4 h-4 ml-2 mr-0 rtl:ml-0 rtl:mr-2 rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

