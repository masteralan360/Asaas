import { ArrowRightLeft, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
    Button,
    SmallDialog,
    SmallDialogContent,
    SmallDialogDescription,
    SmallDialogFooter,
    SmallDialogHeader,
    SmallDialogTitle,
} from '@/ui/components'

interface SaleReturnActionDialogProps {
    isOpen: boolean
    onClose: () => void
    onReturnSale: () => void
    onProductExchange: () => void
}

/**
 * The deliberately small first step for a Sales History return action.  It
 * keeps the existing return confirmation flow intact and lets the caller open
 * the exchange form only when the user explicitly picks that action.
 */
export function SaleReturnActionDialog({
    isOpen,
    onClose,
    onReturnSale,
    onProductExchange,
}: SaleReturnActionDialogProps) {
    const { t } = useTranslation()

    const chooseAction = (callback: () => void) => {
        onClose()
        callback()
    }

    return (
        <SmallDialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
            <SmallDialogContent className="gap-5 rounded-2xl border-border/70 p-5 shadow-2xl sm:max-w-md">
                <SmallDialogHeader className="space-y-2 text-start">
                    <SmallDialogTitle className="text-xl font-bold">
                        {t('sales.exchange.chooseAction', { defaultValue: 'Choose an action' })}
                    </SmallDialogTitle>
                    <SmallDialogDescription>
                        {t('sales.exchange.chooseActionDescription', {
                            defaultValue: 'Return this sale or exchange one of its products.'
                        })}
                    </SmallDialogDescription>
                </SmallDialogHeader>

                <div className="grid gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => chooseAction(onReturnSale)}
                        className="h-auto min-h-20 justify-start gap-4 rounded-xl border-border/80 px-4 py-3 text-start hover:border-destructive/40 hover:bg-destructive/5"
                    >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
                            <RotateCcw className="h-5 w-5" />
                        </span>
                        <span className="grid gap-0.5">
                            <span className="font-semibold">{t('sales.returnSale', { defaultValue: 'Return Sale' })}</span>
                            <span className="whitespace-normal text-xs font-normal text-muted-foreground">
                                {t('sales.exchange.returnSaleDescription', { defaultValue: 'Return products from this sale.' })}
                            </span>
                        </span>
                    </Button>

                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => chooseAction(onProductExchange)}
                        className="h-auto min-h-20 justify-start gap-4 rounded-xl border-border/80 px-4 py-3 text-start hover:border-primary/45 hover:bg-primary/5"
                    >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                            <ArrowRightLeft className="h-5 w-5" />
                        </span>
                        <span className="grid gap-0.5">
                            <span className="font-semibold">{t('sales.exchange.title', { defaultValue: 'Product Exchange' })}</span>
                            <span className="whitespace-normal text-xs font-normal text-muted-foreground">
                                {t('sales.exchange.productExchangeDescription', { defaultValue: 'Replace a product from this sale.' })}
                            </span>
                        </span>
                    </Button>
                </div>

                <SmallDialogFooter className="pt-1 sm:justify-start">
                    <Button type="button" variant="ghost" onClick={onClose}>
                        {t('common.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                </SmallDialogFooter>
            </SmallDialogContent>
        </SmallDialog>
    )
}
