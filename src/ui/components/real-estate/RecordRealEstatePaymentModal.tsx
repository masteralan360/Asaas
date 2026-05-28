import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth'
import { formatCurrency, formatNumericInput, parseFormattedNumber, sanitizeNumericInput } from '@/lib/utils'
import { recordRealEstatePayment, type RealEstateInstallment, type RealEstateTransaction, type WorkspacePaymentMethod } from '@/local-db'
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Textarea,
    useToast
} from '@/ui/components'
import { useWorkspace } from '@/workspace'

interface RecordRealEstatePaymentModalProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    transaction: RealEstateTransaction | null
    installment?: RealEstateInstallment | null
}

const paymentMethods: WorkspacePaymentMethod[] = [
    'cash',
    'bank_transfer',
    'fib',
    'qicard',
    'zaincash',
    'fastpay'
]

function paymentMethodLabel(method: WorkspacePaymentMethod, t: any) {
    switch (method) {
        case 'bank_transfer':
            return t('ledger.paymentMethod.bankTransfer', { defaultValue: 'Bank Transfer' })
        case 'fib':
            return 'FIB'
        case 'qicard':
            return 'QiCard'
        case 'zaincash':
            return 'ZainCash'
        case 'fastpay':
            return 'FastPay'
        default:
            return t(`pos.paymentMethods.${method}`, { defaultValue: method.toUpperCase() })
    }
}

export function RecordRealEstatePaymentModal({
    isOpen,
    onOpenChange,
    transaction,
    installment
}: RecordRealEstatePaymentModalProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { features } = useWorkspace()
    const [isSaving, setIsSaving] = useState(false)
    const [amount, setAmount] = useState('')
    const [paymentMethod, setPaymentMethod] = useState<WorkspacePaymentMethod>('cash')
    const [note, setNote] = useState('')

    const maxAmount = useMemo(() => {
        if (installment?.balanceAmount && installment.balanceAmount > 0) {
            return installment.balanceAmount
        }
        return transaction?.balanceAmount || 0
    }, [installment?.balanceAmount, transaction?.balanceAmount])

    useEffect(() => {
        if (!isOpen || !transaction) {
            return
        }

        setIsSaving(false)
        setAmount(String(maxAmount || ''))
        setPaymentMethod('cash')
        setNote('')
    }, [isOpen, maxAmount, transaction])

    const parsedAmount = parseFormattedNumber(amount || '0')
    const canSubmit = !!transaction && parsedAmount > 0 && parsedAmount <= maxAmount

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!transaction || !canSubmit || isSaving) {
            return
        }

        setIsSaving(true)
        try {
            await recordRealEstatePayment(transaction.workspaceId, {
                transactionId: transaction.id,
                installmentId: installment?.id ?? null,
                amount: parsedAmount,
                paymentMethod,
                note: note.trim() || null,
                createdBy: user?.id ?? null
            })

            toast({
                title: t('common.success') || 'Success',
                description: t('realEstate.messages.paymentRecorded', { defaultValue: 'Real estate payment recorded.' })
            })
            onOpenChange(false)
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: error?.message || t('realEstate.messages.paymentFailed', { defaultValue: 'Failed to record real estate payment.' }),
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)] w-[calc(100vw-0.75rem)] max-w-lg rounded-[1.25rem] border-border/60 p-0 sm:w-full sm:rounded-[1.5rem]">
                <DialogHeader className="border-b bg-muted/30 px-4 py-4 pr-14 text-left sm:px-6">
                    <DialogTitle>{t('realEstate.recordContractPayment', { defaultValue: 'Record Contract Payment' })}</DialogTitle>
                    <DialogDescription>
                        {transaction ? `${transaction.transactionNo} / ${transaction.location}` : ''}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit}>
                    <div className="space-y-4 px-4 py-4 sm:px-6">
                        <div className="rounded-xl border bg-muted/20 p-3 text-sm">
                            <div className="text-muted-foreground">{t('realEstate.contractBalance', { defaultValue: 'Contract Balance' })}</div>
                            <div className="text-xl font-bold">
                                {transaction ? formatCurrency(maxAmount, transaction.currency, features.iqd_display_preference) : '-'}
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label>{t('payments.table.amount', { defaultValue: 'Amount' })}</Label>
                            <Input
                                type="text"
                                inputMode={transaction?.currency === 'iqd' ? 'numeric' : 'decimal'}
                                value={formatNumericInput(amount)}
                                onChange={(event) => setAmount(sanitizeNumericInput(event.target.value, { allowDecimal: transaction?.currency !== 'iqd' }))}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>{t('payments.table.method', { defaultValue: 'Method' })}</Label>
                            <Select value={paymentMethod} onValueChange={(value: WorkspacePaymentMethod) => setPaymentMethod(value)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {paymentMethods.map((method) => (
                                        <SelectItem key={method} value={method}>{paymentMethodLabel(method, t)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label>{t('realEstate.notes', { defaultValue: 'Notes' })}</Label>
                            <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
                        </div>
                    </div>

                    <DialogFooter className="border-t bg-muted/20 px-4 py-4 sm:justify-between sm:px-6">
                        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={isSaving}>
                            {t('common.cancel') || 'Cancel'}
                        </Button>
                        <Button type="submit" className="w-full sm:w-auto" disabled={!canSubmit || isSaving}>
                            {t('common.record', { defaultValue: 'Record' })}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
