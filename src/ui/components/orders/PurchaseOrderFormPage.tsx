import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CalendarDays, CreditCard, PackagePlus, Plus, ShoppingCart, Trash2, Users, Warehouse, X } from 'lucide-react'

import { useAuth } from '@/auth'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { buildOrderExchangeRatesSnapshot, convertCurrencyAmountWithLiveRates, getPrimaryExchangeDetails } from '@/lib/orderCurrency'
import {
    formatCurrency,
    formatLocalDateTimeValue,
    formatLocalDateValue,
    generateId,
    parseLocalDateTimeValue,
    parseLocalDateValue
} from '@/lib/utils'
import {
    createPurchaseOrder,
    getPrimaryStorageFromList,
    shouldCreatePurchaseCostBatch,
    updatePurchaseOrder,
    useBusinessPartners,
    useProducts,
    usePurchaseOrder,
    useStorages,
    type BusinessPartner,
    type CurrencyCode,
    type InstallmentFrequency,
    type PurchaseOrder,
    type PurchaseOrderItem,
    type PurchaseOrderStatus
} from '@/local-db'
import { useWorkspace } from '@/workspace'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CurrencySelector,
    DateTimePicker,
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
import { LoanPartyPickerDialog } from '@/ui/components/loans/LoanPartyPickerDialog'

interface PurchaseOrderFormPageProps {
    workspaceId: string
    onCancel: () => void
    onCreated?: (orderId: string) => void
    editingOrderId?: string
}

type FormItem = {
    id: string
    productId: string
    storageId: string
    quantity: string
    unitPrice: string
    batchNumber: string
    batchSalePrice: string
    batchExpiryDate: string
    batchManufacturingDate: string
}

function createEmptyItem(storageId = ''): FormItem {
    return {
        id: generateId(),
        productId: '',
        storageId,
        quantity: '1',
        unitPrice: '',
        batchNumber: '',
        batchSalePrice: '',
        batchExpiryDate: '',
        batchManufacturingDate: ''
    }
}

function roundFormAmount(value: number) {
    return Math.round(value * 100) / 100
}

function getCommonStorageId(items: Array<{ storageId?: string | null }>, fallbackStorageId = '') {
    const storageIds = Array.from(new Set(items.map((item) => item.storageId || fallbackStorageId).filter(Boolean)))
    return storageIds.length === 1 ? storageIds[0] : null
}

const DYNAMIC_UNITS = ['m²', 'Kg']

function isDynamicUnit(unit: string | undefined) {
    return DYNAMIC_UNITS.includes(unit ?? '')
}

export function PurchaseOrderFormPage({
    workspaceId,
    onCancel,
    onCreated,
    editingOrderId
}: PurchaseOrderFormPageProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { features, hasFeature } = useWorkspace()
    const { exchangeData, eurRates, tryRates } = useExchangeRate()

    const products = useProducts(workspaceId)
    const storages = useStorages(workspaceId)
    const supplierPartners = useBusinessPartners(workspaceId, { roles: ['supplier'] })
    const editingOrder = usePurchaseOrder(editingOrderId)
    const defaultStorageId = getPrimaryStorageFromList(storages)?.id || ''

    const [isSaving, setIsSaving] = useState(false)
    const [supplierId, setSupplierId] = useState(editingOrder?.businessPartnerId || editingOrder?.supplierId || '')
    const [supplierSearch, setSupplierSearch] = useState(editingOrder?.supplierName || '')
    const [isSupplierPickerOpen, setIsSupplierPickerOpen] = useState(false)
    const [destinationStorageId, setDestinationStorageId] = useState(editingOrder?.destinationStorageId || defaultStorageId)
    const [currency, setCurrency] = useState<CurrencyCode>(editingOrder?.currency || features.default_currency)
    const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(editingOrder?.expectedDeliveryDate ? formatLocalDateTimeValue(editingOrder.expectedDeliveryDate) : '')
    const [discount, setDiscount] = useState(editingOrder?.discount ? String(editingOrder.discount) : '')
    const [notes, setNotes] = useState(editingOrder?.notes || '')
    const [isPaid, setIsPaid] = useState(editingOrder?.isPaid || false)
    const [paymentMethod, setPaymentMethod] = useState<string>(editingOrder?.paymentMethod || 'cash')
    const [installmentCount, setInstallmentCount] = useState(String(editingOrder?.installmentCount || 3))
    const [installmentFrequency, setInstallmentFrequency] = useState<InstallmentFrequency>(editingOrder?.installmentFrequency || 'monthly')
    const [firstDueDate, setFirstDueDate] = useState(editingOrder?.firstDueDate?.slice(0, 10) || '')
    const [initialPaymentAmount, setInitialPaymentAmount] = useState(
        editingOrder?.initialPaymentAmount ? String(editingOrder.initialPaymentAmount) : ''
    )
    const [items, setItems] = useState<FormItem[]>(() => {
        if (editingOrder) {
            return editingOrder.items.map((item) => ({
                id: item.id || generateId(),
                productId: item.productId,
                storageId: item.storageId || editingOrder.destinationStorageId || defaultStorageId,
                quantity: String(item.quantity),
                unitPrice: String(item.convertedUnitPrice),
                batchNumber: item.batchNumber || '',
                batchSalePrice: item.batchSalePrice == null ? '' : String(item.batchSalePrice),
                batchExpiryDate: item.batchExpiryDate || '',
                batchManufacturingDate: item.batchManufacturingDate || ''
            }))
        }
        return [createEmptyItem(defaultStorageId)]
    })

    useEffect(() => {
        if (!editingOrder) return
        setSupplierId(editingOrder.businessPartnerId || editingOrder.supplierId)
        setSupplierSearch(editingOrder.supplierName)
        setDestinationStorageId(editingOrder.destinationStorageId || defaultStorageId)
        setCurrency(editingOrder.currency)
        setExpectedDeliveryDate(editingOrder.expectedDeliveryDate ? formatLocalDateTimeValue(editingOrder.expectedDeliveryDate) : '')
        setDiscount(editingOrder.discount ? String(editingOrder.discount) : '')
        setNotes(editingOrder.notes || '')
        setIsPaid(editingOrder.isPaid)
        setPaymentMethod(editingOrder.paymentMethod || 'cash')
        setInstallmentCount(String(editingOrder.installmentCount || 3))
        setInstallmentFrequency(editingOrder.installmentFrequency || 'monthly')
        setFirstDueDate(editingOrder.firstDueDate?.slice(0, 10) || '')
        setInitialPaymentAmount(editingOrder.initialPaymentAmount ? String(editingOrder.initialPaymentAmount) : '')
        setItems(editingOrder.items.map((item) => ({
            id: item.id || generateId(),
            productId: item.productId,
            storageId: item.storageId || editingOrder.destinationStorageId || defaultStorageId,
            quantity: String(item.quantity),
            unitPrice: String(item.convertedUnitPrice),
            batchNumber: item.batchNumber || '',
            batchSalePrice: item.batchSalePrice == null ? '' : String(item.batchSalePrice),
            batchExpiryDate: item.batchExpiryDate || '',
            batchManufacturingDate: item.batchManufacturingDate || ''
        })))
    }, [defaultStorageId, editingOrder])

    const liveRates = useMemo(() => ({ exchangeData, eurRates, tryRates }), [exchangeData, eurRates, tryRates])

    const selectedSupplier = supplierPartners.find((entry) => entry.id === supplierId)

    const getStorageDisplayName = (storageId: string) => {
        const storage = storages.find((entry) => entry.id === storageId)
        if (!storage) return t('orders.form.selectStorage', { defaultValue: 'Select Storage' })
        return storage.isSystem ? (t(`storages.${storage.name.toLowerCase()}`) || storage.name) : storage.name
    }

    const applyDefaultItemPrice = (productId: string, partnerCurrency: CurrencyCode) => {
        const product = products.find((entry) => entry.id === productId)
        if (!product) return ''
        return String(convertCurrencyAmountWithLiveRates(product.costPrice, product.currency, partnerCurrency, liveRates))
    }

    const updateItem = (index: number, changes: Partial<FormItem>) => {
        setItems((current) =>
            current.map((item, itemIndex) => {
                if (itemIndex !== index) return item
                const next = { ...item, ...changes }
                if (changes.productId && (!item.unitPrice || changes.productId !== item.productId)) {
                    next.unitPrice = applyDefaultItemPrice(changes.productId, currency)
                    const product = products.find((entry) => entry.id === changes.productId)
                    next.batchSalePrice = product ? String(product.price) : ''
                }
                return next
            })
        )
    }

    const preview = useMemo(() => {
        const subtotal = items.reduce((sum, item) => sum + ((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)), 0)
        const total = subtotal - Number(discount || 0)
        return roundFormAmount(total)
    }, [currency, discount, items])

    const configuredItemsCount = useMemo(
        () => items.filter((item) => item.productId && Number(item.quantity) > 0).length,
        [items]
    )

    const selectedStorageName = getStorageDisplayName(destinationStorageId)

    const initialPayment = roundFormAmount(Math.max(0, Number(initialPaymentAmount || 0)))
    const isFinanced = paymentMethod === 'loan' || paymentMethod === 'installments'
    const isInstallmentBased = paymentMethod === 'installments'
    const canSubmit = Boolean(selectedSupplier) &&
        items.some((item) => item.productId && Number(item.quantity) > 0) &&
        (!isFinanced || initialPayment < preview) &&
        (!isInstallmentBased || (
            Number(installmentCount) >= 1
            && Boolean(firstDueDate)
        ))

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!user?.workspaceId || isSaving) return

        const supplier = supplierPartners.find((entry) => entry.id === supplierId)
        if (!supplier) {
            toast({
                title: t('common.error') || 'Error',
                description: t('orders.form.errors.noSuppliers', { defaultValue: 'Add suppliers before creating purchase orders.' }),
                variant: 'destructive'
            })
            return
        }
        if (isFinanced && initialPayment >= preview) {
            toast({
                title: t('common.error') || 'Error',
                description: t('orders.form.errors.installmentBalanceRequired', { defaultValue: 'The initial payment must be less than the order total.' }),
                variant: 'destructive'
            })
            return
        }

        setIsSaving(true)
        try {
            const orderItems: PurchaseOrderItem[] = items
                .filter((item) => item.productId && Number(item.quantity) > 0)
                .map((item) => {
                    const product = products.find((entry) => entry.id === item.productId)
                    if (!product) {
                        throw new Error(t('orders.form.errors.productNotFound', { defaultValue: 'Selected product was not found.' }))
                    }
                    if (!item.storageId) {
                        throw new Error(t('orders.form.errors.targetStorageRequired', {
                            productName: product.name,
                            defaultValue: `Select a target storage for ${product.name}.`
                        }))
                    }

                    const quantity = Number(item.quantity)
                    const unitPrice = Number(item.unitPrice || 0)
                    const batchSalePrice = item.batchSalePrice === '' ? null : Number(item.batchSalePrice)
                    if (batchSalePrice !== null && (!Number.isFinite(batchSalePrice) || batchSalePrice < 0)) {
                        throw new Error(t('orders.form.errors.invalidBatchSalePrice', {
                            productName: product.name,
                            defaultValue: `Enter a valid batch selling price for ${product.name}.`
                        }))
                    }
                    return {
                        id: item.id,
                        productId: product.id,
                        storageId: item.storageId,
                        productName: product.name,
                        productSku: product.sku,
                        quantity,
                        lineTotal: roundFormAmount(quantity * unitPrice),
                        originalCurrency: product.currency,
                        originalUnitPrice: convertCurrencyAmountWithLiveRates(unitPrice, currency, product.currency, liveRates),
                        convertedUnitPrice: roundFormAmount(unitPrice),
                        settlementCurrency: currency,
                        batchNumber: item.batchNumber.trim() || null,
                        batchSalePrice,
                        batchExpiryDate: item.batchExpiryDate || null,
                        batchManufacturingDate: item.batchManufacturingDate || null
                    }
                })

            if (orderItems.length === 0) {
                throw new Error(t('orders.form.errors.atLeastOneItem', { defaultValue: 'Add at least one item.' }))
            }
            const hasMultiCurrency = orderItems.some(item => item.originalCurrency !== item.settlementCurrency)
            const snapshot = hasMultiCurrency ? buildOrderExchangeRatesSnapshot(liveRates) : []
            const primaryRate = hasMultiCurrency ? getPrimaryExchangeDetails(currency, features.default_currency, snapshot) : null
            const commonStorageId = getCommonStorageId(orderItems)
            const subtotal = roundFormAmount(orderItems.reduce((sum, item) => sum + item.lineTotal, 0))
            const discountNum = roundFormAmount(Number(discount || 0))
            const total = roundFormAmount(subtotal - discountNum)
            const paidAmount = isFinanced ? initialPayment : isPaid ? total : 0
            const balanceAmount = roundFormAmount(Math.max(total - paidAmount, 0))

            const payload = {
                businessPartnerId: supplier.id,
                supplierId: supplier.id,
                supplierName: supplier.name,
                destinationStorageId: commonStorageId,
                items: orderItems,
                subtotal,
                discount: discountNum,
                total,
                currency,
                exchangeRate: primaryRate?.exchangeRate ?? null,
                exchangeRateSource: primaryRate?.exchangeRateSource ?? null,
                exchangeRateTimestamp: primaryRate?.exchangeRateTimestamp ?? null,
                exchangeRates: hasMultiCurrency ? snapshot : null,
                status: 'draft' as PurchaseOrderStatus,
                expectedDeliveryDate: expectedDeliveryDate || null,
                actualDeliveryDate: null,
                isPaid: !isFinanced && balanceAmount <= 0,
                paymentStatus: balanceAmount <= 0 ? 'paid' as const : paidAmount > 0 ? 'partial' as const : 'unpaid' as const,
                paidAmount,
                balanceAmount,
                paidAt: !isFinanced && paidAmount > 0 ? new Date().toISOString() : null,
                paymentMethod: paymentMethod as PurchaseOrder['paymentMethod'],
                initialPaymentAmount: isFinanced ? initialPayment : 0,
                linkedLoanId: editingOrder?.linkedLoanId || null,
                isInstallmentBased,
                installmentCount: isInstallmentBased ? Math.max(1, Math.trunc(Number(installmentCount) || 1)) : paymentMethod === 'loan' && firstDueDate ? 1 : 0,
                installmentFrequency: isFinanced ? installmentFrequency : null,
                firstDueDate: isFinanced ? firstDueDate || null : null,
                nextDueDate: isFinanced ? firstDueDate || null : null,
                notes: notes || undefined
            }

            const savedOrder = editingOrderId
                ? await updatePurchaseOrder(editingOrderId, payload)
                : await createPurchaseOrder(workspaceId, payload, user?.id ?? null)

            toast({ title: editingOrderId ? (t('common.save') || 'Saved') : (t('common.create') || 'Created') })
            onCreated?.(savedOrder.id)
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: error?.message || t('orders.form.errors.savePurchaseFailed', { defaultValue: 'Failed to save purchase order.' }),
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background">
            <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar">
                    <div className="space-y-5 pb-5">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto gap-2 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                                    onClick={onCancel}
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    {t('orders.title', { defaultValue: 'Orders' })}
                                </Button>
                                <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                                    <ShoppingCart className="h-7 w-7" />
                                    {editingOrderId
                                        ? t('orders.form.editPurchaseOrder', { defaultValue: 'Edit Purchase Order' })
                                        : t('orders.form.newPurchaseOrder', { defaultValue: 'New Purchase Order' })}
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    {t('orders.form.purchaseDescription', { defaultValue: 'Create a purchase order, assign a supplier and products, then post stock on receipt.' })}
                                </p>
                            </div>
                        </div>

                        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.95fr)]">
                            <div className="space-y-5">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>{t('orders.form.supplierInformation', { defaultValue: 'Supplier Information' })}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid gap-4">
                                            <div className="grid gap-2">
                                                <Label>{t('orders.form.supplier', { defaultValue: 'Supplier' })} <span className="text-destructive">*</span></Label>
                                                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                                                    <PartnerAutocompleteInput
                                                        value={supplierSearch}
                                                        onChange={(value) => {
                                                            setSupplierSearch(value)
                                                            setSupplierId('')
                                                        }}
                                                        onSelectPartner={(partner: BusinessPartner) => {
                                                            setSupplierSearch(partner.name)
                                                            setSupplierId(partner.id)
                                                            if (partner.defaultCurrency) setCurrency(partner.defaultCurrency)
                                                        }}
                                                        workspaceId={workspaceId}
                                                        roles={['supplier']}
                                                        placeholder={t('orders.form.selectSupplier', { defaultValue: 'Select Supplier' })}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        className="w-full shrink-0 gap-2 md:w-auto"
                                                        onClick={() => setIsSupplierPickerOpen(true)}
                                                    >
                                                        <Users className="h-4 w-4" />
                                                        {t('loans.selectParty', { defaultValue: 'Business Partner' })}
                                                    </Button>
                                                </div>
                                                {supplierId && selectedSupplier ? (
                                                    <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
                                                        <div className="min-w-0">
                                                            <div className="text-[11px] font-bold uppercase tracking-wide text-primary">
                                                                {t('suppliers.title', { defaultValue: 'Supplier' })}
                                                            </div>
                                                            <div className="text-sm font-semibold">{selectedSupplier.name}</div>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 shrink-0 px-2 text-muted-foreground"
                                                            onClick={() => {
                                                                setSupplierId('')
                                                                setSupplierSearch('')
                                                            }}
                                                        >
                                                            <X className="h-4 w-4" />
                                                            {t('loans.clearParty', { defaultValue: 'Clear Link' })}
                                                        </Button>
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="grid gap-2">
                                                <Label className="flex items-center gap-2">
                                                    <Warehouse className="h-4 w-4 text-muted-foreground" />
                                                    {t('orders.form.destinationStorage', { defaultValue: 'Target Storage' })} <span className="text-destructive">*</span>
                                                </Label>
                                                <Select value={destinationStorageId} onValueChange={setDestinationStorageId}>
                                                    <SelectTrigger><SelectValue placeholder={t('orders.form.selectStorage', { defaultValue: 'Select Storage' })} /></SelectTrigger>
                                                    <SelectContent>
                                                        {storages.map((storage) => (
                                                            <SelectItem key={storage.id} value={storage.id}>
                                                                {storage.isSystem ? (t(`storages.${storage.name.toLowerCase()}`) || storage.name) : storage.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <p className="text-xs text-muted-foreground">
                                                    {t('orders.form.destinationStorageHint', { defaultValue: 'Stock will be added to this storage when the order is completed.' })}
                                                </p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <LoanPartyPickerDialog
                                    isOpen={isSupplierPickerOpen}
                                    onOpenChange={setIsSupplierPickerOpen}
                                    workspaceId={workspaceId}
                                    roles={['supplier']}
                                    selectedPartyId={supplierId}
                                    onSelect={(selection) => {
                                        if (selection.linkedPartyId) {
                                            setSupplierId(selection.linkedPartyId)
                                            setSupplierSearch(selection.linkedPartyName || '')
                                            if (selection.defaultCurrency) setCurrency(selection.defaultCurrency)
                                        }
                                        setIsSupplierPickerOpen(false)
                                    }}
                                />

                                <Card>
                                    <CardHeader className="flex flex-col items-start justify-between gap-4 space-y-0 sm:flex-row">
                                        <div className="space-y-1">
                                            <CardTitle>{t('orders.form.lineItems', { defaultValue: 'Line Items' })}</CardTitle>
                                            <p className="text-sm text-muted-foreground">
                                                {t('orders.form.purchaseLineItemsDescription', { defaultValue: 'Add products with quantities and cost prices.' })}
                                            </p>
                                        </div>
                                        <Button type="button" variant="outline" size="sm" onClick={() => setItems((current) => [...current, createEmptyItem(destinationStorageId || defaultStorageId)])}>
                                            <Plus className="mr-1 h-3.5 w-3.5" />
                                            {t('orders.form.addItem', { defaultValue: 'Add Item' })}
                                        </Button>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        {items.map((item, index) => {
                                            const product = products.find((entry) => entry.id === item.productId)
                                            const lineTotal = roundFormAmount((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))
                                            const createsBatch = product
                                                ? shouldCreatePurchaseCostBatch(
                                                    convertCurrencyAmountWithLiveRates(
                                                        Number(item.unitPrice) || 0,
                                                        currency,
                                                        product.currency,
                                                        liveRates
                                                    ),
                                                    product.costPrice,
                                                    product.currency
                                                )
                                                : false

                                            return (
                                                <div key={item.id} className="grid gap-3 rounded-2xl border bg-background p-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_110px_140px_40px]">
                                                    <div className="space-y-2">
                                                        <Label className="md:hidden">{t('orders.form.table.product', { defaultValue: 'Product' })}</Label>
                                                        <Select value={item.productId} onValueChange={(value) => updateItem(index, { productId: value })}>
                                                            <SelectTrigger><SelectValue placeholder={t('orders.form.selectProduct', { defaultValue: 'Select Product' })} /></SelectTrigger>
                                                            <SelectContent>
                                                                {products.map((productOption) => (
                                                                    <SelectItem key={productOption.id} value={productOption.id}>{productOption.name}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="md:hidden">{t('orders.form.destinationStorage', { defaultValue: 'Target Storage' })}</Label>
                                                        <Select value={item.storageId} onValueChange={(value) => updateItem(index, { storageId: value })}>
                                                            <SelectTrigger><SelectValue placeholder={t('orders.form.selectStorage', { defaultValue: 'Select Storage' })} /></SelectTrigger>
                                                            <SelectContent>
                                                                {storages.map((storage) => (
                                                                    <SelectItem key={storage.id} value={storage.id}>
                                                                        {storage.isSystem ? (t(`storages.${storage.name.toLowerCase()}`) || storage.name) : storage.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <p className="text-xs text-muted-foreground">
                                                            {item.storageId
                                                                ? t('orders.form.receiveIntoStorageHint', {
                                                                    storageName: getStorageDisplayName(item.storageId),
                                                                    defaultValue: `Will be received into ${getStorageDisplayName(item.storageId)} when the order is completed.`
                                                                })
                                                                : t('orders.form.chooseTargetStorageForLine', { defaultValue: 'Choose a target storage for this line.' })}
                                                        </p>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="md:hidden">{t('orders.form.table.qty', { defaultValue: 'Qty' })}</Label>
                                                        <div className="flex items-center gap-1">
                                                            <Input type="number" min={isDynamicUnit(product?.unit) ? "0.01" : "1"} step={isDynamicUnit(product?.unit) ? "0.01" : "1"} value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} placeholder={t('common.quantity', { defaultValue: 'Quantity' })} />
                                                            {product?.unit && <span className="text-xs text-muted-foreground shrink-0">{t(`products.units.${product.unit}`, product.unit)}</span>}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="md:hidden">{t('orders.form.table.price', { defaultValue: 'Unit Price' })}</Label>
                                                        <Input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(index, { unitPrice: event.target.value })} placeholder={t('common.price', { defaultValue: 'Price' })} />
                                                    </div>
                                                    <div className="flex items-start justify-end">
                                                        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                    <div className="flex items-center justify-between text-xs text-muted-foreground md:col-span-5">
                                                        <span>{product?.sku ? `SKU: ${product.sku}` : '\u00A0'}</span>
                                                        <span>{(t('orders.form.table.total', { defaultValue: 'Total' }))}: {formatCurrency(lineTotal, currency, features.iqd_display_preference)}</span>
                                                    </div>
                                                    {createsBatch && <div className="grid gap-3 border-t pt-3 md:col-span-5 md:grid-cols-4">
                                                        <div className="space-y-2">
                                                            <Label>{t('orders.form.batchNumber', { defaultValue: 'Batch / Lot Number' })}</Label>
                                                            <Input
                                                                value={item.batchNumber}
                                                                onChange={(event) => updateItem(index, { batchNumber: event.target.value })}
                                                                placeholder={t('orders.form.autoGenerated', { defaultValue: 'Auto-generated' })}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>
                                                                {t('orders.form.batchSalePrice', { defaultValue: 'Batch Selling Price' })}
                                                                {product ? ` (${product.currency.toUpperCase()})` : ''}
                                                            </Label>
                                                            <Input
                                                                type="number"
                                                                min="0"
                                                                step="0.01"
                                                                value={item.batchSalePrice}
                                                                onChange={(event) => updateItem(index, { batchSalePrice: event.target.value })}
                                                                placeholder={product ? String(product.price) : '0'}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>{t('orders.form.manufacturingDate', { defaultValue: 'Manufacturing Date' })}</Label>
                                                            <Input
                                                                type="date"
                                                                value={item.batchManufacturingDate}
                                                                onChange={(event) => updateItem(index, { batchManufacturingDate: event.target.value })}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>{t('orders.form.expiryDate', { defaultValue: 'Expiry Date' })}</Label>
                                                            <Input
                                                                type="date"
                                                                value={item.batchExpiryDate}
                                                                onChange={(event) => updateItem(index, { batchExpiryDate: event.target.value })}
                                                            />
                                                        </div>
                                                    </div>}
                                                </div>
                                            )
                                        })}
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle>{t('orders.form.notes', { defaultValue: 'Notes' })}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <Textarea
                                            rows={4}
                                            value={notes}
                                            onChange={(event) => setNotes(event.target.value)}
                                            placeholder={t('orders.form.notesPlaceholder', { defaultValue: 'Order notes, special instructions...' })}
                                        />
                                    </CardContent>
                                </Card>
                            </div>

                            <div className="space-y-5">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>{t('orders.form.orderDetails', { defaultValue: 'Order Details' })}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="purchase-delivery" className="flex items-center gap-2">
                                                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                                    {t('orders.form.expectedDelivery', { defaultValue: 'Expected Delivery' })}
                                                </Label>
                                                <DateTimePicker
                                                    id="purchase-delivery"
                                                    mode="date-time"
                                                    date={parseLocalDateTimeValue(expectedDeliveryDate)}
                                                    setDate={(value) => setExpectedDeliveryDate(value ? formatLocalDateTimeValue(value) : '')}
                                                    placeholder={t('orders.form.expectedDelivery', { defaultValue: 'Expected Delivery' })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <CurrencySelector
                                                    value={currency}
                                                    onChange={(value) => setCurrency(value)}
                                                    label={t('orders.form.currency', { defaultValue: 'Currency' })}
                                                    iqdDisplayPreference={features.iqd_display_preference}
                                                    allowedCurrencies={Array.from(new Set([features.default_currency, ...features.allowed_currencies])) as CurrencyCode[]}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="purchase-payment" className="flex items-center gap-2">
                                                <CreditCard className="h-4 w-4 text-muted-foreground" />
                                                {t('pos.paymentMethod', { defaultValue: 'Payment Method' })}
                                            </Label>
                                            <Select value={paymentMethod} onValueChange={(value) => {
                                                setPaymentMethod(value)
                                                if (value === 'loan' || value === 'installments') setIsPaid(false)
                                            }}>
                                                <SelectTrigger id="purchase-payment"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="cash">{t('directTransactions.paymentMethod.cash', { defaultValue: 'Cash' })}</SelectItem>
                                                    <SelectItem value="fib">{t('directTransactions.paymentMethod.fib', { defaultValue: 'FIB' })}</SelectItem>
                                                    <SelectItem value="qicard">{t('directTransactions.paymentMethod.qicard', { defaultValue: 'QiCard' })}</SelectItem>
                                                    <SelectItem value="zaincash">{t('directTransactions.paymentMethod.zaincash', { defaultValue: 'ZainCash' })}</SelectItem>
                                                    <SelectItem value="fastpay">{t('directTransactions.paymentMethod.fastpay', { defaultValue: 'FastPay' })}</SelectItem>
                                                    <SelectItem value="bank_transfer">{t('directTransactions.paymentMethod.bankTransfer', { defaultValue: 'Bank Transfer' })}</SelectItem>
                                                    {hasFeature('loans') ? <SelectItem value="loan">{t('nav.loans', { defaultValue: 'Loans' })}</SelectItem> : null}
                                                    {hasFeature('installments') ? <SelectItem value="installments">{t('nav.installments', { defaultValue: 'Installments' })}</SelectItem> : null}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        {!isFinanced ? <div className="flex items-center justify-between rounded-2xl border bg-muted/20 px-4 py-3">
                                            <div>
                                                <div className="text-sm font-medium">{t('orders.form.paidOnSave', { defaultValue: 'Paid on save' })}</div>
                                                <div className="text-xs text-muted-foreground">{t('orders.form.paidOnSaveDescription', { defaultValue: 'Record the order as already settled.' })}</div>
                                            </div>
                                            <Switch
                                                checked={isPaid}
                                                onCheckedChange={setIsPaid}
                                            />
                                        </div> : null}
                                        {isFinanced ? (
                                            <div className="grid gap-4 rounded-2xl border p-4 sm:grid-cols-2">
                                                {isInstallmentBased ? <><div className="space-y-2">
                                                    <Label htmlFor="purchase-installment-count">{t('orders.form.installmentCount', { defaultValue: 'Number of installments' })}</Label>
                                                    <Input
                                                        id="purchase-installment-count"
                                                        type="number"
                                                        min="1"
                                                        max="120"
                                                        value={installmentCount}
                                                        onChange={(event) => setInstallmentCount(event.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>{t('orders.form.installmentFrequency', { defaultValue: 'Frequency' })}</Label>
                                                    <Select value={installmentFrequency} onValueChange={(value) => setInstallmentFrequency(value as InstallmentFrequency)}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="weekly">{t('orders.form.weekly', { defaultValue: 'Weekly' })}</SelectItem>
                                                            <SelectItem value="biweekly">{t('orders.form.biweekly', { defaultValue: 'Every two weeks' })}</SelectItem>
                                                            <SelectItem value="monthly">{t('orders.form.monthly', { defaultValue: 'Monthly' })}</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div></> : null}
                                                <div className="space-y-2">
                                                    <Label htmlFor="purchase-first-due">{isInstallmentBased
                                                        ? t('orders.form.firstDueDate', { defaultValue: 'First due date' })
                                                        : t('orders.form.dueDate', { defaultValue: 'Due date (optional)' })}</Label>
                                                    <DateTimePicker
                                                        id="purchase-first-due"
                                                        mode="date"
                                                        date={parseLocalDateValue(firstDueDate)}
                                                        setDate={(value) => setFirstDueDate(formatLocalDateValue(value))}
                                                        placeholder={t('orders.form.firstDueDate', { defaultValue: 'First due date' })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="purchase-initial-payment">{t('orders.form.initialPayment', { defaultValue: 'Initial payment' })}</Label>
                                                    <Input
                                                        id="purchase-initial-payment"
                                                        type="number"
                                                        min="0"
                                                        max={preview}
                                                        step={currency === 'iqd' ? '1' : '0.01'}
                                                        value={initialPaymentAmount}
                                                        onChange={(event) => setInitialPaymentAmount(event.target.value)}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between text-sm sm:col-span-2">
                                                    <span className="text-muted-foreground">{t('orders.form.financedBalance', { defaultValue: 'Financed balance' })}</span>
                                                    <span className="font-semibold">
                                                        {formatCurrency(Math.max(preview - initialPayment, 0), currency, features.iqd_display_preference)}
                                                    </span>
                                                </div>
                                            </div>
                                        ) : null}
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle>{t('orders.form.commercials', { defaultValue: 'Commercials' })}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="purchase-discount">{t('orders.form.discount', { defaultValue: 'Discount' })}</Label>
                                            <Input id="purchase-discount" type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
                                        </div>
                                        <div className="rounded-2xl border bg-muted/30 p-4">
                                            <div className="flex items-center justify-between text-sm">
                                                <span>{t('orders.form.itemsConfigured', { defaultValue: 'Items configured' })}</span>
                                                <span className="font-semibold">{configuredItemsCount}</span>
                                            </div>
                                            <div className="mt-2 flex items-center justify-between text-sm">
                                                <span>{t('pos.paymentMethod', { defaultValue: 'Payment Method' })}</span>
                                                <span className="font-medium capitalize">{paymentMethod}</span>
                                            </div>
                                            <div className="mt-2 flex items-center justify-between text-sm">
                                                <span>{t('common.total', { defaultValue: 'Total' })}</span>
                                                <span className="text-xl font-black">{formatCurrency(preview, currency, features.iqd_display_preference)}</span>
                                            </div>
                                            <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                                                <PackagePlus className="mt-0.5 h-4 w-4" />
                                                <span>{t('orders.form.completionHint', {
                                                    storageName: selectedStorageName,
                                                    defaultValue: `Completing this order will add stock to ${selectedStorageName}.`
                                                })}</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-shrink-0 border-t bg-background/95 px-4 py-2 backdrop-blur lg:px-6">
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onCancel} disabled={isSaving}>
                            {t('common.cancel') || 'Cancel'}
                        </Button>
                        <Button type="submit" className="w-full sm:w-auto" disabled={!canSubmit || isSaving}>
                            {isSaving
                                ? (t('common.loading') || 'Loading...')
                                : (editingOrderId ? (t('common.save') || 'Save') : (t('orders.form.saveOrder', { defaultValue: 'Save Order' })))}
                        </Button>
                    </div>
                </div>
            </form>
        </div>
    )
}
