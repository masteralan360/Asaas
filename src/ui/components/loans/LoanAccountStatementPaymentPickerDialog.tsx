import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { IQDDisplayPreference, Loan, LoanPayment } from '@/local-db'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
    Button
} from '@/ui/components'

type LoanAccountStatementPaymentPickerDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    payments: LoanPayment[]
    currency: Loan['settlementCurrency']
    iqdPreference?: IQDDisplayPreference
    onConfirm: (paymentId: string) => void
}

export function LoanAccountStatementPaymentPickerDialog({
    open,
    onOpenChange,
    payments,
    currency,
    iqdPreference = 'IQD',
    onConfirm
}: LoanAccountStatementPaymentPickerDialogProps) {
    const { t } = useTranslation()
    const activePayments = useMemo(() => payments
        .filter((payment) => !payment.isDeleted)
        .slice()
        .sort((left, right) => right.paidAt.localeCompare(left.paidAt) || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)), [payments])
    const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setSelectedPaymentId((current) => activePayments.some((payment) => payment.id === current)
            ? current
            : activePayments[0]?.id || null)
    }, [activePayments, open])

    return (
        <AppDialog open={open} onOpenChange={onOpenChange}>
            <AppDialogContent className="max-w-2xl">
                <AppDialogHeader>
                    <AppDialogTitle>{t('loans.accountStatement.selectRepaymentTitle')}</AppDialogTitle>
                </AppDialogHeader>
                <AppDialogBody>
                    <p className="text-sm text-muted-foreground">{t('loans.accountStatement.selectRepaymentDescription')}</p>
                    <div className="mt-4 space-y-2">
                        {activePayments.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                {t('loans.accountStatement.noRepayments')}
                            </div>
                        ) : activePayments.map((payment, index) => {
                            const selected = payment.id === selectedPaymentId
                            const isLatest = index === 0
                            return (
                                <button
                                    key={payment.id}
                                    type="button"
                                    className={`flex w-full items-center justify-between gap-4 rounded-lg border p-3 text-start transition-colors ${
                                        selected
                                            ? 'border-primary bg-primary/5'
                                            : isLatest
                                                ? 'border-primary/40 bg-primary/[0.025] hover:border-primary/70'
                                                : 'border-slate-200 bg-slate-50/60 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                    }`}
                                    aria-pressed={selected}
                                    onClick={() => setSelectedPaymentId(payment.id)}
                                >
                                    <span className="min-w-0">
                                        <span className="flex items-center gap-2">
                                            <span className="font-semibold">{formatDateTime(payment.paidAt)}</span>
                                            {isLatest ? (
                                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                                                    {t('loans.accountStatement.latest')}
                                                </span>
                                            ) : null}
                                        </span>
                                        <span className="mt-1 block text-xs text-muted-foreground">{t(`pos.${payment.paymentMethod}`)}</span>
                                    </span>
                                    <span className={`shrink-0 ${isLatest || selected ? 'font-bold' : 'font-medium text-slate-600'}`}>
                                        {formatCurrency(payment.amount, currency, iqdPreference)}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </AppDialogBody>
                <AppDialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
                    <Button type="button" disabled={!selectedPaymentId} onClick={() => selectedPaymentId && onConfirm(selectedPaymentId)}>
                        {t('common.continue')}
                    </Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}
