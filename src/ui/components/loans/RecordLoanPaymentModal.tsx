import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { formatCurrency } from '@/lib/utils'
import { recordLoanPayment, type Loan, type LoanPaymentMethod } from '@/local-db'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Label,
    Input,
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    useToast
} from '@/ui/components'
import { useWorkspace } from '@/workspace'

interface RecordLoanPaymentModalProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    loan: Loan | null
    onSaved?: () => void
}

export function RecordLoanPaymentModal({
    isOpen,
    onOpenChange,
    workspaceId,
    loan,
    onSaved
}: RecordLoanPaymentModalProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { features } = useWorkspace()
    const [amount, setAmount] = useState('')
    const [method, setMethod] = useState<LoanPaymentMethod>('cash')
    const [note, setNote] = useState('')
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        if (!isOpen || !loan) return
        setAmount(String(loan.balanceAmount))
        setMethod('cash')
        setNote('')
    }, [isOpen, loan])

    if (!loan) return null

    const numericAmount = Number(amount || 0)
    const canSubmit = numericAmount > 0 && numericAmount <= loan.balanceAmount

    const handleSave = async () => {
        if (!canSubmit || isSaving) return
        setIsSaving(true)
        try {
            await recordLoanPayment(workspaceId, {
                loanId: loan.id,
                amount: numericAmount,
                paymentMethod: method,
                note: note.trim() || undefined,
                createdBy: user?.id
            })

            toast({
                title: t('messages.success') || 'Success',
                description: t('loans.messages.paymentRecorded') || 'Payment recorded'
            })
            onOpenChange(false)
            onSaved?.()
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: t('messages.error') || 'Error',
                description: error?.message || (t('loans.messages.paymentRecordFailed') || 'Failed to record payment')
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('loans.recordPayment') || 'Record Payment'}</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4">
                    <div className="text-sm text-muted-foreground">
                        {t('loans.balance') || 'Balance'}:{' '}
                        <span className="font-semibold text-foreground">
                            {formatCurrency(loan.balanceAmount, loan.settlementCurrency, features.iqd_display_preference)}
                        </span>
                    </div>

                    <div className="grid gap-2">
                        <Label>{t('loans.paymentAmount') || 'Payment Amount'}</Label>
                        <Input
                            type="number"
                            min={0}
                            max={loan.balanceAmount}
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label>{t('pos.paymentMethod') || 'Payment Method'}</Label>
                        <Select value={method} onValueChange={(value: LoanPaymentMethod) => setMethod(value)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cash">{t('pos.cash') || 'Cash'}</SelectItem>
                                <SelectItem value="fib">FIB</SelectItem>
                                <SelectItem value="qicard">QiCard</SelectItem>
                                <SelectItem value="zaincash">ZainCash</SelectItem>
                                <SelectItem value="fastpay">FastPay</SelectItem>
                                <SelectItem value="loan_adjustment">{t('loans.adjustment') || 'Loan Adjustment'}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <Label>{t('loans.notes') || 'Notes'}</Label>
                        <Input value={note} onChange={e => setNote(e.target.value)} />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        {t('common.cancel') || 'Cancel'}
                    </Button>
                    <Button onClick={handleSave} disabled={!canSubmit || isSaving}>
                        {t('common.save') || 'Save'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

