import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, CreditCard, Eye, LayoutGrid, List, Loader2, Lock, PackagePlus, Pencil, Plus, Printer, Search, ShoppingCart, Trash2, Truck, UsersRound, Wallet, Warehouse, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getLocalizedOrderError } from '@/lib/orderErrors'
import type { PaymentMethodOption } from '@/lib/paymentMethods'
import { useLocation, useRoute } from 'wouter'

import { SalesOrderFormPage } from '@/ui/components/orders/SalesOrderFormPage'
import { PurchaseOrderFormPage } from '@/ui/components/orders/PurchaseOrderFormPage'

import { useAuth } from '@/auth'
import { useDateRange } from '@/context/DateRangeContext'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { formatLocalizedMonthYear } from '@/lib/monthDisplay'
import { getReportOriginId } from '@/lib/printIdentity'
import { buildOrderExchangeRatesSnapshot, convertCurrencyAmountWithLiveRates, getPrimaryExchangeDetails } from '@/lib/orderCurrency'
import { ORDER_DECIMAL_STEP, roundOrderValue } from '@/lib/orderPrecision'
import { formatCurrency, formatDate, formatLocalDateTimeValue, generateId, parseLocalDateTimeValue } from '@/lib/utils'
import { generateTemplatePdf, type PrintFormat } from '@/services/pdfGenerator'
import {
    createPurchaseOrder,
    createSalesOrder,
    approvePurchaseOrderRequest,
    approveSalesOrderRequest,
    deletePurchaseOrder,
    deleteSalesOrder,
    getOrderBalanceAmount,
    getOrderPaidAmount,
    getOrderPaymentStatus,
    getPrimaryStorageFromList,
    isOrderApprovalRequested,
    findLatestUnreversedPaymentTransaction,
    lockPurchaseOrder,
    lockSalesOrder,
    recordObligationSettlement,
    reversePaymentTransaction,
    shouldCreatePurchaseCostBatch,
    updatePurchaseOrder,
    updatePurchaseOrderStatus,
    updateSalesOrder,
    updateSalesOrderStatus,
    useCustomers,
    useInventory,
    useProducts,
    usePurchaseOrders,
    useSalesOrders,
    useStorages,
    useSuppliers,
    type CurrencyCode,
    type PaymentObligation,
    type PurchaseOrder,
    type PurchaseOrderItem,
    type PurchaseOrderStatus,
    type SalesOrder,
    type SalesOrderItem,
    type SalesOrderStatus,
    type WorkspacePaymentMethod
} from '@/local-db'
import { useWorkspace } from '@/workspace'
import { isMobile } from '@/lib/platform'
import { cn } from '@/lib/utils'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    DateTimePicker,
    Dialog,
    DialogBody,
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    PaymentMethodSelect,
    SettlementDialog,
    Textarea,
    PrintPreviewModal,
    DateRangeFilters,
    useToast
} from '@/ui/components'
import { DeleteConfirmationModal } from '@/ui/components/DeleteConfirmationModal'
import { OrderDetailsView } from '@/ui/components/orders/OrderDetailsView'
import { OrderListPrintTemplate } from '@/ui/components/orders/OrderPrintTemplates'
import { OrderStatusBadge } from '@/ui/components/orders/OrderStatusBadge'

type OrderTab = 'sales' | 'purchase'

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

type SalesFormState = {
    customerId: string
    sourceStorageId: string
    currency: CurrencyCode
    shippingAddress: string
    expectedDeliveryDate: string
    discount: string
    tax: string
    notes: string
    isPaid: boolean
    paymentMethod: string
    items: FormItem[]
}

type PurchaseFormState = {
    supplierId: string
    destinationStorageId: string
    currency: CurrencyCode
    expectedDeliveryDate: string
    discount: string
    notes: string
    isPaid: boolean
    paymentMethod: string
    items: FormItem[]
}

type DeleteTarget =
    | { type: 'sales'; order: SalesOrder }
    | { type: 'purchase'; order: PurchaseOrder }

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
    return roundOrderValue(value)
}

function isDynamicUnit(unit: string | undefined) {
    return unit === 'm²' || unit === 'Kg' || unit === 'Meter'
}

function formatStatusLabel(t: (key: string) => string, status: string) {
    const translated = t(`orders.status.${status}`)
    return translated && translated !== `orders.status.${status}` ? translated : status
}

function formatPaymentStatus(t: (key: string, options?: Record<string, unknown>) => string, order: SalesOrder | PurchaseOrder) {
    if ((order as SalesOrder).returnStatus === 'full') {
        return t('sales.return.returnedStatus') || 'Returned'
    }

    const status = getOrderPaymentStatus(order)
    if (status === 'paid') return t('orders.status.paid', { defaultValue: 'Paid' })
    if (status === 'partial') return t('orders.status.partial', { defaultValue: 'Partially Paid' })
    return t('orders.status.unpaid', { defaultValue: 'Unpaid' })
}

function getOrderSummary(items: Array<{ productName: string }>) {
    const firstItems = items.slice(0, 2).map((item) => item.productName)
    if (items.length <= 2) return firstItems.join(', ')
    return `${firstItems.join(', ')} +${items.length - 2}`
}

function getCommonStorageId(items: Array<{ storageId?: string | null }>, fallbackStorageId = '') {
    const storageIds = Array.from(new Set(items.map((item) => item.storageId || fallbackStorageId).filter(Boolean)))
    return storageIds.length === 1 ? storageIds[0] : null
}

function buildSalesOrderPaymentObligation(order: SalesOrder): PaymentObligation {
    return {
        id: `sales-order:${order.id}`,
        workspaceId: order.workspaceId,
        sourceModule: 'orders',
        sourceType: 'sales_order',
        sourceRecordId: order.id,
        sourceSubrecordId: null,
        direction: 'incoming',
        amount: getOrderBalanceAmount(order),
        currency: order.currency,
        dueDate: (order.expectedDeliveryDate || order.actualDeliveryDate || order.updatedAt).slice(0, 10),
        counterpartyName: order.customerName,
        referenceLabel: order.orderNumber,
        title: order.customerName,
        subtitle: order.status,
        status: 'open',
        routePath: `/orders/${order.id}`,
        metadata: {
            orderStatus: order.status,
            sourceChannel: order.sourceChannel || 'manual'
        }
    }
}

function buildPurchaseOrderPaymentObligation(order: PurchaseOrder): PaymentObligation {
    return {
        id: `purchase-order:${order.id}`,
        workspaceId: order.workspaceId,
        sourceModule: 'orders',
        sourceType: 'purchase_order',
        sourceRecordId: order.id,
        sourceSubrecordId: null,
        direction: 'outgoing',
        amount: getOrderBalanceAmount(order),
        currency: order.currency,
        dueDate: (order.expectedDeliveryDate || order.actualDeliveryDate || order.updatedAt).slice(0, 10),
        counterpartyName: order.supplierName,
        referenceLabel: order.orderNumber,
        title: order.supplierName,
        subtitle: order.status,
        status: 'open',
        routePath: `/orders/${order.id}`,
        metadata: {
            orderStatus: order.status
        }
    }
}

function OrdersListView({ workspaceId, initialTab = 'sales' }: { workspaceId: string; initialTab?: OrderTab }) {
    const { t, i18n } = useTranslation()
    const { user } = useAuth()
    const { features, workspaceName } = useWorkspace()
    const { exchangeData, eurRates, tryRates } = useExchangeRate()
    const { toast } = useToast()
    const [, navigate] = useLocation()
    const { dateRange, customDates } = useDateRange()
    const products = useProducts(workspaceId)
    const inventory = useInventory(workspaceId)
    const storages = useStorages(workspaceId)
    const customers = useCustomers(workspaceId)
    const suppliers = useSuppliers(workspaceId)
    const salesOrders = useSalesOrders(workspaceId)
    const purchaseOrders = usePurchaseOrders(workspaceId)
    const defaultStorageId = getPrimaryStorageFromList(storages)?.id || ''

    const [activeTab, setActiveTab] = useState<OrderTab>(initialTab)
    const [viewMode, setViewMode] = useState<'table' | 'grid'>(() => (localStorage.getItem('orders_view_mode') as 'table' | 'grid') || 'table')
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'ordered' | 'received' | 'completed'>('all')
    const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid'>('all')

    useEffect(() => {
        setActiveTab(initialTab)
    }, [initialTab])

    useEffect(() => {
        localStorage.setItem('orders_view_mode', viewMode)
    }, [viewMode])
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingSalesOrder, setEditingSalesOrder] = useState<SalesOrder | null>(null)
    const [editingPurchaseOrder, setEditingPurchaseOrder] = useState<PurchaseOrder | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [workflowActionByOrderId, setWorkflowActionByOrderId] = useState<Record<string, string>>({})
    const workflowActionByOrderIdRef = useRef(new Map<string, string>())
    const [lockConfirm, setLockConfirm] = useState<{ isOpen: boolean; orderId: string; type: 'sales' | 'purchase' | null }>({
        isOpen: false,
        orderId: '',
        type: null
    })
    const [cancelConfirm, setCancelConfirm] = useState<{ isOpen: boolean; orderId: string; type: 'sales' | 'purchase' | null }>({
        isOpen: false,
        orderId: '',
        type: null
    })
    const [settlementTarget, setSettlementTarget] = useState<PaymentObligation | null>(null)
    const [isSubmittingSettlement, setIsSubmittingSettlement] = useState(false)
    const [showPrintPreview, setShowPrintPreview] = useState(false)

    const [salesForm, setSalesForm] = useState<SalesFormState>({
        customerId: '',
        sourceStorageId: defaultStorageId,
        currency: features.default_currency,
        shippingAddress: '',
        expectedDeliveryDate: '',
        discount: '',
        tax: '',
        notes: '',
        isPaid: false,
        paymentMethod: 'cash',
        items: [createEmptyItem(defaultStorageId)]
    })

    const [purchaseForm, setPurchaseForm] = useState<PurchaseFormState>({
        supplierId: '',
        destinationStorageId: defaultStorageId,
        currency: features.default_currency,
        expectedDeliveryDate: '',
        discount: '',
        notes: '',
        isPaid: false,
        paymentMethod: 'cash',
        items: [createEmptyItem(defaultStorageId)]
    })

    const liveRates = useMemo(() => ({
        exchangeData,
        eurRates,
        tryRates
    }), [exchangeData, eurRates, tryRates])

    const canManageOrders = user?.role === 'admin' || user?.role === 'staff'
    const canDeleteOrders = user?.role === 'admin'
    const canApproveOrderRequests = user?.role === 'admin'
    const availableSalesProductIdsByStorage = useMemo(() => {
        const rows = new Map<string, Set<string>>()
        for (const row of inventory) {
            if (row.quantity <= 0) {
                continue
            }

            const current = rows.get(row.storageId) ?? new Set<string>()
            current.add(row.productId)
            rows.set(row.storageId, current)
        }

        return rows
    }, [inventory])

    useEffect(() => {
        if (!defaultStorageId) {
            return
        }

        setSalesForm((current) => ({
            ...current,
            sourceStorageId: current.sourceStorageId || defaultStorageId,
            items: current.items.map((item) => !item.storageId ? { ...item, storageId: defaultStorageId } : item)
        }))
        setPurchaseForm((current) => ({
            ...current,
            destinationStorageId: current.destinationStorageId || defaultStorageId,
            items: current.items.map((item) => !item.storageId ? { ...item, storageId: defaultStorageId } : item)
        }))
    }, [defaultStorageId])

    const filteredSalesOrders = useMemo(() => {
        let items = [...salesOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

        const now = new Date()
        if (dateRange === 'today') {
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
            items = items.filter(s => new Date(s.createdAt) >= startOfDay)
        } else if (dateRange === 'month') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            items = items.filter(s => new Date(s.createdAt) >= startOfMonth)
        } else if (dateRange === 'lastMonth') {
            const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            items = items.filter(s => {
                const createdAt = new Date(s.createdAt)
                return createdAt >= startOfLastMonth && createdAt < startOfMonth
            })
        } else if (dateRange === 'custom' && (customDates.start || customDates.end)) {
            const start = customDates.start ? new Date(customDates.start) : null
            if (start) start.setHours(0, 0, 0, 0)
            const end = customDates.end ? new Date(customDates.end) : null
            if (end) end.setHours(23, 59, 59, 999)
            items = items.filter(s => {
                const d = new Date(s.createdAt)
                if (start && d < start) return false
                if (end && d > end) return false
                return true
            })
        }

        if (statusFilter !== 'all') {
            items = items.filter((order) => order.status === statusFilter)
        }

        if (paymentFilter !== 'all') {
            items = items.filter(order => paymentFilter === 'paid' ? order.isPaid : !order.isPaid)
        }

        const query = search.trim().toLowerCase()
        if (!query) return items

        return items.filter((order) =>
            order.orderNumber.toLowerCase().includes(query)
            || order.customerName.toLowerCase().includes(query)
            || order.items.some((item) => item.productName.toLowerCase().includes(query))
        )
    }, [salesOrders, search, statusFilter, paymentFilter, dateRange, customDates])

    const filteredPurchaseOrders = useMemo(() => {
        let items = purchaseOrders

        const now = new Date()
        if (dateRange === 'today') {
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
            items = items.filter(s => new Date(s.createdAt) >= startOfDay)
        } else if (dateRange === 'month') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            items = items.filter(s => new Date(s.createdAt) >= startOfMonth)
        } else if (dateRange === 'lastMonth') {
            const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            items = items.filter(s => {
                const createdAt = new Date(s.createdAt)
                return createdAt >= startOfLastMonth && createdAt < startOfMonth
            })
        } else if (dateRange === 'custom' && (customDates.start || customDates.end)) {
            const start = customDates.start ? new Date(customDates.start) : null
            if (start) start.setHours(0, 0, 0, 0)
            const end = customDates.end ? new Date(customDates.end) : null
            if (end) end.setHours(23, 59, 59, 999)
            items = items.filter(s => {
                const d = new Date(s.createdAt)
                if (start && d < start) return false
                if (end && d > end) return false
                return true
            })
        }

        if (statusFilter !== 'all') {
            items = items.filter((order) => order.status === statusFilter)
        }

        if (paymentFilter !== 'all') {
            items = items.filter(order => paymentFilter === 'paid' ? order.isPaid : !order.isPaid)
        }

        const query = search.trim().toLowerCase()
        if (!query) return items
        return items.filter((order) =>
            order.orderNumber.toLowerCase().includes(query)
            || order.supplierName.toLowerCase().includes(query)
            || order.items.some((item) => item.productName.toLowerCase().includes(query))
        )
    }, [purchaseOrders, search, statusFilter, paymentFilter, dateRange, customDates])

    const salesPreview = useMemo(() => {
        const subtotal = salesForm.items.reduce((sum, item) => sum + ((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)), 0)
        const total = subtotal - Number(salesForm.discount || 0) + Number(salesForm.tax || 0)
        return roundFormAmount(total)
    }, [salesForm.currency, salesForm.discount, salesForm.items, salesForm.tax])
    const salesConfiguredItemsCount = useMemo(
        () => salesForm.items.filter((item) => item.productId && Number(item.quantity) > 0).length,
        [salesForm.items]
    )

    const purchasePreview = useMemo(() => {
        const subtotal = purchaseForm.items.reduce((sum, item) => sum + ((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)), 0)
        const total = subtotal - Number(purchaseForm.discount || 0)
        return roundFormAmount(total)
    }, [purchaseForm.currency, purchaseForm.discount, purchaseForm.items])
    const purchaseConfiguredItemsCount = useMemo(
        () => purchaseForm.items.filter((item) => item.productId && Number(item.quantity) > 0).length,
        [purchaseForm.items]
    )

    const getDateDisplay = () => {
        if (dateRange === 'today') {
            return formatDate(new Date())
        }
        if (dateRange === 'month') {
            const now = new Date()
            return formatLocalizedMonthYear(now, i18n.language)
        }
        if (dateRange === 'lastMonth') {
            const now = new Date()
            return formatLocalizedMonthYear(new Date(now.getFullYear(), now.getMonth() - 1, 1), i18n.language)
        }
        if (dateRange === 'custom') {
            if (activeTab === 'sales' && filteredSalesOrders && filteredSalesOrders.length > 0) {
                const dates = filteredSalesOrders.map(s => new Date(s.createdAt).getTime())
                const minDate = new Date(Math.min(...dates))
                const maxDate = new Date(Math.max(...dates))
                return `${t('performance.filters.from')} ${formatDate(minDate)} ${t('performance.filters.to')} ${formatDate(maxDate)}`
            }
            if (activeTab === 'purchase' && filteredPurchaseOrders && filteredPurchaseOrders.length > 0) {
                const dates = filteredPurchaseOrders.map(s => new Date(s.createdAt).getTime())
                const minDate = new Date(Math.min(...dates))
                const maxDate = new Date(Math.max(...dates))
                return `${t('performance.filters.from')} ${formatDate(minDate)} ${t('performance.filters.to')} ${formatDate(maxDate)}`
            }
            if (customDates.start || customDates.end) {
                const parts = []
                if (customDates.start) parts.push(`${t('performance.filters.from')} ${formatDate(customDates.start)}`)
                if (customDates.end) parts.push(`${t('performance.filters.to')} ${formatDate(customDates.end)}`)
                return parts.join(' ')
            }
        }
        if (dateRange === 'allTime') {
            const arr = activeTab === 'sales' ? filteredSalesOrders : filteredPurchaseOrders
            if (arr && arr.length > 0) {
                const dates = arr.map(s => new Date(s.createdAt).getTime())
                const minDate = new Date(Math.min(...dates))
                const maxDate = new Date(Math.max(...dates))
                return `${t('performance.filters.from')} ${formatDate(minDate)} ${t('performance.filters.to')} ${formatDate(maxDate)}`
            }
            return t('performance.filters.allTime') || 'All Time'
        }
        return ''
    }

    const getStorageDisplayName = (storageId: string) => {
        const storage = storages.find((entry) => entry.id === storageId)
        if (!storage) {
            return t('orders.form.selectStorage', { defaultValue: 'Select Storage' })
        }

        return storage.isSystem ? (t(`storages.${storage.name.toLowerCase()}`) || storage.name) : storage.name
    }
    const multipleStoragesLabel = t('orders.form.multipleStorages', { defaultValue: 'Multiple storages' })
    const getStorageSummaryName = (items: FormItem[], fallbackStorageId: string) => {
        const commonStorageId = getCommonStorageId(items, fallbackStorageId)
        if (commonStorageId) {
            return getStorageDisplayName(commonStorageId)
        }

        return items.some((item) => item.storageId) ? multipleStoragesLabel : t('orders.form.selectStorage', { defaultValue: 'Select Storage' })
    }
    const getSalesProductOptions = (storageId: string, selectedProductId: string) => {
        const availableIds = availableSalesProductIdsByStorage.get(storageId) ?? new Set<string>()
        return products.filter((product) => product.id === selectedProductId || availableIds.has(product.id))
    }

    const selectedCustomerName = customers.find((entry) => entry.id === salesForm.customerId)?.name
        || t('orders.form.selectCustomer', { defaultValue: 'Select Customer' })
    const selectedSupplierName = suppliers.find((entry) => entry.id === purchaseForm.supplierId)?.name
        || t('orders.form.selectSupplier', { defaultValue: 'Select Supplier' })
    const selectedSalesStorageName = getStorageSummaryName(salesForm.items, salesForm.sourceStorageId)
    const selectedPurchaseStorageName = getStorageSummaryName(purchaseForm.items, purchaseForm.destinationStorageId)
    const inventoryByStorageProduct = useMemo(() => new Map(
        inventory.map((row) => [`${row.storageId}:${row.productId}`, row.quantity] as const)
    ), [inventory])

    const getAvailableQuantity = (productId: string, storageId: string) => {
        if (!productId || !storageId) {
            return 0
        }

        return inventoryByStorageProduct.get(`${storageId}:${productId}`) ?? 0
    }

    const getPaymentMethodLabel = (paymentMethod: string) => {
        switch (paymentMethod) {
            case 'cash':
                return 'Cash'
            case 'bank_transfer':
                return 'Bank Transfer'
            case 'loan':
                return 'Loans'
            case 'installments':
                return 'Installments'
            default:
                return paymentMethod
        }
    }

    function resetSalesForm(customerId?: string) {
        const customer = customerId ? customers.find((entry) => entry.id === customerId) : undefined
        setEditingSalesOrder(null)
        setSalesForm({
            customerId: customerId || '',
            sourceStorageId: defaultStorageId,
            currency: customer?.defaultCurrency || features.default_currency,
            shippingAddress: '',
            expectedDeliveryDate: '',
            discount: '',
            tax: '',
            notes: '',
            isPaid: false,
            paymentMethod: 'cash',
            items: [createEmptyItem(defaultStorageId)]
        })
    }

    function resetPurchaseForm(supplierId?: string) {
        const supplier = supplierId ? suppliers.find((entry) => entry.id === supplierId) : undefined
        setEditingPurchaseOrder(null)
        setPurchaseForm({
            supplierId: supplierId || '',
            destinationStorageId: defaultStorageId,
            currency: supplier?.defaultCurrency || features.default_currency,
            expectedDeliveryDate: '',
            discount: '',
            notes: '',
            isPaid: false,
            paymentMethod: 'cash',
            items: [createEmptyItem(defaultStorageId)]
        })
    }

    function openSalesEdit(order: SalesOrder) {
        navigate(`/orders/edit/sales/${order.id}`)
    }

    function openPurchaseEdit(order: PurchaseOrder) {
        navigate(`/orders/edit/purchase/${order.id}`)
    }

    async function handleOrderSettlement(input: { paymentMethod: WorkspacePaymentMethod; paidAt: string; amount?: number; note?: string }) {
        if (!workspaceId || !settlementTarget) {
            return
        }

        setIsSubmittingSettlement(true)
        try {
            await recordObligationSettlement(workspaceId, settlementTarget, {
                paymentMethod: input.paymentMethod,
                paidAt: input.paidAt,
                amount: input.amount,
                note: input.note,
                createdBy: user?.id || null
            })
            toast({ title: settlementTarget.direction === 'incoming' ? 'Collection recorded' : 'Payment recorded' })
            setSettlementTarget(null)
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: error?.message || 'Failed to record settlement',
                variant: 'destructive'
            })
        } finally {
            setIsSubmittingSettlement(false)
        }
    }

    async function handleOrderUnpay(order: SalesOrder | PurchaseOrder, type: 'sales' | 'purchase') {
        if (!workspaceId) {
            return
        }

        const sourceType = type === 'sales' ? 'sales_order' : 'purchase_order'
        try {
            const transaction = await findLatestUnreversedPaymentTransaction(workspaceId, {
                sourceType,
                sourceRecordId: order.id
            })
            if (!transaction) {
                throw new Error('No posted payment was found for this order.')
            }

            await reversePaymentTransaction(workspaceId, transaction.id, {
                createdBy: user?.id || null
            })
            toast({ title: 'Payment reversed' })
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: error?.message || 'Failed to reverse payment',
                variant: 'destructive'
            })
        }
    }

    function applyDefaultItemPrice(tab: OrderTab, productId: string, partnerCurrency: CurrencyCode) {
        const product = products.find((entry) => entry.id === productId)
        if (!product) return ''

        const sourcePrice = tab === 'sales' ? product.price : product.costPrice
        return String(convertCurrencyAmountWithLiveRates(sourcePrice, product.currency, partnerCurrency, liveRates))
    }

    function updateSalesItem(index: number, changes: Partial<FormItem>) {
        setSalesForm((current) => ({
            ...current,
            sourceStorageId: changes.storageId || current.sourceStorageId,
            items: current.items.map((item, itemIndex) => {
                if (itemIndex !== index) return item
                const next = { ...item, ...changes }
                if (changes.productId && (!item.unitPrice || changes.productId !== item.productId)) {
                    next.unitPrice = applyDefaultItemPrice('sales', changes.productId, current.currency)
                }
                return next
            })
        }))
    }

    function updatePurchaseItem(index: number, changes: Partial<FormItem>) {
        setPurchaseForm((current) => ({
            ...current,
            destinationStorageId: changes.storageId || current.destinationStorageId,
            items: current.items.map((item, itemIndex) => {
                if (itemIndex !== index) return item
                const next = { ...item, ...changes }
                if (changes.productId && (!item.unitPrice || changes.productId !== item.productId)) {
                    next.unitPrice = applyDefaultItemPrice('purchase', changes.productId, current.currency)
                    const product = products.find((entry) => entry.id === changes.productId)
                    next.batchSalePrice = product ? String(product.price) : ''
                }
                return next
            })
        }))
    }

    function buildSalesItems(orderCurrency: CurrencyCode) {
        const snapshot = buildOrderExchangeRatesSnapshot(liveRates)
        const items: SalesOrderItem[] = salesForm.items
            .filter((item) => item.productId && Number(item.quantity) > 0)
            .map((item) => {
                const product = products.find((entry) => entry.id === item.productId)
                if (!product) throw new Error('Selected product was not found')
                if (!item.storageId) throw new Error(`Select a source storage for ${product.name}`)

                const quantity = Number(item.quantity)
                const unitPrice = Number(item.unitPrice || 0)
                return {
                    id: item.id,
                    productId: product.id,
                    storageId: item.storageId,
                    productName: product.name,
                    productSku: product.sku,
                    unit: product.unit,
                    quantity,
                    lineTotal: roundFormAmount(quantity * unitPrice),
                    originalCurrency: product.currency,
                    originalUnitPrice: convertCurrencyAmountWithLiveRates(unitPrice, orderCurrency, product.currency, liveRates),
                    convertedUnitPrice: roundFormAmount(unitPrice),
                    settlementCurrency: orderCurrency,
                    costPrice: product.costPrice,
                    convertedCostPrice: convertCurrencyAmountWithLiveRates(product.costPrice, product.currency, orderCurrency, liveRates)
                }
            })

        return { items, snapshot }
    }

    function buildPurchaseItems(orderCurrency: CurrencyCode) {
        const snapshot = buildOrderExchangeRatesSnapshot(liveRates)
        const items: PurchaseOrderItem[] = purchaseForm.items
            .filter((item) => item.productId && Number(item.quantity) > 0)
            .map((item) => {
                const product = products.find((entry) => entry.id === item.productId)
                if (!product) throw new Error('Selected product was not found')
                if (!item.storageId) throw new Error(`Select a target storage for ${product.name}`)

                const quantity = Number(item.quantity)
                const unitPrice = Number(item.unitPrice || 0)
                const batchSalePrice = item.batchSalePrice === '' ? null : Number(item.batchSalePrice)
                if (batchSalePrice !== null && (!Number.isFinite(batchSalePrice) || batchSalePrice < 0)) {
                    throw new Error(`Enter a valid batch selling price for ${product.name}`)
                }
                return {
                    id: item.id,
                    productId: product.id,
                    storageId: item.storageId,
                    productName: product.name,
                    productSku: product.sku,
                    unit: product.unit,
                    quantity,
                    lineTotal: roundFormAmount(quantity * unitPrice),
                    originalCurrency: product.currency,
                    originalUnitPrice: convertCurrencyAmountWithLiveRates(unitPrice, orderCurrency, product.currency, liveRates),
                    convertedUnitPrice: roundFormAmount(unitPrice),
                    settlementCurrency: orderCurrency,
                    batchNumber: item.batchNumber.trim() || null,
                    batchSalePrice,
                    batchExpiryDate: item.batchExpiryDate || null,
                    batchManufacturingDate: item.batchManufacturingDate || null
                }
            })

        return { items, snapshot }
    }

    async function handleSalesSubmit(event: FormEvent) {
        event.preventDefault()
        if (!user?.workspaceId) return

        const customer = customers.find((entry) => entry.id === salesForm.customerId)
        if (!customer) {
            toast({ title: t('common.error') || 'Error', description: t('orders.noCustomers') || 'Add customers before creating orders.', variant: 'destructive' })
            return
        }

        setIsSaving(true)
        try {
            const { items, snapshot } = buildSalesItems(salesForm.currency)
            if (items.length === 0) throw new Error('Add at least one item')
            const sourceStorageId = getCommonStorageId(items)

            const subtotal = roundFormAmount(items.reduce((sum, item) => sum + item.lineTotal, 0))
            const discount = roundFormAmount(Number(salesForm.discount || 0))
            const tax = roundFormAmount(Number(salesForm.tax || 0))
            const total = roundFormAmount(subtotal - discount + tax)
            const primaryRate = getPrimaryExchangeDetails(salesForm.currency, features.default_currency, snapshot)

            const payload = {
                businessPartnerId: customer.id,
                customerId: customer.id,
                customerName: customer.name,
                sourceStorageId,
                items,
                subtotal,
                discount,
                tax,
                total,
                currency: salesForm.currency,
                exchangeRate: primaryRate.exchangeRate,
                exchangeRateSource: primaryRate.exchangeRateSource,
                exchangeRateTimestamp: primaryRate.exchangeRateTimestamp,
                exchangeRates: snapshot,
                status: 'draft' as SalesOrderStatus,
                expectedDeliveryDate: salesForm.expectedDeliveryDate || null,
                actualDeliveryDate: null,
                isPaid: salesForm.isPaid,
                paymentStatus: salesForm.isPaid ? 'paid' as const : editingSalesOrder?.paymentStatus || 'unpaid' as const,
                paidAmount: salesForm.isPaid ? total : editingSalesOrder?.paidAmount || 0,
                balanceAmount: salesForm.isPaid ? 0 : editingSalesOrder?.balanceAmount ?? total,
                paidAt: salesForm.isPaid ? new Date().toISOString() : null,
                paymentMethod: salesForm.paymentMethod as SalesOrder['paymentMethod'],
                initialPaymentAmount: 0,
                linkedLoanId: editingSalesOrder?.linkedLoanId || null,
                isInstallmentBased: editingSalesOrder?.isInstallmentBased || false,
                installmentCount: editingSalesOrder?.installmentCount || 0,
                installmentFrequency: editingSalesOrder?.installmentFrequency || null,
                firstDueDate: editingSalesOrder?.firstDueDate || null,
                nextDueDate: editingSalesOrder?.nextDueDate || null,
                reservedAt: null,
                shippingAddress: salesForm.shippingAddress || undefined,
                notes: salesForm.notes || undefined
            }

            if (editingSalesOrder) await updateSalesOrder(editingSalesOrder.id, payload)
            else await createSalesOrder(user.workspaceId, payload, user?.id ?? null)

            toast({ title: editingSalesOrder ? (t('common.save') || 'Saved') : (t('common.create') || 'Created') })
            setDialogOpen(false)
            resetSalesForm()
        } catch (error: any) {
            toast({ title: t('common.error') || 'Error', description: error?.message || 'Failed to save sales order', variant: 'destructive' })
        } finally {
            setIsSaving(false)
        }
    }

    async function handlePurchaseSubmit(event: FormEvent) {
        event.preventDefault()
        if (!user?.workspaceId) return

        const supplier = suppliers.find((entry) => entry.id === purchaseForm.supplierId)
        if (!supplier) {
            toast({ title: t('common.error') || 'Error', description: 'Add suppliers before creating purchase orders.', variant: 'destructive' })
            return
        }

        setIsSaving(true)
        try {
            const { items, snapshot } = buildPurchaseItems(purchaseForm.currency)
            if (items.length === 0) throw new Error('Add at least one item')
            const destinationStorageId = getCommonStorageId(items)

            const subtotal = roundFormAmount(items.reduce((sum, item) => sum + item.lineTotal, 0))
            const discount = roundFormAmount(Number(purchaseForm.discount || 0))
            const total = roundFormAmount(subtotal - discount)
            const primaryRate = getPrimaryExchangeDetails(purchaseForm.currency, features.default_currency, snapshot)

            const payload = {
                businessPartnerId: supplier.id,
                supplierId: supplier.id,
                supplierName: supplier.name,
                destinationStorageId,
                items,
                subtotal,
                discount,
                total,
                currency: purchaseForm.currency,
                exchangeRate: primaryRate.exchangeRate,
                exchangeRateSource: primaryRate.exchangeRateSource,
                exchangeRateTimestamp: primaryRate.exchangeRateTimestamp,
                exchangeRates: snapshot,
                status: 'draft' as PurchaseOrderStatus,
                expectedDeliveryDate: purchaseForm.expectedDeliveryDate || null,
                actualDeliveryDate: null,
                isPaid: purchaseForm.isPaid,
                paymentStatus: purchaseForm.isPaid ? 'paid' as const : editingPurchaseOrder?.paymentStatus || 'unpaid' as const,
                paidAmount: purchaseForm.isPaid ? total : editingPurchaseOrder?.paidAmount || 0,
                balanceAmount: purchaseForm.isPaid ? 0 : editingPurchaseOrder?.balanceAmount ?? total,
                paidAt: purchaseForm.isPaid ? new Date().toISOString() : null,
                paymentMethod: purchaseForm.paymentMethod as PurchaseOrder['paymentMethod'],
                initialPaymentAmount: 0,
                linkedLoanId: editingPurchaseOrder?.linkedLoanId || null,
                isInstallmentBased: editingPurchaseOrder?.isInstallmentBased || false,
                installmentCount: editingPurchaseOrder?.installmentCount || 0,
                installmentFrequency: editingPurchaseOrder?.installmentFrequency || null,
                firstDueDate: editingPurchaseOrder?.firstDueDate || null,
                nextDueDate: editingPurchaseOrder?.nextDueDate || null,
                notes: purchaseForm.notes || undefined
            }

            if (editingPurchaseOrder) await updatePurchaseOrder(editingPurchaseOrder.id, payload)
            else await createPurchaseOrder(user.workspaceId, payload, user?.id ?? null)

            toast({ title: editingPurchaseOrder ? (t('common.save') || 'Saved') : (t('common.create') || 'Created') })
            setDialogOpen(false)
            resetPurchaseForm()
        } catch (error: any) {
            toast({ title: t('common.error') || 'Error', description: error?.message || 'Failed to save purchase order', variant: 'destructive' })
        } finally {
            setIsSaving(false)
        }
    }

    async function runAction(action: () => Promise<unknown>, successMessage: string) {
        try {
            await action()
            toast({ title: successMessage })
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: getLocalizedOrderError(error, t, 'Action failed'),
                variant: 'destructive'
            })
        }
    }

    async function runWorkflowAction(orderId: string, actionName: string, action: () => Promise<unknown>, successMessage: string) {
        if (workflowActionByOrderIdRef.current.has(orderId)) return

        workflowActionByOrderIdRef.current.set(orderId, actionName)
        setWorkflowActionByOrderId((current) => ({ ...current, [orderId]: actionName }))

        try {
            await action()
            toast({ title: successMessage })
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: getLocalizedOrderError(error, t, 'Action failed'),
                variant: 'destructive'
            })
        } finally {
            workflowActionByOrderIdRef.current.delete(orderId)
            setWorkflowActionByOrderId((current) => {
                const { [orderId]: _completedAction, ...remainingActions } = current
                return remainingActions
            })
        }
    }

    function renderWorkflowActionButton({
        orderId,
        actionName,
        label,
        onClick,
        className
    }: {
        orderId: string
        actionName: string
        label: string
        onClick: () => void
        className?: string
    }) {
        const activeAction = workflowActionByOrderId[orderId]
        const isLoading = activeAction === actionName

        return (
            <Button
                size="sm"
                className={className}
                disabled={Boolean(activeAction)}
                aria-busy={isLoading}
                onClick={onClick}
            >
                {isLoading && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {label}
            </Button>
        )
    }

    async function handleDeleteConfirm() {
        if (!deleteTarget) return
        if (deleteTarget.type === 'sales') {
            await runAction(() => deleteSalesOrder(deleteTarget.order.id), 'Sales order deleted')
        } else {
            await runAction(() => deletePurchaseOrder(deleteTarget.order.id), 'Purchase order deleted')
        }
        setDeleteTarget(null)
    }

    async function handleLockConfirm() {
        if (!lockConfirm.orderId || !lockConfirm.type) return

        const action = lockConfirm.type === 'sales' ? () => lockSalesOrder(lockConfirm.orderId) : () => lockPurchaseOrder(lockConfirm.orderId)
        await runAction(action, t('orders.lockedSuccess') || 'Order locked successfully')
        setLockConfirm({ isOpen: false, orderId: '', type: null })
    }

    async function handleCancelConfirm() {
        if (!cancelConfirm.orderId || !cancelConfirm.type) return

        const action = cancelConfirm.type === 'sales'
            ? () => updateSalesOrderStatus(cancelConfirm.orderId, 'cancelled')
            : () => updatePurchaseOrderStatus(cancelConfirm.orderId, 'cancelled')
        await runAction(action, cancelConfirm.type === 'sales' ? 'Sales order cancelled' : 'Purchase order cancelled')
        setCancelConfirm({ isOpen: false, orderId: '', type: null })
    }

    function renderOrderTable() {
        const rows = activeTab === 'sales' ? filteredSalesOrders : filteredPurchaseOrders

        return (
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('orders.table.orderNumber') || 'Order #'}</TableHead>
                            <TableHead>{activeTab === 'sales' ? (t('orders.table.customer') || 'Customer') : (t('suppliers.title') || 'Supplier')}</TableHead>
                            <TableHead>{t('orders.table.items') || 'Items'}</TableHead>
                            <TableHead>{t('common.status') || 'Status'}</TableHead>
                            <TableHead>{t('common.total') || 'Total'}</TableHead>
                            <TableHead>{t('orders.form.date') || 'Date'}</TableHead>
                            <TableHead>{t('pos.paymentMethod') || 'Payment'}</TableHead>
                            <TableHead className="text-right">{t('common.actions') || 'Actions'}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                                    {t('common.noData') || 'No data available'}
                                </TableCell>
                            </TableRow>
                        ) : rows.map((row) => {
                            const summary = getOrderSummary(row.items)
                            const isDraft = row.status === 'draft'
                            const isApprovalRequested = isOrderApprovalRequested(row)
                            const canEdit = canManageOrders && isDraft && (!isApprovalRequested || canApproveOrderRequests)
                            const canDelete = canDeleteOrders && isDraft
                            const returnStatus = activeTab === 'sales' ? (row as SalesOrder).returnStatus : 'none'
                            const isFullyReturnedSalesOrder = activeTab === 'sales' && returnStatus === 'full'

                            return (
                                <TableRow key={row.id} className={isApprovalRequested ? 'bg-violet-50/70 hover:bg-violet-50 dark:bg-violet-950/20 dark:hover:bg-violet-950/30' : undefined}>
                                    <TableCell className="font-semibold">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span>{row.orderNumber}</span>
                                            {activeTab === 'sales' && (row as SalesOrder).sourceChannel === 'marketplace' ? (
                                                <span className="inline-flex rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                                                    {t('ecommerce.title', { defaultValue: 'E-Commerce' })}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="text-xs text-muted-foreground">{summary}</div>
                                    </TableCell>
                                    <TableCell>{activeTab === 'sales' ? (row as SalesOrder).customerName : (row as PurchaseOrder).supplierName}</TableCell>
                                    <TableCell>{row.items.length}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1.5">
                                            <OrderStatusBadge
                                                status={isApprovalRequested ? 'approval_requested' : row.status}
                                                label={isApprovalRequested
                                                    ? t('orders.status.requested', { defaultValue: 'Requested' })
                                                    : formatStatusLabel(t, row.status)}
                                            />
                                            {returnStatus === 'full' ? (
                                                <OrderStatusBadge status="returned" label={t('sales.return.returnedStatus') || 'Returned'} />
                                            ) : returnStatus === 'partial' ? (
                                                <OrderStatusBadge status="partially_returned" label={t('sales.return.partialReturn') || 'Partially Returned'} />
                                            ) : null}
                                        </div>
                                    </TableCell>
                                    <TableCell>{formatCurrency(row.total, row.currency, features.iqd_display_preference)}</TableCell>
                                    <TableCell>{formatDate(row.updatedAt)}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1.5">
                                            <span className={cn(
                                                'font-semibold',
                                                isFullyReturnedSalesOrder
                                                    ? 'text-rose-600'
                                                    : getOrderPaymentStatus(row) === 'paid'
                                                        ? 'text-emerald-600'
                                                        : getOrderPaymentStatus(row) === 'partial'
                                                            ? 'text-sky-600'
                                                            : 'text-amber-600'
                                            )}>
                                                {formatPaymentStatus(t, row)}
                                            </span>
                                            {row.isLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex flex-wrap justify-end gap-2">
                                            {activeTab === 'sales' ? (
                                                <>
                                                    <Button variant="outline" size="sm" allowViewer={true} onClick={() => navigate(`/orders/${row.id}`)}><Eye className="mr-1 h-3.5 w-3.5" />{t('common.view') || 'View'}</Button>
                                                    {canEdit && <Button variant="outline" size="sm" onClick={() => openSalesEdit(row as SalesOrder)}><Pencil className="mr-1 h-3.5 w-3.5" />{t('common.edit') || 'Edit'}</Button>}
                                                    {isApprovalRequested && canApproveOrderRequests && renderWorkflowActionButton({ orderId: row.id, actionName: 'approve', label: t('orders.actions.approve', { defaultValue: 'Approve' }), onClick: () => runWorkflowAction(row.id, 'approve', () => approveSalesOrderRequest(row.id, user?.id ?? null), t('orders.actions.approveRequestSuccess', { defaultValue: 'Order request approved' })) })}
                                                    {!isApprovalRequested && canManageOrders && row.status === 'draft' && renderWorkflowActionButton({ orderId: row.id, actionName: 'reserve', label: t('orders.actions.reserve') || 'Reserve', onClick: () => runWorkflowAction(row.id, 'reserve', () => updateSalesOrderStatus(row.id, 'pending'), 'Sales order reserved') })}
                                                    {!isApprovalRequested && canManageOrders && row.status === 'pending' && renderWorkflowActionButton({ orderId: row.id, actionName: 'complete', label: t('orders.actions.complete') || 'Complete', onClick: () => runWorkflowAction(row.id, 'complete', () => updateSalesOrderStatus(row.id, 'completed'), 'Sales order completed') })}
                                                    {!isApprovalRequested && canManageOrders && (row.status === 'draft' || row.status === 'pending') && <Button variant="outline" size="sm" onClick={() => setCancelConfirm({ isOpen: true, orderId: row.id, type: 'sales' })}>{t('orders.actions.cancel') || 'Cancel'}</Button>}
                                                    {!isFullyReturnedSalesOrder && !isApprovalRequested && canManageOrders && !row.isLocked && row.paymentMethod !== 'loan' && row.paymentMethod !== 'installments' && !row.linkedLoanId && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => row.isPaid
                                                                ? handleOrderUnpay(row as SalesOrder, 'sales')
                                                                : setSettlementTarget(buildSalesOrderPaymentObligation(row as SalesOrder))
                                                            }
                                                        >
                                                            {row.isPaid ? (t('orders.actions.unpay') || 'Unpay') : (t('orders.actions.pay') || 'Pay')}
                                                        </Button>
                                                    )}
                                                    {!isFullyReturnedSalesOrder && !isApprovalRequested && canManageOrders && getOrderPaidAmount(row) > 0 && !row.isLocked && <Button variant="outline" size="sm" onClick={() => setLockConfirm({ isOpen: true, orderId: row.id, type: 'sales' })}><Lock className="h-3.5 w-3.5" /></Button>}
                                                    {canDelete && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteTarget({ type: 'sales', order: row as SalesOrder })}><Trash2 className="h-4 w-4" /></Button>}
                                                </>
                                            ) : (
                                                <>
                                                    <Button variant="outline" size="sm" allowViewer={true} onClick={() => navigate(`/orders/${row.id}`)}><Eye className="mr-1 h-3.5 w-3.5" />{t('common.view') || 'View'}</Button>
                                                    {canEdit && <Button variant="outline" size="sm" onClick={() => openPurchaseEdit(row as PurchaseOrder)}><Pencil className="mr-1 h-3.5 w-3.5" />{t('common.edit') || 'Edit'}</Button>}
                                                    {isApprovalRequested && canApproveOrderRequests && renderWorkflowActionButton({ orderId: row.id, actionName: 'approve', label: t('orders.actions.approve', { defaultValue: 'Approve' }), onClick: () => runWorkflowAction(row.id, 'approve', () => approvePurchaseOrderRequest(row.id, user?.id ?? null), t('orders.actions.approveRequestSuccess', { defaultValue: 'Order request approved' })) })}
                                                    {!isApprovalRequested && canManageOrders && row.status === 'draft' && renderWorkflowActionButton({ orderId: row.id, actionName: 'order', label: t('orders.actions.order') || 'Order', onClick: () => runWorkflowAction(row.id, 'order', () => updatePurchaseOrderStatus(row.id, 'ordered'), 'Purchase order sent') })}
                                                    {!isApprovalRequested && canManageOrders && row.status === 'ordered' && renderWorkflowActionButton({ orderId: row.id, actionName: 'receive', label: t('orders.actions.receive') || 'Receive', onClick: () => runWorkflowAction(row.id, 'receive', () => updatePurchaseOrderStatus(row.id, 'received'), 'Purchase order received') })}
                                                    {!isApprovalRequested && canManageOrders && row.status === 'received' && renderWorkflowActionButton({ orderId: row.id, actionName: 'complete', label: t('orders.actions.complete') || 'Complete', onClick: () => runWorkflowAction(row.id, 'complete', () => updatePurchaseOrderStatus(row.id, 'completed'), 'Purchase order completed') })}
                                                    {!isApprovalRequested && canManageOrders && (row.status === 'draft' || row.status === 'ordered') && <Button variant="outline" size="sm" onClick={() => setCancelConfirm({ isOpen: true, orderId: row.id, type: 'purchase' })}>{t('orders.actions.cancel') || 'Cancel'}</Button>}
                                                    {!isApprovalRequested && canManageOrders && !row.isLocked && row.paymentMethod !== 'loan' && row.paymentMethod !== 'installments' && !row.linkedLoanId && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => row.isPaid
                                                                ? handleOrderUnpay(row as PurchaseOrder, 'purchase')
                                                                : setSettlementTarget(buildPurchaseOrderPaymentObligation(row as PurchaseOrder))
                                                            }
                                                        >
                                                            {row.isPaid ? (t('orders.actions.unpay') || 'Unpay') : (t('orders.actions.pay') || 'Pay')}
                                                        </Button>
                                                    )}
                                                    {!isApprovalRequested && canManageOrders && row.isPaid && !row.isLocked && <Button variant="outline" size="sm" onClick={() => setLockConfirm({ isOpen: true, orderId: row.id, type: 'purchase' })}><Lock className="h-3.5 w-3.5" /></Button>}
                                                    {canDelete && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteTarget({ type: 'purchase', order: row as PurchaseOrder })}><Trash2 className="h-4 w-4" /></Button>}
                                                </>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>
        )
    }

    function renderOrderGrid() {
        const rows = activeTab === 'sales' ? filteredSalesOrders : filteredPurchaseOrders

        return (
            <div className={cn(
                "grid gap-4 p-4 bg-muted/5",
                viewMode === 'grid' && !isMobile() ? "md:grid-cols-2 xl:grid-cols-3" : "grid-cols-1"
            )}>
                {rows.length === 0 ? (
                    <div className="text-center text-muted-foreground py-12 bg-background rounded-lg border">
                        {t('common.noData') || 'No data available'}
                    </div>
                ) : rows.map((row) => {
                    const summary = getOrderSummary(row.items)
                    const isDraft = row.status === 'draft'
                    const isApprovalRequested = isOrderApprovalRequested(row)
                    const canEdit = canManageOrders && isDraft && (!isApprovalRequested || canApproveOrderRequests)
                    const canDelete = canDeleteOrders && isDraft
                    const returnStatus = activeTab === 'sales' ? (row as SalesOrder).returnStatus : 'none'
                    const isFullyReturnedSalesOrder = activeTab === 'sales' && returnStatus === 'full'

                    return (
                        <div
                            key={row.id}
                            className={cn(
                                'p-4 border shadow-sm space-y-4 transition-all active:scale-[0.98] rounded-2xl',
                                isApprovalRequested
                                    ? 'border-violet-300/70 bg-violet-50/70 dark:border-violet-800/60 dark:bg-violet-950/20'
                                    : 'bg-background'
                            )}
                        >
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-primary">{row.orderNumber}</span>
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-primary/10 text-primary">
                                            {activeTab === 'sales' ? t('orders.tabs.sales') : t('orders.tabs.purchase')}
                                        </span>
                                        {activeTab === 'sales' && (row as SalesOrder).sourceChannel === 'marketplace' ? (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20">
                                                {t('ecommerce.title', { defaultValue: 'E-Commerce' })}
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="text-base font-bold text-foreground">
                                        {activeTab === 'sales' ? (row as SalesOrder).customerName : (row as PurchaseOrder).supplierName}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                        {summary}
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1.5 text-right">
                                    <OrderStatusBadge
                                        status={isApprovalRequested ? 'approval_requested' : row.status}
                                        label={isApprovalRequested
                                            ? t('orders.status.requested', { defaultValue: 'Requested' })
                                            : formatStatusLabel(t, row.status)}
                                    />
                                    {returnStatus === 'full' ? (
                                        <OrderStatusBadge status="returned" label={t('sales.return.returnedStatus') || 'Returned'} />
                                    ) : returnStatus === 'partial' ? (
                                        <OrderStatusBadge status="partially_returned" label={t('sales.return.partialReturn') || 'Partially Returned'} />
                                    ) : null}
                                    <div className="text-xs text-muted-foreground mt-2 font-medium">
                                        {formatDate(row.updatedAt)}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 py-3 border-y border-border/50">
                                <div className="text-center">
                                    <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">{t('orders.table.items') || 'Items'}</div>
                                    <div className="text-[11px] font-bold">{row.items.length}</div>
                                </div>
                                <div className="text-center border-l border-border/50">
                                    <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">{t('common.total') || 'Total'}</div>
                                    <div className="text-[11px] font-bold text-primary">{formatCurrency(row.total, row.currency, features.iqd_display_preference)}</div>
                                </div>
                                <div className="text-center border-l border-border/50">
                                    <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">{t('pos.paymentMethod') || 'Payment'}</div>
                                    <div className={cn(
                                        "text-[11px] font-bold flex items-center justify-center gap-1",
                                        isFullyReturnedSalesOrder
                                            ? 'text-rose-600'
                                            : getOrderPaymentStatus(row) === 'paid'
                                                ? "text-emerald-600"
                                                : getOrderPaymentStatus(row) === 'partial'
                                                    ? "text-sky-600"
                                                    : "text-amber-600"
                                    )}>
                                        {formatPaymentStatus(t, row)}
                                        {row.isLocked && <Lock className="h-2.5 w-2.5 text-muted-foreground" />}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                                <Button variant="outline" size="sm" allowViewer={true} className="flex-1 h-9 rounded-xl font-bold gap-2 text-xs" onClick={() => navigate(`/orders/${row.id}`)}>
                                    <Eye className="w-3.5 h-3.5" />
                                    {t('common.view') || 'View'}
                                </Button>
                                {activeTab === 'sales' ? (
                                    <>
                                        {isApprovalRequested && canApproveOrderRequests && renderWorkflowActionButton({ orderId: row.id, actionName: 'approve', label: t('orders.actions.approve', { defaultValue: 'Approve' }), className: 'h-9 rounded-xl px-3 text-[10px] font-bold uppercase shadow-sm ring-1 ring-primary/20', onClick: () => runWorkflowAction(row.id, 'approve', () => approveSalesOrderRequest(row.id, user?.id ?? null), t('orders.actions.approveRequestSuccess', { defaultValue: 'Order request approved' })) })}
                                        {!isApprovalRequested && canManageOrders && row.status === 'draft' && renderWorkflowActionButton({ orderId: row.id, actionName: 'reserve', label: t('orders.actions.reserve') || 'Reserve', className: 'h-9 rounded-xl px-3 text-[10px] font-bold uppercase shadow-sm ring-1 ring-primary/20', onClick: () => runWorkflowAction(row.id, 'reserve', () => updateSalesOrderStatus(row.id, 'pending'), 'Sales order reserved') })}
                                        {!isApprovalRequested && canManageOrders && row.status === 'pending' && renderWorkflowActionButton({ orderId: row.id, actionName: 'complete', label: t('orders.actions.complete') || 'Complete', className: 'h-9 rounded-xl px-3 text-[10px] font-bold uppercase shadow-sm ring-1 ring-primary/20', onClick: () => runWorkflowAction(row.id, 'complete', () => updateSalesOrderStatus(row.id, 'completed'), 'Sales order completed') })}
                                        {!isApprovalRequested && canManageOrders && (row.status === 'draft' || row.status === 'pending') && <Button variant="outline" size="sm" className="h-9 rounded-xl px-3 text-[10px] font-bold uppercase" onClick={() => setCancelConfirm({ isOpen: true, orderId: row.id, type: 'sales' })}>{t('orders.actions.cancel') || 'Cancel'}</Button>}
                                        {canEdit && <Button variant="outline" size="sm" className="h-9 rounded-xl px-3" onClick={() => openSalesEdit(row as SalesOrder)}><Pencil className="h-3.5 w-3.5" /></Button>}
                                        {!isFullyReturnedSalesOrder && !isApprovalRequested && canManageOrders && !row.isLocked && row.paymentMethod !== 'loan' && row.paymentMethod !== 'installments' && !row.linkedLoanId && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-9 rounded-xl px-3 text-[10px] font-bold uppercase"
                                                onClick={() => row.isPaid
                                                    ? handleOrderUnpay(row as SalesOrder, 'sales')
                                                    : setSettlementTarget(buildSalesOrderPaymentObligation(row as SalesOrder))
                                                }
                                            >
                                                {row.isPaid ? (t('orders.actions.unpay') || 'Unpay') : (t('orders.actions.pay') || 'Pay')}
                                            </Button>
                                        )}
                                        {!isFullyReturnedSalesOrder && !isApprovalRequested && canManageOrders && getOrderPaidAmount(row) > 0 && !row.isLocked && <Button variant="outline" size="sm" className="h-9 rounded-xl px-3" onClick={() => setLockConfirm({ isOpen: true, orderId: row.id, type: 'sales' })}><Lock className="h-3.5 w-3.5" /></Button>}
                                        {canDelete && <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-destructive" onClick={() => setDeleteTarget({ type: 'sales', order: row as SalesOrder })}><Trash2 className="h-4 w-4" /></Button>}
                                    </>
                                ) : (
                                    <>
                                        {isApprovalRequested && canApproveOrderRequests && renderWorkflowActionButton({ orderId: row.id, actionName: 'approve', label: t('orders.actions.approve', { defaultValue: 'Approve' }), className: 'h-9 rounded-xl px-3 text-[10px] font-bold uppercase shadow-sm ring-1 ring-primary/20', onClick: () => runWorkflowAction(row.id, 'approve', () => approvePurchaseOrderRequest(row.id, user?.id ?? null), t('orders.actions.approveRequestSuccess', { defaultValue: 'Order request approved' })) })}
                                        {!isApprovalRequested && canManageOrders && row.status === 'draft' && renderWorkflowActionButton({ orderId: row.id, actionName: 'order', label: t('orders.actions.order') || 'Order', className: 'h-9 rounded-xl px-3 text-[10px] font-bold uppercase shadow-sm ring-1 ring-primary/20', onClick: () => runWorkflowAction(row.id, 'order', () => updatePurchaseOrderStatus(row.id, 'ordered'), 'Purchase order placed') })}
                                        {!isApprovalRequested && canManageOrders && row.status === 'ordered' && renderWorkflowActionButton({ orderId: row.id, actionName: 'receive', label: t('orders.actions.receive') || 'Receive', className: 'h-9 rounded-xl px-3 text-[10px] font-bold uppercase shadow-sm ring-1 ring-primary/20', onClick: () => runWorkflowAction(row.id, 'receive', () => updatePurchaseOrderStatus(row.id, 'received'), 'Purchase order received') })}
                                        {!isApprovalRequested && canManageOrders && row.status === 'received' && renderWorkflowActionButton({ orderId: row.id, actionName: 'complete', label: t('orders.actions.complete') || 'Complete', className: 'h-9 rounded-xl px-3 text-[10px] font-bold uppercase shadow-sm ring-1 ring-primary/20', onClick: () => runWorkflowAction(row.id, 'complete', () => updatePurchaseOrderStatus(row.id, 'completed'), 'Purchase order completed') })}
                                        {!isApprovalRequested && canManageOrders && (row.status === 'draft' || row.status === 'ordered') && <Button variant="outline" size="sm" className="h-9 rounded-xl px-3 text-[10px] font-bold uppercase" onClick={() => setCancelConfirm({ isOpen: true, orderId: row.id, type: 'purchase' })}>{t('orders.actions.cancel') || 'Cancel'}</Button>}
                                        {canEdit && <Button variant="outline" size="sm" className="h-9 rounded-xl px-3" onClick={() => openPurchaseEdit(row as PurchaseOrder)}><Pencil className="h-3.5 w-3.5" /></Button>}
                                        {!isApprovalRequested && canManageOrders && !row.isLocked && row.paymentMethod !== 'loan' && row.paymentMethod !== 'installments' && !row.linkedLoanId && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-9 rounded-xl px-3 text-[10px] font-bold uppercase"
                                                onClick={() => row.isPaid
                                                    ? handleOrderUnpay(row as PurchaseOrder, 'purchase')
                                                    : setSettlementTarget(buildPurchaseOrderPaymentObligation(row as PurchaseOrder))
                                                }
                                            >
                                                {row.isPaid ? (t('orders.actions.unpay') || 'Unpay') : (t('orders.actions.pay') || 'Pay')}
                                            </Button>
                                        )}
                                        {!isApprovalRequested && canManageOrders && row.isPaid && !row.isLocked && <Button variant="outline" size="sm" className="h-9 rounded-xl px-3" onClick={() => setLockConfirm({ isOpen: true, orderId: row.id, type: 'purchase' })}><Lock className="h-3.5 w-3.5" /></Button>}
                                        {canDelete && <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-destructive" onClick={() => setDeleteTarget({ type: 'purchase', order: row as PurchaseOrder })}><Trash2 className="h-4 w-4" /></Button>}
                                    </>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    }

    const salesDisabled = products.length === 0
    const purchaseDisabled = products.length === 0

    return (
        <div className="space-y-6" data-tour-id="tutorial-orders-landing">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
                        <ShoppingCart className="h-6 w-6 text-primary" />
                        {t('orders.title') || 'Orders'}
                        {getDateDisplay() && (
                            <span className="text-sm font-semibold text-muted-foreground bg-muted/40 px-2.5 py-0.5 rounded-lg border border-border/50 translate-y-[1px]">
                                {getDateDisplay()}
                            </span>
                        )}
                    </h1>
                    <p className="text-muted-foreground">{t('orders.subtitle') || 'Track sales and purchase orders'}</p>
                </div>
                <div className="flex flex-col sm:flex-row lg:items-center gap-4 self-start lg:self-auto w-full lg:w-auto">
                    <DateRangeFilters />
                    {canManageOrders && (
                        <Button
                            className="gap-2 self-start sm:self-center w-full sm:w-auto rounded-xl"
                            onClick={() => navigate(activeTab === 'sales' ? '/orders/new/sales' : '/orders/new/purchase')}
                            disabled={(activeTab === 'sales' && salesDisabled) || (activeTab === 'purchase' && purchaseDisabled)}
                        >
                            <Plus className="h-4 w-4" />
                            {activeTab === 'sales' ? (t('orders.form.newSalesOrder') || 'New Sales Order') : (t('orders.form.newPurchaseOrder') || 'New Purchase Order')}
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">{t('orders.tabs.sales') || 'Sales Orders'}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black">{salesOrders.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">{t('orders.tabs.purchase') || 'Purchase Orders'}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black">{purchaseOrders.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">{t('budget.status.pending') || 'Pending'}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black">
                            {salesOrders.filter((order) => order.status === 'pending').length + purchaseOrders.filter((order) => order.status === 'ordered').length}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <Tabs
                        value={activeTab}
                        onValueChange={(value) => { setActiveTab(value as OrderTab); navigate(value === 'sales' ? '/orders/sales' : '/orders/purchase') }}
                        className="w-full"
                        dir={i18n.dir()}
                    >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
                                <TabsList className="w-full sm:w-auto">
                                    <TabsTrigger value="sales" className="flex-1 gap-1.5 sm:flex-none">
                                        <ShoppingCart className="h-4 w-4" />
                                        {t('orders.tabs.sales') || 'Sales Orders'}
                                    </TabsTrigger>
                                    <TabsTrigger value="purchase" className="flex-1 gap-1.5 sm:flex-none">
                                        <Truck className="h-4 w-4" />
                                        {t('orders.tabs.purchase') || 'Purchase Orders'}
                                    </TabsTrigger>
                                </TabsList>

                                <div className="flex flex-wrap items-center gap-2">
                                    {/* Status Filter */}
                                    <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border border-border/40">
                                        {(['all', 'draft', 'ordered', 'received', 'completed'] as const).map((value) => (
                                            <button
                                                key={value}
                                                onClick={() => setStatusFilter(value)}
                                                className={cn(
                                                    'px-2.5 py-1 text-[10px] sm:text-xs rounded-md font-bold uppercase transition-all whitespace-nowrap',
                                                    statusFilter === value
                                                        ? 'bg-primary text-primary-foreground shadow-sm'
                                                        : 'text-muted-foreground hover:bg-background/80'
                                                )}
                                            >
                                                {value === 'all' ? (t('common.all') || 'All') : t(`orders.status.${value}`) || value}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Payment Filter */}
                                    <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border border-border/40">
                                        {(['all', 'paid', 'unpaid'] as const).map((value) => (
                                            <button
                                                key={value}
                                                onClick={() => setPaymentFilter(value)}
                                                className={cn(
                                                    'px-2.5 py-1 text-[10px] sm:text-xs rounded-md font-bold uppercase transition-all whitespace-nowrap',
                                                    paymentFilter === value
                                                        ? 'bg-primary text-primary-foreground shadow-sm'
                                                        : 'text-muted-foreground hover:bg-background/80'
                                                )}
                                            >
                                                {value === 'all' ? (t('common.all') || 'All') : t(`budget.status.${value}`) || value}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col lg:flex-row gap-4 items-center w-full lg:w-auto">
                                <div className="relative w-full max-w-sm">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                        allowViewer={true}
                                        placeholder={activeTab === 'sales'
                                            ? (t('orders.placeholder.searchSales') || 'Search sales orders...')
                                            : (t('orders.placeholder.searchPurchase') || 'Search purchase orders...')}
                                        className="pl-9"
                                    />
                                </div>
                                {!isMobile() && (
                                    <div className="flex items-center bg-muted/30 p-1 rounded-lg border border-border/40 ml-auto">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            allowViewer={true}
                                            onClick={() => setViewMode('table')}
                                            className={cn(
                                                "h-7 px-3 font-bold uppercase text-[9px] flex items-center gap-1.5 transition-all text-primary",
                                                viewMode === 'table'
                                                    ? "bg-primary text-primary-foreground shadow-sm"
                                                    : "text-muted-foreground hover:bg-background/50"
                                            )}
                                        >
                                            <List className="w-3" />
                                            {t('orders.view.table')}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            allowViewer={true}
                                            onClick={() => setViewMode('grid')}
                                            className={cn(
                                                "h-7 px-3 font-bold uppercase text-[9px] flex items-center gap-1.5 transition-all text-primary",
                                                viewMode === 'grid'
                                                    ? "bg-primary text-primary-foreground shadow-sm"
                                                    : "text-muted-foreground hover:bg-background/50"
                                            )}
                                        >
                                            <LayoutGrid className="w-3" />
                                            {t('orders.view.grid')}
                                        </Button>
                                    </div>
                                )}
                                <Button variant="outline" allowViewer={true} onClick={() => setShowPrintPreview(true)} className="gap-2 print:hidden">
                                    <Printer className="w-4 h-4" />
                                    {t('common.print') || 'Print'}
                                </Button>
                            </div>
                        </div>
                        <TabsContent value="sales" className="mt-0">
                            {salesDisabled && (
                                <div className="mb-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                                    {customers.length === 0 ? (t('orders.noCustomers') || 'Add customers before creating orders.') : 'Add products before creating orders.'}
                                </div>
                            )}
                            {isMobile() || viewMode === 'grid' ? renderOrderGrid() : renderOrderTable()}
                        </TabsContent>
                        <TabsContent value="purchase" className="mt-0">
                            {purchaseDisabled && (
                                <div className="mb-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                                    {suppliers.length === 0 ? 'Add suppliers before creating purchase orders.' : 'Add products before creating purchase orders.'}
                                </div>
                            )}
                            {isMobile() || viewMode === 'grid' ? renderOrderGrid() : renderOrderTable()}
                        </TabsContent>
                    </Tabs>
                </CardHeader>
            </Card>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent layout="structured" className="max-w-6xl sm:w-[calc(100vw-2rem)] sm:max-h-[calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-2rem)]">
                    <DialogHeader layout="structured">
                        <DialogTitle className="text-xl">
                            {activeTab === 'sales'
                                ? (editingSalesOrder ? (t('orders.form.editSalesOrder') || 'Edit Sales Order') : (t('orders.form.newSalesOrder') || 'New Sales Order'))
                                : (editingPurchaseOrder ? (t('orders.form.editPurchaseOrder') || 'Edit Purchase Order') : (t('orders.form.newPurchaseOrder') || 'New Purchase Order'))}
                        </DialogTitle>
                        <p className="text-sm text-muted-foreground">
                            {activeTab === 'sales'
                                ? 'Choose the customer and assign a source storage to each line before reserving stock.'
                                : 'Choose the supplier and assign a target storage to each line before posting stock.'}
                        </p>
                    </DialogHeader>

                    {activeTab === 'sales' ? (
                        <form onSubmit={handleSalesSubmit} className="flex min-h-0 flex-1 flex-col">
                            <DialogBody>
                                <div className="mb-6 grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-2xl border bg-background/90 p-3 shadow-sm sm:p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                                <UsersRound className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                                    {t('orders.form.customer') || 'Customer'}
                                                </p>
                                                <p className="truncate text-sm font-semibold">{selectedCustomerName}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border bg-background/90 p-3 shadow-sm sm:p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                                <Warehouse className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                                    {t('orders.form.sourceStorage', { defaultValue: 'Source Storage' })}
                                                </p>
                                                <p className="truncate text-sm font-semibold">{selectedSalesStorageName}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border bg-background/90 p-3 shadow-sm sm:p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                                <Wallet className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                                    {t('common.total') || 'Total'}
                                                </p>
                                                <p className="truncate text-sm font-semibold">
                                                    {formatCurrency(salesPreview, salesForm.currency, features.iqd_display_preference)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.95fr)]">
                                    <Card className="border-border/60 shadow-sm">
                                        <CardHeader className="flex flex-col items-start justify-between gap-4 space-y-0 sm:flex-row">
                                            <div className="space-y-1">
                                                <CardTitle>{t('orders.form.addProducts') || 'Add Products'}</CardTitle>
                                                <p className="text-sm text-muted-foreground">
                                                    Pick the source storage inside each line so availability is checked against the right stock position.
                                                </p>
                                            </div>
                                            <Button type="button" variant="outline" size="sm" onClick={() => setSalesForm((current) => ({ ...current, items: [...current.items, createEmptyItem(current.items[current.items.length - 1]?.storageId || current.sourceStorageId || defaultStorageId)] }))}>
                                                <Plus className="mr-1 h-3.5 w-3.5" />
                                                {t('orders.form.addItem') || 'Add Item'}
                                            </Button>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            {salesForm.items.map((item, index) => {
                                                const product = products.find((entry) => entry.id === item.productId)
                                                const lineTotal = roundFormAmount((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))

                                                return (
                                                    <div key={`sales-item-${index}`} className="grid gap-3 rounded-2xl border bg-background p-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_110px_140px_40px]">
                                                        <div className="space-y-2">
                                                            <Label className="md:hidden">{t('orders.form.table.product') || 'Product'}</Label>
                                                            <Select value={item.productId} onValueChange={(value) => updateSalesItem(index, { productId: value })}>
                                                                <SelectTrigger><SelectValue placeholder={t('orders.form.selectProduct') || 'Select Product'} /></SelectTrigger>
                                                                <SelectContent>
                                                                    {getSalesProductOptions(item.storageId, item.productId).map((productOption) => (
                                                                        <SelectItem key={productOption.id} value={productOption.id}>{productOption.name}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="md:hidden">{t('orders.form.sourceStorage', { defaultValue: 'Source Storage' })}</Label>
                                                            <Select value={item.storageId} onValueChange={(value) => updateSalesItem(index, { storageId: value })}>
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
                                                                    ? `Available in ${getStorageDisplayName(item.storageId)}: ${getAvailableQuantity(item.productId, item.storageId)}`
                                                                    : 'Choose a storage for this line before checking stock.'}
                                                            </p>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="md:hidden">{t('orders.form.table.qty') || 'Qty'}</Label>
                                                            <Input type="number" min={isDynamicUnit(product?.unit) ? ORDER_DECIMAL_STEP : '1'} step={isDynamicUnit(product?.unit) ? ORDER_DECIMAL_STEP : '1'} value={item.quantity} onChange={(event) => updateSalesItem(index, { quantity: event.target.value })} placeholder={t('common.quantity') || 'Quantity'} />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="md:hidden">{t('orders.form.table.price') || 'Unit Price'}</Label>
                                                            <Input type="number" min="0" step={ORDER_DECIMAL_STEP} value={item.unitPrice} onChange={(event) => updateSalesItem(index, { unitPrice: event.target.value })} placeholder={t('common.price') || 'Price'} />
                                                        </div>
                                                        <div className="flex items-start justify-end">
                                                            <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => setSalesForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                        <div className="flex items-center justify-between text-xs text-muted-foreground md:col-span-5">
                                                            <span>{product?.sku ? `SKU: ${product.sku}` : '\u00A0'}</span>
                                                            <span>{(t('orders.form.table.total') || 'Total')}: {formatCurrency(lineTotal, salesForm.currency, features.iqd_display_preference)}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </CardContent>
                                    </Card>

                                    <div className="space-y-6">
                                        <Card className="border-border/60 shadow-sm">
                                            <CardHeader className="space-y-1">
                                                <CardTitle>Order Setup</CardTitle>
                                                <p className="text-sm text-muted-foreground">
                                                    Customer, payment, and fulfillment details in one place.
                                                </p>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label>{t('orders.form.customer') || 'Customer'}</Label>
                                                    <Select value={salesForm.customerId} onValueChange={(value) => {
                                                        const customer = customers.find((entry) => entry.id === value)
                                                        setSalesForm((current) => ({ ...current, customerId: value, currency: customer?.defaultCurrency || current.currency }))
                                                    }}>
                                                        <SelectTrigger><SelectValue placeholder={t('orders.form.selectCustomer') || 'Select Customer'} /></SelectTrigger>
                                                        <SelectContent>
                                                            {customers.map((customer) => (
                                                                <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="grid gap-4 sm:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <Label htmlFor="sales-delivery" className="flex items-center gap-2">
                                                            <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                                            {t('orders.form.date') || 'Date'}
                                                        </Label>
                                                        <DateTimePicker
                                                            id="sales-delivery"
                                                            mode="date-time"
                                                            date={parseLocalDateTimeValue(salesForm.expectedDeliveryDate)}
                                                            setDate={(value) => setSalesForm((current) => ({
                                                                ...current,
                                                                expectedDeliveryDate: value ? formatLocalDateTimeValue(value) : ''
                                                            }))}
                                                            placeholder={t('orders.form.date') || 'Date'}
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>{t('orders.form.currency') || 'Currency'}</Label>
                                                        <Input value={salesForm.currency.toUpperCase()} disabled />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="sales-payment" className="flex items-center gap-2">
                                                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                                                        {t('pos.paymentMethod') || 'Payment Method'}
                                                    </Label>
                                                    <PaymentMethodSelect
                                                        id="sales-payment"
                                                        value={salesForm.paymentMethod as PaymentMethodOption}
                                                        onValueChange={(value) => setSalesForm((current) => ({ ...current, paymentMethod: value }))}
                                                        methods={['cash', 'bank_transfer'] as const}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between rounded-2xl border bg-muted/20 px-4 py-3">
                                                    <div>
                                                        <div className="text-sm font-medium">Paid on save</div>
                                                        <div className="text-xs text-muted-foreground">Mark the order as already settled.</div>
                                                    </div>
                                                    <Switch checked={salesForm.isPaid} onCheckedChange={(checked) => setSalesForm((current) => ({ ...current, isPaid: checked }))} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="sales-shipping" className="flex items-center gap-2">
                                                        <Truck className="h-4 w-4 text-muted-foreground" />
                                                        {t('orders.form.shippingAddress') || 'Shipping Address'}
                                                    </Label>
                                                    <Textarea id="sales-shipping" rows={3} value={salesForm.shippingAddress} onChange={(event) => setSalesForm((current) => ({ ...current, shippingAddress: event.target.value }))} placeholder={t('orders.form.shippingPlaceholder') || 'Enter shipping address...'} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="sales-notes">{t('orders.form.notes') || 'Notes'}</Label>
                                                    <Textarea id="sales-notes" rows={3} value={salesForm.notes} onChange={(event) => setSalesForm((current) => ({ ...current, notes: event.target.value }))} />
                                                </div>
                                            </CardContent>
                                        </Card>

                                        <Card className="border-border/60 shadow-sm">
                                            <CardHeader className="space-y-1">
                                                <CardTitle>Commercials</CardTitle>
                                                <p className="text-sm text-muted-foreground">
                                                    Review pricing and settlement before saving the draft.
                                                </p>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="grid gap-4 sm:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <Label htmlFor="sales-discount">{t('orders.form.discount') || 'Discount'}</Label>
                                                        <Input id="sales-discount" type="number" min="0" step={ORDER_DECIMAL_STEP} value={salesForm.discount} onChange={(event) => setSalesForm((current) => ({ ...current, discount: event.target.value }))} />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label htmlFor="sales-tax">{t('orders.form.tax') || 'Tax'}</Label>
                                                        <Input id="sales-tax" type="number" min="0" step={ORDER_DECIMAL_STEP} value={salesForm.tax} onChange={(event) => setSalesForm((current) => ({ ...current, tax: event.target.value }))} />
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl border bg-muted/30 p-4">
                                                    <div className="flex items-center justify-between text-sm">
                                                        <span>Items configured</span>
                                                        <span className="font-semibold">{salesConfiguredItemsCount}</span>
                                                    </div>
                                                    <div className="mt-2 flex items-center justify-between text-sm">
                                                        <span>{t('pos.paymentMethod') || 'Payment Method'}</span>
                                                        <span className="font-medium">{getPaymentMethodLabel(salesForm.paymentMethod)}</span>
                                                    </div>
                                                    <div className="mt-2 flex items-center justify-between text-sm">
                                                        <span>{t('common.total') || 'Total'}</span>
                                                        <span className="text-xl font-black">{formatCurrency(salesPreview, salesForm.currency, features.iqd_display_preference)}</span>
                                                    </div>
                                                    <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                                                        <Wallet className="mt-0.5 h-4 w-4" />
                                                        <span>{salesForm.isPaid ? 'This order will start as paid.' : 'This order will start as unpaid until payment is posted.'}</span>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </DialogBody>

                            <DialogFooter layout="structured">
                                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setDialogOpen(false)}>{t('common.cancel') || 'Cancel'}</Button>
                                <Button type="submit" className="w-full sm:w-auto" disabled={isSaving}>
                                    {isSaving ? (t('common.loading') || 'Loading...') : (editingSalesOrder ? (t('common.save') || 'Save') : (t('orders.form.saveOrder') || 'Save Order'))}
                                </Button>
                            </DialogFooter>
                        </form>
                    ) : (
                        <form onSubmit={handlePurchaseSubmit} className="flex min-h-0 flex-1 flex-col">
                            <DialogBody>
                                <div className="mb-6 grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-2xl border bg-background/90 p-3 shadow-sm sm:p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                                <Truck className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                                    {t('orders.form.supplier') || 'Supplier'}
                                                </p>
                                                <p className="truncate text-sm font-semibold">{selectedSupplierName}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border bg-background/90 p-3 shadow-sm sm:p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                                <Warehouse className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                                    {t('orders.form.destinationStorage', { defaultValue: 'Target Storage' })}
                                                </p>
                                                <p className="truncate text-sm font-semibold">{selectedPurchaseStorageName}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border bg-background/90 p-3 shadow-sm sm:p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                                <Wallet className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                                    {t('common.total') || 'Total'}
                                                </p>
                                                <p className="truncate text-sm font-semibold">
                                                    {formatCurrency(purchasePreview, purchaseForm.currency, features.iqd_display_preference)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.95fr)]">
                                    <Card className="border-border/60 shadow-sm">
                                        <CardHeader className="flex flex-col items-start justify-between gap-4 space-y-0 sm:flex-row">
                                            <div className="space-y-1">
                                                <CardTitle>{t('orders.form.addProducts') || 'Add Products'}</CardTitle>
                                                <p className="text-sm text-muted-foreground">
                                                    Pick the target storage inside each line so every received product lands in the right place.
                                                </p>
                                            </div>
                                            <Button type="button" variant="outline" size="sm" onClick={() => setPurchaseForm((current) => ({ ...current, items: [...current.items, createEmptyItem(current.items[current.items.length - 1]?.storageId || current.destinationStorageId || defaultStorageId)] }))}>
                                                <Plus className="mr-1 h-3.5 w-3.5" />
                                                {t('orders.form.addItem') || 'Add Item'}
                                            </Button>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            {purchaseForm.items.map((item, index) => {
                                                const product = products.find((entry) => entry.id === item.productId)
                                                const lineTotal = roundFormAmount((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))
                                                const createsBatch = product
                                                    ? shouldCreatePurchaseCostBatch(
                                                        convertCurrencyAmountWithLiveRates(
                                                            Number(item.unitPrice) || 0,
                                                            purchaseForm.currency,
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
                                                            <Label className="md:hidden">{t('orders.form.table.product') || 'Product'}</Label>
                                                            <Select value={item.productId} onValueChange={(value) => updatePurchaseItem(index, { productId: value })}>
                                                                <SelectTrigger><SelectValue placeholder={t('orders.form.selectProduct') || 'Select Product'} /></SelectTrigger>
                                                                <SelectContent>
                                                                    {products.map((productOption) => (
                                                                        <SelectItem key={productOption.id} value={productOption.id}>{productOption.name}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="md:hidden">{t('orders.form.destinationStorage', { defaultValue: 'Target Storage' })}</Label>
                                                            <Select value={item.storageId} onValueChange={(value) => updatePurchaseItem(index, { storageId: value })}>
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
                                                                    ? `Will be received into ${getStorageDisplayName(item.storageId)} when the order is completed.`
                                                                    : 'Choose a target storage for this line.'}
                                                            </p>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="md:hidden">{t('orders.form.table.qty') || 'Qty'}</Label>
                                                            <Input type="number" min={isDynamicUnit(product?.unit) ? ORDER_DECIMAL_STEP : '1'} step={isDynamicUnit(product?.unit) ? ORDER_DECIMAL_STEP : '1'} value={item.quantity} onChange={(event) => updatePurchaseItem(index, { quantity: event.target.value })} placeholder={t('common.quantity') || 'Quantity'} />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="md:hidden">{t('orders.form.table.price') || 'Unit Price'}</Label>
                                                            <Input type="number" min="0" step={ORDER_DECIMAL_STEP} value={item.unitPrice} onChange={(event) => updatePurchaseItem(index, { unitPrice: event.target.value })} placeholder={t('common.price') || 'Price'} />
                                                        </div>
                                                        <div className="flex items-start justify-end">
                                                            <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => setPurchaseForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                        <div className="flex items-center justify-between text-xs text-muted-foreground md:col-span-5">
                                                            <span>{product?.sku ? `SKU: ${product.sku}` : '\u00A0'}</span>
                                                            <span>{(t('orders.form.table.total') || 'Total')}: {formatCurrency(lineTotal, purchaseForm.currency, features.iqd_display_preference)}</span>
                                                        </div>
                                                        {createsBatch && <div className="grid gap-3 border-t pt-3 md:col-span-5 md:grid-cols-4">
                                                            <div className="space-y-2">
                                                                <Label>Batch / Lot Number</Label>
                                                                <Input value={item.batchNumber} onChange={(event) => updatePurchaseItem(index, { batchNumber: event.target.value })} placeholder="Auto-generated" />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label>Batch Selling Price{product ? ` (${product.currency.toUpperCase()})` : ''}</Label>
                                                                <Input type="number" min="0" step={ORDER_DECIMAL_STEP} value={item.batchSalePrice} onChange={(event) => updatePurchaseItem(index, { batchSalePrice: event.target.value })} placeholder={product ? String(product.price) : '0'} />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label>Manufacturing Date</Label>
                                                                <Input type="date" value={item.batchManufacturingDate} onChange={(event) => updatePurchaseItem(index, { batchManufacturingDate: event.target.value })} />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label>Expiry Date</Label>
                                                                <Input type="date" value={item.batchExpiryDate} onChange={(event) => updatePurchaseItem(index, { batchExpiryDate: event.target.value })} />
                                                            </div>
                                                        </div>}
                                                    </div>
                                                )
                                            })}
                                        </CardContent>
                                    </Card>

                                    <div className="space-y-6">
                                        <Card className="border-border/60 shadow-sm">
                                            <CardHeader className="space-y-1">
                                                <CardTitle>Order Setup</CardTitle>
                                                <p className="text-sm text-muted-foreground">
                                                    Supplier, payment, and receiving notes in one place.
                                                </p>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label>{t('orders.form.supplier') || 'Supplier'}</Label>
                                                    <Select value={purchaseForm.supplierId} onValueChange={(value) => {
                                                        const supplier = suppliers.find((entry) => entry.id === value)
                                                        setPurchaseForm((current) => ({ ...current, supplierId: value, currency: supplier?.defaultCurrency || current.currency }))
                                                    }}>
                                                        <SelectTrigger><SelectValue placeholder={t('orders.form.selectSupplier') || 'Select Supplier'} /></SelectTrigger>
                                                        <SelectContent>
                                                            {suppliers.map((supplier) => (
                                                                <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="grid gap-4 sm:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <Label htmlFor="purchase-delivery" className="flex items-center gap-2">
                                                            <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                                            {t('orders.form.date') || 'Date'}
                                                        </Label>
                                                        <DateTimePicker
                                                            id="purchase-delivery"
                                                            mode="date-time"
                                                            date={parseLocalDateTimeValue(purchaseForm.expectedDeliveryDate)}
                                                            setDate={(value) => setPurchaseForm((current) => ({
                                                                ...current,
                                                                expectedDeliveryDate: value ? formatLocalDateTimeValue(value) : ''
                                                            }))}
                                                            placeholder={t('orders.form.date') || 'Date'}
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>{t('orders.form.currency') || 'Currency'}</Label>
                                                        <Input value={purchaseForm.currency.toUpperCase()} disabled />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="purchase-payment" className="flex items-center gap-2">
                                                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                                                        {t('pos.paymentMethod') || 'Payment Method'}
                                                    </Label>
                                                    <PaymentMethodSelect
                                                        id="purchase-payment"
                                                        value={purchaseForm.paymentMethod as PaymentMethodOption}
                                                        onValueChange={(value) => setPurchaseForm((current) => ({ ...current, paymentMethod: value }))}
                                                        methods={['cash', 'bank_transfer'] as const}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between rounded-2xl border bg-muted/20 px-4 py-3">
                                                    <div>
                                                        <div className="text-sm font-medium">Paid on save</div>
                                                        <div className="text-xs text-muted-foreground">Record the order as already settled.</div>
                                                    </div>
                                                    <Switch checked={purchaseForm.isPaid} onCheckedChange={(checked) => setPurchaseForm((current) => ({ ...current, isPaid: checked }))} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="purchase-notes">{t('orders.form.notes') || 'Notes'}</Label>
                                                    <Textarea id="purchase-notes" rows={4} value={purchaseForm.notes} onChange={(event) => setPurchaseForm((current) => ({ ...current, notes: event.target.value }))} />
                                                </div>
                                            </CardContent>
                                        </Card>

                                        <Card className="border-border/60 shadow-sm">
                                            <CardHeader className="space-y-1">
                                                <CardTitle>Commercials</CardTitle>
                                                <p className="text-sm text-muted-foreground">
                                                    Review purchase totals and where incoming stock will land.
                                                </p>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label htmlFor="purchase-discount">{t('orders.form.discount') || 'Discount'}</Label>
                                                    <Input id="purchase-discount" type="number" min="0" step={ORDER_DECIMAL_STEP} value={purchaseForm.discount} onChange={(event) => setPurchaseForm((current) => ({ ...current, discount: event.target.value }))} />
                                                </div>
                                                <div className="rounded-2xl border bg-muted/30 p-4">
                                                    <div className="flex items-center justify-between text-sm">
                                                        <span>Items configured</span>
                                                        <span className="font-semibold">{purchaseConfiguredItemsCount}</span>
                                                    </div>
                                                    <div className="mt-2 flex items-center justify-between text-sm">
                                                        <span>{t('pos.paymentMethod') || 'Payment Method'}</span>
                                                        <span className="font-medium">{getPaymentMethodLabel(purchaseForm.paymentMethod)}</span>
                                                    </div>
                                                    <div className="mt-2 flex items-center justify-between text-sm">
                                                        <span>{t('common.total') || 'Total'}</span>
                                                        <span className="text-xl font-black">{formatCurrency(purchasePreview, purchaseForm.currency, features.iqd_display_preference)}</span>
                                                    </div>
                                                    <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                                                        <PackagePlus className="mt-0.5 h-4 w-4" />
                                                        <span>{`Completing this order will add stock to ${selectedPurchaseStorageName}.`}</span>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </DialogBody>

                            <DialogFooter layout="structured">
                                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setDialogOpen(false)}>{t('common.cancel') || 'Cancel'}</Button>
                                <Button type="submit" className="w-full sm:w-auto" disabled={isSaving}>
                                    {isSaving ? (t('common.loading') || 'Loading...') : (editingPurchaseOrder ? (t('common.save') || 'Save') : (t('orders.form.saveOrder') || 'Save Order'))}
                                </Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            <SettlementDialog
                open={!!settlementTarget}
                onOpenChange={(open) => {
                    if (!open) {
                        setSettlementTarget(null)
                    }
                }}
                obligation={settlementTarget}
                isSubmitting={isSubmittingSettlement}
                onSubmit={handleOrderSettlement}
            />

            <DeleteConfirmationModal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDeleteConfirm}
                itemName={deleteTarget?.order.orderNumber}
                title={t('orders.confirmDelete') || 'Delete Order'}
                description={t('orders.deleteWarning') || 'This will permanently remove the order record. Associated invoices should be checked.'}
            />

            <Dialog open={lockConfirm.isOpen} onOpenChange={(open) => !open && setLockConfirm({ isOpen: false, orderId: '', type: null })}>
                <DialogContent className="max-w-[400px] rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
                    <div className="bg-gradient-to-b from-amber-500/10 to-transparent p-8 text-center space-y-4">
                        <div className="mx-auto w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mb-2">
                            <Lock className="w-8 h-8 text-amber-600" />
                        </div>
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-black text-center">{t('orders.lockTitle') || 'Lock Order?'}</DialogTitle>
                        </DialogHeader>
                        <p className="text-muted-foreground text-sm font-medium leading-relaxed">
                            {t('orders.lockDescription') || 'Locking this order will prevent any changes to its payment status. This action cannot be undone.'}
                        </p>
                    </div>
                    <DialogFooter className="p-6 pt-2 grid grid-cols-2 gap-3 sm:justify-start">
                        <Button
                            variant="outline"
                            className="rounded-xl h-12 font-bold border-2"
                            onClick={() => setLockConfirm({ isOpen: false, orderId: '', type: null })}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            className="rounded-xl h-12 font-bold bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-600/20"
                            onClick={handleLockConfirm}
                        >
                            {t('orders.actions.lock') || 'Lock Now'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={cancelConfirm.isOpen} onOpenChange={(open) => !open && setCancelConfirm({ isOpen: false, orderId: '', type: null })}>
                <DialogContent className="max-w-[400px] rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
                    <div className="bg-gradient-to-b from-red-500/10 to-transparent p-8 text-center space-y-4">
                        <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mb-2">
                            <XCircle className="w-8 h-8 text-red-600" />
                        </div>
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-black text-center">{t('orders.cancelTitle') || 'Cancel Order?'}</DialogTitle>
                        </DialogHeader>
                        <p className="text-muted-foreground text-sm font-medium leading-relaxed">
                            {t('orders.cancelDescription') || 'Are you sure you want to cancel this order? This action cannot be undone.'}
                        </p>
                    </div>
                    <DialogFooter className="p-6 pt-2 grid grid-cols-2 gap-3 sm:justify-start">
                        <Button
                            variant="outline"
                            className="rounded-xl h-12 font-bold border-2"
                            onClick={() => setCancelConfirm({ isOpen: false, orderId: '', type: null })}
                        >
                            {t('common.back') || 'Back'}
                        </Button>
                        <Button
                            className="rounded-xl h-12 font-bold bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20"
                            onClick={handleCancelConfirm}
                        >
                            {t('orders.actions.cancel') || 'Cancel Order'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <PrintPreviewModal
                isOpen={showPrintPreview}
                onClose={() => setShowPrintPreview(false)}
                onConfirm={() => setShowPrintPreview(false)}
                title={activeTab === 'sales' ? (t('orders.tabs.sales') || 'Sales Orders') : (t('orders.tabs.purchase') || 'Purchase Orders')}
                module="orders"
                features={features}
                workspaceName={workspaceName}
                originId={getReportOriginId(user?.workspaceId, 'order_report', `orders:${activeTab}`)}
                invoiceData={{
                    invoiceid: `ORDERS-${activeTab.toUpperCase()}`,
                    totalAmount: (activeTab === 'sales' ? filteredSalesOrders : filteredPurchaseOrders).reduce((s, o) => s + o.total, 0),
                    settlementCurrency: features.default_currency || 'usd',
                    origin: 'order_report' as const,
                    createdByName: user?.name || 'Unknown',
                    cashierName: user?.name || 'Unknown',
                    printFormat: 'a4' as const
                }}
                pdfBuilder={async ({ format }: { format: PrintFormat; effectiveId: string }) => {
                    const printLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
                    const orders = activeTab === 'sales' ? filteredSalesOrders : filteredPurchaseOrders
                    const metrics = {
                        totalOrders: orders.length,
                        totalValue: orders.reduce((s, o) => s + o.total, 0),
                        paidCount: orders.filter(o => o.isPaid).length,
                        unpaidCount: orders.filter(o => !o.isPaid).length
                    }
                    return generateTemplatePdf({
                        element: (
                            <OrderListPrintTemplate
                                workspaceName={workspaceName}
                                printLang={printLang}
                                salesOrders={activeTab === 'sales' ? filteredSalesOrders : []}
                                purchaseOrders={activeTab === 'purchase' ? filteredPurchaseOrders : []}
                                activeTab={activeTab}
                                iqdPreference={features.iqd_display_preference}
                                metrics={metrics}
                                logoUrl={features.logo_url}
                            />
                        ),
                        format,
                        printLang,
                    })
                }}
                printTemplate={() => {
                    const printLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
                    const orders = activeTab === 'sales' ? filteredSalesOrders : filteredPurchaseOrders
                    const metrics = {
                        totalOrders: orders.length,
                        totalValue: orders.reduce((s, o) => s + o.total, 0),
                        paidCount: orders.filter(o => o.isPaid).length,
                        unpaidCount: orders.filter(o => !o.isPaid).length
                    }
                    return (
                        <OrderListPrintTemplate
                            workspaceName={workspaceName}
                            printLang={printLang}
                            salesOrders={activeTab === 'sales' ? filteredSalesOrders : []}
                            purchaseOrders={activeTab === 'purchase' ? filteredPurchaseOrders : []}
                            activeTab={activeTab}
                            iqdPreference={features.iqd_display_preference}
                            metrics={metrics}
                            logoUrl={features.logo_url}
                        />
                    )
                }}
            />
        </div>
    )
}

export function Orders() {
    const { user } = useAuth()
    const [, navigate] = useLocation()
    const [salesNewMatch] = useRoute('/orders/new/sales')
    const [purchaseNewMatch] = useRoute('/orders/new/purchase')
    const [salesEditMatch, salesEditParams] = useRoute('/orders/edit/sales/:orderId')
    const [purchaseEditMatch, purchaseEditParams] = useRoute('/orders/edit/purchase/:orderId')
    const [salesTabMatch] = useRoute('/orders/sales')
    const [purchaseTabMatch] = useRoute('/orders/purchase')
    const [detailMatch, params] = useRoute('/orders/:orderId')
    const workspaceId = user?.workspaceId

    if (!workspaceId) {
        return null
    }

    if (salesNewMatch) {
        return (
            <SalesOrderFormPage
                workspaceId={workspaceId}
                onCancel={() => navigate('/orders')}
                onCreated={(orderId) => navigate(`/orders/${orderId}`)}
            />
        )
    }

    if (purchaseNewMatch) {
        return (
            <PurchaseOrderFormPage
                workspaceId={workspaceId}
                onCancel={() => navigate('/orders')}
                onCreated={(orderId) => navigate(`/orders/${orderId}`)}
            />
        )
    }

    if (salesEditMatch && salesEditParams?.orderId) {
        return (
            <SalesOrderFormPage
                workspaceId={workspaceId}
                editingOrderId={salesEditParams.orderId}
                onCancel={() => navigate(`/orders/${salesEditParams.orderId}`)}
                onCreated={(orderId) => navigate(`/orders/${orderId}`)}
            />
        )
    }

    if (purchaseEditMatch && purchaseEditParams?.orderId) {
        return (
            <PurchaseOrderFormPage
                workspaceId={workspaceId}
                editingOrderId={purchaseEditParams.orderId}
                onCancel={() => navigate(`/orders/${purchaseEditParams.orderId}`)}
                onCreated={(orderId) => navigate(`/orders/${orderId}`)}
            />
        )
    }

    if (detailMatch && params?.orderId && params.orderId !== 'sales' && params.orderId !== 'purchase') {
        return <OrderDetailsView workspaceId={workspaceId} orderId={params.orderId} />
    }

    const initialTab: OrderTab = salesTabMatch ? 'sales' : purchaseTabMatch ? 'purchase' : 'sales'
    return <OrdersListView workspaceId={workspaceId} initialTab={initialTab} />
}
