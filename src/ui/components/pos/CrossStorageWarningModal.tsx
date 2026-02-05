import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/components/dialog'
import { Button } from '@/ui/components/button'
import { AlertTriangle, Warehouse, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface CrossStorageWarningModalProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    productName: string
    currentStorageName: string
    foundInStorageName: string
    onConfirm: () => void
}

export function CrossStorageWarningModal({
    isOpen,
    onOpenChange,
    productName,
    currentStorageName,
    foundInStorageName,
    onConfirm
}: CrossStorageWarningModalProps) {
    const { t } = useTranslation()

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md border-amber-500/20 bg-amber-500/5 backdrop-blur-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-amber-600">
                        <AlertTriangle className="h-5 w-5" />
                        {t('pos.wrongStorage.title') || 'Product Not in Current Storage'}
                    </DialogTitle>
                    <DialogDescription className="pt-2 text-foreground/90 font-medium">
                        {t('pos.wrongStorage.message', { product: productName }) || `"${productName}" is not available in the selected storage.`}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-background/50 border border-border/50">
                        <div className="flex flex-col items-center gap-1 flex-1">
                            <span className="text-xs text-muted-foreground uppercase tracking-wider">{t('pos.current') || 'Current'}</span>
                            <div className="flex items-center gap-2 font-bold text-muted-foreground line-through decoration-destructive/50">
                                <Warehouse className="w-4 h-4" />
                                {currentStorageName}
                            </div>
                        </div>

                        <ArrowRight className="w-5 h-5 text-muted-foreground/30" />

                        <div className="flex flex-col items-center gap-1 flex-1">
                            <span className="text-xs text-emerald-600/80 uppercase tracking-wider font-bold">{t('pos.availableIn') || 'Found In'}</span>
                            <div className="flex items-center gap-2 font-black text-foreground bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 text-emerald-700">
                                <Warehouse className="w-4 h-4" />
                                {foundInStorageName}
                            </div>
                        </div>
                    </div>

                    <p className="text-sm text-muted-foreground text-center px-4">
                        {t('pos.wrongStorage.confirm') || 'Do you want to add it anyway? Stock will be deducted from the detected storage.'}
                    </p>
                </div>

                <DialogFooter className="flex gap-2 sm:justify-between w-full">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="flex-1"
                    >
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant="default"
                        onClick={onConfirm}
                        className="flex-1 bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-900/20"
                    >
                        {t('common.continue') || 'Add Anyway'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
