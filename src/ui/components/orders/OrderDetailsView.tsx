import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarDays, CreditCard, LayoutGrid, List, Package, Receipt, ShoppingCart, Trash2, Truck, UsersRound, Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import { useAuth } from '@/auth'
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import {
    deletePurchaseOrder,
    deleteSalesOrder,
    setPurchaseOrderPaymentStatus,
    setSalesOrderPaymentStatus,
    updatePurchaseOrderStatus,
    updateSalesOrderStatus,
    usePurchaseOrder,
    useSalesOrder,
    useStorages,
    type PurchaseOrder,
    type PurchaseOrderItem,
    type PurchaseOrderStatus,
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
    DeleteConfirmationModal,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useToast
} from '@/ui/components'

import { OrderStatusBadge } from './OrderStatusBadge'

function statusLabel(t: (key: string) => string, status: string) {
    const translated = t(`orders.status.${status}`)
    return translated && translated !== `orders.status.${status}` ? translated : status
}

function paymentLabel(t: (key: string) => string, method?: string | null) {
    switch (method) {
        case 'cash': return t('pos.cash') || 'Cash'
        case 'fib': return t('pos.fib') || 'FIB'
        case 'qicard': return t('pos.qicard') || 'Qi Card'
        case 'zaincash': return t('pos.zaincash') || 'Zain Cash'
        case 'fastpay': return t('pos.fastpay') || 'FastPay'
        case 'loan': return t('pos.loan') || 'Loan'
        case 'bank_transfer': return 'Bank Transfer'
        default: return 'Credit'
    }
}

function workflowProgress(kind: 'sales' | 'purchase', status: SalesOrderStatus | PurchaseOrderStatus) {
    if (kind === 'sales') {
        return ({ draft: 18, pending: 62, completed: 100, cancelled: 100 } as const)[status as SalesOrderStatus] ?? 0
    }

    return ({ draft: 14, ordered: 46, received: 78, completed: 100, cancelled: 100 } as const)[status as PurchaseOrderStatus] ?? 0
}

function readViewMode() {
    return (localStorage.getItem('order_details_view_mode') as 'table' | 'grid') || 'table'
}

export function OrderDetailsView({ workspaceId, orderId }: { workspaceId: string; orderId: string }) {
    const { t } = useTranslation()
    const { user } = useAuth()
    const { features } = useWorkspace()
    const [, navigate] = useLocation()
    const { toast } = useToast()
    const storages = useStorages(workspaceId)
    const salesOrder = useSalesOrder(orderId)
    const purchaseOrder = usePurchaseOrder(orderId)
    const [viewMode, setViewMode] = useState<'table' | 'grid'>(readViewMode)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        localStorage.setItem('order_details_view_mode', viewMode)
    }, [viewMode])

    const resolved = salesOrder
        ? { kind: 'sales' as const, order: salesOrder }
        : purchaseOrder
            ? { kind: 'purchase' as const, order: purchaseOrder }
            : null

    const canManage = user?.role === 'admin' || user?.role === 'staff'
    const canDelete = user?.role === 'admin'

    const storageName = (storageId?: string | null) => {
        if (!storageId) return 'N/A'
        const match = storages.find((entry) => entry.id === storageId)
        if (!match) return 'N/A'
        return match.isSystem ? (t(`storages.${match.name.toLowerCase()}`) || match.name) : match.name
    }

    const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
        try {
            await action()
            toast({ title: successMessage })
        } catch (error: any) {
            toast({
                title: t('common.error') || 'Error',
                description: error?.message || 'Action failed',
                variant: 'destructive'
            })
        }
    }

    if (!resolved) {
        return (
            <Card>
                <CardContent className="space-y-4 py-10 text-center">
                    <div className="text-lg font-semibold">Order not found</div>
                    <div className="text-sm text-muted-foreground">The order may have been deleted or moved out of this workspace.</div>
                    <div>
                        <Button variant="outline" onClick={() => navigate('/orders')}>
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            {t('nav.orders') || 'Orders'}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        )
    }

    const isSales = resolved.kind === 'sales'
    const order = resolved.order
    const currency = order.currency
    const iqd = features.iqd_display_preference
    const mainStorageId = isSales ? (order as SalesOrder).sourceStorageId : (order as PurchaseOrder).destinationStorageId
    const totalUnits = order.items.reduce((sum, item) => sum + item.quantity, 0)
    const progress = workflowProgress(resolved.kind, order.status)
    const outstanding = order.isPaid ? 0 : order.total
    const profit = isSales
        ? order.total - (order as SalesOrder).items.reduce((sum, item) => sum + (item.convertedCostPrice * item.quantity), 0)
        : null
    const margin = profit !== null && order.total > 0 ? (profit / order.total) * 100 : null
    const receivedUnits = !isSales
        ? (order as PurchaseOrder).items.reduce((sum, item) => sum + (item.receivedQuantity ?? ((order.status === 'received' || order.status === 'completed') ? item.quantity : 0)), 0)
        : null
    const averageUnitCost = !isSales && totalUnits > 0 ? order.total / totalUnits : null

    const activity = [
        { id: 'created', date: order.createdAt, label: 'Order created' },
        order.expectedDeliveryDate ? { id: 'expected', date: order.expectedDeliveryDate, label: 'Expected delivery' } : null,
        isSales && (order as SalesOrder).reservedAt ? { id: 'reserved', date: (order as SalesOrder).reservedAt as string, label: 'Inventory reserved' } : null,
        order.actualDeliveryDate ? { id: 'actual', date: order.actualDeliveryDate, label: isSales ? 'Order completed' : 'Stock received' } : null,
        order.paidAt ? { id: 'paid', date: order.paidAt, label: 'Payment recorded' } : null
    ].filter(Boolean).sort((a, b) => new Date((b as any).date).getTime() - new Date((a as any).date).getTime()) as Array<{ id: string; date: string; label: string }>

    const actions = isSales
        ? [
            canManage && order.status === 'draft' ? { key: 'reserve', label: 'Reserve', onClick: () => runAction(() => updateSalesOrderStatus(order.id, 'pending'), 'Sales order reserved'), variant: 'default' as const } : null,
            canManage && order.status === 'pending' ? { key: 'complete', label: 'Complete', onClick: () => runAction(() => updateSalesOrderStatus(order.id, 'completed'), 'Sales order completed'), variant: 'default' as const } : null,
            canManage && order.status === 'pending' ? { key: 'cancel', label: 'Cancel', onClick: () => runAction(() => updateSalesOrderStatus(order.id, 'cancelled'), 'Sales order cancelled'), variant: 'outline' as const } : null
        ].filter(Boolean)
        : [
            canManage && order.status === 'draft' ? { key: 'order', label: 'Order', onClick: () => runAction(() => updatePurchaseOrderStatus(order.id, 'ordered'), 'Purchase order sent'), variant: 'default' as const } : null,
            canManage && order.status === 'ordered' ? { key: 'receive', label: 'Receive', onClick: () => runAction(() => updatePurchaseOrderStatus(order.id, 'received'), 'Purchase order received'), variant: 'default' as const } : null,
            canManage && order.status === 'received' ? { key: 'complete', label: 'Complete', onClick: () => runAction(() => updatePurchaseOrderStatus(order.id, 'completed'), 'Purchase order completed'), variant: 'default' as const } : null,
            canManage && (order.status === 'draft' || order.status === 'ordered') ? { key: 'cancel', label: 'Cancel', onClick: () => runAction(() => updatePurchaseOrderStatus(order.id, 'cancelled'), 'Purchase order cancelled'), variant: 'outline' as const } : null
        ].filter(Boolean)

    const confirmDelete = async () => {
        setIsDeleting(true)
        try {
            if (isSales) await deleteSalesOrder(order.id)
            else await deletePurchaseOrder(order.id)
            toast({ title: t('common.success') || 'Success', description: 'Order deleted successfully.' })
            setDeleteOpen(false)
            navigate('/orders')
        } catch (error: any) {
            toast({ title: t('common.error') || 'Error', description: error?.message || 'Failed to delete order.', variant: 'destructive' })
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Link href="/orders" className="inline-flex items-center gap-1 hover:text-foreground">
                        <ArrowLeft className="h-4 w-4" />
                        {t('nav.orders') || 'Orders'}
                    </Link>
                    <span>/</span>
                    <span className="font-semibold text-foreground">{order.orderNumber}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {actions.map((action) => action && (
                        <Button key={action.key} variant={action.variant} onClick={action.onClick}>
                            {action.label}
                        </Button>
                    ))}
                    {canManage && (
                        <Button
                            variant="outline"
                            onClick={() => runAction(
                                () => isSales
                                    ? setSalesOrderPaymentStatus(order.id, { isPaid: !order.isPaid, paymentMethod: (order.paymentMethod || 'cash') as SalesOrder['paymentMethod'] })
                                    : setPurchaseOrderPaymentStatus(order.id, { isPaid: !order.isPaid, paymentMethod: (order.paymentMethod || 'cash') as PurchaseOrder['paymentMethod'] }),
                                order.isPaid ? 'Marked unpaid' : 'Marked paid'
                            )}
                        >
                            <CreditCard className="mr-2 h-4 w-4" />
                            {order.isPaid ? 'Mark Unpaid' : 'Mark Paid'}
                        </Button>
                    )}
                    {canDelete && order.status === 'draft' && (
                        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('common.delete') || 'Delete'}
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-4">
                    <Card>
                        <CardHeader><CardTitle>{isSales ? 'Customer' : 'Supplier'}</CardTitle></CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-4">
                                <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                    {isSales ? <UsersRound className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{isSales ? 'Customer' : 'Supplier'}</div>
                                    <div className="truncate text-lg font-semibold">{isSales ? (order as SalesOrder).customerName : (order as PurchaseOrder).supplierName}</div>
                                </div>
                            </div>
                            <div className="rounded-2xl border bg-background/70 p-4">
                                <div className="flex items-start gap-3">
                                    <Warehouse className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{isSales ? 'Source Storage' : 'Destination Storage'}</div>
                                        <div className="font-medium">{storageName(mainStorageId)}</div>
                                    </div>
                                </div>
                            </div>
                            {isSales && (order as SalesOrder).shippingAddress && (
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Shipping Address</div>
                                    <div className="mt-1 whitespace-pre-wrap">{(order as SalesOrder).shippingAddress}</div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Commercials</CardTitle></CardHeader>
                        <CardContent className="grid gap-3 text-sm">
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                                <div className="rounded-2xl border bg-muted/20 p-3">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Created</div>
                                    <div className="mt-1 font-medium">{formatDateTime(order.createdAt)}</div>
                                </div>
                                <div className="rounded-2xl border bg-muted/20 p-3">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Expected Delivery</div>
                                    <div className="mt-1 font-medium">{order.expectedDeliveryDate ? formatDate(order.expectedDeliveryDate) : 'N/A'}</div>
                                </div>
                            </div>
                            <div className="rounded-2xl border bg-background/70 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{t('pos.paymentMethod') || 'Payment Method'}</div>
                                        <div className="mt-1 font-medium">{paymentLabel(t, order.paymentMethod)}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Currency</div>
                                        <div className="mt-1 font-medium">{currency.toUpperCase()}</div>
                                    </div>
                                </div>
                            </div>
                            {order.notes && (
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Notes</div>
                                    <div className="mt-2 whitespace-pre-wrap">{order.notes}</div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
                        <CardContent>
                            <div className="relative space-y-5 ps-4 before:absolute before:bottom-2 before:start-0 before:top-2 before:w-0.5 before:bg-border/70">
                                {activity.map((row) => (
                                    <div key={row.id} className="relative">
                                        <div className={cn(
                                            'absolute -start-[1.375rem] top-1.5 h-3 w-3 rounded-full border-2 border-background',
                                            row.id === 'paid' ? 'bg-emerald-500' : row.id === 'actual' ? 'bg-primary' : row.id === 'reserved' ? 'bg-amber-500' : 'bg-slate-400'
                                        )} />
                                        <div className="space-y-1">
                                            <div className="font-semibold leading-none">{row.label}</div>
                                            <div className="text-xs text-muted-foreground">{formatDateTime(row.date)}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-4 lg:col-span-2">
                    <Card className={cn(
                        'overflow-hidden border-border/60',
                        isSales ? 'bg-gradient-to-br from-primary/10 via-background to-emerald-500/10' : 'bg-gradient-to-br from-sky-500/10 via-background to-cyan-500/10'
                    )}>
                        <CardContent className="p-6">
                            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                                <div className="space-y-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={cn('inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em]', isSales ? 'border-primary/20 bg-primary/10 text-primary' : 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300')}>
                                            {isSales ? 'Sales Order' : 'Purchase Order'}
                                        </span>
                                        <OrderStatusBadge status={order.status} label={statusLabel(t, order.status)} />
                                        <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em]', order.isPaid ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
                                            {order.isPaid ? 'Paid' : 'Pending'}
                                        </span>
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-muted-foreground">{isSales ? 'Sales order number' : 'Purchase order number'}</div>
                                        <div className="mt-1 text-3xl font-black tracking-tight">{order.orderNumber}</div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                            <span className="inline-flex items-center gap-1.5">{isSales ? <UsersRound className="h-4 w-4" /> : <Truck className="h-4 w-4" />}{isSales ? (order as SalesOrder).customerName : (order as PurchaseOrder).supplierName}</span>
                                            <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                                            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(order.createdAt)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-3xl border border-border/50 bg-background/80 p-5 shadow-sm">
                                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{t('common.total') || 'Total'}</div>
                                    <div className="mt-2 text-4xl font-black tracking-tight">{formatCurrency(order.total, currency, iqd)}</div>
                                    <div className="mt-2 text-sm text-muted-foreground">{order.isPaid ? 'Fully settled' : `Outstanding: ${formatCurrency(outstanding, currency, iqd)}`}</div>
                                </div>
                            </div>

                            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Items</div>
                                    <div className="mt-2 text-2xl font-black">{order.items.length}</div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Units</div>
                                    <div className="mt-2 text-2xl font-black">{totalUnits}</div>
                                </div>
                                {isSales && profit !== null ? (
                                    <>
                                        <div className="rounded-2xl border bg-background/70 p-4">
                                            <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Gross Profit</div>
                                            <div className={cn('mt-2 text-2xl font-black', profit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{formatCurrency(profit, currency, iqd)}</div>
                                        </div>
                                        <div className="rounded-2xl border bg-background/70 p-4">
                                            <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Margin</div>
                                            <div className="mt-2 text-2xl font-black">{margin?.toFixed(1)}%</div>
                                        </div>
                                    </>
                                ) : null}
                                {!isSales && receivedUnits !== null ? (
                                    <>
                                        <div className="rounded-2xl border bg-background/70 p-4">
                                            <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Received Units</div>
                                            <div className="mt-2 text-2xl font-black">{receivedUnits}</div>
                                        </div>
                                        <div className="rounded-2xl border bg-background/70 p-4">
                                            <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Average Unit Cost</div>
                                            <div className="mt-2 text-2xl font-black">{formatCurrency(averageUnitCost || 0, currency, iqd)}</div>
                                        </div>
                                    </>
                                ) : null}
                            </div>

                            <div className="mt-6 space-y-2">
                                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    <span>{order.status === 'cancelled' ? 'Workflow Stopped' : 'Workflow Progress'}</span>
                                    <span>{progress}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-background/80">
                                    <div className={cn('h-full rounded-full transition-all duration-500', order.status === 'cancelled' ? 'bg-rose-500' : order.status === 'completed' ? 'bg-emerald-500' : isSales ? 'bg-primary' : 'bg-sky-500')} style={{ width: `${progress}%` }} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <CardTitle>Order Items</CardTitle>
                            <div className="hidden items-center rounded-lg border bg-muted/30 p-1 md:flex">
                                <Button variant="ghost" size="sm" onClick={() => setViewMode('table')} className={cn('h-8 gap-1.5 px-3 text-[10px] font-black uppercase tracking-[0.16em]', viewMode === 'table' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground')}>
                                    <List className="h-3 w-3" />Table
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setViewMode('grid')} className={cn('h-8 gap-1.5 px-3 text-[10px] font-black uppercase tracking-[0.16em]', viewMode === 'grid' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground')}>
                                    <LayoutGrid className="h-3 w-3" />Grid
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {viewMode === 'grid' ? (
                                <div className="grid gap-4 md:grid-cols-2">
                                    {order.items.map((item) => {
                                        const salesItem = item as SalesOrderItem
                                        const purchaseItem = item as PurchaseOrderItem
                                        const itemProfit = isSales ? item.lineTotal - (salesItem.convertedCostPrice * item.quantity) : 0
                                        const itemReceived = !isSales ? purchaseItem.receivedQuantity ?? ((order.status === 'received' || order.status === 'completed') ? purchaseItem.quantity : 0) : 0

                                        return (
                                            <div key={item.id} className="rounded-3xl border bg-background/80 p-4 shadow-sm">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-lg font-semibold">{item.productName}</div>
                                                        <div className="text-xs text-muted-foreground">{item.productSku || 'N/A'}</div>
                                                    </div>
                                                    <div className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-primary">{item.quantity} units</div>
                                                </div>
                                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                                    <div className="rounded-2xl border bg-muted/20 p-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{isSales ? 'Source Storage' : 'Destination Storage'}</div>
                                                        <div className="mt-1 font-medium">{storageName(item.storageId || mainStorageId)}</div>
                                                    </div>
                                                    <div className="rounded-2xl border bg-muted/20 p-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Line Total</div>
                                                        <div className="mt-1 font-medium">{formatCurrency(item.lineTotal, currency, iqd)}</div>
                                                    </div>
                                                    <div className="rounded-2xl border bg-muted/20 p-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Unit Price</div>
                                                        <div className="mt-1 font-medium">{formatCurrency(item.convertedUnitPrice, currency, iqd)}</div>
                                                    </div>
                                                    <div className="rounded-2xl border bg-muted/20 p-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{isSales ? 'Item Profit' : 'Received Units'}</div>
                                                        <div className={cn('mt-1 font-medium', isSales && itemProfit >= 0 ? 'text-emerald-600' : isSales ? 'text-rose-600' : '')}>
                                                            {isSales ? formatCurrency(itemProfit, currency, iqd) : itemReceived}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-2xl border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>{t('products.title') || 'Product'}</TableHead>
                                                <TableHead>{isSales ? 'Source Storage' : 'Destination Storage'}</TableHead>
                                                <TableHead className="text-end">Qty</TableHead>
                                                {!isSales && <TableHead className="text-end">Received</TableHead>}
                                                <TableHead className="text-end">Unit Price</TableHead>
                                                {isSales && <TableHead className="text-end">Cost / Unit</TableHead>}
                                                <TableHead className="text-end">{t('common.total') || 'Total'}</TableHead>
                                                {isSales && <TableHead className="text-end">Item Profit</TableHead>}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {order.items.map((item) => {
                                                const salesItem = item as SalesOrderItem
                                                const purchaseItem = item as PurchaseOrderItem
                                                const itemReceived = purchaseItem.receivedQuantity ?? ((order.status === 'received' || order.status === 'completed') ? purchaseItem.quantity : 0)
                                                const itemProfit = item.lineTotal - (salesItem.convertedCostPrice * item.quantity)

                                                return (
                                                    <TableRow key={item.id}>
                                                        <TableCell>
                                                            <div className="font-semibold">{item.productName}</div>
                                                            <div className="text-xs text-muted-foreground">{item.productSku || 'N/A'}</div>
                                                        </TableCell>
                                                        <TableCell>{storageName(item.storageId || mainStorageId)}</TableCell>
                                                        <TableCell className="text-end">{item.quantity}</TableCell>
                                                        {!isSales && <TableCell className="text-end">{itemReceived}</TableCell>}
                                                        <TableCell className="text-end">{formatCurrency(item.convertedUnitPrice, currency, iqd)}</TableCell>
                                                        {isSales && <TableCell className="text-end">{formatCurrency(salesItem.convertedCostPrice, currency, iqd)}</TableCell>}
                                                        <TableCell className="text-end font-semibold">{formatCurrency(item.lineTotal, currency, iqd)}</TableCell>
                                                        {isSales && <TableCell className={cn('text-end font-semibold', itemProfit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{formatCurrency(itemProfit, currency, iqd)}</TableCell>}
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}

                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                                <div className="rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"><ShoppingCart className="h-4 w-4" />Subtotal</div>
                                    <div className="mt-2 text-xl font-black">{formatCurrency(order.subtotal, currency, iqd)}</div>
                                </div>
                                <div className="rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"><Receipt className="h-4 w-4" />Discount</div>
                                    <div className="mt-2 text-xl font-black">{formatCurrency(order.discount, currency, iqd)}</div>
                                </div>
                                <div className="rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"><Package className="h-4 w-4" />{isSales ? 'Tax' : 'Total'}</div>
                                    <div className="mt-2 text-xl font-black">{formatCurrency(isSales ? (order as SalesOrder).tax : order.total, currency, iqd)}</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <DeleteConfirmationModal
                isOpen={deleteOpen}
                onClose={() => {
                    if (!isDeleting) setDeleteOpen(false)
                }}
                onConfirm={confirmDelete}
                itemName={order.orderNumber}
                isLoading={isDeleting}
                title={t('orders.confirmDelete') || 'Delete Order'}
                description={t('orders.deleteWarning') || 'This will permanently remove the order record. Associated invoices should be checked.'}
            />
        </div>
    )
}
