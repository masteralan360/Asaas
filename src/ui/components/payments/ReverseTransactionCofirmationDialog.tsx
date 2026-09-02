import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatCurrency } from '@/lib/utils'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle
} from '@/ui/components/dialog'
import { Button } from '@/ui/components/button'

export interface ReverseTransactionDetails {
    amount: number
    currency: string
    direction: 'incoming' | 'outgoing'
    referenceLabel?: string | null
    counterpartyName?: string | null
}

interface ReverseTransactionCofirmationDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
    isProcessing?: boolean
    transaction: ReverseTransactionDetails | null
    iqdPreference?: 'IQD' | 'د.ع'
}

export function ReverseTransactionCofirmationDialog({
    open,
    onOpenChange,
    onConfirm,
    isProcessing = false,
    transaction,
    iqdPreference = 'IQD'
}: ReverseTransactionCofirmationDialogProps) {
    const { t } = useTranslation()
    const transactionLabel = transaction?.referenceLabel?.trim()
        || transaction?.counterpartyName?.trim()
        || t('reverseTransactionConfirmation.transaction')

    const handleOpenChange = (nextOpen: boolean) => {
        if (!isProcessing) {
            onOpenChange(nextOpen)
        }
    }

    return (
        <AppDialog open={open} onOpenChange={handleOpenChange}>
            <AppDialogContent className="max-w-lg" showCloseButton={!isProcessing}>
                <AppDialogHeader>
                    <AppDialogTitle className="flex items-center gap-2">
                        <RotateCcw className="h-5 w-5 text-amber-600" />
                        {t('reverseTransactionConfirmation.title')}
                    </AppDialogTitle>
                    <p className="text-sm text-muted-foreground">
                        {t('reverseTransactionConfirmation.description')}
                    </p>
                </AppDialogHeader>

                <AppDialogBody className="space-y-4">
                    <section className="rounded-xl border border-border/70 bg-muted/20 p-4">
                        <h3 className="mb-3 text-sm font-semibold">
                            {t('reverseTransactionConfirmation.details')}
                        </h3>
                        <dl className="space-y-3 text-sm">
                            <div className="flex items-start justify-between gap-4">
                                <dt className="text-muted-foreground">
                                    {t('reverseTransactionConfirmation.source')}
                                </dt>
                                <dd className="max-w-[60%] text-end font-medium">{transactionLabel}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <dt className="text-muted-foreground">
                                    {t('reverseTransactionConfirmation.direction')}
                                </dt>
                                <dd className="font-medium">
                                    {transaction?.direction === 'incoming'
                                        ? t('reverseTransactionConfirmation.incoming')
                                        : t('reverseTransactionConfirmation.outgoing')}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <dt className="text-muted-foreground">
                                    {t('reverseTransactionConfirmation.amount')}
                                </dt>
                                <dd className="font-semibold">
                                    {transaction
                                        ? formatCurrency(transaction.amount, transaction.currency, iqdPreference)
                                        : '—'}
                                </dd>
                            </div>
                        </dl>
                    </section>

                    <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <p>{t('reverseTransactionConfirmation.warning')}</p>
                    </div>
                </AppDialogBody>

                <AppDialogFooter className="gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isProcessing}
                    >
                        {t('common.cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={isProcessing || !transaction}
                    >
                        {isProcessing ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <RotateCcw className="me-2 h-4 w-4" />}
                        {isProcessing
                            ? t('reverseTransactionConfirmation.reversing')
                            : t('reverseTransactionConfirmation.confirm')}
                    </Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}
