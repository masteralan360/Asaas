import { useEffect, useState } from 'react'

import { useBusinessPartners, type CurrencyCode, type WorkspacePaymentMethod } from '@/local-db'
import { formatNumberWithCommas, parseFormattedNumber } from '@/lib/utils'
import {
    Button,
    CurrencySelector,
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
    Textarea
} from '@/ui/components'
import { useWorkspace } from '@/workspace'

interface DirectTransactionDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    isSubmitting?: boolean
    onSubmit: (input: {
        direction: 'incoming' | 'outgoing'
        amount: number
        currency: CurrencyCode
        paymentMethod: WorkspacePaymentMethod
        paidAt: string
        reason: string
        note?: string
        counterpartyName?: string
        businessPartnerId?: string | null
    }) => Promise<void> | void
}

function toLocalDateTimeValue(value: string) {
    const date = new Date(value)
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    return local.toISOString().slice(0, 16)
}

export function DirectTransactionDialog({
    open,
    onOpenChange,
    workspaceId,
    isSubmitting = false,
    onSubmit
}: DirectTransactionDialogProps) {
    const { features } = useWorkspace()
    const partners = useBusinessPartners(workspaceId)
    const [direction, setDirection] = useState<'incoming' | 'outgoing'>('outgoing')
    const [amount, setAmount] = useState('')
    const [currency, setCurrency] = useState<CurrencyCode>((features.default_currency || 'usd') as CurrencyCode)
    const [paymentMethod, setPaymentMethod] = useState<WorkspacePaymentMethod>('cash')
    const [paidAt, setPaidAt] = useState('')
    const [reason, setReason] = useState('')
    const [note, setNote] = useState('')
    const [counterpartyName, setCounterpartyName] = useState('')
    const [businessPartnerId, setBusinessPartnerId] = useState<string>('none')

    useEffect(() => {
        if (!open) {
            return
        }

        setDirection('outgoing')
        setAmount('')
        setCurrency((features.default_currency || 'usd') as CurrencyCode)
        setPaymentMethod('cash')
        setPaidAt(toLocalDateTimeValue(new Date().toISOString()))
        setReason('')
        setNote('')
        setCounterpartyName('')
        setBusinessPartnerId('none')
    }, [features.default_currency, open])

    const selectedPartner = businessPartnerId !== 'none'
        ? partners.find((item) => item.id === businessPartnerId)
        : undefined

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>New Direct Transaction</DialogTitle>
                    <DialogDescription>
                        Manual incoming or outgoing money for activity outside the tracked system modules. Payroll does not belong here.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>Direction</Label>
                            <Select value={direction} onValueChange={(value: 'incoming' | 'outgoing') => setDirection(value)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="outgoing">Outgoing</SelectItem>
                                    <SelectItem value="incoming">Incoming</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label>Payment Method</Label>
                            <Select value={paymentMethod} onValueChange={(value: WorkspacePaymentMethod) => setPaymentMethod(value)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="cash">Cash</SelectItem>
                                    <SelectItem value="fib">FIB</SelectItem>
                                    <SelectItem value="qicard">QiCard</SelectItem>
                                    <SelectItem value="zaincash">ZainCash</SelectItem>
                                    <SelectItem value="fastpay">FastPay</SelectItem>
                                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                        <div className="grid gap-2">
                            <Label>Amount</Label>
                            <Input
                                value={amount}
                                onChange={(event) => setAmount(formatNumberWithCommas(event.target.value))}
                                placeholder="0"
                            />
                        </div>
                        <CurrencySelector value={currency} onChange={setCurrency} iqdDisplayPreference={features.iqd_display_preference} />
                    </div>

                    <div className="grid gap-2">
                        <Label>Reason</Label>
                        <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why did this payment happen?" />
                    </div>

                    {features.crm ? (
                        <div className="grid gap-2">
                            <Label>Business Partner</Label>
                            <Select value={businessPartnerId} onValueChange={setBusinessPartnerId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Optional business partner" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">No linked partner</SelectItem>
                                    {partners.map((partner) => (
                                        <SelectItem key={partner.id} value={partner.id}>{partner.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    ) : null}

                    <div className="grid gap-2">
                        <Label>Counterparty</Label>
                        <Input
                            value={selectedPartner?.name || counterpartyName}
                            onChange={(event) => setCounterpartyName(event.target.value)}
                            disabled={!!selectedPartner}
                            placeholder="Who received or paid this amount?"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label>Paid At</Label>
                        <Input type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
                    </div>

                    <div className="grid gap-2">
                        <Label>Note</Label>
                        <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button
                        disabled={isSubmitting}
                        onClick={() => onSubmit({
                            direction,
                            amount: parseFormattedNumber(amount),
                            currency,
                            paymentMethod,
                            paidAt: new Date(paidAt).toISOString(),
                            reason: reason.trim(),
                            note: note.trim() || undefined,
                            counterpartyName: selectedPartner?.name || counterpartyName.trim() || undefined,
                            businessPartnerId: selectedPartner?.id || null
                        })}
                    >
                        Save Transaction
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
