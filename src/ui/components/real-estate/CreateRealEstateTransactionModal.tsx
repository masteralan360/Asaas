import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Plus, Users, X } from 'lucide-react'

import { useAuth } from '@/auth'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { buildOrderExchangeRatesSnapshot } from '@/lib/orderCurrency'
import { formatCurrency, formatLocalDateValue, formatNumericInput, parseFormattedNumber, parseLocalDateValue, sanitizeNumericInput } from '@/lib/utils'
import { createBusinessPartner, createRealEstateTransaction, type BusinessPartner, type CurrencyCode, type InstallmentFrequency, type RealEstatePropertyType, type RealEstateTransactionType } from '@/local-db'
import {
    Button,
    DateTimePicker,
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
    Switch,
    Textarea,
    useToast
} from '@/ui/components'
import { PartnerAutocompleteInput } from '@/ui/components/crm/PartnerAutocompleteInput'
import { BusinessPartnerFormDialog, type BusinessPartnerFormPayload } from '@/ui/components/crm/BusinessPartnerFormDialog'
import { useWorkspace } from '@/workspace'

interface CreateRealEstateTransactionModalProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    settlementCurrency: CurrencyCode
    onCreated?: (transactionId: string) => void
}

type PartyLink = {
    id: string
    name: string
} | null

export function CreateRealEstateTransactionModal({
    isOpen,
    onOpenChange,
    workspaceId,
    settlementCurrency,
    onCreated
}: CreateRealEstateTransactionModalProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { features } = useWorkspace()
    const { exchangeData, eurRates, tryRates } = useExchangeRate()
    const [isSaving, setIsSaving] = useState(false)
    const [location, setLocation] = useState('')
    const [transactionType, setTransactionType] = useState<RealEstateTransactionType>('sell')
    const [propertyType, setPropertyType] = useState<RealEstatePropertyType | ''>('')
    const [buyerName, setBuyerName] = useState('')
    const [sellerName, setSellerName] = useState('')
    const [buyerLink, setBuyerLink] = useState<PartyLink>(null)
    const [sellerLink, setSellerLink] = useState<PartyLink>(null)
    const [buyerWitnessName, setBuyerWitnessName] = useState('')
    const [buyerWitnessAddress, setBuyerWitnessAddress] = useState('')
    const [buyerWitnessPhone, setBuyerWitnessPhone] = useState('')
    const [sellerWitnessName, setSellerWitnessName] = useState('')
    const [sellerWitnessAddress, setSellerWitnessAddress] = useState('')
    const [sellerWitnessPhone, setSellerWitnessPhone] = useState('')
    const [landAreaM2, setLandAreaM2] = useState('')
    const [currency, setCurrency] = useState<CurrencyCode>(settlementCurrency)
    const [totalAmount, setTotalAmount] = useState('')
    const [paidAmount, setPaidAmount] = useState('')
    const [profitAmount, setProfitAmount] = useState('')
    const [isInstallmentBased, setIsInstallmentBased] = useState(false)
    const [installmentCount, setInstallmentCount] = useState(1)
    const [installmentFrequency, setInstallmentFrequency] = useState<InstallmentFrequency>('monthly')
    const [firstDueDate, setFirstDueDate] = useState(formatLocalDateValue(new Date()))
    const [notes, setNotes] = useState('')
    const [isCreateBuyerOpen, setIsCreateBuyerOpen] = useState(false)
    const [isSavingBuyer, setIsSavingBuyer] = useState(false)
    const [isCreateSellerOpen, setIsCreateSellerOpen] = useState(false)
    const [isSavingSeller, setIsSavingSeller] = useState(false)

    useEffect(() => {
        if (!isOpen) {
            return
        }

        setIsSaving(false)
        setLocation('')
        setTransactionType('sell')
        setPropertyType('')
        setBuyerName('')
        setSellerName('')
        setBuyerLink(null)
        setSellerLink(null)
        setBuyerWitnessName('')
        setBuyerWitnessAddress('')
        setBuyerWitnessPhone('')
        setSellerWitnessName('')
        setSellerWitnessAddress('')
        setSellerWitnessPhone('')
        setLandAreaM2('')
        setCurrency(settlementCurrency)
        setTotalAmount('')
        setPaidAmount('')
        setProfitAmount('')
        setIsInstallmentBased(false)
        setInstallmentCount(1)
        setInstallmentFrequency('monthly')
        setFirstDueDate(formatLocalDateValue(new Date()))
        setNotes('')
    }, [isOpen, settlementCurrency])

    useEffect(() => {
        const allowDecimal = currency !== 'iqd'
        setTotalAmount((current) => sanitizeNumericInput(current, { allowDecimal }))
        setPaidAmount((current) => sanitizeNumericInput(current, { allowDecimal }))
        setProfitAmount((current) => sanitizeNumericInput(current, { allowDecimal }))
    }, [currency])

    const availableCurrencies = useMemo(() => {
        const currencies: CurrencyCode[] = Array.from(new Set([settlementCurrency, ...features.allowed_currencies])) as CurrencyCode[]
        return currencies
    }, [features.allowed_currencies, settlementCurrency])

    const exchangeRateSnapshot = useMemo(() => {
        const snapshot = buildOrderExchangeRatesSnapshot({
            exchangeData,
            eurRates,
            tryRates
        })
        return snapshot.length > 0 ? snapshot : null
    }, [exchangeData, eurRates, tryRates])

    const parsedTotal = parseFormattedNumber(totalAmount || '0')
    const parsedPaid = parseFormattedNumber(paidAmount || '0')
    const remainingBalance = Math.max(parsedTotal - parsedPaid, 0)
    const hasDuplicateLinkedParty = Boolean(buyerLink?.id && sellerLink?.id && buyerLink.id === sellerLink.id)
    const canSubmit = location.trim().length > 0 &&
        buyerName.trim().length > 0 &&
        sellerName.trim().length > 0 &&
        parsedTotal > 0 &&
        parsedPaid <= parsedTotal &&
        !hasDuplicateLinkedParty &&
        (!isInstallmentBased || (remainingBalance > 0 && installmentCount > 0 && firstDueDate))

    const handleBuyerPartnerSelect = (partner: BusinessPartner) => {
        if (sellerLink?.id === partner.id) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: t('realEstate.messages.buyerSellerSamePartner', { defaultValue: 'Buyer and seller cannot use the same business partner.' }),
                variant: 'destructive'
            })
            return
        }

        setBuyerLink({ id: partner.id, name: partner.name })
        setBuyerName(partner.name)
    }

    const handleCreateBuyerPartner = async (payload: BusinessPartnerFormPayload) => {
        setIsSavingBuyer(true)
        try {
            const partner = await createBusinessPartner(workspaceId, payload, { allowRealEstateRoles: features.real_estate })
            toast({ title: t('businessPartners.messages.addSuccess', { defaultValue: 'Business partner created successfully' }) })
            setIsCreateBuyerOpen(false)
            handleBuyerPartnerSelect(partner)
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || 'Failed to create business partner',
                variant: 'destructive'
            })
        } finally {
            setIsSavingBuyer(false)
        }
    }

    const handleSellerPartnerSelect = (partner: BusinessPartner) => {
        if (buyerLink?.id === partner.id) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: t('realEstate.messages.buyerSellerSamePartner', { defaultValue: 'Buyer and seller cannot use the same business partner.' }),
                variant: 'destructive'
            })
            return
        }

        setSellerLink({ id: partner.id, name: partner.name })
        setSellerName(partner.name)
    }

    const handleCreateSellerPartner = async (payload: BusinessPartnerFormPayload) => {
        setIsSavingSeller(true)
        try {
            const partner = await createBusinessPartner(workspaceId, payload, { allowRealEstateRoles: features.real_estate })
            toast({ title: t('businessPartners.messages.addSuccess', { defaultValue: 'Business partner created successfully' }) })
            setIsCreateSellerOpen(false)
            handleSellerPartnerSelect(partner)
        } catch (error: any) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error?.message || 'Failed to create business partner',
                variant: 'destructive'
            })
        } finally {
            setIsSavingSeller(false)
        }
    }

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!canSubmit || isSaving) {
            return
        }

        setIsSaving(true)
        try {
            const result = await createRealEstateTransaction(workspaceId, {
                transactionType,
                propertyType: (propertyType || null) as RealEstatePropertyType | null,
                location: location.trim(),
                landAreaM2: parseFormattedNumber(landAreaM2 || '0'),
                currency,
                totalAmount: parsedTotal,
                paidAmount: parsedPaid,
                profitAmount: parseFormattedNumber(profitAmount || '0'),
                buyerName: buyerName.trim(),
                buyerBusinessPartnerId: buyerLink?.id ?? null,
                buyerWitnessName,
                buyerWitnessAddress,
                buyerWitnessPhone,
                sellerName: sellerName.trim(),
                sellerBusinessPartnerId: sellerLink?.id ?? null,
                sellerWitnessName,
                sellerWitnessAddress,
                sellerWitnessPhone,
                isInstallmentBased,
                installmentCount,
                installmentFrequency,
                firstDueDate,
                exchangeRateSnapshot,
                notes: notes.trim() || null,
                createdBy: user?.id ?? null
            })

            toast({
                title: t('common.success') || 'Success',
                description: t('realEstate.messages.created', { defaultValue: 'Real estate transaction created.' })
            })
            onOpenChange(false)
            onCreated?.(result.transaction.id)
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: error?.message || t('realEstate.messages.createFailed', { defaultValue: 'Failed to create real estate transaction.' }),
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)] flex max-h-[calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-0.75rem)] w-[calc(100vw-0.75rem)] max-w-4xl flex-col overflow-hidden rounded-[1.25rem] border-border/60 p-0 sm:w-full sm:max-h-[min(calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-2rem),820px)] sm:rounded-[1.75rem]">
                <DialogHeader className="border-b bg-muted/30 px-4 py-4 pr-14 text-left sm:px-6 sm:py-5">
                    <DialogTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5" />
                        {t('realEstate.createTitle', { defaultValue: 'Create Real Estate Transaction' })}
                    </DialogTitle>
                    <DialogDescription>
                        {t('realEstate.createDescription', { defaultValue: 'Record a property deal with multi-currency and optional installment tracking.' })}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
                        <div className="grid gap-4">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.location', { defaultValue: 'Location' })} <span className="text-destructive">*</span></Label>
                                    <Input
                                        value={location}
                                        onChange={(event) => setLocation(event.target.value)}
                                        placeholder={t('realEstate.locationPlaceholder', { defaultValue: 'Property address or coordinates' })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.transactionType', { defaultValue: 'Transaction Type' })}</Label>
                                    <Select value={transactionType} onValueChange={(value: RealEstateTransactionType) => setTransactionType(value)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="sell">{t('realEstate.types.sell', { defaultValue: 'Sell' })}</SelectItem>
                                            <SelectItem value="buy">{t('realEstate.types.buy', { defaultValue: 'Buy' })}</SelectItem>
                                            <SelectItem value="rent">{t('realEstate.types.rent', { defaultValue: 'Rent' })}</SelectItem>
                                            <SelectItem value="lease">{t('realEstate.types.lease', { defaultValue: 'Lease' })}</SelectItem>
                                            <SelectItem value="exchange">{t('realEstate.types.exchange', { defaultValue: 'Exchange' })}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.propertyType', { defaultValue: 'Property Type' })}</Label>
                                    <Select value={propertyType} onValueChange={(value: RealEstatePropertyType | '') => setPropertyType(value)}>
                                        <SelectTrigger><SelectValue placeholder={t('realEstate.propertyTypePlaceholder', { defaultValue: 'Select type' })} /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="house">{t('realEstate.propertyTypes.house', { defaultValue: 'House' })}</SelectItem>
                                            <SelectItem value="apartment">{t('realEstate.propertyTypes.apartment', { defaultValue: 'Apartment' })}</SelectItem>
                                            <SelectItem value="land">{t('realEstate.propertyTypes.land', { defaultValue: 'Land' })}</SelectItem>
                                            <SelectItem value="commercial">{t('realEstate.propertyTypes.commercial', { defaultValue: 'Commercial' })}</SelectItem>
                                            <SelectItem value="villa">{t('realEstate.propertyTypes.villa', { defaultValue: 'Villa' })}</SelectItem>
                                            <SelectItem value="office">{t('realEstate.propertyTypes.office', { defaultValue: 'Office' })}</SelectItem>
                                            <SelectItem value="warehouse">{t('realEstate.propertyTypes.warehouse', { defaultValue: 'Warehouse' })}</SelectItem>
                                            <SelectItem value="other">{t('realEstate.propertyTypes.other', { defaultValue: 'Other' })}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.buyer', { defaultValue: 'Buyer' })} <span className="text-destructive">*</span></Label>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex gap-2">
                                            <PartnerAutocompleteInput
                                                value={buyerName}
                                                onChange={(value) => {
                                                    setBuyerName(value)
                                                    if (buyerLink && value.trim() !== buyerLink.name) {
                                                        setBuyerLink(null)
                                                    }
                                                }}
                                                onSelectPartner={handleBuyerPartnerSelect}
                                                workspaceId={workspaceId}
                                                placeholder={t('realEstate.buyerPlaceholder', { defaultValue: 'Search or enter buyer name' })}
                                                className="flex-1"
                                                includeRealEstateRoles={features.real_estate}
                                                excludePartnerIds={sellerLink?.id ? [sellerLink.id] : []}
                                            />
                                            <Button type="button" size="icon" variant="outline" className="shrink-0" onClick={() => setIsCreateBuyerOpen(true)}>
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        {buyerLink ? (
                                            <LinkedPartyBadge label={t('realEstate.linkedBuyer', { defaultValue: 'Linked buyer' })} name={buyerLink.name} onClear={() => setBuyerLink(null)} />
                                        ) : null}
                                    </div>
                                </div>
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.seller', { defaultValue: 'Seller' })} <span className="text-destructive">*</span></Label>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex gap-2">
                                            <PartnerAutocompleteInput
                                                value={sellerName}
                                                onChange={(value) => {
                                                    setSellerName(value)
                                                    if (sellerLink && value.trim() !== sellerLink.name) {
                                                        setSellerLink(null)
                                                    }
                                                }}
                                                onSelectPartner={handleSellerPartnerSelect}
                                                workspaceId={workspaceId}
                                                placeholder={t('realEstate.sellerPlaceholder', { defaultValue: 'Search or enter seller name' })}
                                                className="flex-1"
                                                includeRealEstateRoles={features.real_estate}
                                                excludePartnerIds={buyerLink?.id ? [buyerLink.id] : []}
                                            />
                                            <Button type="button" size="icon" variant="outline" className="shrink-0" onClick={() => setIsCreateSellerOpen(true)}>
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        {sellerLink ? (
                                            <LinkedPartyBadge label={t('realEstate.linkedSeller', { defaultValue: 'Linked seller' })} name={sellerLink.name} onClear={() => setSellerLink(null)} />
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                            {hasDuplicateLinkedParty ? (
                                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                    {t('realEstate.messages.buyerSellerSamePartner', { defaultValue: 'Buyer and seller cannot use the same business partner.' })}
                                </div>
                            ) : null}

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <WitnessFields
                                    title={t('realEstate.buyerWitness', { defaultValue: 'Buyer Witness' })}
                                    name={buyerWitnessName}
                                    address={buyerWitnessAddress}
                                    phone={buyerWitnessPhone}
                                    onNameChange={setBuyerWitnessName}
                                    onAddressChange={setBuyerWitnessAddress}
                                    onPhoneChange={setBuyerWitnessPhone}
                                />
                                <WitnessFields
                                    title={t('realEstate.sellerWitness', { defaultValue: 'Seller Witness' })}
                                    name={sellerWitnessName}
                                    address={sellerWitnessAddress}
                                    phone={sellerWitnessPhone}
                                    onNameChange={setSellerWitnessName}
                                    onAddressChange={setSellerWitnessAddress}
                                    onPhoneChange={setSellerWitnessPhone}
                                />
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.landArea', { defaultValue: 'Land Area (m2)' })}</Label>
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="0"
                                        value={formatNumericInput(landAreaM2)}
                                        onChange={(event) => setLandAreaM2(sanitizeNumericInput(event.target.value, { allowDecimal: true }))}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.currency', { defaultValue: 'Currency' })}</Label>
                                    <Select value={currency} onValueChange={(value: CurrencyCode) => setCurrency(value)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {availableCurrencies.map((item) => (
                                                <SelectItem key={item} value={item}>{item.toUpperCase()}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.total', { defaultValue: 'Total' })} <span className="text-destructive">*</span></Label>
                                    <Input
                                        type="text"
                                        inputMode={currency === 'iqd' ? 'numeric' : 'decimal'}
                                        placeholder="0"
                                        value={formatNumericInput(totalAmount)}
                                        onChange={(event) => setTotalAmount(sanitizeNumericInput(event.target.value, { allowDecimal: currency !== 'iqd' }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.contractPaid', { defaultValue: 'Contract Paid' })}</Label>
                                    <Input
                                        type="text"
                                        inputMode={currency === 'iqd' ? 'numeric' : 'decimal'}
                                        placeholder="0"
                                        value={formatNumericInput(paidAmount)}
                                        onChange={(event) => setPaidAmount(sanitizeNumericInput(event.target.value, { allowDecimal: currency !== 'iqd' }))}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>{t('realEstate.profitAmount', { defaultValue: 'Commission Amount' })}</Label>
                                    <Input
                                        type="text"
                                        inputMode={currency === 'iqd' ? 'numeric' : 'decimal'}
                                        placeholder="0"
                                        value={formatNumericInput(profitAmount)}
                                        onChange={(event) => setProfitAmount(sanitizeNumericInput(event.target.value, { allowDecimal: currency !== 'iqd' }))}
                                    />
                                </div>
                            </div>

                            <div className="rounded-2xl border bg-muted/20 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <Label htmlFor="real-estate-installments" className="text-base font-semibold">
                                            {t('realEstate.installmentBasedDeal', { defaultValue: 'Installment-based Deal' })}
                                        </Label>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {t('realEstate.installmentDescription', { defaultValue: 'Generate a repayment schedule for the remaining balance.' })}
                                        </p>
                                    </div>
                                    <Switch
                                        id="real-estate-installments"
                                        checked={isInstallmentBased}
                                        onCheckedChange={setIsInstallmentBased}
                                        disabled={remainingBalance <= 0}
                                    />
                                </div>

                                {isInstallmentBased ? (
                                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <div className="grid gap-2">
                                            <Label>{t('loans.installmentCount', { defaultValue: 'Installments' })}</Label>
                                            <Input
                                                type="number"
                                                min={1}
                                                inputMode="numeric"
                                                value={installmentCount}
                                                onChange={(event) => setInstallmentCount(Math.max(1, Number(event.target.value || 1)))}
                                            />
                                            {remainingBalance > 0 ? (
                                                <p className="text-[11px] text-muted-foreground">
                                                    {formatCurrency(remainingBalance / installmentCount, currency, features.iqd_display_preference)} / {t('loans.installmentCount', { defaultValue: 'installment' })}
                                                </p>
                                            ) : null}
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>{t('loans.frequency', { defaultValue: 'Frequency' })}</Label>
                                            <Select value={installmentFrequency} onValueChange={(value: InstallmentFrequency) => setInstallmentFrequency(value)}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="weekly">{t('loans.frequencies.weekly', { defaultValue: 'Weekly' })}</SelectItem>
                                                    <SelectItem value="biweekly">{t('loans.frequencies.biweekly', { defaultValue: 'Biweekly' })}</SelectItem>
                                                    <SelectItem value="monthly">{t('loans.frequencies.monthly', { defaultValue: 'Monthly' })}</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>{t('loans.firstDueDate', { defaultValue: 'First Due Date' })}</Label>
                                            <DateTimePicker
                                                id="real-estate-first-due-date"
                                                mode="date"
                                                date={parseLocalDateValue(firstDueDate)}
                                                setDate={(value) => setFirstDueDate(value ? formatLocalDateValue(value) : '')}
                                                placeholder={t('loans.firstDueDate', { defaultValue: 'First Due Date' })}
                                            />
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <div className="grid gap-2">
                                <Label>{t('realEstate.notes', { defaultValue: 'Notes' })}</Label>
                                <Textarea
                                    rows={4}
                                    value={notes}
                                    onChange={(event) => setNotes(event.target.value)}
                                    placeholder={t('realEstate.notesPlaceholder', { defaultValue: 'Property details, contract number, etc.' })}
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="border-t bg-muted/20 px-4 py-4 pb-[calc(1rem+var(--safe-area-bottom))] sm:justify-between sm:px-6">
                        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={isSaving}>
                            {t('common.cancel') || 'Cancel'}
                        </Button>
                        <Button type="submit" className="w-full sm:w-auto" disabled={!canSubmit || isSaving}>
                            {t('common.create') || 'Create'}
                        </Button>
                    </DialogFooter>
                </form>

            <BusinessPartnerFormDialog
                isOpen={isCreateBuyerOpen}
                onOpenChange={setIsCreateBuyerOpen}
                defaultCurrency={features.default_currency}
                availableCurrencies={availableCurrencies}
                initialRole={features.real_estate ? 'buyer' : 'customer'}
                enableRealEstateRoles={features.real_estate}
                isSaving={isSavingBuyer}
                onSubmit={handleCreateBuyerPartner}
            />
            <BusinessPartnerFormDialog
                isOpen={isCreateSellerOpen}
                onOpenChange={setIsCreateSellerOpen}
                defaultCurrency={features.default_currency}
                availableCurrencies={availableCurrencies}
                initialRole={features.real_estate ? 'seller' : 'customer'}
                enableRealEstateRoles={features.real_estate}
                isSaving={isSavingSeller}
                onSubmit={handleCreateSellerPartner}
            />
            </DialogContent>
        </Dialog>
    )
}

function WitnessFields({
    title,
    name,
    address,
    phone,
    onNameChange,
    onAddressChange,
    onPhoneChange
}: {
    title: string
    name: string
    address: string
    phone: string
    onNameChange: (value: string) => void
    onAddressChange: (value: string) => void
    onPhoneChange: (value: string) => void
}) {
    const { t } = useTranslation()

    return (
        <div className="grid gap-3 rounded-2xl border bg-muted/20 p-4">
            <div className="text-sm font-semibold">{title}</div>
            <div className="grid gap-2">
                <Label>{t('common.name', { defaultValue: 'Name' })}</Label>
                <Input value={name} onChange={(event) => onNameChange(event.target.value)} />
            </div>
            <div className="grid gap-2">
                <Label>{t('customers.form.address', { defaultValue: 'Address' })}</Label>
                <Input value={address} onChange={(event) => onAddressChange(event.target.value)} />
            </div>
            <div className="grid gap-2">
                <Label>{t('realEstate.witnessPhone', { defaultValue: 'Phone Number' })}</Label>
                <Input value={phone} onChange={(event) => onPhoneChange(event.target.value)} />
            </div>
        </div>
    )
}

function LinkedPartyBadge({
    label,
    name,
    onClear
}: {
    label: string
    name: string
    onClear: () => void
}) {
    return (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
                <Users className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-primary">{label}</div>
                    <div className="truncate font-medium">{name}</div>
                </div>
            </div>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={onClear}
                aria-label="Clear linked business partner"
            >
                <X className="h-4 w-4" />
            </Button>
        </div>
    )
}
