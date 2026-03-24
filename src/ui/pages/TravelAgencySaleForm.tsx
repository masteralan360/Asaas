import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarDays, Camera, CircleDollarSign, Plane, Plus, Trash2, Upload, UserRound, UsersRound } from 'lucide-react'
import { useLocation, useRoute } from 'wouter'

import { useAuth } from '@/auth'
import {
    createSupplier,
    createTravelAgencySale,
    updateTravelAgencySale,
    useSuppliers,
    useTravelAgencySale,
    type CurrencyCode,
    type Supplier,
    type TravelAgencyPaymentMethod,
    type TravelAgencyReceiver,
    type TravelAgencySale,
    type TravelAgencyTourist,
    type TravelAgencyTravelMethod,
    type TravelAgencyTripType
} from '@/local-db'
import { travelMethodOptions, travelPaymentMethodOptions, travelReceiverOptions } from '@/lib/travelAgency'
import { cn, formatCurrency, generateId } from '@/lib/utils'
import { TouristMrzScanDialog, type TouristMrzScanMode, type TouristMrzScanResult } from '@/ui/components/travel/TouristMrzScanDialog'
import { useWorkspace } from '@/workspace'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Dialog,
    DialogContent,
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

type TravelPlanFormState = {
    method: TravelAgencyTravelMethod | ''
    departure: string
    arrival: string
    tripType: TravelAgencyTripType
}

type TouristFormState = {
    id: string
    fullName: string
    surname: string
    dateOfBirth: string
    nationality: string
    passportNumber: string
    revenue: string
    notes: string
    travelPlan: TravelPlanFormState
}

type TravelAgencyFormState = {
    saleDate: string
    touristCount: string
    tourists: TouristFormState[]
    groupTravelPlan: TravelPlanFormState
    groupRevenue: string
    supplierId: string
    supplierCost: string
    currency: CurrencyCode
    travelPackages: string[]
    paymentMethod: TravelAgencyPaymentMethod
    receiver: TravelAgencyReceiver
    notes: string
    isPaid: boolean
}

type SupplierQuickCreateState = {
    name: string
    contactName: string
    email: string
    phone: string
    defaultCurrency: CurrencyCode
    notes: string
}

const NO_VALUE = '__none__'
const ADD_SUPPLIER_VALUE = '__add_supplier__'

function createEmptyTravelPlan(): TravelPlanFormState {
    return {
        method: '',
        departure: '',
        arrival: '',
        tripType: 'one_way'
    }
}

function createEmptyTourist(): TouristFormState {
    return {
        id: generateId(),
        fullName: '',
        surname: '',
        dateOfBirth: '',
        nationality: '',
        passportNumber: '',
        revenue: '',
        notes: '',
        travelPlan: createEmptyTravelPlan()
    }
}

function normalizeTourists(count: number, tourists: TouristFormState[]) {
    const nextCount = Math.max(1, count)
    const nextTourists = tourists.slice(0, nextCount)

    while (nextTourists.length < nextCount) {
        nextTourists.push(createEmptyTourist())
    }

    return nextTourists
}

function createInitialForm(defaultCurrency: CurrencyCode): TravelAgencyFormState {
    return {
        saleDate: new Date().toISOString().slice(0, 10),
        touristCount: '1',
        tourists: [createEmptyTourist()],
        groupTravelPlan: createEmptyTravelPlan(),
        groupRevenue: '',
        supplierId: '',
        supplierCost: '',
        currency: defaultCurrency,
        travelPackages: [],
        paymentMethod: 'cash',
        receiver: 'office',
        notes: '',
        isPaid: false
    }
}

function buildTravelPlan(plan: TravelPlanFormState) {
    if (!plan.method) {
        return null
    }

    return {
        method: plan.method,
        departure: plan.method === 'plane' ? plan.departure.trim() || undefined : undefined,
        arrival: plan.method === 'plane' ? plan.arrival.trim() || undefined : undefined,
        tripType: plan.method === 'plane' ? plan.tripType : undefined
    }
}

function mapSaleToForm(sale: TravelAgencySale): TravelAgencyFormState {
    return {
        saleDate: sale.saleDate,
        touristCount: String(sale.touristCount),
        tourists: normalizeTourists(
            sale.touristCount,
            sale.tourists.map((tourist) => ({
                id: tourist.id,
                fullName: tourist.fullName,
                surname: tourist.surname,
                dateOfBirth: tourist.dateOfBirth || '',
                nationality: tourist.nationality || '',
                passportNumber: tourist.passportNumber || '',
                revenue: tourist.revenue ? String(tourist.revenue) : '',
                notes: tourist.notes || '',
                travelPlan: {
                    method: tourist.travelPlan?.method || '',
                    departure: tourist.travelPlan?.departure || '',
                    arrival: tourist.travelPlan?.arrival || '',
                    tripType: tourist.travelPlan?.tripType || 'one_way'
                }
            }))
        ),
        groupTravelPlan: {
            method: sale.groupTravelPlan?.method || '',
            departure: sale.groupTravelPlan?.departure || '',
            arrival: sale.groupTravelPlan?.arrival || '',
            tripType: sale.groupTravelPlan?.tripType || 'one_way'
        },
        groupRevenue: sale.groupRevenue ? String(sale.groupRevenue) : '',
        supplierId: sale.supplierId || '',
        supplierCost: sale.supplierCost ? String(sale.supplierCost) : '',
        currency: sale.currency,
        travelPackages: sale.travelPackages || [],
        paymentMethod: sale.paymentMethod,
        receiver: sale.receiver,
        notes: sale.notes || '',
        isPaid: sale.isPaid
    }
}

function TravelPlanEditor({
    title,
    description,
    value,
    onChange
}: {
    title: string
    description?: string
    value: TravelPlanFormState
    onChange: (nextValue: TravelPlanFormState) => void
}) {
    return (
        <div className="space-y-4 rounded-2xl border border-border/60 bg-background p-4">
            <div className="space-y-1">
                <div className="text-sm font-semibold">{title}</div>
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>

            <div className="space-y-2">
                <Label>Travel Method</Label>
                <Select
                    value={value.method || NO_VALUE}
                    onValueChange={(nextMethod) => onChange({
                        ...value,
                        method: nextMethod === NO_VALUE ? '' : nextMethod as TravelAgencyTravelMethod,
                        departure: nextMethod === 'plane' ? value.departure : '',
                        arrival: nextMethod === 'plane' ? value.arrival : '',
                        tripType: nextMethod === 'plane' ? value.tripType : 'one_way'
                    })}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NO_VALUE}>Not set</SelectItem>
                        {travelMethodOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {value.method === 'plane' && (
                <div className="space-y-4 rounded-2xl bg-muted/30 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Departure</Label>
                            <Input
                                value={value.departure}
                                onChange={(event) => onChange({ ...value, departure: event.target.value })}
                                placeholder="Departure airport or city"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Arrival</Label>
                            <Input
                                value={value.arrival}
                                onChange={(event) => onChange({ ...value, arrival: event.target.value })}
                                placeholder="Arrival airport or city"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Trip Type</Label>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <Button
                                type="button"
                                variant={value.tripType === 'one_way' ? 'default' : 'outline'}
                                onClick={() => onChange({ ...value, tripType: 'one_way' })}
                                className="justify-start"
                            >
                                One-Way
                            </Button>
                            <Button
                                type="button"
                                variant={value.tripType === 'round_trip' ? 'default' : 'outline'}
                                onClick={() => onChange({ ...value, tripType: 'round_trip' })}
                                className="justify-start"
                            >
                                Round-Trip
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function SupplierQuickCreateDialog({
    isOpen,
    onClose,
    defaultCurrency,
    availableCurrencies,
    workspaceId,
    onCreated
}: {
    isOpen: boolean
    onClose: () => void
    defaultCurrency: CurrencyCode
    availableCurrencies: CurrencyCode[]
    workspaceId?: string
    onCreated: (supplier: Supplier) => void
}) {
    const { toast } = useToast()
    const [isSaving, setIsSaving] = useState(false)
    const [formState, setFormState] = useState<SupplierQuickCreateState>({
        name: '',
        contactName: '',
        email: '',
        phone: '',
        defaultCurrency,
        notes: ''
    })

    useEffect(() => {
        if (!isOpen) {
            setFormState({
                name: '',
                contactName: '',
                email: '',
                phone: '',
                defaultCurrency,
                notes: ''
            })
            setIsSaving(false)
        }
    }, [defaultCurrency, isOpen])

    async function handleSubmit(event: FormEvent) {
        event.preventDefault()
        if (!workspaceId) {
            return
        }

        setIsSaving(true)
        try {
            const supplier = await createSupplier(workspaceId, {
                name: formState.name.trim(),
                contactName: formState.contactName.trim() || undefined,
                email: formState.email.trim() || undefined,
                phone: formState.phone.trim() || undefined,
                defaultCurrency: formState.defaultCurrency,
                notes: formState.notes.trim() || undefined,
                address: undefined,
                city: undefined,
                country: undefined,
                creditLimit: 0
            })

            toast({ title: 'Supplier created' })
            onCreated(supplier)
            onClose()
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error?.message || 'Failed to create supplier',
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl rounded-3xl">
                <DialogHeader>
                    <DialogTitle>Add Supplier</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="travel-supplier-name">Company Name</Label>
                            <Input
                                id="travel-supplier-name"
                                value={formState.name}
                                onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="travel-supplier-contact">Contact Name</Label>
                            <Input
                                id="travel-supplier-contact"
                                value={formState.contactName}
                                onChange={(event) => setFormState((current) => ({ ...current, contactName: event.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="travel-supplier-email">Email</Label>
                            <Input
                                id="travel-supplier-email"
                                type="email"
                                value={formState.email}
                                onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="travel-supplier-phone">Phone</Label>
                            <Input
                                id="travel-supplier-phone"
                                value={formState.phone}
                                onChange={(event) => setFormState((current) => ({ ...current, phone: event.target.value }))}
                            />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <Label>Default Currency</Label>
                            <Select
                                value={formState.defaultCurrency}
                                onValueChange={(value) => setFormState((current) => ({ ...current, defaultCurrency: value as CurrencyCode }))}
                            >
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
                        <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="travel-supplier-notes">Notes</Label>
                            <Textarea
                                id="travel-supplier-notes"
                                rows={4}
                                value={formState.notes}
                                onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter className="sm:justify-between">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving ? 'Saving...' : 'Create Supplier'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function TravelAgencySaleEditor({ saleId }: { saleId?: string }) {
    const { user } = useAuth()
    const { features } = useWorkspace()
    const { toast } = useToast()
    const [, navigate] = useLocation()
    const suppliers = useSuppliers(user?.workspaceId)
    const sale = useTravelAgencySale(saleId)
    const isEditing = Boolean(saleId)
    const [packageDraft, setPackageDraft] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [supplierDialogOpen, setSupplierDialogOpen] = useState(false)
    const [mrzDialogState, setMrzDialogState] = useState<{
        touristIndex: number | null
        mode: TouristMrzScanMode
    }>({
        touristIndex: null,
        mode: 'upload'
    })
    const [formState, setFormState] = useState<TravelAgencyFormState>(() => createInitialForm(features.default_currency))

    const availableCurrencies = useMemo(() => {
        const currencies: CurrencyCode[] = ['usd', 'iqd']
        if (features.eur_conversion_enabled) currencies.push('eur')
        if (features.try_conversion_enabled) currencies.push('try')
        return currencies
    }, [features.eur_conversion_enabled, features.try_conversion_enabled])

    const supplierOptions = useMemo(() => {
        if (!formState.supplierId || suppliers.some((supplier) => supplier.id === formState.supplierId)) {
            return suppliers
        }

        return [
            ...suppliers,
            {
                id: formState.supplierId,
                name: sale?.supplierName || 'Archived supplier'
            } as Supplier
        ]
    }, [formState.supplierId, sale?.supplierName, suppliers])

    const computedTotals = useMemo(() => {
        const touristRevenue = formState.tourists.reduce((sum, tourist) => sum + (Number(tourist.revenue) || 0), 0)
        const groupRevenue = Number(formState.groupRevenue) || 0
        const supplierCost = Number(formState.supplierCost) || 0

        return {
            touristRevenue,
            groupRevenue,
            supplierCost,
            totalRevenue: touristRevenue + groupRevenue,
            net: touristRevenue + groupRevenue - supplierCost
        }
    }, [formState.groupRevenue, formState.supplierCost, formState.tourists])

    useEffect(() => {
        if (sale) {
            setFormState(mapSaleToForm(sale))
        }
    }, [sale])

    function updateTourist(index: number, updater: (tourist: TouristFormState) => TouristFormState) {
        setFormState((current) => ({
            ...current,
            tourists: current.tourists.map((tourist, touristIndex) => (
                touristIndex === index ? updater(tourist) : tourist
            ))
        }))
    }

    function handleTouristCountChange(rawValue: string) {
        const nextCount = Math.max(1, Number(rawValue || 1))
        setFormState((current) => ({
            ...current,
            touristCount: String(nextCount),
            tourists: normalizeTourists(nextCount, current.tourists)
        }))
    }

    function addTravelPackage() {
        const normalized = packageDraft.trim()
        if (!normalized) {
            return
        }

        setFormState((current) => ({
            ...current,
            travelPackages: current.travelPackages.includes(normalized)
                ? current.travelPackages
                : [...current.travelPackages, normalized]
        }))
        setPackageDraft('')
    }

    function openMrzDialog(touristIndex: number, mode: TouristMrzScanMode) {
        setMrzDialogState({
            touristIndex,
            mode
        })
    }

    function closeMrzDialog() {
        setMrzDialogState({
            touristIndex: null,
            mode: 'upload'
        })
    }

    function applyMrzResult(result: TouristMrzScanResult) {
        if (mrzDialogState.touristIndex === null) {
            return
        }

        updateTourist(mrzDialogState.touristIndex, (current) => ({
            ...current,
            fullName: result.fullName || current.fullName,
            surname: result.surname || current.surname,
            dateOfBirth: result.dateOfBirth || current.dateOfBirth,
            nationality: result.nationality || current.nationality,
            passportNumber: result.passportNumber || current.passportNumber
        }))

        closeMrzDialog()
    }

    function removeTravelPackage(travelPackage: string) {
        setFormState((current) => ({
            ...current,
            travelPackages: current.travelPackages.filter((entry) => entry !== travelPackage)
        }))
    }

    async function handleSubmit(event: FormEvent) {
        event.preventDefault()
        if (!user?.workspaceId) {
            return
        }

        if (!formState.saleDate) {
            toast({
                title: 'Sale date is required',
                variant: 'destructive'
            })
            return
        }

        setIsSaving(true)
        try {
            const touristCount = Math.max(1, Number(formState.touristCount || 1))
            const normalizedTourists = normalizeTourists(touristCount, formState.tourists).map((tourist) => ({
                id: tourist.id,
                fullName: tourist.fullName.trim(),
                surname: tourist.surname.trim(),
                dateOfBirth: tourist.dateOfBirth || undefined,
                nationality: tourist.nationality.trim() || undefined,
                passportNumber: tourist.passportNumber.trim() || undefined,
                travelPlan: buildTravelPlan(tourist.travelPlan),
                revenue: Number(tourist.revenue) || 0,
                notes: tourist.notes.trim() || undefined
            })) satisfies TravelAgencyTourist[]

            const selectedSupplier = suppliers.find((supplier) => supplier.id === formState.supplierId)
            const payload = {
                saleDate: formState.saleDate,
                touristCount,
                tourists: normalizedTourists,
                groupTravelPlan: touristCount > 1 ? buildTravelPlan(formState.groupTravelPlan) : null,
                groupRevenue: Number(formState.groupRevenue) || 0,
                supplierId: formState.supplierId || null,
                supplierName: selectedSupplier?.name || sale?.supplierName || null,
                supplierCost: Number(formState.supplierCost) || 0,
                currency: formState.currency,
                travelPackages: formState.travelPackages,
                paymentMethod: formState.paymentMethod,
                receiver: formState.receiver,
                notes: formState.notes.trim() || undefined,
                isPaid: formState.isPaid,
                paidAt: formState.isPaid ? (sale?.paidAt || new Date().toISOString()) : null
            }

            if (isEditing && saleId) {
                await updateTravelAgencySale(saleId, payload)
                toast({ title: 'Travel sale updated' })
            } else {
                await createTravelAgencySale(user.workspaceId, payload)
                toast({ title: 'Travel sale created' })
            }

            navigate('/travel-agency')
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error?.message || 'Failed to save travel sale',
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    if (isEditing && !sale) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <div className="text-sm text-muted-foreground">Loading sale...</div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                    <Button variant="ghost" className="w-fit gap-2 px-0" onClick={() => navigate('/travel-agency')}>
                        <ArrowLeft className="h-4 w-4" />
                        Back to Travel Agency
                    </Button>
                    <div>
                        <h1 className="flex items-center gap-2 text-2xl font-bold">
                            <Plane className="h-6 w-6 text-primary" />
                            {isEditing ? (sale?.saleNumber || 'Edit Travel Sale') : 'New Travel Sale'}
                        </h1>
                        <p className="text-muted-foreground">Date, tourists, packages, supplier cut, and payment details are all saved on this sale.</p>
                    </div>
                </div>
                <div className="rounded-2xl bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
                    Date is user-controlled and never auto-overwritten.
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_380px]">
                    <Card className="border-border/60 shadow-sm">
                        <CardHeader className="space-y-1">
                            <CardTitle className="flex items-center gap-2">
                                <UsersRound className="h-5 w-5 text-primary" />
                                Tourists
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">When tourist count is above one, the sale becomes a group and gets its own travel plan and revenue.</p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="travel-sale-date" className="flex items-center gap-2">
                                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                        Sale Date
                                    </Label>
                                    <Input
                                        id="travel-sale-date"
                                        type="date"
                                        value={formState.saleDate}
                                        onChange={(event) => setFormState((current) => ({ ...current, saleDate: event.target.value }))}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="travel-tourist-count">Tourists Number</Label>
                                    <Input
                                        id="travel-tourist-count"
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={formState.touristCount}
                                        onChange={(event) => handleTouristCountChange(event.target.value)}
                                    />
                                </div>
                            </div>

                            {Number(formState.touristCount) > 1 && (
                                <TravelPlanEditor
                                    title="Group Travel Plan"
                                    description="This group method stays separate from each tourist's own travel method."
                                    value={formState.groupTravelPlan}
                                    onChange={(nextValue) => setFormState((current) => ({ ...current, groupTravelPlan: nextValue }))}
                                />
                            )}

                            {formState.tourists.map((tourist, index) => (
                                <div key={tourist.id} className="space-y-4 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                        <div>
                                            <div className="flex items-center gap-2 text-lg font-semibold">
                                                <UserRound className="h-5 w-5 text-primary" />
                                                Tourist {index + 1}
                                            </div>
                                            <p className="text-sm text-muted-foreground">Fields can stay empty. You can add tourists now and complete their details later.</p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="gap-2"
                                                onClick={() => openMrzDialog(index, 'upload')}
                                            >
                                                <Upload className="h-4 w-4" />
                                                Upload
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="gap-2"
                                                onClick={() => openMrzDialog(index, 'camera')}
                                            >
                                                <Camera className="h-4 w-4" />
                                                Camera
                                            </Button>
                                            <div className="rounded-2xl bg-muted px-3 py-2 text-sm font-medium">
                                                Revenue {formatCurrency(Number(tourist.revenue) || 0, formState.currency, features.iqd_display_preference)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>Full Name</Label>
                                            <Input value={tourist.fullName} onChange={(event) => updateTourist(index, (current) => ({ ...current, fullName: event.target.value }))} placeholder="Given names" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Surname</Label>
                                            <Input value={tourist.surname} onChange={(event) => updateTourist(index, (current) => ({ ...current, surname: event.target.value }))} placeholder="Family name" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Date of Birth</Label>
                                            <Input type="date" value={tourist.dateOfBirth} onChange={(event) => updateTourist(index, (current) => ({ ...current, dateOfBirth: event.target.value }))} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Nationality</Label>
                                            <Input value={tourist.nationality} onChange={(event) => updateTourist(index, (current) => ({ ...current, nationality: event.target.value }))} placeholder="Nationality" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Passport / ID</Label>
                                            <Input value={tourist.passportNumber} onChange={(event) => updateTourist(index, (current) => ({ ...current, passportNumber: event.target.value }))} placeholder="Document number" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Revenue</Label>
                                            <Input type="number" min="0" step="0.01" value={tourist.revenue} onChange={(event) => updateTourist(index, (current) => ({ ...current, revenue: event.target.value }))} placeholder="0.00" />
                                        </div>
                                        <div className="space-y-2 md:col-span-2">
                                            <Label>Notes</Label>
                                            <Textarea rows={2} value={tourist.notes} onChange={(event) => updateTourist(index, (current) => ({ ...current, notes: event.target.value }))} placeholder="Anything specific about this tourist" />
                                        </div>
                                    </div>

                                    <TravelPlanEditor
                                        title={`Tourist ${index + 1} Travel Plan`}
                                        description="This does not get overridden by the group travel method."
                                        value={tourist.travelPlan}
                                        onChange={(nextValue) => updateTourist(index, (current) => ({ ...current, travelPlan: nextValue }))}
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    <div className="space-y-6">
                        <Card className="border-border/60 shadow-sm">
                            <CardHeader className="space-y-1">
                                <CardTitle>Sale Setup</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label>Currency</Label>
                                        <Select value={formState.currency} onValueChange={(value) => setFormState((current) => ({ ...current, currency: value as CurrencyCode }))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {availableCurrencies.map((currency) => (
                                                    <SelectItem key={currency} value={currency}>{currency.toUpperCase()}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Group Revenue</Label>
                                        <Input type="number" min="0" step="0.01" value={formState.groupRevenue} onChange={(event) => setFormState((current) => ({ ...current, groupRevenue: event.target.value }))} placeholder="0.00" />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>Travel Packages</Label>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <Input
                                            value={packageDraft}
                                            onChange={(event) => setPackageDraft(event.target.value)}
                                            placeholder="Add package name, for example Berlin Package"
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault()
                                                    addTravelPackage()
                                                }
                                            }}
                                        />
                                        <Button type="button" className="gap-2" onClick={addTravelPackage}>
                                            <Plus className="h-4 w-4" />
                                            Add Package
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap gap-2 pt-2">
                                        {formState.travelPackages.length === 0 && <span className="text-sm text-muted-foreground">No packages added yet.</span>}
                                        {formState.travelPackages.map((travelPackage) => (
                                            <button key={travelPackage} type="button" onClick={() => removeTravelPackage(travelPackage)} className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                                                {travelPackage}
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>Supplier</Label>
                                    <Select
                                        value={formState.supplierId || NO_VALUE}
                                        onValueChange={(value) => {
                                            if (value === ADD_SUPPLIER_VALUE) {
                                                setSupplierDialogOpen(true)
                                                return
                                            }
                                            setFormState((current) => ({ ...current, supplierId: value === NO_VALUE ? '' : value }))
                                        }}
                                    >
                                        <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={NO_VALUE}>No supplier</SelectItem>
                                            {supplierOptions.map((supplier) => (
                                                <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                                            ))}
                                            <SelectItem value={ADD_SUPPLIER_VALUE}>Add Supplier...</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>Supplier Cost</Label>
                                    <Input type="number" min="0" step="0.01" value={formState.supplierCost} onChange={(event) => setFormState((current) => ({ ...current, supplierCost: event.target.value }))} placeholder="Supplier cut / cost" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Payment Method</Label>
                                    <Select value={formState.paymentMethod} onValueChange={(value) => setFormState((current) => ({ ...current, paymentMethod: value as TravelAgencyPaymentMethod }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {travelPaymentMethodOptions.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Receiver</Label>
                                    <Select value={formState.receiver} onValueChange={(value) => setFormState((current) => ({ ...current, receiver: value as TravelAgencyReceiver }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {travelReceiverOptions.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="flex items-center justify-between rounded-2xl border bg-muted/20 px-4 py-3">
                                    <div>
                                        <div className="text-sm font-medium">Paid on save</div>
                                        <div className="text-xs text-muted-foreground">You can still pay or unpay this sale later from the list page.</div>
                                    </div>
                                    <Switch checked={formState.isPaid} onCheckedChange={(checked) => setFormState((current) => ({ ...current, isPaid: checked }))} />
                                </div>

                                <div className="space-y-2">
                                    <Label>Sale Notes</Label>
                                    <Textarea rows={4} value={formState.notes} onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional notes about this sale" />
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-border/60 shadow-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <CircleDollarSign className="h-5 w-5 text-primary" />
                                    Commercial Summary
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex items-center justify-between text-sm"><span>Tourist Revenue</span><span className="font-semibold">{formatCurrency(computedTotals.touristRevenue, formState.currency, features.iqd_display_preference)}</span></div>
                                <div className="flex items-center justify-between text-sm"><span>Group Revenue</span><span className="font-semibold">{formatCurrency(computedTotals.groupRevenue, formState.currency, features.iqd_display_preference)}</span></div>
                                <div className="flex items-center justify-between text-sm"><span>Supplier Cost</span><span className="font-semibold">{formatCurrency(computedTotals.supplierCost, formState.currency, features.iqd_display_preference)}</span></div>
                                <div className="border-t pt-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">Net</span>
                                        <span className={cn('text-xl font-black', computedTotals.net >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                                            {formatCurrency(computedTotals.net, formState.currency, features.iqd_display_preference)}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:justify-between">
                    <Button type="button" variant="outline" onClick={() => navigate('/travel-agency')}>Cancel</Button>
                    <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : isEditing ? 'Save Sale' : 'Create Sale'}</Button>
                </div>
            </form>

            <SupplierQuickCreateDialog
                isOpen={supplierDialogOpen}
                onClose={() => setSupplierDialogOpen(false)}
                defaultCurrency={formState.currency}
                availableCurrencies={availableCurrencies}
                workspaceId={user?.workspaceId}
                onCreated={(supplier) => setFormState((current) => ({ ...current, supplierId: supplier.id }))}
            />

            <TouristMrzScanDialog
                open={mrzDialogState.touristIndex !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        closeMrzDialog()
                    }
                }}
                touristLabel={mrzDialogState.touristIndex !== null ? `Tourist ${mrzDialogState.touristIndex + 1}` : 'Tourist'}
                initialMode={mrzDialogState.mode}
                onScanned={applyMrzResult}
            />
        </div>
    )
}

export function TravelAgencySaleCreate() {
    return <TravelAgencySaleEditor />
}

export function TravelAgencySaleEdit() {
    const [, params] = useRoute('/travel-agency/:saleId')
    return <TravelAgencySaleEditor saleId={params?.saleId} />
}
