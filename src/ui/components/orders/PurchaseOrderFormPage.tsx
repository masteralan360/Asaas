import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CalendarDays, CreditCard, PackagePlus, Plus, ShoppingCart, Star, Trash2, Users, Warehouse, X } from 'lucide-react'

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
    generateId,
    parseLocalDateTimeValue,
    parseLocalDateValue,
    sanitizeNumericInput
} from '@/lib/utils'
import { getOrderLineFreeBonusQuantity } from '@/lib/orderLineItems'
import { ORDER_DECIMAL_STEP, roundOrderValue } from '@/lib/orderPrecision'
import {
    createPurchaseOrder,
    findPartnerProductPriceBookItem,
    getPrimaryStorageFromList,
    shouldCreatePurchaseCostBatch,
    updatePurchaseOrder,
    useBusinessPartners,
    usePriceBookCatalogState,
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

interface PurchaseOrderFormPageProps {
    workspaceId: string
    onCancel: () => void
    onCreated?: (orderId: string) => void
    editingOrderId?: string
}

type FormItem = {
    id: string
    seq: number
    productId: string
    productSearch: string
    storageId: string
    quantity: string
    freeBonusQuantity: string
    unitPrice: string
    batchNumber: string
    batchSalePrice: string
    batchExpiryDate: string
    batchManufacturingDate: string
    priceBookId: string
    priceBookItemId: string
    priceSourceCurrency: CurrencyCode | ''
}

function createEmptyItem(storageId = '', seq = 1): FormItem {
    return {
        id: generateId(),
        seq,
        productId: '',
        productSearch: '',
        storageId,
        quantity: '1',
        freeBonusQuantity: '0',
        unitPrice: '',
        batchNumber: '',
        batchSalePrice: '',
        batchExpiryDate: '',
        batchManufacturingDate: '',
        priceBookId: '',
        priceBookItemId: '',
        priceSourceCurrency: ''
    }
}

function roundFormAmount(value: number) {
    return roundOrderValue(value)
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
    const { features, hasCapability, hasFeature } = useWorkspace()
    const { permissionKeys } = useWorkspacePermissions()
    const { exchangeData, eurRates, tryRates } = useExchangeRate()
    const demoTutorial = useDemoTutorial()

    const products = useProducts(workspaceId)
    const storages = useStorages(workspaceId)
    const supplierPartners = useBusinessPartners(workspaceId, { roles: ['supplier'] })
    const editingOrder = usePurchaseOrder(editingOrderId)
    const defaultStorageId = getPrimaryStorageFromList(storages)?.id || ''
    const priceBooksEnabled = hasCapability('priceBooks')
    const {
        priceBooks,
        priceBookItems,
        isReady: isPriceBookCatalogReady,
        error: priceBookCatalogError
    } = usePriceBookCatalogState(priceBooksEnabled ? workspaceId : undefined, { enabled: priceBooksEnabled })
    const { isAccessKeyHeld } = useUiAccess()
    const [prioritizedMethod, setPrioritizedMethod] = useState<string | null>(getPrioritizedPaymentMethod)

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
    const [paymentMethod, setPaymentMethod] = useState<string>(editingOrder?.paymentMethod || prioritizedMethod || 'cash')
    const [installmentCount, setInstallmentCount] = useState(String(editingOrder?.installmentCount || 3))
    const [installmentFrequency, setInstallmentFrequency] = useState<InstallmentFrequency>(editingOrder?.installmentFrequency || 'monthly')
    const [firstDueDate, setFirstDueDate] = useState(editingOrder?.firstDueDate?.slice(0, 10) || '')
    const [initialPaymentAmount, setInitialPaymentAmount] = useState(
        editingOrder?.initialPaymentAmount ? String(editingOrder.initialPaymentAmount) : ''
    )
    const [items, setItems] = useState<FormItem[]>(() => {
        if (editingOrder) {
            return editingOrder.items.map((item, idx) => {
                const product = products.find((p) => p.id === item.productId)
                return {
                    id: item.id || generateId(),
                    seq: idx + 1,
                    productId: item.productId,
                    productSearch: product?.name || '',
                    storageId: item.storageId || editingOrder.destinationStorageId || defaultStorageId,
                    quantity: String(item.quantity),
                    freeBonusQuantity: String(getOrderLineFreeBonusQuantity(item)),
                    unitPrice: String(item.convertedUnitPrice),
                    batchNumber: item.batchNumber || '',
                    batchSalePrice: item.batchSalePrice == null ? '' : String(item.batchSalePrice),
                    batchExpiryDate: item.batchExpiryDate || '',
                    batchManufacturingDate: item.batchManufacturingDate || '',
                    priceBookId: item.priceBookId || '',
                    priceBookItemId: item.priceBookItemId || '',
                    priceSourceCurrency: item.priceBookId && item.priceBookItemId ? item.originalCurrency : ''
                }
            })
        }
        return [createEmptyItem(defaultStorageId)]
    })
    const requiresApprovalRequest = user?.role === 'staff' && permissionKeys.includes('orders.requirePurchaseOrderRequest')
    const canUseFreeBonus = hasCapability('orderFreeBonus')
    const [highlightedStorageIndex, setHighlightedStorageIndex] = useState<number | null>(null)
    const [highlightedNewSeq, setHighlightedNewSeq] = useState<number | null>(null)

    useEffect(() => {
        if (highlightedNewSeq == null) return
        const timeout = setTimeout(() => setHighlightedNewSeq(null), 1600)
        return () => clearTimeout(timeout)
    }, [highlightedNewSeq])


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
        setItems(editingOrder.items.map((item, idx) => {
            const product = products.find((p) => p.id === item.productId)
            return {
                id: item.id || generateId(),
                seq: idx + 1,
                productId: item.productId,
                productSearch: product?.name || '',
                storageId: item.storageId || editingOrder.destinationStorageId || defaultStorageId,
                quantity: String(item.quantity),
                freeBonusQuantity: String(getOrderLineFreeBonusQuantity(item)),
                unitPrice: String(item.convertedUnitPrice),
                batchNumber: item.batchNumber || '',
                batchSalePrice: item.batchSalePrice == null ? '' : String(item.batchSalePrice),
                batchExpiryDate: item.batchExpiryDate || '',
                batchManufacturingDate: item.batchManufacturingDate || '',
                priceBookId: item.priceBookId || '',
                priceBookItemId: item.priceBookItemId || '',
                priceSourceCurrency: item.priceBookId && item.priceBookItemId ? item.originalCurrency : ''
            }
        }))
    }, [defaultStorageId, editingOrder])

    useEffect(() => {
        if (!editingOrder || !products.length) return
        setItems((current) => {
            let changed = false
            const next = current.map((item) => {
                if (item.productId && !item.productSearch) {
                    const product = products.find((p) => p.id === item.productId)
                    if (product) {
                        changed = true
                        return { ...item, productSearch: product.name }
                    }
                }
                return item
            })
            return changed ? next : current
        })
    }, [products, editingOrder])

    const liveRates = useMemo(() => ({ exchangeData, eurRates, tryRates }), [exchangeData, eurRates, tryRates])

    const selectedSupplier = supplierPartners.find((entry) => entry.id === supplierId)

    const getPriceBookItemForPartner = useCallback((partner: Pick<BusinessPartner, 'priceBookId'> | null | undefined, productId: string) =>
        findPartnerProductPriceBookItem(
            priceBooksEnabled,
            partner,
            productId,
            priceBooks,
            priceBookItems
        ),
    [priceBookItems, priceBooks, priceBooksEnabled])

    const getStorageDisplayName = (storageId: string) => {
        const storage = storages.find((entry) => entry.id === storageId)
        if (!storage) return t('orders.form.selectStorage', { defaultValue: 'Select Storage' })
        return storage.isSystem ? (t(`storages.${storage.name.toLowerCase()}`) || storage.name) : storage.name
    }

    const resolveItemPricing = useCallback((
        productId: string,
        partnerCurrency: CurrencyCode,
        partner: Pick<BusinessPartner, 'priceBookId'> | null | undefined
    ): Pick<FormItem, 'unitPrice' | 'batchSalePrice' | 'priceBookId' | 'priceBookItemId' | 'priceSourceCurrency'> => {
        const product = products.find((entry) => entry.id === productId)
        if (!product) {
            return {
                unitPrice: '',
                batchSalePrice: '',
                priceBookId: '',
                priceBookItemId: '',
                priceSourceCurrency: ''
            }
        }

        const priceBookItem = getPriceBookItemForPartner(partner, productId)
        if (priceBookItem) {
            return {
                unitPrice: String(convertCurrencyAmountWithLiveRates(
                    priceBookItem.costPrice,
                    priceBookItem.currency,
                    partnerCurrency,
                    liveRates
                )),
                batchSalePrice: String(convertCurrencyAmountWithLiveRates(
                    priceBookItem.price,
                    priceBookItem.currency,
                    product.currency,
                    liveRates
                )),
                priceBookId: priceBookItem.priceBookId,
                priceBookItemId: priceBookItem.id,
                priceSourceCurrency: priceBookItem.currency
            }
        }

        return {
            unitPrice: String(convertCurrencyAmountWithLiveRates(product.costPrice, product.currency, partnerCurrency, liveRates)),
            batchSalePrice: String(product.price),
            priceBookId: '',
            priceBookItemId: '',
            priceSourceCurrency: ''
        }
    }, [getPriceBookItemForPartner, liveRates, products])

    const selectSupplierPartner = useCallback((partner: Pick<BusinessPartner, 'id' | 'name' | 'defaultCurrency' | 'priceBookId'>) => {
        const nextCurrency = partner.defaultCurrency || currency
        setSupplierSearch(partner.name)
        setSupplierId(partner.id)
        setCurrency(nextCurrency)
        if (priceBooksEnabled) {
            setItems((current) => current.map((item) => item.productId
                ? { ...item, ...resolveItemPricing(item.productId, nextCurrency, partner) }
                : item
            ))
        }
    }, [currency, priceBooksEnabled, resolveItemPricing])

    const handleStorageMissing = useCallback((index: number) => {
        setHighlightedStorageIndex(index)
        setTimeout(() => setHighlightedStorageIndex((prev) => prev === index ? null : prev), 3000)
        const el = document.getElementById(`purchase-storage-${index}`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [])

    const updateItem = (index: number, changes: Partial<FormItem>) => {
        setItems((current) =>
            current.map((item, itemIndex) => {
                if (itemIndex !== index) return item
                if (priceBooksEnabled && changes.productId && !selectedSupplier) return item
                const next = { ...item, ...changes }
                if (changes.productId && (!item.unitPrice || changes.productId !== item.productId)) {
                    Object.assign(next, resolveItemPricing(changes.productId, currency, selectedSupplier))
                } else if (changes.productId !== undefined && !changes.productId) {
                    next.priceBookId = ''
                    next.priceBookItemId = ''
                    next.priceSourceCurrency = ''
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
        (!priceBooksEnabled || isPriceBookCatalogReady) &&
        (!isFinanced || initialPayment < preview) &&
        (!isInstallmentBased || (
            Number(installmentCount) >= 1
            && Boolean(firstDueDate)
        ))

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (priceBooksEnabled && !isPriceBookCatalogReady) return
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
            let usesPriceBookPricing = false
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
                    const freeBonusQuantityValue = Number(item.freeBonusQuantity || 0)
                    const hasPriceBookProvenance = Boolean(item.priceBookId && item.priceBookItemId)
                    if (hasPriceBookProvenance) usesPriceBookPricing = true
                    const sourceCurrency = hasPriceBookProvenance && item.priceSourceCurrency
                        ? item.priceSourceCurrency
                        : product.currency
                    const unitPrice = Number(item.unitPrice || 0)
                    if (!Number.isFinite(freeBonusQuantityValue) || freeBonusQuantityValue < 0) {
                        throw new Error(t('orders.form.errors.invalidFreeBonus', {
                            productName: product.name,
                            defaultValue: `Enter a valid free bonus for ${product.name}.`
                        }))
                    }
                    const freeBonusQuantity = freeBonusQuantityValue
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
                        priceBookId: hasPriceBookProvenance ? item.priceBookId : null,
                        priceBookItemId: hasPriceBookProvenance ? item.priceBookItemId : null,
                        storageId: item.storageId,
                        productName: product.name,
                        productSku: product.sku,
                        quantity,
                        ...(freeBonusQuantity > 0 ? { freeBonusQuantity } : {}),
                        lineTotal: roundFormAmount(quantity * unitPrice),
                        originalCurrency: sourceCurrency,
                        originalUnitPrice: convertCurrencyAmountWithLiveRates(
                            unitPrice,
                            currency,
                            sourceCurrency,
                            liveRates
                        ),
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
            const snapshot = hasMultiCurrency || usesPriceBookPricing ? buildOrderExchangeRatesSnapshot(liveRates) : []
            const primaryRate = hasMultiCurrency ? getPrimaryExchangeDetails(currency, features.default_currency, snapshot) : null
            const commonStorageId = getCommonStorageId(orderItems)
            const subtotal = roundFormAmount(orderItems.reduce((sum, item) => sum + item.lineTotal, 0))
            const discountNum = roundFormAmount(Number(discount || 0))
            const total = roundFormAmount(subtotal - discountNum)
            const paidAmount = isFinanced ? initialPayment : isPaid ? total : 0
            const balanceAmount = roundFormAmount(Math.max(total - paidAmount, 0))
            const savedAt = new Date().toISOString()

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
                paidAt: !isFinanced && paidAmount > 0 ? savedAt : null,
                paymentMethod: paymentMethod as PurchaseOrder['paymentMethod'],
                initialPaymentAmount: isFinanced ? initialPayment : 0,
                linkedLoanId: editingOrder?.linkedLoanId || null,
                isInstallmentBased,
                installmentCount: isInstallmentBased ? Math.max(1, Math.trunc(Number(installmentCount) || 1)) : paymentMethod === 'loan' && firstDueDate ? 1 : 0,
                installmentFrequency: isFinanced ? installmentFrequency : null,
                firstDueDate: isFinanced ? firstDueDate || null : null,
                nextDueDate: isFinanced ? firstDueDate || null : null,
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
                ? await updatePurchaseOrder(editingOrderId, payload)
                : await createPurchaseOrder(workspaceId, payload, user?.id ?? null)

            toast({
                title: requiresApprovalRequest
                    ? t('orders.form.requestSent', { defaultValue: 'Request sent' })
                    : editingOrderId ? (t('common.save') || 'Saved') : (t('common.create') || 'Created')
            })
            if (!editingOrderId) {
                demoTutorial.completeOrderCreated(savedOrder.id, 'purchase')
            }
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
                                ? t('orders.form.editPurchaseOrder', { defaultValue: 'Edit Purchase Order' })
                                : t('orders.form.newPurchaseOrder', { defaultValue: 'New Purchase Order' })}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {t('orders.form.purchaseDescription', { defaultValue: 'Create a purchase order, assign a supplier and products, then post stock on receipt.' })}
                        </p>
                    </div>
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.95fr)]">
                            <div className="space-y-5">
                                <Card>
                                    <CardHeader>
                                        <CardTitle>{t('orders.form.supplierInformation', { defaultValue: 'Supplier Information' })}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid gap-4">
                                            <div className="grid gap-2">
                                                <Label>{t('orders.form.supplier', { defaultValue: 'Supplier' })} <span className="text-destructive">*</span></Label>
                                                <div className="flex flex-col gap-2 md:flex-row md:items-center" data-tour-id="tutorial-order-partner-picker">
                                                    <PartnerAutocompleteInput
                                                        value={supplierSearch}
                                                        onChange={(value) => {
                                                            setSupplierSearch(value)
                                                            setSupplierId('')
                                                        }}
                                                        onSelectPartner={(partner: BusinessPartner) => {
                                                            selectSupplierPartner(partner)
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
                                            const partner = supplierPartners.find((entry) => entry.id === selection.linkedPartyId)
                                            if (partner) {
                                                selectSupplierPartner(partner)
                                            } else {
                                                selectSupplierPartner({
                                                    id: selection.linkedPartyId,
                                                    name: selection.linkedPartyName || '',
                                                    defaultCurrency: selection.defaultCurrency,
                                                    priceBookId: null
                                                })
                                            }
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
                                        <Button type="button" variant="outline" size="sm" onClick={() => setItems((current) => {
                                            const nextSeq = current.reduce((max, it) => Math.max(max, it.seq), 0) + 1
                                            setHighlightedNewSeq(nextSeq)
                                            return [createEmptyItem(destinationStorageId || defaultStorageId, nextSeq), ...current]
                                        })}>
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
                                                ) || (Boolean(item.priceBookId && item.priceBookItemId) && (
                                                    item.batchSalePrice !== ''
                                                    && shouldCreatePurchaseCostBatch(
                                                        Number(item.batchSalePrice),
                                                        product.price,
                                                        product.currency
                                                    )
                                                ))
                                                : false

                                            return (
                                                <div
                                                    key={item.id}
                                                    className={cn(
                                                        'relative grid gap-3 rounded-2xl border bg-background p-4 transition-all duration-700',
                                                        canUseFreeBonus
                                                            ? 'md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_110px_110px_140px_40px]'
                                                            : 'md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_110px_140px_40px]',
                                                        item.seq === highlightedNewSeq && 'border-primary ring-2 ring-primary/60 bg-primary/5'
                                                    )}
                                                >
                                                    <span className="absolute -top-2 start-3 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                                                        {item.seq}
                                                    </span>
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
                                                            products={products}
                                                            disabled={priceBooksEnabled && (!isPriceBookCatalogReady || !selectedSupplier)}
                                                            placeholder={priceBooksEnabled && !selectedSupplier
                                                                ? t('priceBooks.selectPartnerFirst', { defaultValue: 'Select a business partner first' })
                                                                : priceBooksEnabled && priceBookCatalogError
                                                                    ? t('priceBooks.loadingErrorShort', { defaultValue: 'Price Books unavailable - retrying...' })
                                                                    : t('orders.form.selectProduct', { defaultValue: 'Select Product' })}
                                                            hasSelection={!!item.productId}
                                                            storageMissing={!item.storageId}
                                                            storageMissingLabel={t('orders.form.selectStorage', { defaultValue: 'Select Storage' })}
                                                            onStorageMissingClick={() => handleStorageMissing(index)}
                                                        />
                                                    </div>
                                                    <div id={`purchase-storage-${index}`} className={cn('space-y-2', highlightedStorageIndex === index && 'animate-pulse')} data-tour-id={index === 0 ? 'tutorial-order-storage' : undefined}>
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
                                                            {item.storageId
                                                                ? t('orders.form.receiveIntoStorageHint', {
                                                                    storageName: getStorageDisplayName(item.storageId),
                                                                    defaultValue: `Will be received into ${getStorageDisplayName(item.storageId)} when the order is completed.`
                                                                })
                                                                : t('orders.form.chooseTargetStorageForLine', { defaultValue: 'Choose a target storage for this line.' })}
                                                        </p>
                                                    </div>
                                                    <div className="space-y-2" data-tour-id={index === 0 ? 'tutorial-order-quantity' : undefined}>
                                                        <Label>{t('common.quantity', { defaultValue: 'Quantity' })}</Label>
                                                        <div className="flex items-center gap-1">
                                                            <Input type="number" min={isDynamicUnit(product?.unit) ? ORDER_DECIMAL_STEP : "1"} step={isDynamicUnit(product?.unit) ? ORDER_DECIMAL_STEP : "1"} value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} placeholder={t('common.quantity', { defaultValue: 'Quantity' })} />
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
                                                                    step={isDynamicUnit(product?.unit) ? ORDER_DECIMAL_STEP : '1'}
                                                                    value={item.freeBonusQuantity}
                                                                    onChange={(event) => updateItem(index, { freeBonusQuantity: event.target.value })}
                                                                    placeholder={t('orders.form.freeBonus', { defaultValue: 'Free Bonus' })}
                                                                />
                                                                {product?.unit && <span className="text-xs text-muted-foreground shrink-0">{t(`products.units.${product.unit}`, product.unit)}</span>}
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                    <div className="space-y-2" data-tour-id={index === 0 ? 'tutorial-order-unit-price' : undefined}>
                                                        <Label>{t('common.buyingPrice', { defaultValue: 'Buying Price' })}</Label>
                                                        <Input value={formatNumericInput(item.unitPrice)} onChange={(event) => updateItem(index, { unitPrice: sanitizeNumericInput(event.target.value, { allowDecimal: true, maxFractionDigits: 3 }) })} placeholder={t('common.buyingPrice', { defaultValue: 'Buying Price' })} />
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
                                                    {createsBatch && <div className={cn('grid gap-3 border-t pt-3 md:grid-cols-4', canUseFreeBonus ? 'md:col-span-6' : 'md:col-span-5')}>
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
                                                                value={formatNumericInput(item.batchSalePrice ?? '')}
                                                                onChange={(event) => updateItem(index, { batchSalePrice: sanitizeNumericInput(event.target.value, { allowDecimal: true, maxFractionDigits: 3 }) })}
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
                                                        step={ORDER_DECIMAL_STEP}
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
                                        <div className="space-y-2">
                                            <Label htmlFor="purchase-discount">- {t('orders.form.discount', { defaultValue: 'Discount' })}</Label>
                                            <Input id="purchase-discount" value={formatNumericInput(discount)} onChange={(event) => setDiscount(sanitizeNumericInput(event.target.value, { allowDecimal: true, maxFractionDigits: 3 }))} />
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
