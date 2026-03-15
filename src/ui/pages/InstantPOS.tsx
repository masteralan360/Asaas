import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import { addToOfflineMutations, useCategories, useProducts } from '@/local-db'
import { db } from '@/local-db/database'
import { useWorkspace } from '@/workspace'
import { formatCompactDateTime, formatCurrency, generateId, cn } from '@/lib/utils'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    useToast
} from '@/ui/components'
import { AlertCircle, CheckCircle2, ClipboardList, Minus, Plus, Receipt, Trash2 } from 'lucide-react'
import { normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'

const TICKETS_STORAGE_KEY = 'instant_pos_tickets'
const TICKET_COUNTER_KEY = 'instant_pos_ticket_counter'

type InstantPosStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'paid'

type InstantPosItem = {
    productId: string
    name: string
    sku: string
    unitPrice: number
    quantity: number
    currency: string
}

type InstantPosTicket = {
    id: string
    number: string
    createdAt: string
    status: InstantPosStatus
    items: InstantPosItem[]
    kitchenRoutedAt?: string
}

const STATUS_FLOW: InstantPosStatus[] = ['pending', 'preparing', 'ready', 'served', 'paid']

const STATUS_LABELS: Record<InstantPosStatus, string> = {
    pending: 'Pending',
    preparing: 'Preparing',
    ready: 'Ready',
    served: 'Served',
    paid: 'Paid / Closed'
}

const STATUS_BADGES: Record<InstantPosStatus, string> = {
    pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    preparing: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    ready: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    served: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    paid: 'bg-slate-500/10 text-slate-600 border-slate-500/20'
}

function loadTickets(): InstantPosTicket[] {
    if (typeof window === 'undefined') return []
    try {
        const raw = localStorage.getItem(TICKETS_STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

function saveTickets(tickets: InstantPosTicket[]) {
    if (typeof window === 'undefined') return
    const next = JSON.stringify(tickets)
    const current = localStorage.getItem(TICKETS_STORAGE_KEY)
    if (current === next) return
    localStorage.setItem(TICKETS_STORAGE_KEY, next)
    window.dispatchEvent(new CustomEvent('instant-pos-tickets-updated'))
}

function nextTicketNumber(): string {
    if (typeof window === 'undefined') return 'T-001'
    const current = Number(localStorage.getItem(TICKET_COUNTER_KEY) || '0') + 1
    localStorage.setItem(TICKET_COUNTER_KEY, String(current))
    return `T-${String(current).padStart(3, '0')}`
}

export function InstantPOS() {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const { features, updateSettings } = useWorkspace()
    const products = useProducts(user?.workspaceId)
    const categories = useCategories(user?.workspaceId)

    const [tickets, setTickets] = useState<InstantPosTicket[]>(() => loadTickets())
    const [activeTicketId, setActiveTicketId] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string>('all')
    const [isKdsSaving, setIsKdsSaving] = useState(false)
    const [isCheckoutLoading, setIsCheckoutLoading] = useState(false)

    const settlementCurrency = features.default_currency || 'usd'

    useEffect(() => {
        saveTickets(tickets)
    }, [tickets])

    useEffect(() => {
        const handleStorage = (event: StorageEvent) => {
            if (event.key === TICKETS_STORAGE_KEY) {
                setTickets(loadTickets())
            }
        }
        window.addEventListener('storage', handleStorage)
        return () => window.removeEventListener('storage', handleStorage)
    }, [])

    useEffect(() => {
        if (!tickets.length) {
            setActiveTicketId(null)
            return
        }
        if (!activeTicketId || !tickets.some(ticket => ticket.id === activeTicketId)) {
            setActiveTicketId(tickets[0].id)
        }
    }, [tickets, activeTicketId])

    const activeTicket = useMemo(
        () => tickets.find(ticket => ticket.id === activeTicketId) || null,
        [tickets, activeTicketId]
    )

    const filteredProducts = useMemo(() => {
        const term = search.trim().toLowerCase()
        return products.filter(product => {
            const matchesSearch = !term
                || (product.name || '').toLowerCase().includes(term)
                || (product.sku || '').toLowerCase().includes(term)
            if (!matchesSearch) return false
            if (selectedCategory === 'all') return true
            if (selectedCategory === 'none') return !product.categoryId
            return product.categoryId === selectedCategory
        })
    }, [products, search, selectedCategory])

    const activeTicketTotals = useMemo(() => {
        if (!activeTicket) {
            return { count: 0, total: 0, hasMixedCurrency: false }
        }
        const hasMixedCurrency = activeTicket.items.some(item => item.currency !== settlementCurrency)
        const total = activeTicket.items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0)
        const count = activeTicket.items.reduce((sum, item) => sum + item.quantity, 0)
        return { count, total, hasMixedCurrency }
    }, [activeTicket, settlementCurrency])

    const createTicket = () => {
        const ticket: InstantPosTicket = {
            id: generateId(),
            number: nextTicketNumber(),
            createdAt: new Date().toISOString(),
            status: 'pending',
            items: []
        }
        setTickets(prev => [ticket, ...prev])
        setActiveTicketId(ticket.id)
    }

    const updateTicket = (ticketId: string, updater: (ticket: InstantPosTicket) => InstantPosTicket) => {
        setTickets(prev => prev.map(ticket => (ticket.id === ticketId ? updater(ticket) : ticket)))
    }

    const addItemToTicket = (productId: string) => {
        const product = products.find(item => item.id === productId)
        if (!product) return

        if (!activeTicket) {
            const newTicket: InstantPosTicket = {
                id: generateId(),
                number: nextTicketNumber(),
                createdAt: new Date().toISOString(),
                status: 'pending',
                items: [{
                    productId: product.id,
                    name: product.name,
                    sku: product.sku,
                    unitPrice: product.price,
                    quantity: 1,
                    currency: product.currency
                }]
            }
            setTickets(prev => [newTicket, ...prev])
            setActiveTicketId(newTicket.id)
            return
        }

        updateTicket(activeTicket.id, ticket => {
            const existing = ticket.items.find(item => item.productId === product.id)
            if (existing) {
                const items = ticket.items.map(item =>
                    item.productId === product.id
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                )
                return { ...ticket, items }
            }

            const newItem: InstantPosItem = {
                productId: product.id,
                name: product.name,
                sku: product.sku,
                unitPrice: product.price,
                quantity: 1,
                currency: product.currency
            }

            return { ...ticket, items: [...ticket.items, newItem] }
        })
    }

    const updateItemQuantity = (productId: string, delta: number) => {
        if (!activeTicket) return
        updateTicket(activeTicket.id, ticket => {
            const items = ticket.items
                .map(item => item.productId === productId
                    ? { ...item, quantity: Math.max(1, item.quantity + delta) }
                    : item
                )
            return { ...ticket, items }
        })
    }

    const removeItem = (productId: string) => {
        if (!activeTicket) return
        updateTicket(activeTicket.id, ticket => ({
            ...ticket,
            items: ticket.items.filter(item => item.productId !== productId)
        }))
    }

    const setTicketStatus = (status: InstantPosStatus) => {
        if (!activeTicket) return
        updateTicket(activeTicket.id, ticket => ({
            ...ticket,
            status,
            kitchenRoutedAt: status === 'preparing' && features.kds_enabled
                ? (ticket.kitchenRoutedAt || new Date().toISOString())
                : ticket.kitchenRoutedAt
        }))

        if (status === 'preparing' && features.kds_enabled) {
            toast({
                title: t('common.success') || 'Sent to Kitchen',
                description: t('instantPos.kdsToast') || 'Ticket routed to KDS for preparation.'
            })
        }
    }

    const handleKdsToggle = async (nextValue: boolean) => {
        if (isKdsSaving) return
        setIsKdsSaving(true)
        try {
            await updateSettings({ kds_enabled: nextValue })
            toast({
                title: t('common.success') || 'Success',
                description: nextValue
                    ? (t('instantPos.kdsEnabled') || 'Kitchen routing enabled for Instant POS.')
                    : (t('instantPos.kdsDisabled') || 'Kitchen routing disabled. Cashier handles preparation.')
            })
        } catch (error) {
            const normalized = normalizeSupabaseActionError(error)
            toast({
                title: t('common.error') || 'Error',
                description: normalized.message || (t('instantPos.kdsToggleError') || 'Failed to update kitchen routing.'),
                variant: 'destructive'
            })
        } finally {
            setIsKdsSaving(false)
        }
    }

    const closeTicket = (ticketId: string) => {
        setTickets(prev => prev.filter(ticket => ticket.id !== ticketId))
        if (activeTicketId === ticketId) {
            setActiveTicketId(null)
        }
    }

    const checkoutTicket = async () => {
        if (!activeTicket || !user?.workspaceId || !user?.id) return
        if (activeTicket.items.length === 0) return

        if (activeTicketTotals.hasMixedCurrency) {
            toast({
                title: t('common.error') || 'Error',
                description: t('instantPos.currencyMismatch') || 'Instant POS supports one settlement currency per ticket.'
            })
            return
        }

        setIsCheckoutLoading(true)
        const saleId = generateId()
        const snapshotTimestamp = new Date().toISOString()

        const itemsWithMetadata = activeTicket.items.map(item => {
            const product = products.find(p => p.id === item.productId)
            const costPrice = product?.costPrice || 0
            const inventorySnapshot = product?.quantity ?? 0
            return {
                product_id: item.productId,
                product_name: item.name,
                product_sku: item.sku,
                quantity: item.quantity,
                unit_price: item.unitPrice,
                total_price: item.unitPrice * item.quantity,
                cost_price: costPrice,
                converted_cost_price: costPrice,
                original_currency: item.currency,
                original_unit_price: item.unitPrice,
                converted_unit_price: item.unitPrice,
                settlement_currency: settlementCurrency,
                negotiated_price: null,
                total: item.unitPrice * item.quantity,
                inventory_snapshot: inventorySnapshot
            }
        })

        const totalAmount = itemsWithMetadata.reduce((sum, item) => sum + item.total_price, 0)

        const checkoutPayload = {
            id: saleId,
            items: itemsWithMetadata,
            total_amount: totalAmount,
            settlement_currency: settlementCurrency,
            exchange_source: 'instant_pos',
            exchange_rate: 0,
            exchange_rate_timestamp: snapshotTimestamp,
            exchange_rates: [],
            origin: 'instant_pos',
            payment_method: 'cash',
            system_verified: true,
            system_review_status: 'approved',
            system_review_reason: null
        }

        try {
            const { data, error } = await runSupabaseAction('instantPos.completeSale', () =>
                supabase.rpc('complete_sale', { payload: checkoutPayload })
            )

            if (error) throw normalizeSupabaseActionError(error)

            const serverResult = data as any
            const sequenceId = serverResult?.sequence_id
            const formattedInvoiceId = sequenceId ? `#${String(sequenceId).padStart(5, '0')}` : `#${saleId.slice(0, 8)}`

            await Promise.all(activeTicket.items.map(async (item) => {
                const product = products.find(p => p.id === item.productId)
                if (product) {
                    await db.products.update(item.productId, {
                        quantity: Math.max(0, product.quantity - item.quantity)
                    })
                }
            }))

            await db.invoices.add({
                id: saleId,
                invoiceid: formattedInvoiceId,
                sequenceId: sequenceId,
                workspaceId: user.workspaceId,
                customerId: '',
                status: 'paid',
                totalAmount: totalAmount,
                settlementCurrency: settlementCurrency,
                origin: 'instant_pos',
                cashierName: user?.name || 'System',
                createdByName: user?.name || 'System',
                createdAt: snapshotTimestamp,
                updatedAt: snapshotTimestamp,
                syncStatus: 'synced',
                lastSyncedAt: new Date().toISOString(),
                version: 1,
                isDeleted: false
            })

            closeTicket(activeTicket.id)

            toast({
                title: t('instantPos.checkoutComplete') || 'Order closed',
                description: t('instantPos.checkoutCompleteDesc') || 'Sale recorded in Sales History.'
            })
        } catch (err) {
            const normalized = normalizeSupabaseActionError(err)
            console.error('[Instant POS] Checkout failed, saving offline:', normalized)

            if (!navigator.onLine) {
                try {
                    await db.sales.add({
                        id: saleId,
                        workspaceId: user.workspaceId,
                        cashierId: user.id,
                        totalAmount: totalAmount,
                        settlementCurrency: settlementCurrency,
                        exchangeSource: 'instant_pos',
                        exchangeRate: 0,
                        exchangeRateTimestamp: snapshotTimestamp,
                        exchangeRates: [],
                        origin: 'instant_pos',
                        payment_method: 'cash',
                        createdAt: snapshotTimestamp,
                        updatedAt: snapshotTimestamp,
                        syncStatus: 'pending',
                        lastSyncedAt: null,
                        version: 1,
                        isDeleted: false,
                        systemVerified: true,
                        systemReviewStatus: 'approved',
                        systemReviewReason: null
                    })

                    await Promise.all(itemsWithMetadata.map(item =>
                        db.sale_items.add({
                            id: generateId(),
                            saleId: saleId,
                            productId: item.product_id,
                            quantity: item.quantity,
                            unitPrice: item.unit_price,
                            totalPrice: item.total_price,
                            costPrice: item.cost_price,
                            convertedCostPrice: item.converted_cost_price,
                            originalCurrency: item.original_currency,
                            originalUnitPrice: item.original_unit_price,
                            convertedUnitPrice: item.converted_unit_price,
                            settlementCurrency: item.settlement_currency,
                            negotiatedPrice: undefined,
                            inventorySnapshot: item.inventory_snapshot
                        })
                    ))

                    await Promise.all(activeTicket.items.map(async (item) => {
                        const product = products.find(p => p.id === item.productId)
                        if (product) {
                            await db.products.update(item.productId, {
                                quantity: Math.max(0, product.quantity - item.quantity)
                            })
                        }
                    }))

                    await db.invoices.add({
                        id: saleId,
                        invoiceid: `#${saleId.slice(0, 8)}`,
                        workspaceId: user.workspaceId,
                        customerId: '',
                        status: 'paid',
                        totalAmount: totalAmount,
                        settlementCurrency: settlementCurrency,
                        origin: 'instant_pos',
                        cashierName: user?.name || 'System',
                        createdByName: user?.name || 'System',
                        createdAt: snapshotTimestamp,
                        updatedAt: snapshotTimestamp,
                        syncStatus: 'pending',
                        lastSyncedAt: null,
                        version: 1,
                        isDeleted: false
                    })

                    await addToOfflineMutations('sales', saleId, 'create', checkoutPayload, user.workspaceId)

                    closeTicket(activeTicket.id)

                    toast({
                        title: t('instantPos.offlineSaved') || 'Saved offline',
                        description: t('instantPos.offlineSavedDesc') || 'Ticket closed and will sync when online.'
                    })
                } catch (offlineErr) {
                    const offlineNormalized = normalizeSupabaseActionError(offlineErr)
                    toast({
                        title: t('common.error') || 'Error',
                        description: offlineNormalized.message || (t('instantPos.offlineSaveError') || 'Failed to save offline.'),
                        variant: 'destructive'
                    })
                }
            } else {
                toast({
                    title: t('common.error') || 'Error',
                    description: normalized.message || (t('instantPos.checkoutError') || 'Checkout failed.'),
                    variant: 'destructive'
                })
            }
        } finally {
            setIsCheckoutLoading(false)
        }
    }

    const statusIndex = activeTicket ? STATUS_FLOW.indexOf(activeTicket.status) : -1

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">{t('instantPos.title') || 'Instant POS'}</h1>
                    <p className="text-sm text-muted-foreground">
                        {t('instantPos.subtitle') || 'Create tickets fast and route orders to the kitchen.'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 px-4 py-2">
                        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">KDS</div>
                        <Switch
                            checked={features.kds_enabled}
                            onCheckedChange={handleKdsToggle}
                            disabled={isKdsSaving}
                        />
                    </div>
                    <Button onClick={createTicket} className="gap-2">
                        <Receipt className="w-4 h-4" />
                        {t('instantPos.newTicket') || 'New Ticket'}
                    </Button>
                </div>
            </div>

            <div className="grid h-full gap-4 lg:grid-cols-[260px_1fr_340px]">
                <Card className="h-full overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <ClipboardList className="w-4 h-4" />
                            {t('instantPos.tickets') || 'Tickets'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 overflow-y-auto max-h-[calc(100vh-260px)] custom-scrollbar">
                        {tickets.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                                {t('instantPos.noTickets') || 'No open tickets yet.'}
                            </div>
                        ) : (
                            tickets.map(ticket => {
                                const badgeClass = STATUS_BADGES[ticket.status]
                                const isActive = ticket.id === activeTicketId
                                const ticketTotal = ticket.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
                                return (
                                    <button
                                        key={ticket.id}
                                        onClick={() => setActiveTicketId(ticket.id)}
                                        className={cn(
                                            'w-full text-left rounded-xl border px-3 py-3 transition-all',
                                            isActive
                                                ? 'border-primary bg-primary/5 shadow-lg'
                                                : 'border-border/50 hover:border-primary/40'
                                        )}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="font-semibold">{ticket.number}</div>
                                            <span className={cn('text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border', badgeClass)}>
                                                {STATUS_LABELS[ticket.status]}
                                            </span>
                                        </div>
                                        <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
                                            <span>{formatCompactDateTime(ticket.createdAt)}</span>
                                            <span>{formatCurrency(ticketTotal, settlementCurrency, features.iqd_display_preference)}</span>
                                        </div>
                                    </button>
                                )
                            })
                        )}
                    </CardContent>
                </Card>

                <Card className="h-full">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">{t('instantPos.menu') || 'Menu'} </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex flex-wrap gap-3">
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('instantPos.search') || 'Search items...'}
                                className="flex-1 min-w-[180px]"
                            />
                            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder={t('instantPos.category') || 'Category'} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t('instantPos.allCategories') || 'All Categories'}</SelectItem>
                                    <SelectItem value="none">{t('instantPos.uncategorized') || 'Uncategorized'}</SelectItem>
                                    {categories.map(category => (
                                        <SelectItem key={category.id} value={category.id}>
                                            {category.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {filteredProducts.length === 0 ? (
                                <div className="col-span-full text-sm text-muted-foreground">
                                    {t('instantPos.noProducts') || 'No products match your search.'}
                                </div>
                            ) : (
                                filteredProducts.map(product => (
                                    <button
                                        key={product.id}
                                        onClick={() => addItemToTicket(product.id)}
                                        className="group flex flex-col gap-2 rounded-xl border border-border/50 bg-background/60 p-3 text-left transition-all hover:border-primary/40 hover:shadow-md"
                                    >
                                        <div className="font-semibold line-clamp-2">{product.name}</div>
                                        <div className="text-xs text-muted-foreground">SKU: {product.sku || '---'}</div>
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="font-bold text-primary">
                                                {formatCurrency(product.price, product.currency, features.iqd_display_preference)}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground">{product.quantity} {product.unit}</span>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="h-full">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">{t('instantPos.ticketDetails') || 'Ticket Details'}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {!activeTicket ? (
                            <div className="text-sm text-muted-foreground">
                                {t('instantPos.selectTicket') || 'Select a ticket to begin.'}
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm text-muted-foreground">{t('instantPos.activeTicket') || 'Active Ticket'}</div>
                                        <div className="text-xl font-bold">{activeTicket.number}</div>
                                    </div>
                                    <span className={cn('text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border', STATUS_BADGES[activeTicket.status])}>
                                        {STATUS_LABELS[activeTicket.status]}
                                    </span>
                                </div>

                                <div className="space-y-2">
                                    <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                        {t('instantPos.statusProgress') || 'Status'}
                                    </div>
                                    <div className="grid grid-cols-5 gap-2">
                                        {STATUS_FLOW.map((status, index) => (
                                            <button
                                                key={status}
                                                onClick={() => setTicketStatus(status)}
                                                className={cn(
                                                    'rounded-lg px-2 py-2 text-[10px] font-bold uppercase transition-all border',
                                                    index <= statusIndex
                                                        ? 'bg-primary text-primary-foreground border-primary'
                                                        : 'bg-muted/30 text-muted-foreground border-border/40 hover:border-primary/30'
                                                )}
                                            >
                                                {STATUS_LABELS[status]}
                                            </button>
                                        ))}
                                    </div>
                                {features.kds_enabled ? (
                                    <div className="text-xs text-muted-foreground">
                                        {t('instantPos.kdsActive') || 'Kitchen routing is active for this workspace.'}
                                    </div>
                                ) : (
                                    <div className="text-xs text-muted-foreground">
                                        {t('instantPos.kdsInactive') || 'Kitchen routing is off. Cashier handles preparation.'}
                                    </div>
                                )}
                                {activeTicket.status === 'pending' && (
                                    <Button
                                        variant="outline"
                                        onClick={() => setTicketStatus('preparing')}
                                        className="w-full justify-center"
                                    >
                                        {features.kds_enabled
                                            ? (t('instantPos.sendToKitchen') || 'Send to Kitchen')
                                            : (t('instantPos.startPreparation') || 'Start Preparation')}
                                    </Button>
                                )}
                            </div>

                                <div className="space-y-3">
                                    {activeTicket.items.length === 0 ? (
                                        <div className="text-sm text-muted-foreground">
                                            {t('instantPos.emptyTicket') || 'Add items to start this ticket.'}
                                        </div>
                                    ) : (
                                        activeTicket.items.map(item => (
                                            <div key={item.productId} className="flex items-start justify-between gap-3 rounded-xl border border-border/50 p-3">
                                                <div className="flex-1">
                                                    <div className="font-medium">{item.name}</div>
                                                    <div className="text-xs text-muted-foreground">{item.sku || '---'}</div>
                                                    <div className="text-sm font-bold text-primary">
                                                        {formatCurrency(item.unitPrice, item.currency, features.iqd_display_preference)}
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            variant="outline"
                                                            size="icon"
                                                            onClick={() => updateItemQuantity(item.productId, -1)}
                                                            className="h-8 w-8"
                                                        >
                                                            <Minus className="w-3 h-3" />
                                                        </Button>
                                                        <span className="text-sm font-bold">{item.quantity}</span>
                                                        <Button
                                                            variant="outline"
                                                            size="icon"
                                                            onClick={() => updateItemQuantity(item.productId, 1)}
                                                            className="h-8 w-8"
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-destructive hover:text-destructive"
                                                        onClick={() => removeItem(item.productId)}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>

                                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">{t('instantPos.items') || 'Items'}</span>
                                        <span className="font-semibold">{activeTicketTotals.count}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-lg font-bold">{t('instantPos.total') || 'Total'}</span>
                                        <span className="text-lg font-bold text-primary">
                                            {activeTicketTotals.hasMixedCurrency
                                                ? '--'
                                                : formatCurrency(activeTicketTotals.total, settlementCurrency, features.iqd_display_preference)}
                                        </span>
                                    </div>
                                    {activeTicketTotals.hasMixedCurrency && (
                                        <div className="flex items-center gap-2 text-xs text-amber-500">
                                            <AlertCircle className="w-3.5 h-3.5" />
                                            {t('instantPos.currencyWarning') || 'Ticket has mixed currencies. Checkout is disabled.'}
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-col gap-2">
                                    <Button
                                        className="h-11 text-base font-semibold gap-2"
                                        onClick={checkoutTicket}
                                        disabled={
                                            isCheckoutLoading
                                            || activeTicket.items.length === 0
                                            || activeTicketTotals.hasMixedCurrency
                                        }
                                    >
                                        <CheckCircle2 className="w-4 h-4" />
                                        {isCheckoutLoading
                                            ? (t('instantPos.checkoutLoading') || 'Closing...')
                                            : (t('instantPos.checkout') || 'Checkout & Close')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => closeTicket(activeTicket.id)}
                                        disabled={isCheckoutLoading}
                                    >
                                        {t('instantPos.closeTicket') || 'Close Ticket Without Payment'}
                                    </Button>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
