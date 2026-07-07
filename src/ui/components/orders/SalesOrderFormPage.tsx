import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CalendarDays, CreditCard, Plus, ShoppingCart, Star, Trash2, Truck, Users, X } from 'lucide-react'

import { useAuth } from '@/auth'
import { useDemoTutorial } from '@/demo'
import { useUiAccess } from '@/context/UiAccessContext'
import { isMobile } from '@/lib/platform'
import { getPrioritizedPaymentMethod, setPrioritizedPaymentMethod } from '@/lib/prioritizedPaymentMethod'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { buildOrderExchangeRatesSnapshot, convertCurrencyAmountWithLiveRates, getPrimaryExchangeDetails } from '@/lib/orderCurrency'
import {
    cn,
    formatCurrency,
    formatLocalDateTimeValue,
    formatLocalDateValue,
    formatNumericInput,
    parseLocalDateTimeValue,
    parseLocalDateValue,
    sanitizeNumericInput
} from '@/lib/utils'
import { getOrderLineFreeBonusQuantity } from '@/lib/orderLineItems'
import {
    createSalesOrder,
    getPrimaryStorageFromList,
    updateSalesOrder,
    useBusinessPartners,
    useInventory,
    useProducts,
    useSalesOrder,
    useStorages,
    type BusinessPartner,
    type CurrencyCode,
    type InstallmentFrequency,
    type SalesOrder,
    type SalesOrderItem,
    type SalesOrderStatus
} from '@/local-db'
import { useWorkspace } from '@/workspace'
import { useWorkspacePermissions } from '@/permissions'
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
import { ProductAutocompleteInput } from './ProductAutocompleteInput'
import { LoanPartyPickerDialog } from '@/ui/components/loans/LoanPartyPickerDialog'

interface SalesOrderFormPageProps {
    workspaceId: string
    onCancel: () => void
    onCreated?: (orderId: string) => void
    editingOrderId?: string
}
type FormItem = {
    productId: string
    productSearch: string
    storageId: string
    quantity: string
    freeBonusQuantity: string
    unitPrice: string
}

function createEmptyItem(storageId = ''): FormItem {
    return { productId: '', productSearch: '', storageId, quantity: '1', freeBonusQuantity: '0', unitPrice: '' }
}

function roundFormAmount(value: number) {
    return Math.round(value * 100) / 100
}

const DYNAMIC_UNITS = ['m²', 'Kg']

function isDynamicUnit(unit: string | undefined) {
    return DYNAMIC_UNITS.includes(unit ?? '')
}

function getCommonStorageId(items: Array<{ storageId?: string | null }>, fallbackStorageId = '') {
    const storageIds = Array.from(new Set(items.map((item) => item.storageId || fallbackStorageId).filter(Boolean)))
    return storageIds.length === 1 ? storageIds[0] : null
}

export function SalesOrderFormPage({
    workspaceId,
    onCancel,
    onCreated,
    editingOrderId
}: SalesOrderFormPageProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { features, hasCapability, hasFeature } = useWorkspace()
    const { permissionKeys } = useWorkspacePermissions()
    const { exchangeData, eurRates, tryRates } = useExchangeRate()
    const demoTutorial = useDemoTutorial()

    const products = useProducts(workspaceId)
    const inventory = useInventory(workspaceId)
    const storages = useStorages(workspaceId)
    const customerPartners = useBusinessPartners(workspaceId, { roles: ['customer'] })
    const editingOrder = useSalesOrder(editingOrderId)
    const defaultStorageId = getPrimaryStorageFromList(storages)?.id || ''
    const { isAccessKeyHeld } = useUiAccess()
    const [prioritizedMethod, setPrioritizedMethod] = useState<string | null>(getPrioritizedPaymentMethod)

    const [isSaving, setIsSaving] = useState(false)
    const [customerId, setCustomerId] = useState(editingOrder?.businessPartnerId || editingOrder?.customerId || '')
    const [customerSearch, setCustomerSearch] = useState(editingOrder?.customerName || '')
    const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false)
    const [sourceStorageId, setSourceStorageId] = useState(editingOrder?.sourceStorageId || defaultStorageId)
    const [currency, setCurrency] = useState<CurrencyCode>(editingOrder?.currency || features.default_currency)
    const [shippingAddress, setShippingAddress] = useState(editingOrder?.shippingAddress || '')
    const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(editingOrder?.expectedDeliveryDate ? formatLocalDateTimeValue(editingOrder.expectedDeliveryDate) : '')
    const [discount, setDiscount] = useState(editingOrder?.discount ? String(editingOrder.discount) : '')
    const [tax, setTax] = useState(editingOrder?.tax ? String(editingOrder.tax) : '')
    const [notes, setNotes] = useState(editingOrder?.notes || '')
    const [isPaid, setIsPaid] = useState(editingOrder?.isPaid || false)
    const [paymentMethod, setPaymentMethod] = useState<string>(editingOrder?.paymentMethod || prioritizedMethod || 'cash')
    const [installmentCount, setInstallmentCount] = useState(String(editingOrder?.installmentCount || 3))
    const [installmentFrequency, setInstallmentFrequency] = useState<InstallmentFrequency>(editingOrder?.installmentFrequency || 'monthly')
    const [firstDueDate, setFirstDueDate] = useState(editingOrder?.firstDueDate?.slice(0, 10) || '')
    const [initialPaymentAmount, setInitialPaymentAmount] = useState(
        editingOrder?.initialPaymentAmount ? String(editingOrder.initialPaymentAmount) : ''
    )
    const [items, setItems] = useState<FormItem[]>(() => {
        if (editingOrder) {
            return editingOrder.items.map((item) => {
                const product = products.find((p) => p.id === item.productId)
                return {
                    productId: item.productId,
                    productSearch: product?.name || '',
                    storageId: item.storageId || editingOrder.sourceStorageId || defaultStorageId,
                    quantity: String(item.quantity),
                    freeBonusQuantity: String(getOrderLineFreeBonusQuantity(item)),
                    unitPrice: String(item.convertedUnitPrice)
                }
            })
        }
        return [createEmptyItem(defaultStorageId)]
    })
    const requiresApprovalRequest = user?.role === 'staff' && permissionKeys.includes('orders.requireSalesOrderRequest')
    const canUseFreeBonus = hasCapability('orderFreeBonus')
    const [highlightedStorageIndex, setHighlightedStorageIndex] = useState<number | null>(null)

    useEffect(() => {
        if (!editingOrder) return
        setCustomerId(editingOrder.businessPartnerId || editingOrder.customerId)
        setCustomerSearch(editingOrder.customerName)
        setSourceStorageId(editingOrder.sourceStorageId || defaultStorageId)
        setCurrency(editingOrder.currency)
        setShippingAddress(editingOrder.shippingAddress || '')
        setExpectedDeliveryDate(editingOrder.expectedDeliveryDate ? formatLocalDateTimeValue(editingOrder.expectedDeliveryDate) : '')
        setDiscount(editingOrder.discount ? String(editingOrder.discount) : '')
        setTax(editingOrder.tax ? String(editingOrder.tax) : '')
        setNotes(editingOrder.notes || '')
        setIsPaid(editingOrder.isPaid)
        setPaymentMethod(editingOrder.paymentMethod || 'cash')
        setInstallmentCount(String(editingOrder.installmentCount || 3))
        setInstallmentFrequency(editingOrder.installmentFrequency || 'monthly')
        setFirstDueDate(editingOrder.firstDueDate?.slice(0, 10) || '')
        setInitialPaymentAmount(editingOrder.initialPaymentAmount ? String(editingOrder.initialPaymentAmount) : '')
        setItems(editingOrder.items.map((item) => {
            const product = products.find((p) => p.id === item.productId)
            return {
                productId: item.productId,
                productSearch: product?.name || '',
                storageId: item.storageId || editingOrder.sourceStorageId || defaultStorageId,
                quantity: String(item.quantity),
                freeBonusQuantity: String(getOrderLineFreeBonusQuantity(item)),
                unitPrice: String(item.convertedUnitPrice)
            }
        }))
    }, [defaultStorageId, editingOrder])

    const liveRates = useMemo(() => ({ exchangeData, eurRates, tryRates }), [exchangeData, eurRates, tryRates])

    const availableSalesProductIdsByStorage = useMemo(() => {
        const rows = new Map<string, Set<string>>()
        for (const row of inventory) {
            if (row.quantity <= 0) continue
            const current = rows.get(row.storageId) ?? new Set<string>()
            current.add(row.productId)
            rows.set(row.storageId, current)
        }
        return rows
    }, [inventory])

    const selectedCustomer = customerPartners.find((entry) => entry.id === customerId)
    const inventoryByStorageProduct = useMemo(() => new Map(
        inventory.map((row) => [`${row.storageId}:${row.productId}`, row.quantity])
    ), [inventory])

    const getAvailableQuantity = (productId: string, storageId: string) => {
        if (!productId || !storageId) return 0
        return inventoryByStorageProduct.get(`${storageId}:${productId}`) ?? 0
    }

    const getSalesProductOptions = (storageId: string, selectedProductId: string) => {
        const availableIds = availableSalesProductIdsByStorage.get(storageId) ?? new Set<string>()
        return products.filter((product) => product.id === selectedProductId || availableIds.has(product.id))
    }

    const applyDefaultItemPrice = (productId: string, partnerCurrency: CurrencyCode) => {
        const product = products.find((entry) => entry.id === productId)
        if (!product) return ''
        return String(convertCurrencyAmountWithLiveRates(product.price, product.currency, partnerCurrency, liveRates))
    }

    const handleStorageMissing = useCallback((index: number) => {
        setHighlightedStorageIndex(index)
        setTimeout(() => setHighlightedStorageIndex((prev) => prev === index ? null : prev), 3000)
        const el = document.getElementById(`sales-storage-${index}`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [])

    const updateItem = (index: number, changes: Partial<FormItem>) => {
        setItems((current) =>
            current.map((item, itemIndex) => {
                if (itemIndex !== index) return item
                const next = { ...item, ...changes }
                if (changes.productId && (!item.unitPrice || changes.productId !== item.productId)) {
                    next.unitPrice = applyDefaultItemPrice(changes.productId, currency)
                }
                return next
            })
        )
    }

    const preview = useMemo(() => {
        const subtotal = items.reduce((sum, item) => sum + ((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)), 0)
        const total = subtotal - Number(discount || 0) + Number(tax || 0)
        return roundFormAmount(total)
    }, [currency, discount, items, tax])

    const configuredItemsCount = useMemo(
        () => items.filter((item) => item.productId && Number(item.quantity) > 0).length,
        [items]
    )

    const initialPayment = roundFormAmount(Math.max(0, Number(initialPaymentAmount || 0)))
    const isFinanced = paymentMethod === 'loan' || paymentMethod === 'installments'
    const isInstallmentBased = paymentMethod === 'installments'
    const canSubmit = Boolean(selectedCustomer) &&
        items.some((item) => item.productId && Number(item.quantity) > 0) &&
        (!isFinanced || initialPayment < preview) &&
        (!isInstallmentBased || (
            Number(installmentCount) >= 1
            && Boolean(firstDueDate)
        ))

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!user?.workspaceId || isSaving) return

        const customer = customerPartners.find((entry) => entry.id === customerId)
        if (!customer) {
            toast({ title: t('common.error') || 'Error', description: t('orders.noCustomers') || 'Add customers before creating orders.', variant: 'destructive' })
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
            const orderItems: SalesOrderItem[] = items
                .filter((item) => item.productId && Number(item.quantity) > 0)
                .map((item) => {
                    const product = products.find((entry) => entry.id === item.productId)
                    if (!product) {
                        throw new Error(t('orders.form.errors.productNotFound', { defaultValue: 'Selected product was not found.' }))
                    }
                    if (!item.storageId) {
                        throw new Error(t('orders.form.errors.sourceStorageRequired', {
                            productName: product.name,
                            defaultValue: `Select a source storage for ${product.name}.`
                        }))
                    }

                    const quantity = Number(item.quantity)
                    const freeBonusQuantityValue = Number(item.freeBonusQuantity || 0)
                    const unitPrice = Number(item.unitPrice || 0)
                    if (!Number.isFinite(freeBonusQuantityValue) || freeBonusQuantityValue < 0) {
                        throw new Error(t('orders.form.errors.invalidFreeBonus', {
                            productName: product.name,
                            defaultValue: `Enter a valid free bonus for ${product.name}.`
                        }))
                    }
                    const freeBonusQuantity = freeBonusQuantityValue
                    return {
                        id: `${product.id}-${item.storageId}-${quantity}-${freeBonusQuantity}-${unitPrice}`,
                        productId: product.id,
                        storageId: item.storageId,
                        productName: product.name,
                        productSku: product.sku,
                        quantity,
                        ...(freeBonusQuantity > 0 ? { freeBonusQuantity } : {}),
                        lineTotal: roundFormAmount(quantity * unitPrice),
                        originalCurrency: product.currency,
                        originalUnitPrice: convertCurrencyAmountWithLiveRates(unitPrice, currency, product.currency, liveRates),
                        convertedUnitPrice: roundFormAmount(unitPrice),
                        settlementCurrency: currency,
                        costPrice: product.costPrice,
                        convertedCostPrice: convertCurrencyAmountWithLiveRates(product.costPrice, product.currency, currency, liveRates)
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
            const taxNum = roundFormAmount(Number(tax || 0))
            const total = roundFormAmount(subtotal - discountNum + taxNum)
            const paidAmount = isFinanced ? initialPayment : isPaid ? total : 0
            const balanceAmount = roundFormAmount(Math.max(total - paidAmount, 0))
            const savedAt = new Date().toISOString()

            const payload = {
                businessPartnerId: customer.id,
                customerId: customer.id,
                customerName: customer.name,
                sourceStorageId: commonStorageId,
                items: orderItems,
                subtotal,
                discount: discountNum,
                tax: taxNum,
                total,
                currency,
                exchangeRate: primaryRate?.exchangeRate ?? null,
                exchangeRateSource: primaryRate?.exchangeRateSource ?? null,
                exchangeRateTimestamp: primaryRate?.exchangeRateTimestamp ?? null,
                exchangeRates: hasMultiCurrency ? snapshot : null,
                status: 'draft' as SalesOrderStatus,
                expectedDeliveryDate: expectedDeliveryDate || null,
                actualDeliveryDate: null,
                isPaid: !isFinanced && balanceAmount <= 0,
                paymentStatus: balanceAmount <= 0 ? 'paid' as const : paidAmount > 0 ? 'partial' as const : 'unpaid' as const,
                paidAmount,
                balanceAmount,
                paidAt: !isFinanced && paidAmount > 0 ? savedAt : null,
                paymentMethod: paymentMethod as SalesOrder['paymentMethod'],
                initialPaymentAmount: isFinanced ? initialPayment : 0,
                linkedLoanId: editingOrder?.linkedLoanId || null,
                isInstallmentBased,
                installmentCount: isInstallmentBased ? Math.max(1, Math.trunc(Number(installmentCount) || 1)) : paymentMethod === 'loan' && firstDueDate ? 1 : 0,
                installmentFrequency: isFinanced ? installmentFrequency : null,
                firstDueDate: isFinanced ? firstDueDate || null : null,
                nextDueDate: isFinanced ? firstDueDate || null : null,
                reservedAt: null,
                shippingAddress: shippingAddress || undefined,
                notes: notes || undefined,
                ...(requiresApprovalRequest ? {
                    approvalStatus: 'requested' as const,
                    approvalRequestedBy: user.id,
                    approvalRequestedAt: savedAt,
                    approvalReviewedBy: null,
                    approvalReviewedAt: null
                } : {})
            }

            const savedOrder = editingOrderId
                ? await updateSalesOrder(editingOrderId, payload)
                : await createSalesOrder(workspaceId, payload, user?.id ?? null)

            toast({
                title: requiresApprovalRequest
                    ? t('orders.form.requestSent', { defaultValue: 'Request sent' })
                    : editingOrderId ? (t('common.save') || 'Saved') : (t('common.create') || 'Created')
            })
            if (!editingOrderId) {
                demoTutorial.completeOrderCreated(savedOrder.id, 'sales')
            }
            onCreated?.(savedOrder.id)
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: error?.message || t('orders.form.errors.saveSalesFailed', { defaultValue: 'Failed to save sales order.' }),
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="w-full">
            <form onSubmit={handleSubmit}>
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
                        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight" data-tour-id="tutorial-order-form-title">
                            <ShoppingCart className="h-7 w-7" />
                            {editingOrderId
                                ? t('orders.form.editSalesOrder', { defaultValue: 'Edit Sales Order' })
                                : t('orders.form.newSalesOrder', { defaultValue: 'New Sales Order' })}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {t('orders.form.salesDescription', { defaultValue: 'Create a sales order, assign a customer and products, then reserve stock.' })}
                        </p>
                    </div>
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.95fr)]">
                            <div className="space-y-5">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>{t('orders.form.customerInformation', { defaultValue: 'Customer Information' })}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid gap-4">
                                            <div className="grid gap-2">
                                                <Label>{t('orders.form.customer', { defaultValue: 'Customer' })} <span className="text-destructive">*</span></Label>
                                                <div className="flex flex-col gap-2 md:flex-row md:items-center" data-tour-id="tutorial-order-partner-picker">
                                                    <PartnerAutocompleteInput
                                                        value={customerSearch}
                                                        onChange={(value) => {
                                                            setCustomerSearch(value)
                                                            setCustomerId('')
                                                        }}
                                                        onSelectPartner={(partner: BusinessPartner) => {
                                                            setCustomerSearch(partner.name)
                                                            setCustomerId(partner.id)
                                                            if (partner.defaultCurrency) setCurrency(partner.defaultCurrency)
                                                        }}
                                                        workspaceId={workspaceId}
                                                        roles={['customer']}
                                                        placeholder={t('orders.form.selectCustomer', { defaultValue: 'Select Customer' })}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        className="w-full shrink-0 gap-2 md:w-auto"
                                                        onClick={() => setIsCustomerPickerOpen(true)}
                                                    >
                                                        <Users className="h-4 w-4" />
                                                        {t('loans.selectParty', { defaultValue: 'Business Partner' })}
                                                    </Button>
                                                </div>
                                                {customerId && selectedCustomer ? (
                                                    <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
                                                        <div className="min-w-0">
                                                            <div className="text-[11px] font-bold uppercase tracking-wide text-primary">
                                                                {t('customers.title', { defaultValue: 'Customer' })}
                                                            </div>
                                                            <div className="text-sm font-semibold">{selectedCustomer.name}</div>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 shrink-0 px-2 text-muted-foreground"
                                                            onClick={() => {
                                                                setCustomerId('')
                                                                setCustomerSearch('')
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
                                                    <Truck className="h-4 w-4 text-muted-foreground" />
                                                    {t('orders.form.shippingAddress', { defaultValue: 'Shipping Address' })}
                                                </Label>
                                                <Textarea
                                                    rows={3}
                                                    value={shippingAddress}
                                                    onChange={(event) => setShippingAddress(event.target.value)}
                                                    placeholder={t('orders.form.shippingPlaceholder', { defaultValue: 'Enter shipping address...' })}
                                                />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <LoanPartyPickerDialog
                                    isOpen={isCustomerPickerOpen}
                                    onOpenChange={setIsCustomerPickerOpen}
                                    workspaceId={workspaceId}
                                    roles={['customer']}
                                    selectedPartyId={customerId}
                                    onSelect={(selection) => {
                                        if (selection.linkedPartyId) {
                                            setCustomerId(selection.linkedPartyId)
                                            setCustomerSearch(selection.linkedPartyName || '')
                                            if (selection.defaultCurrency) setCurrency(selection.defaultCurrency)
                                        }
                                        setIsCustomerPickerOpen(false)
                                    }}
                                />

                                <Card>
                                    <CardHeader className="flex flex-col items-start justify-between gap-4 space-y-0 sm:flex-row">
                                        <div className="space-y-1">
                                            <CardTitle>{t('orders.form.lineItems', { defaultValue: 'Line Items' })}</CardTitle>
                                            <p className="text-sm text-muted-foreground">
                                                {t('orders.form.lineItemsDescription', { defaultValue: 'Add products with quantities and prices.' })}
                                            </p>
                                        </div>
                                        <Button type="button" variant="outline" size="sm" onClick={() => setItems((current) => [...current, createEmptyItem(current[current.length - 1]?.storageId || sourceStorageId || defaultStorageId)])}>
                                            <Plus className="mr-1 h-3.5 w-3.5" />
                                            {t('orders.form.addItem', { defaultValue: 'Add Item' })}
                                        </Button>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        {items.map((item, index) => {
                                            const product = products.find((entry) => entry.id === item.productId)
                                            const lineTotal = roundFormAmount((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))
                                            const freeBonusQuantity = Math.max(0, Number(item.freeBonusQuantity || 0))
                                            const inventoryQuantity = (Number(item.quantity) || 0) + (canUseFreeBonus ? freeBonusQuantity : 0)

                                            return (
                                                <div
                                                    key={`sales-item-${index}`}
                                                    className={cn(
                                                        'grid gap-3 rounded-2xl border bg-background p-4',
                                                        canUseFreeBonus
                                                            ? 'md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_110px_110px_140px_40px]'
                                                            : 'md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_110px_140px_40px]'
                                                    )}
                                                >
                                                    <div
                                                        className="space-y-2"
                                                        data-tour-id={index === 0 ? 'tutorial-order-product-picker' : undefined}
                                                        data-demo-product-linked={item.productId ? 'true' : 'false'}
                                                    >
                                                        <Label>{t('orders.form.selectProduct', { defaultValue: 'Select Product' })}</Label>
                                                        <ProductAutocompleteInput
                                                            value={item.productSearch}
                                                            onChange={(value) => updateItem(index, { productSearch: value, productId: '' })}
                                                            onSelectProduct={(product) => updateItem(index, { productId: product.id, productSearch: product.name })}
                                                            products={getSalesProductOptions(item.storageId, item.productId)}
                                                            placeholder={t('orders.form.selectProduct', { defaultValue: 'Select Product' })}
                                                            hasSelection={!!item.productId}
                                                            storageMissing={!item.storageId}
                                                            storageMissingLabel={t('orders.form.selectStorage', { defaultValue: 'Select Storage' })}
                                                            onStorageMissingClick={() => handleStorageMissing(index)}
                                                        />
                                                    </div>
                                                    <div id={`sales-storage-${index}`} className={cn('space-y-2', highlightedStorageIndex === index && 'animate-pulse')} data-tour-id={index === 0 ? 'tutorial-order-storage' : undefined}>
                                                        <Label className={cn(highlightedStorageIndex === index && 'text-destructive font-bold')}>{t('orders.form.selectStorage', { defaultValue: 'Select Storage' })}</Label>
                                                        <Select value={item.storageId} onValueChange={(value) => { setHighlightedStorageIndex(null); updateItem(index, { storageId: value }) }}>
                                                            <SelectTrigger className={cn(highlightedStorageIndex === index && 'ring-2 ring-destructive')}><SelectValue placeholder={t('orders.form.selectStorage', { defaultValue: 'Select Storage' })} /></SelectTrigger>
                                                            <SelectContent>
                                                                {storages.map((storage) => (
                                                                    <SelectItem key={storage.id} value={storage.id}>
                                                                        {storage.isSystem ? (t(`storages.${storage.name.toLowerCase()}`) || storage.name) : storage.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <p className="text-xs text-muted-foreground">
                                                            {item.storageId && item.productId
                                                                ? t('orders.form.availableQuantity', {
                                                                    quantity: getAvailableQuantity(item.productId, item.storageId),
                                                                    defaultValue: `Available: ${getAvailableQuantity(item.productId, item.storageId)}`
                                                                })
                                                                : t('orders.form.chooseSourceStorageForLine', { defaultValue: 'Choose a source storage for this line.' })}
                                                        </p>
                                                    </div>
                                                    <div className="space-y-2" data-tour-id={index === 0 ? 'tutorial-order-quantity' : undefined}>
                                                        <Label>{t('common.quantity', { defaultValue: 'Quantity' })}</Label>
                                                        <div className="flex items-center gap-1">
                                                            <Input type="number" min={isDynamicUnit(product?.unit) ? "0.01" : "1"} step={isDynamicUnit(product?.unit) ? "0.01" : "1"} value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} placeholder={t('common.quantity', { defaultValue: 'Quantity' })} />
                                                            {product?.unit && <span className="text-xs text-muted-foreground shrink-0">{t(`products.units.${product.unit}`, product.unit)}</span>}
                                                        </div>
                                                    </div>
                                                    {canUseFreeBonus ? (
                                                        <div className="space-y-2">
                                                            <Label>{t('orders.form.freeBonus', { defaultValue: 'Free Bonus' })}</Label>
                                                            <div className="flex items-center gap-1">
                                                                <Input
                                                                    type="number"
                                                                    min="0"
                                                                    step={isDynamicUnit(product?.unit) ? '0.01' : '1'}
                                                                    value={item.freeBonusQuantity}
                                                                    onChange={(event) => updateItem(index, { freeBonusQuantity: event.target.value })}
                                                                    placeholder={t('orders.form.freeBonus', { defaultValue: 'Free Bonus' })}
                                                                />
                                                                {product?.unit && <span className="text-xs text-muted-foreground shrink-0">{t(`products.units.${product.unit}`, product.unit)}</span>}
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                    <div className="space-y-2" data-tour-id={index === 0 ? 'tutorial-order-unit-price' : undefined}>
                                                        <Label>{t('common.sellingPrice', { defaultValue: 'Selling Price' })}</Label>
                                                        <Input value={formatNumericInput(item.unitPrice)} onChange={(event) => updateItem(index, { unitPrice: sanitizeNumericInput(event.target.value, { allowDecimal: true, maxFractionDigits: 4 }) })} placeholder={t('common.sellingPrice', { defaultValue: 'Selling Price' })} />
                                                    </div>
                                                    <div className="flex items-start justify-end" data-tour-id={index === 0 ? 'tutorial-order-line-actions' : undefined}>
                                                        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                    <div className={cn('flex items-center justify-between text-xs text-muted-foreground', canUseFreeBonus ? 'md:col-span-6' : 'md:col-span-5')}>
                                                        <span>{product?.sku ? `SKU: ${product.sku}` : '\u00A0'}</span>
                                                        <span>
                                                            {canUseFreeBonus && freeBonusQuantity > 0
                                                                ? `${t('orders.form.inventoryQuantity', { defaultValue: 'Inventory Qty' })}: ${inventoryQuantity} - `
                                                                : ''}
                                                            {(t('orders.form.table.total', { defaultValue: 'Total' }))}: {formatCurrency(lineTotal, currency, features.iqd_display_preference)}
                                                        </span>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </CardContent>
                                </Card>

                                <Card data-tour-id="tutorial-order-notes">
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
                                            <div className="space-y-2" data-tour-id="tutorial-order-date">
                                                <Label htmlFor="sales-delivery" className="flex items-center gap-2">
                                                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                                    {t('orders.form.expectedDelivery', { defaultValue: 'Expected Delivery' })}
                                                </Label>
                                                <DateTimePicker
                                                    id="sales-delivery"
                                                    mode="date-time"
                                                    date={parseLocalDateTimeValue(expectedDeliveryDate)}
                                                    setDate={(value) => setExpectedDeliveryDate(value ? formatLocalDateTimeValue(value) : '')}
                                                    placeholder={t('orders.form.expectedDelivery', { defaultValue: 'Expected Delivery' })}
                                                />
                                            </div>
                                            <div className="space-y-2" data-tour-id="tutorial-order-currency">
                                                <CurrencySelector
                                                    value={currency}
                                                    onChange={(value) => setCurrency(value)}
                                                    label={t('orders.form.currency', { defaultValue: 'Currency' })}
                                                    iqdDisplayPreference={features.iqd_display_preference}
                                                    allowedCurrencies={Array.from(new Set([features.default_currency, ...features.allowed_currencies])) as CurrencyCode[]}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2" data-tour-id="tutorial-order-payment">
                                            <Label htmlFor="sales-payment" className="flex items-center gap-2">
                                                <CreditCard className="h-4 w-4 text-muted-foreground" />
                                                {t('pos.paymentMethod', { defaultValue: 'Payment Method' })}
                                            </Label>
                                            <Select value={paymentMethod} onValueChange={(value) => {
                                                setPaymentMethod(value)
                                                if (value === 'loan' || value === 'installments') setIsPaid(false)
                                            }}>
                                                <SelectTrigger id="sales-payment"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="cash" onPointerDown={(e) => { if ((e.shiftKey || isAccessKeyHeld) && !isMobile()) { if (prioritizedMethod === 'cash') { setPrioritizedPaymentMethod(null); setPrioritizedMethod(null); setPaymentMethod('cash') } else { setPrioritizedPaymentMethod('cash'); setPrioritizedMethod('cash') } } }}>{t('directTransactions.paymentMethod.cash', { defaultValue: 'Cash' })}{prioritizedMethod === 'cash' ? <Star className="ml-2 h-3 w-3 fill-yellow-400 inline" /> : null}</SelectItem>
                                                    <SelectItem value="fib" onPointerDown={(e) => { if ((e.shiftKey || isAccessKeyHeld) && !isMobile()) { if (prioritizedMethod === 'fib') { setPrioritizedPaymentMethod(null); setPrioritizedMethod(null); setPaymentMethod('cash') } else { setPrioritizedPaymentMethod('fib'); setPrioritizedMethod('fib') } } }}>{t('directTransactions.paymentMethod.fib', { defaultValue: 'FIB' })}{prioritizedMethod === 'fib' ? <Star className="ml-2 h-3 w-3 fill-yellow-400 inline" /> : null}</SelectItem>
                                                    <SelectItem value="qicard" onPointerDown={(e) => { if ((e.shiftKey || isAccessKeyHeld) && !isMobile()) { if (prioritizedMethod === 'qicard') { setPrioritizedPaymentMethod(null); setPrioritizedMethod(null); setPaymentMethod('cash') } else { setPrioritizedPaymentMethod('qicard'); setPrioritizedMethod('qicard') } } }}>{t('directTransactions.paymentMethod.qicard', { defaultValue: 'QiCard' })}{prioritizedMethod === 'qicard' ? <Star className="ml-2 h-3 w-3 fill-yellow-400 inline" /> : null}</SelectItem>
                                                    <SelectItem value="zaincash" onPointerDown={(e) => { if ((e.shiftKey || isAccessKeyHeld) && !isMobile()) { if (prioritizedMethod === 'zaincash') { setPrioritizedPaymentMethod(null); setPrioritizedMethod(null); setPaymentMethod('cash') } else { setPrioritizedPaymentMethod('zaincash'); setPrioritizedMethod('zaincash') } } }}>{t('directTransactions.paymentMethod.zaincash', { defaultValue: 'ZainCash' })}{prioritizedMethod === 'zaincash' ? <Star className="ml-2 h-3 w-3 fill-yellow-400 inline" /> : null}</SelectItem>
                                                    <SelectItem value="fastpay" onPointerDown={(e) => { if ((e.shiftKey || isAccessKeyHeld) && !isMobile()) { if (prioritizedMethod === 'fastpay') { setPrioritizedPaymentMethod(null); setPrioritizedMethod(null); setPaymentMethod('cash') } else { setPrioritizedPaymentMethod('fastpay'); setPrioritizedMethod('fastpay') } } }}>{t('directTransactions.paymentMethod.fastpay', { defaultValue: 'FastPay' })}{prioritizedMethod === 'fastpay' ? <Star className="ml-2 h-3 w-3 fill-yellow-400 inline" /> : null}</SelectItem>
                                                    <SelectItem value="bank_transfer" onPointerDown={(e) => { if ((e.shiftKey || isAccessKeyHeld) && !isMobile()) { if (prioritizedMethod === 'bank_transfer') { setPrioritizedPaymentMethod(null); setPrioritizedMethod(null); setPaymentMethod('cash') } else { setPrioritizedPaymentMethod('bank_transfer'); setPrioritizedMethod('bank_transfer') } } }}>{t('directTransactions.paymentMethod.bankTransfer', { defaultValue: 'Bank Transfer' })}{prioritizedMethod === 'bank_transfer' ? <Star className="ml-2 h-3 w-3 fill-yellow-400 inline" /> : null}</SelectItem>
                                                    {hasFeature('loans') ? <SelectItem value="loan" onPointerDown={(e) => { if ((e.shiftKey || isAccessKeyHeld) && !isMobile()) { if (prioritizedMethod === 'loan') { setPrioritizedPaymentMethod(null); setPrioritizedMethod(null); setPaymentMethod('cash') } else { setPrioritizedPaymentMethod('loan'); setPrioritizedMethod('loan') } } }}>{t('nav.loans', { defaultValue: 'Loans' })}{prioritizedMethod === 'loan' ? <Star className="ml-2 h-3 w-3 fill-yellow-400 inline" /> : null}</SelectItem> : null}
                                                    {hasFeature('installments') ? <SelectItem value="installments" onPointerDown={(e) => { if ((e.shiftKey || isAccessKeyHeld) && !isMobile()) { if (prioritizedMethod === 'installments') { setPrioritizedPaymentMethod(null); setPrioritizedMethod(null); setPaymentMethod('cash') } else { setPrioritizedPaymentMethod('installments'); setPrioritizedMethod('installments') } } }}>{t('nav.installments', { defaultValue: 'Installments' })}{prioritizedMethod === 'installments' ? <Star className="ml-2 h-3 w-3 fill-yellow-400 inline" /> : null}</SelectItem> : null}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        {!isFinanced ? <div className="flex items-center justify-between rounded-2xl border bg-muted/20 px-4 py-3" data-tour-id="tutorial-order-paid">
                                            <div>
                                                <div className="text-sm font-medium">{t('orders.form.paidOnSave', { defaultValue: 'Paid on save' })}</div>
                                                <div className="text-xs text-muted-foreground">{t('orders.form.paidOnSaveDescription', { defaultValue: 'Mark the order as already settled.' })}</div>
                                            </div>
                                            <Switch
                                                checked={isPaid}
                                                onCheckedChange={setIsPaid}
                                            />
                                        </div> : null}
                                        {isFinanced ? (
                                            <div className="grid gap-4 rounded-2xl border p-4 sm:grid-cols-2">
                                                {isInstallmentBased ? <><div className="space-y-2">
                                                    <Label htmlFor="sales-installment-count">{t('orders.form.installmentCount', { defaultValue: 'Number of installments' })}</Label>
                                                    <Input
                                                        id="sales-installment-count"
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
                                                    <Label htmlFor="sales-first-due">{isInstallmentBased
                                                        ? t('orders.form.firstDueDate', { defaultValue: 'First due date' })
                                                        : t('orders.form.dueDate', { defaultValue: 'Due date (optional)' })}</Label>
                                                    <DateTimePicker
                                                        id="sales-first-due"
                                                        mode="date"
                                                        date={parseLocalDateValue(firstDueDate)}
                                                        setDate={(value) => setFirstDueDate(formatLocalDateValue(value))}
                                                        placeholder={t('orders.form.firstDueDate', { defaultValue: 'First due date' })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="sales-initial-payment">{t('orders.form.initialPayment', { defaultValue: 'Initial payment' })}</Label>
                                                    <Input
                                                        id="sales-initial-payment"
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

                                <Card data-tour-id="tutorial-order-commercials">
                                    <CardHeader>
                                        <CardTitle>{t('orders.form.commercials', { defaultValue: 'Commercials' })}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="sales-discount">- {t('orders.form.discount', { defaultValue: 'Discount' })}</Label>
                                                <Input id="sales-discount" value={formatNumericInput(discount)} onChange={(event) => setDiscount(sanitizeNumericInput(event.target.value, { allowDecimal: true, maxFractionDigits: 4 }))} />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="sales-tax">+ {t('orders.form.tax', { defaultValue: 'Tax' })}</Label>
                                                <Input id="sales-tax" value={formatNumericInput(tax)} onChange={(event) => setTax(sanitizeNumericInput(event.target.value, { allowDecimal: true, maxFractionDigits: 4 }))} />
                                            </div>
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
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-border/60 shadow-sm">
                                    <CardHeader className="space-y-1">
                                        <CardTitle className="text-xl">{t('common.actions') || 'Actions'}</CardTitle>
                                        <p className="text-sm text-muted-foreground">
                                            {t('orders.form.saveHint', { defaultValue: 'Review the order details, then save or cancel.' })}
                                        </p>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <Button type="submit" className="h-12 w-full rounded-xl font-black" disabled={!canSubmit || isSaving} data-tour-id="tutorial-order-save">
                                            {isSaving
                                                ? (t('common.loading') || 'Loading...')
                                                : requiresApprovalRequest
                                                    ? (editingOrderId
                                                        ? t('orders.form.sendUpdateRequest', { defaultValue: 'Send Update Request' })
                                                        : t('orders.form.sendRequest', { defaultValue: 'Send Request' }))
                                                    : (editingOrderId ? (t('common.save') || 'Save') : (t('orders.form.saveOrder', { defaultValue: 'Save Order' })))}
                                        </Button>
                                        <Button type="button" variant="outline" className="h-12 w-full rounded-xl" onClick={onCancel} disabled={isSaving}>
                                            {t('common.cancel') || 'Cancel'}
                                        </Button>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    </form>
                </div>
            )
}
