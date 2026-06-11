import { type FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CalendarDays, CreditCard, Plus, ShoppingCart, Trash2, Truck, Users, X } from 'lucide-react'

import { useAuth } from '@/auth'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { buildOrderExchangeRatesSnapshot, convertCurrencyAmountWithLiveRates, getPrimaryExchangeDetails } from '@/lib/orderCurrency'
import { formatCurrency, formatLocalDateTimeValue, parseLocalDateTimeValue } from '@/lib/utils'
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
    type SalesOrder,
    type SalesOrderItem,
    type SalesOrderStatus
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

interface SalesOrderFormPageProps {
    workspaceId: string
    onCancel: () => void
    onCreated?: (orderId: string) => void
    editingOrderId?: string
}

type FormItem = {
    productId: string
    storageId: string
    quantity: string
    unitPrice: string
}

function createEmptyItem(storageId = ''): FormItem {
    return { productId: '', storageId, quantity: '1', unitPrice: '' }
}

function roundFormAmount(value: number, currency: CurrencyCode) {
    if (currency === 'iqd') return Math.round(value)
    return Math.round(value * 100) / 100
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
    const { features } = useWorkspace()
    const { exchangeData, eurRates, tryRates } = useExchangeRate()

    const products = useProducts(workspaceId)
    const inventory = useInventory(workspaceId)
    const storages = useStorages(workspaceId)
    const customerPartners = useBusinessPartners(workspaceId, { roles: ['customer'] })
    const editingOrder = useSalesOrder(editingOrderId)
    const defaultStorageId = getPrimaryStorageFromList(storages)?.id || ''

    const [isSaving, setIsSaving] = useState(false)
    const [customerId, setCustomerId] = useState(editingOrder?.businessPartnerId || editingOrder?.customerId || '')
    const [customerSearch, setCustomerSearch] = useState(editingOrder?.customerName || '')
    const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false)
    const [sourceStorageId] = useState(editingOrder?.sourceStorageId || defaultStorageId)
    const [currency, setCurrency] = useState<CurrencyCode>(editingOrder?.currency || features.default_currency)
    const [shippingAddress, setShippingAddress] = useState(editingOrder?.shippingAddress || '')
    const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(editingOrder?.expectedDeliveryDate ? formatLocalDateTimeValue(editingOrder.expectedDeliveryDate) : '')
    const [discount, setDiscount] = useState(editingOrder?.discount ? String(editingOrder.discount) : '')
    const [tax, setTax] = useState(editingOrder?.tax ? String(editingOrder.tax) : '')
    const [notes, setNotes] = useState(editingOrder?.notes || '')
    const [isPaid, setIsPaid] = useState(editingOrder?.isPaid || false)
    const [paymentMethod, setPaymentMethod] = useState<string>(editingOrder?.paymentMethod || 'cash')
    const [items, setItems] = useState<FormItem[]>(() => {
        if (editingOrder) {
            return editingOrder.items.map((item) => ({
                productId: item.productId,
                storageId: item.storageId || editingOrder.sourceStorageId || defaultStorageId,
                quantity: String(item.quantity),
                unitPrice: String(item.convertedUnitPrice)
            }))
        }
        return [createEmptyItem(defaultStorageId)]
    })

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
        return roundFormAmount(total, currency)
    }, [currency, discount, items, tax])

    const configuredItemsCount = useMemo(
        () => items.filter((item) => item.productId && Number(item.quantity) > 0).length,
        [items]
    )

    const canSubmit = Boolean(selectedCustomer) &&
        items.some((item) => item.productId && Number(item.quantity) > 0) &&
        (!isPaid || paymentMethod !== 'credit')

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!user?.workspaceId || isSaving) return

        const customer = customerPartners.find((entry) => entry.id === customerId)
        if (!customer) {
            toast({ title: t('common.error') || 'Error', description: t('orders.noCustomers') || 'Add customers before creating orders.', variant: 'destructive' })
            return
        }
        if (isPaid && paymentMethod === 'credit') {
            toast({ title: t('common.error') || 'Error', description: 'Select an actual payment method for paid orders.', variant: 'destructive' })
            return
        }

        setIsSaving(true)
        try {
            const snapshot = buildOrderExchangeRatesSnapshot(liveRates)
            const orderItems: SalesOrderItem[] = items
                .filter((item) => item.productId && Number(item.quantity) > 0)
                .map((item) => {
                    const product = products.find((entry) => entry.id === item.productId)
                    if (!product) throw new Error('Selected product was not found')
                    if (!item.storageId) throw new Error(`Select a source storage for ${product.name}`)

                    const quantity = Number(item.quantity)
                    const unitPrice = Number(item.unitPrice || 0)
                    return {
                        id: `${product.id}-${item.storageId}-${quantity}-${unitPrice}`,
                        productId: product.id,
                        storageId: item.storageId,
                        productName: product.name,
                        productSku: product.sku,
                        quantity,
                        lineTotal: roundFormAmount(quantity * unitPrice, currency),
                        originalCurrency: product.currency,
                        originalUnitPrice: convertCurrencyAmountWithLiveRates(unitPrice, currency, product.currency, liveRates),
                        convertedUnitPrice: roundFormAmount(unitPrice, currency),
                        settlementCurrency: currency,
                        costPrice: product.costPrice,
                        convertedCostPrice: convertCurrencyAmountWithLiveRates(product.costPrice, product.currency, currency, liveRates)
                    }
                })

            if (orderItems.length === 0) throw new Error('Add at least one item')
            const commonStorageId = getCommonStorageId(orderItems)
            const subtotal = roundFormAmount(orderItems.reduce((sum, item) => sum + item.lineTotal, 0), currency)
            const discountNum = roundFormAmount(Number(discount || 0), currency)
            const taxNum = roundFormAmount(Number(tax || 0), currency)
            const total = roundFormAmount(subtotal - discountNum + taxNum, currency)
            const primaryRate = getPrimaryExchangeDetails(currency, features.default_currency, snapshot)

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
                exchangeRate: primaryRate.exchangeRate,
                exchangeRateSource: primaryRate.exchangeRateSource,
                exchangeRateTimestamp: primaryRate.exchangeRateTimestamp,
                exchangeRates: snapshot,
                status: 'draft' as SalesOrderStatus,
                expectedDeliveryDate: expectedDeliveryDate || null,
                actualDeliveryDate: null,
                isPaid,
                paidAt: isPaid ? new Date().toISOString() : null,
                paymentMethod: isPaid ? (paymentMethod as SalesOrder['paymentMethod']) : 'credit',
                reservedAt: null,
                shippingAddress: shippingAddress || undefined,
                notes: notes || undefined
            }

            if (editingOrderId) {
                await updateSalesOrder(editingOrderId, payload)
            } else {
                await createSalesOrder(workspaceId, payload)
            }

            toast({ title: editingOrderId ? (t('common.save') || 'Saved') : (t('common.create') || 'Created') })
            onCreated?.(editingOrderId || '')
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: error?.message || 'Failed to save sales order',
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
                                        ? t('orders.form.editSalesOrder', { defaultValue: 'Edit Sales Order' })
                                        : t('orders.form.newSalesOrder', { defaultValue: 'New Sales Order' })}
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    {t('orders.form.salesDescription', { defaultValue: 'Create a sales order, assign a customer and products, then reserve stock.' })}
                                </p>
                            </div>
                        </div>

                        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.95fr)]">
                            <div className="space-y-5">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>{t('orders.form.customerInformation', { defaultValue: 'Customer Information' })}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid gap-4">
                                            <div className="grid gap-2">
                                                <Label>{t('orders.form.customer', { defaultValue: 'Customer' })} <span className="text-destructive">*</span></Label>
                                                <div className="flex flex-col gap-2 md:flex-row md:items-center">
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
                                            const lineTotal = roundFormAmount((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), currency)

                                            return (
                                                <div key={`sales-item-${index}`} className="grid gap-3 rounded-2xl border bg-background p-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_110px_140px_40px]">
                                                    <div className="space-y-2">
                                                        <Label className="md:hidden">{t('orders.form.table.product', { defaultValue: 'Product' })}</Label>
                                                        <Select value={item.productId} onValueChange={(value) => updateItem(index, { productId: value })}>
                                                            <SelectTrigger><SelectValue placeholder={t('orders.form.selectProduct', { defaultValue: 'Select Product' })} /></SelectTrigger>
                                                            <SelectContent>
                                                                {getSalesProductOptions(item.storageId, item.productId).map((productOption) => (
                                                                    <SelectItem key={productOption.id} value={productOption.id}>{productOption.name}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="md:hidden">{t('orders.form.sourceStorage', { defaultValue: 'Source Storage' })}</Label>
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
                                                            {item.storageId && item.productId
                                                                ? `Available: ${getAvailableQuantity(item.productId, item.storageId)}`
                                                                : 'Choose a storage for this line.'}
                                                        </p>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="md:hidden">{t('orders.form.table.qty', { defaultValue: 'Qty' })}</Label>
                                                        <Input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} placeholder={t('common.quantity', { defaultValue: 'Quantity' })} />
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
                                                <Label htmlFor="sales-delivery" className="flex items-center gap-2">
                                                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                                    {t('orders.form.date', { defaultValue: 'Expected Delivery' })}
                                                </Label>
                                                <DateTimePicker
                                                    id="sales-delivery"
                                                    mode="date-time"
                                                    date={parseLocalDateTimeValue(expectedDeliveryDate)}
                                                    setDate={(value) => setExpectedDeliveryDate(value ? formatLocalDateTimeValue(value) : '')}
                                                    placeholder={t('orders.form.date', { defaultValue: 'Date' })}
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
                                            <Label htmlFor="sales-payment" className="flex items-center gap-2">
                                                <CreditCard className="h-4 w-4 text-muted-foreground" />
                                                {t('pos.paymentMethod', { defaultValue: 'Payment Method' })}
                                            </Label>
                                            <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value)}>
                                                <SelectTrigger id="sales-payment"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="cash">{t('directTransactions.paymentMethod.cash', { defaultValue: 'Cash' })}</SelectItem>
                                                    <SelectItem value="fib">{t('directTransactions.paymentMethod.fib', { defaultValue: 'FIB' })}</SelectItem>
                                                    <SelectItem value="qicard">{t('directTransactions.paymentMethod.qicard', { defaultValue: 'QiCard' })}</SelectItem>
                                                    <SelectItem value="zaincash">{t('directTransactions.paymentMethod.zaincash', { defaultValue: 'ZainCash' })}</SelectItem>
                                                    <SelectItem value="fastpay">{t('directTransactions.paymentMethod.fastpay', { defaultValue: 'FastPay' })}</SelectItem>
                                                    <SelectItem value="credit">Credit</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="flex items-center justify-between rounded-2xl border bg-muted/20 px-4 py-3">
                                            <div>
                                                <div className="text-sm font-medium">{t('orders.form.paidOnSave', { defaultValue: 'Paid on save' })}</div>
                                                <div className="text-xs text-muted-foreground">{t('orders.form.paidOnSaveDescription', { defaultValue: 'Mark the order as already settled.' })}</div>
                                            </div>
                                            <Switch checked={isPaid} onCheckedChange={setIsPaid} />
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle>{t('orders.form.commercials', { defaultValue: 'Commercials' })}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="sales-discount">{t('orders.form.discount', { defaultValue: 'Discount' })}</Label>
                                                <Input id="sales-discount" type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="sales-tax">{t('orders.form.tax', { defaultValue: 'Tax' })}</Label>
                                                <Input id="sales-tax" type="number" min="0" step="0.01" value={tax} onChange={(event) => setTax(event.target.value)} />
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
