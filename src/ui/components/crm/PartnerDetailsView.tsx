import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, CreditCard, Eye, LayoutGrid, List, Mail, MapPin, Package, Phone, Receipt, ShoppingCart, Truck, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import { convertCurrencyAmountWithSnapshot } from '@/lib/orderCurrency'
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import {
    useCustomer,
    useCustomerSalesOrders,
    useSupplier,
    useSupplierPurchaseOrders,
    type PurchaseOrder,
    type SalesOrder
} from '@/local-db'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/components'
import { OrderStatusBadge } from '@/ui/components/orders/OrderStatusBadge'
import { useWorkspace } from '@/workspace'

type PartnerKind = 'customer' | 'supplier'
type RelatedOrder = SalesOrder | PurchaseOrder

function statusLabel(t: (key: string, options?: Record<string, unknown>) => string, status: string) {
    return t(`orders.status.${status}`, { defaultValue: status })
}

function readViewMode(kind: PartnerKind) {
    return (localStorage.getItem(`partner_details_view_mode_${kind}`) as 'table' | 'grid') || 'table'
}

function getOrderSummary(items: Array<{ productName: string }>) {
    const firstItems = items.slice(0, 2).map((item) => item.productName)
    if (items.length <= 2) return firstItems.join(', ')
    return `${firstItems.join(', ')} +${items.length - 2}`
}

function toPartnerCurrency(order: RelatedOrder, currency: SalesOrder['currency']) {
    return convertCurrencyAmountWithSnapshot(order.total, order.currency, currency, order.exchangeRates)
}

function paymentBadgeClass(isPaid: boolean) {
    return isPaid
        ? 'border-emerald-200 bg-emerald-500/10 text-emerald-700'
        : 'border-amber-200 bg-amber-500/10 text-amber-700'
}

export function PartnerDetailsView({
    workspaceId,
    partnerId,
    kind
}: {
    workspaceId: string
    partnerId: string
    kind: PartnerKind
}) {
    const { t } = useTranslation()
    const { features } = useWorkspace()
    const [, navigate] = useLocation()
    const customer = useCustomer(kind === 'customer' ? partnerId : undefined)
    const supplier = useSupplier(kind === 'supplier' ? partnerId : undefined)
    const customerOrders = useCustomerSalesOrders(kind === 'customer' ? partnerId : undefined, kind === 'customer' ? workspaceId : undefined)
    const supplierOrders = useSupplierPurchaseOrders(kind === 'supplier' ? partnerId : undefined, kind === 'supplier' ? workspaceId : undefined)
    const partner = kind === 'customer' ? customer : supplier
    const relatedOrders = kind === 'customer' ? customerOrders : supplierOrders
    const [viewMode, setViewMode] = useState<'table' | 'grid'>(() => readViewMode(kind))

    useEffect(() => {
        localStorage.setItem(`partner_details_view_mode_${kind}`, viewMode)
    }, [kind, viewMode])

    const defaultCurrency = partner?.defaultCurrency ?? features.default_currency
    const iqdPreference = features.iqd_display_preference
    const isCustomer = kind === 'customer'
    const listHref = isCustomer ? '/customers' : '/suppliers'
    const listLabel = isCustomer
        ? t('customers.title', { defaultValue: 'Customers' })
        : t('suppliers.title', { defaultValue: 'Suppliers' })
    const typeLabel = isCustomer
        ? t('orders.details.customer', { defaultValue: 'Customer' })
        : t('orders.details.supplier', { defaultValue: 'Supplier' })
    const contactName = isCustomer ? undefined : supplier?.contactName

    const activeOrders = useMemo(
        () => relatedOrders.filter((order) => order.status !== 'cancelled'),
        [relatedOrders]
    )
    const settledOrders = useMemo(
        () => activeOrders.filter((order) => order.isPaid),
        [activeOrders]
    )
    const completedOrders = useMemo(
        () => activeOrders.filter((order) => isCustomer ? order.status === 'completed' : order.status === 'received' || order.status === 'completed'),
        [activeOrders, isCustomer]
    )
    const outstandingOrders = useMemo(
        () => activeOrders.filter((order) => {
            if (order.isPaid) return false
            if (isCustomer) {
                return order.status === 'pending' || order.status === 'completed'
            }

            return order.status === 'ordered' || order.status === 'received' || order.status === 'completed'
        }),
        [activeOrders, isCustomer]
    )
    const sortedOrders = useMemo(
        () => [...relatedOrders].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
        [relatedOrders]
    )
    const totalValue = useMemo(
        () => activeOrders.reduce((sum, order) => sum + toPartnerCurrency(order, defaultCurrency), 0),
        [activeOrders, defaultCurrency]
    )
    const settledValue = useMemo(
        () => settledOrders.reduce((sum, order) => sum + toPartnerCurrency(order, defaultCurrency), 0),
        [defaultCurrency, settledOrders]
    )
    const outstandingValue = useMemo(
        () => outstandingOrders.reduce((sum, order) => sum + toPartnerCurrency(order, defaultCurrency), 0),
        [defaultCurrency, outstandingOrders]
    )
    const averageOrderValue = activeOrders.length > 0 ? totalValue / activeOrders.length : 0
    const totalUnits = useMemo(
        () => activeOrders.reduce((sum, order) => sum + order.items.reduce((lineSum, item) => lineSum + item.quantity, 0), 0),
        [activeOrders]
    )
    const settledPercent = totalValue > 0 ? Math.min(100, (settledValue / totalValue) * 100) : 0
    const creditUsagePercent = partner?.creditLimit && partner.creditLimit > 0 ? Math.min(100, (outstandingValue / partner.creditLimit) * 100) : 0
    const latestOrder = sortedOrders[0]
    const earliestOrder = sortedOrders[sortedOrders.length - 1]
    const locationLabel = partner ? [partner.city, partner.country].filter(Boolean).join(', ') || 'N/A' : 'N/A'
    const activityRows = useMemo(
        () => sortedOrders.slice(0, 8).map((order) => ({
            id: order.id,
            date: order.actualDeliveryDate || order.paidAt || order.updatedAt || order.createdAt,
            title: `${order.orderNumber}`,
            status: order.status,
            total: order.total,
            currency: order.currency
        })),
        [sortedOrders]
    )
    const topProducts = useMemo(() => {
        const rows = new Map<string, { id: string; name: string; quantity: number; amount: number }>()
        for (const order of activeOrders) {
            for (const item of order.items) {
                const current = rows.get(item.productId) ?? {
                    id: item.productId,
                    name: item.productName,
                    quantity: 0,
                    amount: 0
                }
                current.quantity += item.quantity
                current.amount += convertCurrencyAmountWithSnapshot(item.lineTotal, order.currency, defaultCurrency, order.exchangeRates)
                rows.set(item.productId, current)
            }
        }

        return Array.from(rows.values()).sort((a, b) => {
            if (b.amount !== a.amount) {
                return b.amount - a.amount
            }

            return b.quantity - a.quantity
        }).slice(0, 5)
    }, [activeOrders, defaultCurrency])

    if (!partner) {
        return (
            <Card>
                <CardContent className="space-y-4 py-10 text-center">
                    <div className="text-lg font-semibold">
                        {kind === 'customer'
                            ? t('customers.details.notFound', { defaultValue: 'Customer not found' })
                            : t('suppliers.details.notFound', { defaultValue: 'Supplier not found' })}
                    </div>
                    <div className="text-sm text-muted-foreground">
                        {kind === 'customer'
                            ? t('customers.details.notFoundDescription', { defaultValue: 'The customer may have been deleted or moved out of this workspace.' })
                            : t('suppliers.details.notFoundDescription', { defaultValue: 'The supplier may have been deleted or moved out of this workspace.' })}
                    </div>
                    <div>
                        <Button variant="outline" onClick={() => navigate(kind === 'customer' ? '/customers' : '/suppliers')}>
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            {kind === 'customer'
                                ? t('customers.title', { defaultValue: 'Customers' })
                                : t('suppliers.title', { defaultValue: 'Suppliers' })}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Link href={listHref} className="inline-flex items-center gap-1 hover:text-foreground">
                        <ArrowLeft className="h-4 w-4" />
                        {listLabel}
                    </Link>
                    <span>/</span>
                    <span className="font-semibold text-foreground">{partner.name}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>
                                {isCustomer
                                    ? t('customers.details.identity', { defaultValue: 'Customer Profile' })
                                    : t('suppliers.details.identity', { defaultValue: 'Supplier Profile' })}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-4">
                                <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                    {isCustomer ? <UsersRound className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{typeLabel}</div>
                                    <div className="truncate text-lg font-semibold">{partner.name}</div>
                                    <div className="mt-1 flex flex-wrap gap-2">
                                        <span className="rounded-full border bg-background/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]">
                                            {partner.defaultCurrency.toUpperCase()}
                                        </span>
                                        <span className="rounded-full border bg-background/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]">
                                            {formatDate(partner.createdAt)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {contactName ? (
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="flex items-start gap-3">
                                        <UsersRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                        <div>
                                            <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                                {t('suppliers.form.contactName', { defaultValue: 'Contact Name' })}
                                            </div>
                                            <div className="font-medium">{contactName}</div>
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            <div className="rounded-2xl border bg-background/70 p-4">
                                <div className="flex items-start gap-3">
                                    <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            {t('customers.form.phone', { defaultValue: 'Phone' })}
                                        </div>
                                        <div className="font-medium">{partner.phone || 'N/A'}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border bg-background/70 p-4">
                                <div className="flex items-start gap-3">
                                    <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            {t('customers.form.email', { defaultValue: 'Email' })}
                                        </div>
                                        <div className="break-all font-medium">{partner.email || 'N/A'}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border bg-background/70 p-4">
                                <div className="flex items-start gap-3">
                                    <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            {t('customers.table.location', { defaultValue: 'Location' })}
                                        </div>
                                        <div className="font-medium">{locationLabel}</div>
                                    </div>
                                </div>
                            </div>

                            {partner.address ? (
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        {t('customers.form.address', { defaultValue: 'Address' })}
                                    </div>
                                    <div className="mt-1 whitespace-pre-wrap">{partner.address}</div>
                                </div>
                            ) : null}

                            {partner.notes ? (
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        {t('orders.details.notes', { defaultValue: 'Notes' })}
                                    </div>
                                    <div className="mt-2 whitespace-pre-wrap">{partner.notes}</div>
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>

                    <Card className="overflow-hidden border-none bg-transparent shadow-none">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-xl font-bold">
                                {isCustomer
                                    ? t('customers.details.relationship', { defaultValue: 'Relationship Summary' })
                                    : t('suppliers.details.relationship', { defaultValue: 'Relationship Summary' })}
                            </CardTitle>
                            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                                {typeLabel}
                            </span>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="rounded-2xl border border-border/40 bg-muted/30 p-6 text-center">
                                <div className="text-sm font-medium text-muted-foreground">
                                    {isCustomer
                                        ? t('customers.details.totalSales', { defaultValue: 'Total Sales' })
                                        : t('suppliers.details.totalPurchases', { defaultValue: 'Total Purchases' })}
                                </div>
                                <div className="mt-1 text-4xl font-black tracking-tight">
                                    {formatCurrency(totalValue, defaultCurrency, iqdPreference)}
                                </div>
                                <div className="mt-2 text-sm text-muted-foreground">
                                    {outstandingValue > 0
                                        ? `${t('orders.details.outstanding', { defaultValue: 'Outstanding' })}: ${formatCurrency(outstandingValue, defaultCurrency, iqdPreference)}`
                                        : t('orders.details.fullySettled', { defaultValue: 'Fully settled' })}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-center">
                                <div className="rounded-2xl border border-border/40 bg-muted/20 p-5">
                                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                        {isCustomer
                                            ? t('customers.details.completedOrders', { defaultValue: 'Completed Orders' })
                                            : t('suppliers.details.receivedOrders', { defaultValue: 'Received Orders' })}
                                    </div>
                                    <div className="text-2xl font-bold text-emerald-500">{completedOrders.length}</div>
                                </div>
                                <div className="rounded-2xl border border-border/40 bg-muted/20 p-5">
                                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                        {t('customers.details.paidOrders', { defaultValue: 'Paid Orders' })}
                                    </div>
                                    <div className="text-2xl font-bold text-blue-500">{settledOrders.length}</div>
                                </div>
                            </div>

                            <div className="space-y-2 pt-2">
                                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                    <span>
                                        {isCustomer
                                            ? t('customers.details.settlementProgress', { defaultValue: 'Settlement Progress' })
                                            : t('suppliers.details.settlementProgress', { defaultValue: 'Settlement Progress' })}
                                    </span>
                                    <span>{Math.round(settledPercent)}%</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
                                    <div
                                        className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)] transition-all duration-500"
                                        style={{ width: `${settledPercent}%` }}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t('orders.details.activity.title', { defaultValue: 'Activity' })}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {activityRows.length === 0 ? (
                                <div className="py-6 text-sm text-muted-foreground">
                                    {isCustomer
                                        ? t('customers.details.activityEmpty', { defaultValue: 'No related orders yet.' })
                                        : t('suppliers.details.activityEmpty', { defaultValue: 'No related orders yet.' })}
                                </div>
                            ) : (
                                <div className="relative space-y-6 ps-4 before:absolute before:bottom-2 before:start-0 before:top-2 before:w-0.5 before:bg-border/60">
                                    {activityRows.map((row) => (
                                        <div key={row.id} className="group relative">
                                            <div className="absolute -start-[1.375rem] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary shadow-[0_0_8px_rgba(59,130,246,0.35)] transition-transform group-hover:scale-125" />
                                            <div className="space-y-0.5">
                                                <div className="font-bold leading-none transition-colors group-hover:text-primary">{row.title}</div>
                                                <div className="pt-1 text-xs font-medium text-muted-foreground">
                                                    {statusLabel(t, row.status)}
                                                </div>
                                                <div className="flex items-center gap-1.5 pt-1 text-xs font-medium text-muted-foreground">
                                                    <span>{formatDateTime(row.date)}</span>
                                                    <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                                                    <span className="font-bold text-foreground/80">
                                                        {formatCurrency(row.total, row.currency, iqdPreference)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-4 lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>
                                {isCustomer
                                    ? t('customers.details.overview', { defaultValue: 'Sales Overview' })
                                    : t('suppliers.details.overview', { defaultValue: 'Purchasing Overview' })}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]">
                                <div className="rounded-3xl border border-border/50 bg-background/80 p-5 shadow-sm">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-primary">
                                            {typeLabel}
                                        </span>
                                        <span className="rounded-full border bg-muted/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                                            {defaultCurrency.toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                        {isCustomer
                                            ? t('customers.details.relationshipValue', { defaultValue: 'Relationship Value' })
                                            : t('suppliers.details.relationshipValue', { defaultValue: 'Relationship Value' })}
                                    </div>
                                    <div className="mt-2 text-4xl font-black tracking-tight">
                                        {formatCurrency(totalValue, defaultCurrency, iqdPreference)}
                                    </div>
                                    <div className="mt-2 text-sm text-muted-foreground">
                                        {latestOrder
                                            ? `${t('customers.details.lastOrder', { defaultValue: 'Last order' })}: ${formatDate(latestOrder.createdAt)}`
                                            : t('customers.details.noOrders', { defaultValue: 'No related orders yet.' })}
                                    </div>
                                    <div className="mt-6 space-y-2">
                                        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                            <span>
                                                {isCustomer
                                                    ? t('customers.details.creditUsage', { defaultValue: 'Credit Usage' })
                                                    : t('suppliers.details.creditUsage', { defaultValue: 'Credit Usage' })}
                                            </span>
                                            <span>{Math.round(creditUsagePercent)}%</span>
                                        </div>
                                        <div className="h-2 overflow-hidden rounded-full bg-background/80">
                                            <div
                                                className={cn(
                                                    'h-full rounded-full transition-all duration-500',
                                                    creditUsagePercent >= 80 ? 'bg-rose-500' : creditUsagePercent >= 50 ? 'bg-amber-500' : 'bg-primary'
                                                )}
                                                style={{ width: `${creditUsagePercent}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                    <div className="rounded-2xl border bg-muted/20 p-4">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            <CreditCard className="h-4 w-4" />
                                            {t('customers.form.creditLimit', { defaultValue: 'Credit Limit' })}
                                        </div>
                                        <div className="mt-2 text-xl font-black">
                                            {formatCurrency(partner.creditLimit || 0, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border bg-muted/20 p-4">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            <Receipt className="h-4 w-4" />
                                            {t('orders.details.outstanding', { defaultValue: 'Outstanding' })}
                                        </div>
                                        <div className="mt-2 text-xl font-black">
                                            {formatCurrency(outstandingValue, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border bg-muted/20 p-4">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            <ShoppingCart className="h-4 w-4" />
                                            {t('customers.details.averageOrder', { defaultValue: 'Average Order' })}
                                        </div>
                                        <div className="mt-2 text-xl font-black">
                                            {formatCurrency(averageOrderValue, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border bg-muted/20 p-4">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            <CalendarDays className="h-4 w-4" />
                                            {t('customers.details.firstOrder', { defaultValue: 'First Order' })}
                                        </div>
                                        <div className="mt-2 text-xl font-black">
                                            {earliestOrder ? formatDate(earliestOrder.createdAt) : 'N/A'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                        {t('customers.details.activeOrders', { defaultValue: 'Active Orders' })}
                                    </div>
                                    <div className="mt-2 text-2xl font-black">{activeOrders.length}</div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                        {isCustomer
                                            ? t('customers.details.completedOrders', { defaultValue: 'Completed Orders' })
                                            : t('suppliers.details.receivedOrders', { defaultValue: 'Received Orders' })}
                                    </div>
                                    <div className="mt-2 text-2xl font-black">{completedOrders.length}</div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                        {t('customers.details.paidOrders', { defaultValue: 'Paid Orders' })}
                                    </div>
                                    <div className="mt-2 text-2xl font-black">{settledOrders.length}</div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                        {t('orders.details.units', { defaultValue: 'Units' })}
                                    </div>
                                    <div className="mt-2 text-2xl font-black">{totalUnits}</div>
                                </div>
                            </div>

                            <div className="mt-6 rounded-2xl border bg-background/70 p-4">
                                <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                    <Package className="h-4 w-4" />
                                    {isCustomer
                                        ? t('customers.details.topProducts', { defaultValue: 'Top Products' })
                                        : t('suppliers.details.topProducts', { defaultValue: 'Top Products' })}
                                </div>
                                {topProducts.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">
                                        {isCustomer
                                            ? t('customers.details.topProductsEmpty', { defaultValue: 'Product activity will appear once orders are added.' })
                                            : t('suppliers.details.topProductsEmpty', { defaultValue: 'Product activity will appear once orders are added.' })}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {topProducts.map((product, index) => (
                                            <div key={product.id} className="flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-black text-primary">
                                                            {index + 1}
                                                        </span>
                                                        <span className="truncate font-semibold">{product.name}</span>
                                                    </div>
                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        {product.quantity} {t('orders.details.units', { defaultValue: 'Units' })}
                                                    </div>
                                                </div>
                                                <div className="text-right text-sm font-semibold">
                                                    {formatCurrency(product.amount, defaultCurrency, iqdPreference)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <CardTitle>
                                {isCustomer
                                    ? t('orders.tabs.sales', { defaultValue: 'Sales Orders' })
                                    : t('orders.tabs.purchase', { defaultValue: 'Purchase Orders' })}
                            </CardTitle>
                            <div className="hidden items-center rounded-lg border bg-muted/30 p-1 md:flex">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setViewMode('table')}
                                    className={cn(
                                        'h-8 gap-1.5 px-3 text-[10px] font-black uppercase tracking-[0.16em]',
                                        viewMode === 'table' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                                    )}
                                >
                                    <List className="h-3 w-3" />
                                    {t('common.table', { defaultValue: 'Table' })}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setViewMode('grid')}
                                    className={cn(
                                        'h-8 gap-1.5 px-3 text-[10px] font-black uppercase tracking-[0.16em]',
                                        viewMode === 'grid' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                                    )}
                                >
                                    <LayoutGrid className="h-3 w-3" />
                                    {t('common.grid', { defaultValue: 'Grid' })}
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {relatedOrders.length === 0 ? (
                                <div className="rounded-2xl border py-12 text-center text-muted-foreground">
                                    {isCustomer
                                        ? t('customers.details.noOrders', { defaultValue: 'No related orders yet.' })
                                        : t('suppliers.details.noOrders', { defaultValue: 'No related orders yet.' })}
                                </div>
                            ) : viewMode === 'grid' ? (
                                <div className="grid gap-4 md:grid-cols-2">
                                    {sortedOrders.map((order) => (
                                        <div key={order.id} className="rounded-3xl border bg-background/80 p-4 shadow-sm">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-lg font-semibold">{order.orderNumber}</div>
                                                    <div className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</div>
                                                </div>
                                                <OrderStatusBadge status={order.status} label={statusLabel(t, order.status)} />
                                            </div>

                                            <div className="mt-4 rounded-2xl border bg-muted/20 p-3">
                                                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                                    {t('common.items', { defaultValue: 'Items' })}
                                                </div>
                                                <div className="mt-1 text-sm font-medium">{getOrderSummary(order.items)}</div>
                                            </div>

                                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                                <div className="rounded-2xl border bg-muted/20 p-3">
                                                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                                        {t('common.status', { defaultValue: 'Status' })}
                                                    </div>
                                                    <div className="mt-1">
                                                        <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide', paymentBadgeClass(order.isPaid))}>
                                                            {order.isPaid
                                                                ? t('customers.details.paid', { defaultValue: 'Paid' })
                                                                : t('customers.details.unpaid', { defaultValue: 'Unpaid' })}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl border bg-muted/20 p-3">
                                                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                                        {t('common.total', { defaultValue: 'Total' })}
                                                    </div>
                                                    <div className="mt-1 font-medium">{formatCurrency(order.total, order.currency, iqdPreference)}</div>
                                                </div>
                                            </div>

                                            <div className="mt-4">
                                                <Button variant="outline" className="w-full gap-2" onClick={() => navigate(`/orders/${order.id}`)}>
                                                    <Eye className="h-4 w-4" />
                                                    {t('common.view', { defaultValue: 'View' })}
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-2xl border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>{t('orders.table.orderNumber', { defaultValue: 'Order #' })}</TableHead>
                                                <TableHead>{t('common.date', { defaultValue: 'Date' })}</TableHead>
                                                <TableHead>{t('common.status', { defaultValue: 'Status' })}</TableHead>
                                                <TableHead>{t('common.items', { defaultValue: 'Items' })}</TableHead>
                                                <TableHead>{t('pos.paymentMethod', { defaultValue: 'Payment' })}</TableHead>
                                                <TableHead className="text-end">{t('common.total', { defaultValue: 'Total' })}</TableHead>
                                                <TableHead className="text-end">{t('common.actions', { defaultValue: 'Actions' })}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sortedOrders.map((order) => (
                                                <TableRow key={order.id}>
                                                    <TableCell className="font-semibold">{order.orderNumber}</TableCell>
                                                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                                                    <TableCell>
                                                        <OrderStatusBadge status={order.status} label={statusLabel(t, order.status)} />
                                                    </TableCell>
                                                    <TableCell>{getOrderSummary(order.items)}</TableCell>
                                                    <TableCell>
                                                        <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide', paymentBadgeClass(order.isPaid))}>
                                                            {order.isPaid
                                                                ? t('customers.details.paid', { defaultValue: 'Paid' })
                                                                : t('customers.details.unpaid', { defaultValue: 'Unpaid' })}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-end font-semibold">
                                                        {formatCurrency(order.total, order.currency, iqdPreference)}
                                                    </TableCell>
                                                    <TableCell className="text-end">
                                                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(`/orders/${order.id}`)}>
                                                            <Eye className="h-4 w-4" />
                                                            {t('common.view', { defaultValue: 'View' })}
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
