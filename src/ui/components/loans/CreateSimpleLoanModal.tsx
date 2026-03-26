import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, X } from 'lucide-react'

import { useAuth } from '@/auth'
import { createManualLoan, type CurrencyCode, type LoanDirection } from '@/local-db'
import { getLoanCounterpartyNameLabel, getLoanDirectionLabel } from '@/lib/loanPresentation'
import { getLoanLinkedPartyTypeLabel, type LoanPartySelection } from '@/lib/loanParties'
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
    useToast
} from '@/ui/components'
import { useWorkspace } from '@/workspace'
import { LoanPartyPickerDialog } from './LoanPartyPickerDialog'

interface CreateSimpleLoanModalProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    settlementCurrency: CurrencyCode
    onCreated?: (loanId: string) => void
}

export function CreateSimpleLoanModal({
    isOpen,
    onOpenChange,
    workspaceId,
    settlementCurrency,
    onCreated
}: CreateSimpleLoanModalProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { features } = useWorkspace()
    const [isSaving, setIsSaving] = useState(false)
    const [direction, setDirection] = useState<LoanDirection>('lent')
    const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(settlementCurrency)
    const [borrowerName, setBorrowerName] = useState('')
    const [borrowerPhone, setBorrowerPhone] = useState('')
    const [borrowerAddress, setBorrowerAddress] = useState('')
    const [borrowerNationalId, setBorrowerNationalId] = useState('')
    const [selectedParty, setSelectedParty] = useState<LoanPartySelection | null>(null)
    const [isPartyPickerOpen, setIsPartyPickerOpen] = useState(false)
    const [principalAmount, setPrincipalAmount] = useState('')
    const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10))
    const [notes, setNotes] = useState('')

    useEffect(() => {
        if (!isOpen) return

        setIsSaving(false)
        setDirection('lent')
        setSelectedCurrency(settlementCurrency)
        setBorrowerName('')
        setBorrowerPhone('')
        setBorrowerAddress('')
        setBorrowerNationalId('')
        setSelectedParty(null)
        setIsPartyPickerOpen(false)
        setPrincipalAmount('')
        setDueDate(new Date().toISOString().slice(0, 10))
        setNotes('')
    }, [isOpen])

    const canSubmit = borrowerName.trim() && Number(principalAmount) > 0 && dueDate

    const counterpartyNameLabel = useMemo(
        () => getLoanCounterpartyNameLabel({ loanCategory: 'simple', direction }, t),
        [direction, t]
    )
    const availableCurrencies = useMemo(() => {
        const currencies: CurrencyCode[] = Array.from(new Set([settlementCurrency, 'usd', 'iqd'])) as CurrencyCode[]
        if (features.eur_conversion_enabled && !currencies.includes('eur')) currencies.push('eur')
        if (features.try_conversion_enabled && !currencies.includes('try')) currencies.push('try')
        return currencies
    }, [features.eur_conversion_enabled, features.try_conversion_enabled, settlementCurrency])

    const handlePartySelect = (selection: LoanPartySelection) => {
        setSelectedParty(selection)
        setSelectedCurrency(selection.defaultCurrency)
        setBorrowerName(selection.borrowerName)
        setBorrowerPhone(selection.borrowerPhone)
        setBorrowerAddress(selection.borrowerAddress)
    }

    const handleCreate = async () => {
        if (!canSubmit || isSaving) return

        setIsSaving(true)
        try {
            const result = await createManualLoan(workspaceId, {
                saleId: null,
                loanCategory: 'simple',
                direction,
                linkedPartyType: selectedParty?.linkedPartyType || null,
                linkedPartyId: selectedParty?.linkedPartyId || null,
                linkedPartyName: selectedParty?.linkedPartyName || null,
                borrowerName: borrowerName.trim(),
                borrowerPhone: borrowerPhone.trim(),
                borrowerAddress: borrowerAddress.trim(),
                borrowerNationalId: borrowerNationalId.trim(),
                principalAmount: Number(principalAmount),
                settlementCurrency: selectedCurrency,
                installmentCount: 1,
                installmentFrequency: 'monthly',
                firstDueDate: dueDate,
                notes: notes.trim() || undefined,
                createdBy: user?.id
            })

            toast({
                title: t('messages.success') || 'Success',
                description: t('loans.messages.loanCreated') || 'Loan created successfully'
            })
            onOpenChange(false)
            onCreated?.(result.loan.id)
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: t('messages.error') || 'Error',
                description: error?.message || (t('loans.messages.loanCreateFailed') || 'Failed to create loan')
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('loans.createSimpleLoan', { defaultValue: 'Create Simple Loan' })}</DialogTitle>
                    <DialogDescription>
                        {t('loans.simpleLoanDescription', { defaultValue: 'Add a manual lending or borrowing entry and optionally link it to a business partner.' })}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                    <div className="grid gap-2 md:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>{t('loans.direction', { defaultValue: 'Direction' })}</Label>
                            <Select value={direction} onValueChange={(value: LoanDirection) => setDirection(value)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="lent">{getLoanDirectionLabel('lent', t)}</SelectItem>
                                    <SelectItem value="borrowed">{getLoanDirectionLabel('borrowed', t)}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>{t('loans.currencyHint', { defaultValue: 'Settlement Currency' })}</Label>
                            <Select value={selectedCurrency} onValueChange={(value: CurrencyCode) => setSelectedCurrency(value)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableCurrencies.map((currency) => (
                                        <SelectItem key={currency} value={currency}>
                                            {currency.toUpperCase()}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label>{counterpartyNameLabel}</Label>
                        <div className="flex items-center gap-2">
                            <Input value={borrowerName} onChange={e => setBorrowerName(e.target.value)} className="flex-1" />
                            <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={() => setIsPartyPickerOpen(true)}>
                                <Users className="h-4 w-4" />
                                {t('loans.selectParty', { defaultValue: 'Business Partner' })}
                            </Button>
                        </div>
                        {selectedParty ? (
                            <div className="flex items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                                <div className="min-w-0">
                                    <div className="text-[11px] font-bold uppercase tracking-wide text-primary">
                                        {t('loans.belongsTo', { defaultValue: 'Belongs to' })}
                                    </div>
                                    <div className="text-sm font-semibold">
                                        {getLoanLinkedPartyTypeLabel(selectedParty.linkedPartyType, t)} - {selectedParty.linkedPartyName}
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 shrink-0 px-2 text-muted-foreground"
                                    onClick={() => setSelectedParty(null)}
                                >
                                    <X className="h-4 w-4" />
                                    {t('loans.clearParty', { defaultValue: 'Clear Link' })}
                                </Button>
                            </div>
                        ) : null}
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>{t('loans.contactPhone', { defaultValue: 'Phone' })}</Label>
                            <Input value={borrowerPhone} onChange={e => setBorrowerPhone(e.target.value)} />
                        </div>
                        <div className="grid gap-2">
                            <Label>{t('loans.referenceId', { defaultValue: 'Reference / ID' })}</Label>
                            <Input value={borrowerNationalId} onChange={e => setBorrowerNationalId(e.target.value)} />
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label>{t('loans.contactAddress', { defaultValue: 'Address' })}</Label>
                        <Input value={borrowerAddress} onChange={e => setBorrowerAddress(e.target.value)} />
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>{t('loans.principal', { defaultValue: 'Principal' })}</Label>
                            <Input
                                type="number"
                                min={0}
                                value={principalAmount}
                                onChange={e => setPrincipalAmount(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>{t('loans.dueDate', { defaultValue: 'Due Date' })}</Label>
                            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label>{t('loans.notes', { defaultValue: 'Notes' })}</Label>
                        <Input value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        {t('common.cancel') || 'Cancel'}
                    </Button>
                    <Button onClick={handleCreate} disabled={!canSubmit || isSaving}>
                        {t('common.create') || 'Create'}
                    </Button>
                </DialogFooter>
            </DialogContent>

            <LoanPartyPickerDialog
                isOpen={isPartyPickerOpen}
                onOpenChange={setIsPartyPickerOpen}
                workspaceId={workspaceId}
                selectedPartyId={selectedParty?.linkedPartyId}
                onSelect={handlePartySelect}
            />
        </Dialog>
    )
}
