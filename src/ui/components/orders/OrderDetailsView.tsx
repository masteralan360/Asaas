import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ArrowLeft, CalendarDays, CreditCard, LayoutGrid, List, Lock, Package, Printer, Receipt, ShoppingCart, Trash2, TrendingUp, Truck, UsersRound, Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getLocalizedOrderError } from '@/lib/orderErrors'
import { Link, useLocation } from 'wouter'

import { useAuth } from '@/auth'
import { useProfileData } from '@/hooks/useProfileData'
import { cn, formatCurrency, formatDate, formatDateTime, formatSnapshotTime } from '@/lib/utils'
import { generateTemplatePdf, type PrintFormat } from '@/services/pdfGenerator'
import type { TemplatePreview, TemplatePreviewRenderOptions } from '@/lib/pdfPreviewStore'
import {
    deletePurchaseOrder,
    deleteSalesOrder,
    findLatestUnreversedPaymentTransaction,
    getOrderBalanceAmount,
    getOrderPaidAmount,
    getOrderPaymentStatus,
    lockPurchaseOrder,
    lockSalesOrder,
    recordObligationSettlement,
    reversePaymentTransaction,
    updatePurchaseOrderStatus,
    updateSalesOrderStatus,
    usePurchaseOrder,
    useLoan,
    useLoanInstallments,
    useOrderInstallments,
    useSalesOrder,
    useStorages,
    useWorkspaceContacts,
    type PaymentObligation,
    type OrderInstallment,
    type PurchaseOrder,
    type PurchaseOrderItem,
    type PurchaseOrderStatus,
    type SalesOrder,
    type SalesOrderItem,
    type SalesOrderStatus,
    type WorkspacePaymentMethod
} from '@/local-db'
import { useWorkspace } from '@/workspace'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    DeleteConfirmationModal,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    PrintPreviewModal,
    SettlementDialog,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useToast
} from '@/ui/components'

import { OrderDetailsPrintTemplate } from './OrderPrintTemplates'
import { OrderStatusBadge } from './OrderStatusBadge'
import { useOrderCustomPrint } from './useOrderCustomPrint'

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
        case 'loan': return t('nav.loans') || 'Loans'
        case 'installments': return t('nav.installments') || 'Installments'
        default: return method || '-'
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

function buildSalesOrderPaymentObligation(order: SalesOrder, installment?: OrderInstallment): PaymentObligation {
    return {
        id: installment ? `order-installment:${installment.id}` : `sales-order:${order.id}`,
        workspaceId: order.workspaceId,
        sourceModule: 'orders',
        sourceType: 'sales_order',
        sourceRecordId: order.id,
        sourceSubrecordId: installment?.id || null,
        direction: 'incoming',
        amount: installment?.balanceAmount || getOrderBalanceAmount(order),
        currency: order.currency,
        dueDate: installment?.dueDate || (order.expectedDeliveryDate || order.actualDeliveryDate || order.updatedAt).slice(0, 10),
        counterpartyName: order.customerName,
        referenceLabel: order.orderNumber,
        title: order.customerName,
        subtitle: installment ? `Installment ${installment.installmentNo}` : order.status,
        status: 'open',
        routePath: `/orders/${order.id}`,
        metadata: {
            orderStatus: order.status,
            sourceChannel: order.sourceChannel || 'manual',
            installmentId: installment?.id || null,
            installmentNo: installment?.installmentNo || null
        }
    }
}

function buildPurchaseOrderPaymentObligation(order: PurchaseOrder, installment?: OrderInstallment): PaymentObligation {
    return {
        id: installment ? `order-installment:${installment.id}` : `purchase-order:${order.id}`,
        workspaceId: order.workspaceId,
        sourceModule: 'orders',
        sourceType: 'purchase_order',
        sourceRecordId: order.id,
        sourceSubrecordId: installment?.id || null,
        direction: 'outgoing',
        amount: installment?.balanceAmount || getOrderBalanceAmount(order),
        currency: order.currency,
        dueDate: installment?.dueDate || (order.expectedDeliveryDate || order.actualDeliveryDate || order.updatedAt).slice(0, 10),
        counterpartyName: order.supplierName,
        referenceLabel: order.orderNumber,
        title: order.supplierName,
        subtitle: installment ? `Installment ${installment.installmentNo}` : order.status,
        status: 'open',
        routePath: `/orders/${order.id}`,
        metadata: {
            orderStatus: order.status,
            installmentId: installment?.id || null,
            installmentNo: installment?.installmentNo || null
        }
    }
}

function InstallmentAmount({
    label,
    value,
    valueClassName
}: {
    label: string
    value: string
    valueClassName?: string
}) {
    return (
        <div className="min-w-0 rounded-xl bg-muted/30 px-2 py-2 text-center">
            <div className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground" title={label}>
                {label}
            </div>
            <div className={cn('mt-1 whitespace-nowrap text-xs font-semibold sm:text-sm', valueClassName)}>
                {value}
            </div>
        </div>
    )
}

export function OrderDetailsView({ workspaceId, orderId }: { workspaceId: string; orderId: string }) {
    const { t, i18n } = useTranslation()
    const { user } = useAuth()
    const { features, workspaceName, isLocalMode } = useWorkspace()
    const [, navigate] = useLocation()
    const { toast } = useToast()
    const storages = useStorages(workspaceId)
    const salesOrder = useSalesOrder(orderId)
    const purchaseOrder = usePurchaseOrder(orderId)
    const linkedLoanId = salesOrder?.linkedLoanId || purchaseOrder?.linkedLoanId || undefined
    const linkedLoan = useLoan(linkedLoanId)
    const loanInstallments = useLoanInstallments(linkedLoanId, workspaceId)
    const legacyInstallments = useOrderInstallments(orderId, workspaceId)
    const installments = linkedLoanId
        ? loanInstallments.map((item) => ({
            ...item,
            orderType: linkedLoan?.orderType || 'sales',
            orderId,
            dueDate: item.dueDate || ''
        } as OrderInstallment))
        : legacyInstallments
    const workspaceContacts = useWorkspaceContacts(workspaceId)
    const workspaceFooterContacts = useMemo(() => {
        const pickContactPair = (type: 'address' | 'email' | 'phone') => {
            const contactsOfType = workspaceContacts.filter((contact) =>
                contact.type === type
                && typeof contact.value === 'string'
                && contact.value.trim().length > 0
            )
            if (contactsOfType.length === 0) return {}
            const primaryContact = contactsOfType.find((contact) => contact.isPrimary) || contactsOfType[0]
            const primary = primaryContact.value.trim()
            const nonPrimaryContact = contactsOfType.find((contact) =>
                contact.id !== primaryContact.id
                && (!contact.isPrimary || contact.value.trim() !== primary)
            )
            const nonPrimary = nonPrimaryContact?.value.trim()
            return {
                ...(primary ? { primary } : {}),
                ...(nonPrimary ? { nonPrimary } : {})
            }
        }
        return {
            address: pickContactPair('address'),
            email: pickContactPair('email'),
            phone: pickContactPair('phone')
        }
    }, [workspaceContacts])
    const [viewMode, setViewMode] = useState<'table' | 'grid'>(readViewMode)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [showPrintPreview, setShowPrintPreview] = useState(false)
    const [lockConfirm, setLockConfirm] = useState<{ isOpen: boolean }>({ isOpen: false })
    const [isLocking, setIsLocking] = useState(false)
    const [settlementTarget, setSettlementTarget] = useState<PaymentObligation | null>(null)
    const [isSubmittingSettlement, setIsSubmittingSettlement] = useState(false)

    useEffect(() => {
        localStorage.setItem('order_details_view_mode', viewMode)
    }, [viewMode])

    const resolved = useMemo(() => salesOrder
        ? { kind: 'sales' as const, order: salesOrder }
        : purchaseOrder
            ? { kind: 'purchase' as const, order: purchaseOrder }
            : null,
    [purchaseOrder, salesOrder])

    const creatorId = (resolved?.order as any)?.createdBy ?? null
    const { profile: creatorProfile } = useProfileData(creatorId)

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
                description: getLocalizedOrderError(error, t, 'Action failed'),
                variant: 'destructive'
            })
        }
    }

    const orderDetailsPreview = useMemo<TemplatePreview | undefined>(() => {
        if (!resolved) return undefined
        const { order, kind } = resolved
        const counterpartyLabel = kind === 'sales'
            ? (t('orders.details.customer') || 'Customer')
            : (t('orders.details.supplier') || 'Supplier')
        const counterpartyName = kind === 'sales' ? (order as any).customerName : (order as any).supplierName
        return {
            fields: [
                { key: 'counterpartyName', label: counterpartyLabel, value: counterpartyName || '', type: 'text' },
                { key: 'notes', label: t('common.notes') || 'Notes', value: (order as any).notes || '', type: 'text' },
                { key: 'hideUnit', label: t('orders.form.hideUnit', { defaultValue: 'Hide Unit' }), value: localStorage.getItem('atlas_print_hide_unit') || 'false', type: 'boolean' },
                { key: 'hideDiscount', label: t('orders.form.hideDiscount', { defaultValue: 'Hide Discount' }), value: localStorage.getItem('atlas_print_hide_discount') || 'false', type: 'boolean' },
            ],
            createElement: (data: Record<string, string>, effectiveId?: string, printLangOverride?: string, renderOptions?: TemplatePreviewRenderOptions) => {
                const updatedOrder = {
                    ...order,
                    ...(kind === 'sales' ? { customerName: data.counterpartyName } : { supplierName: data.counterpartyName }),
                    notes: data.notes,
                }
                const baseLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
                const printLang = printLangOverride || baseLang
                return (
                    <OrderDetailsPrintTemplate
                        workspaceName={workspaceName}
                        printLang={printLang}
                        order={updatedOrder}
                        installments={installments}
                        kind={kind}
                        iqdPreference={features.iqd_display_preference}
                        logoUrl={features.logo_url}
                        qrValue={effectiveId ? `https://asaas-r2-proxy.alanepic360.workers.dev/${workspaceId}/printed-invoices/A4/${effectiveId}.pdf` : undefined}
                        hideUnit={data.hideUnit === 'true'}
                        hideDiscount={data.hideDiscount === 'true'}
                        workspaceFooterContacts={renderOptions?.workspaceFooterContacts || workspaceFooterContacts}
                    />
                )
            },
            buildPdf: async (element: ReactElement, printLangOverride?: string) => {
                const baseLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
                const printLang = printLangOverride || baseLang
                return generateTemplatePdf({
                    element,
                    format: 'a4',
                    printLang,
                })
            },
        }
    }, [resolved, features, installments, workspaceName, t, i18n, workspaceId, workspaceFooterContacts])

    const customOrderPrint = useOrderCustomPrint({
        workspaceId,
        workspaceName,
        features,
        isLocalMode,
        isOpen: showPrintPreview,
        printLanguage: i18n.language,
        order: resolved?.order,
        orderKind: resolved?.kind,
        installments,
        t
    })

    if (!resolved) {
        return (
            <Card>
                <CardContent className="space-y-4 py-10 text-center">
                    <div className="text-lg font-semibold">{t('orders.details.notFound') || 'Order not found'}</div>
                    <div className="text-sm text-muted-foreground">{t('orders.details.notFoundDescription') || 'The order may have been deleted or moved out of this workspace.'}</div>
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
    const paidAmount = getOrderPaidAmount(order)
    const outstanding = getOrderBalanceAmount(order)
    const paymentStatus = getOrderPaymentStatus(order)
    const isFinanced = order.paymentMethod === 'loan' || order.paymentMethod === 'installments' || !!order.linkedLoanId
    const linkedLoanRoute = linkedLoan
        ? linkedLoan.loanCategory === 'simple' ? `/loans/${linkedLoan.id}` : `/installments/${linkedLoan.id}`
        : null
    const nextInstallment = installments.find((installment) => installment.balanceAmount > 0)
    const profit = isSales
        ? order.total - (order as SalesOrder).items.reduce((sum, item) => sum + (item.convertedCostPrice * item.quantity), 0)
        : null
    const margin = profit !== null && order.total > 0 ? (profit / order.total) * 100 : null
    const receivedUnits = !isSales
        ? (order as PurchaseOrder).items.reduce((sum, item) => sum + (item.receivedQuantity ?? ((order.status === 'received' || order.status === 'completed') ? item.quantity : 0)), 0)
        : null
    const averageUnitCost = !isSales && totalUnits > 0 ? order.total / totalUnits : null

    const activity = [
        { id: 'created', date: order.createdAt, label: t('orders.details.activity.created') || 'Order created' },
        order.expectedDeliveryDate ? { id: 'expected', date: order.expectedDeliveryDate, label: t('orders.details.activity.expected') || 'Expected delivery' } : null,
        isSales && (order as SalesOrder).reservedAt ? { id: 'reserved', date: (order as SalesOrder).reservedAt as string, label: t('orders.details.activity.reserved') || 'Inventory reserved' } : null,
        order.actualDeliveryDate ? { id: 'actual', date: order.actualDeliveryDate, label: isSales ? (t('orders.details.activity.completed') || 'Order completed') : (t('orders.details.activity.received') || 'Stock received') } : null,
        order.paidAt ? { id: 'paid', date: order.paidAt, label: t('orders.details.activity.paid') || 'Payment recorded' } : null
    ].filter(Boolean).sort((a, b) => new Date((b as any).date).getTime() - new Date((a as any).date).getTime()) as Array<{ id: string; date: string; label: string }>

    const actions = isSales
        ? [
            canManage && order.status === 'draft' ? { key: 'reserve', label: t('orders.actions.reserve') || 'Reserve', onClick: () => runAction(() => updateSalesOrderStatus(order.id, 'pending'), t('orders.details.messages.reserveSuccess') || 'Sales order reserved'), variant: 'default' as const } : null,
            canManage && order.status === 'pending' ? { key: 'complete', label: t('orders.actions.complete') || 'Complete', onClick: () => runAction(() => updateSalesOrderStatus(order.id, 'completed'), t('orders.details.messages.completeSuccess') || 'Sales order completed'), variant: 'default' as const } : null,
            canManage && order.status === 'pending' ? { key: 'cancel', label: t('orders.actions.cancel') || 'Cancel', onClick: () => runAction(() => updateSalesOrderStatus(order.id, 'cancelled'), t('orders.details.messages.cancelSuccess') || 'Sales order cancelled'), variant: 'outline' as const } : null
        ].filter(Boolean)
        : [
            canManage && order.status === 'draft' ? { key: 'order', label: t('orders.actions.order') || 'Order', onClick: () => runAction(() => updatePurchaseOrderStatus(order.id, 'ordered'), t('orders.details.messages.orderSuccess') || 'Purchase order sent'), variant: 'default' as const } : null,
            canManage && order.status === 'ordered' ? { key: 'receive', label: t('orders.actions.receive') || 'Receive', onClick: () => runAction(() => updatePurchaseOrderStatus(order.id, 'received'), t('orders.details.messages.receiveSuccess') || 'Purchase order received'), variant: 'default' as const } : null,
            canManage && order.status === 'received' ? { key: 'complete', label: t('orders.actions.complete') || 'Complete', onClick: () => runAction(() => updatePurchaseOrderStatus(order.id, 'completed'), t('orders.details.messages.completeSuccess') || 'Purchase order completed'), variant: 'default' as const } : null,
            canManage && (order.status === 'draft' || order.status === 'ordered') ? { key: 'cancel', label: t('orders.actions.cancel') || 'Cancel', onClick: () => runAction(() => updatePurchaseOrderStatus(order.id, 'cancelled'), t('orders.details.messages.cancelSuccess') || 'Purchase order cancelled'), variant: 'outline' as const } : null
        ].filter(Boolean)

    const confirmDelete = async () => {
        setIsDeleting(true)
        try {
            if (isSales) await deleteSalesOrder(order.id)
            else await deletePurchaseOrder(order.id)
            toast({ title: t('orders.details.messages.deleteSuccess') || 'Order deleted successfully.' })
            setDeleteOpen(false)
            navigate('/orders')
        } catch (error: any) {
            toast({ title: t('orders.details.messages.deleteError') || 'Error', description: error?.message || 'Failed to delete order.', variant: 'destructive' })
        } finally {
            setIsDeleting(false)
        }
    }

    const handleLockConfirm = async () => {
        setIsLocking(true)
        try {
            if (isSales) await lockSalesOrder(order.id)
            else await lockPurchaseOrder(order.id)
            toast({ title: t('orders.details.messages.lockSuccess') || 'Order locked successfully' })
            setLockConfirm({ isOpen: false })
        } catch (error: any) {
            toast({
                title: t('orders.details.messages.lockError') || 'Error',
                description: error?.message || 'Locking failed',
                variant: 'destructive'
            })
        } finally {
            setIsLocking(false)
        }
    }

    const handleOrderSettlement = async (input: { paymentMethod: WorkspacePaymentMethod; paidAt: string; amount?: number; note?: string }) => {
        if (!settlementTarget) {
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

            toast({
                title: settlementTarget.direction === 'incoming' ? 'Collection recorded' : 'Payment recorded'
            })
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

    const handleOrderUnpay = async () => {
        const sourceType = isSales ? 'sales_order' : 'purchase_order'

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
                    {isSales && (order as SalesOrder).sourceChannel === 'marketplace' ? (
                        <span className="inline-flex rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                            {t('ecommerce.title', { defaultValue: 'E-Commerce' })}
                        </span>
                    ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {actions.map((action) => action && (
                        <Button key={action.key} variant={action.variant} onClick={action.onClick}>
                            {action.label}
                        </Button>
                    ))}
                    {canManage && isFinanced && linkedLoanRoute ? (
                        <Button variant="outline" onClick={() => navigate(linkedLoanRoute)}>
                            <CreditCard className="mr-2 h-4 w-4" />
                            {order.paymentMethod === 'installments'
                                ? t('orders.actions.openInstallments', { defaultValue: 'Open Installments' })
                                : t('orders.actions.openLoan', { defaultValue: 'Open Loan' })}
                        </Button>
                    ) : null}
                    {canManage && !isFinanced && outstanding > 0 && !order.isLocked && (
                        <Button
                            variant="outline"
                            onClick={() => setSettlementTarget(
                                isSales
                                    ? buildSalesOrderPaymentObligation(order as SalesOrder, nextInstallment)
                                    : buildPurchaseOrderPaymentObligation(order as PurchaseOrder, nextInstallment)
                            )}
                        >
                            <CreditCard className="mr-2 h-4 w-4" />
                            {t('orders.actions.recordPayment', { defaultValue: 'Record Payment' })}
                        </Button>
                    )}
                    {canManage && !isFinanced && paidAmount > 0 && !order.isLocked && (
                        <Button variant="outline" onClick={handleOrderUnpay}>
                            {t('orders.actions.reverseLastPayment', { defaultValue: 'Reverse Last Payment' })}
                        </Button>
                    )}
                    {canManage && order.isPaid && !order.isLocked && (
                        <Button
                            variant="outline"
                            className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 hover:text-amber-700 border-amber-500/20"
                            onClick={() => setLockConfirm({ isOpen: true })}
                        >
                            <Lock className="mr-2 h-4 w-4" />
                            {t('orders.actions.lock') || 'Lock'}
                        </Button>
                    )}
                    {canDelete && order.status === 'draft' && (
                        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('common.delete') || 'Delete'}
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        onClick={() => {
                            customOrderPrint.resetSelection()
                            setShowPrintPreview(true)
                        }}
                        className="gap-2 print:hidden bg-background"
                    >
                        <Printer className="h-4 w-4" />
                        {t('common.print') || 'Print'}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-4">
                    <Card>
                        <CardHeader><CardTitle>{isSales ? (t('orders.details.customer') || 'Customer') : (t('orders.details.supplier') || 'Supplier')}</CardTitle></CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-4">
                                <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                    {isSales ? <UsersRound className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{isSales ? (t('orders.details.customer') || 'Customer') : (t('orders.details.supplier') || 'Supplier')}</div>
                                    <div className="truncate text-lg font-semibold">{isSales ? (order as SalesOrder).customerName : (order as PurchaseOrder).supplierName}</div>
                                </div>
                            </div>
                            <div className="rounded-2xl border bg-background/70 p-4">
                                <div className="flex items-start gap-3">
                                    <Warehouse className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{isSales ? (t('orders.details.sourceStorage') || 'Source Storage') : (t('orders.details.destinationStorage') || 'Destination Storage')}</div>
                                        <div className="font-medium">{storageName(mainStorageId)}</div>
                                    </div>
                                </div>
                            </div>
                            {isSales && (order as SalesOrder).shippingAddress && (
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{t('orders.details.shippingAddress') || 'Shipping Address'}</div>
                                    <div className="mt-1 whitespace-pre-wrap">{(order as SalesOrder).shippingAddress}</div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {installments.length > 0 ? (
                        <Card>
                            <CardHeader>
                                <CardTitle>{t('orders.details.installmentSchedule', { defaultValue: 'Installment Schedule' })}</CardTitle>
                            </CardHeader>
                            <CardContent className="px-3 sm:px-6">
                                <div className="divide-y overflow-hidden rounded-2xl border">
                                    {installments.map((installment) => {
                                        const canPayInstallment = canManage && installment.balanceAmount > 0 && !order.isLocked
                                        return (
                                            <div key={installment.id} className="space-y-3 p-3">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="flex min-w-0 items-center gap-3">
                                                        <span className="font-bold">#{installment.installmentNo}</span>
                                                        <span className="text-sm text-muted-foreground">
                                                            {formatDate(installment.dueDate)}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn(
                                                            'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide',
                                                            installment.status === 'paid'
                                                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                                                : installment.status === 'overdue'
                                                                    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                                                    : installment.status === 'partial'
                                                                        ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                                                                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                                        )}>
                                                            {t(`orders.installmentStatus.${installment.status}`, { defaultValue: installment.status })}
                                                        </span>
                                                        {canPayInstallment ? (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 px-3"
                                                                onClick={() => linkedLoanRoute
                                                                    ? navigate(linkedLoanRoute)
                                                                    : setSettlementTarget(
                                                                        isSales
                                                                            ? buildSalesOrderPaymentObligation(order as SalesOrder, installment)
                                                                            : buildPurchaseOrderPaymentObligation(order as PurchaseOrder, installment)
                                                                    )}
                                                            >
                                                                {t('orders.actions.payInstallment', { defaultValue: 'Pay' })}
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2">
                                                    <InstallmentAmount
                                                        label={t('orders.details.plannedAmount', { defaultValue: 'Planned' })}
                                                        value={formatCurrency(installment.plannedAmount, currency, iqd)}
                                                    />
                                                    <InstallmentAmount
                                                        label={t('orders.details.paidAmount', { defaultValue: 'Paid' })}
                                                        value={formatCurrency(installment.paidAmount, currency, iqd)}
                                                        valueClassName="text-emerald-600"
                                                    />
                                                    <InstallmentAmount
                                                        label={t('orders.details.outstanding') || 'Outstanding'}
                                                        value={formatCurrency(installment.balanceAmount, currency, iqd)}
                                                        valueClassName="font-bold"
                                                    />
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    ) : null}

                    <Card>
                        <CardHeader><CardTitle>{t('orders.details.commercials') || 'Commercials'}</CardTitle></CardHeader>
                        <CardContent className="grid gap-3 text-sm">
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                                <div className="rounded-2xl border bg-muted/20 p-3">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{t('orders.details.created') || 'Created'}</div>
                                    <div className="mt-1 font-medium">{formatDateTime(order.createdAt)}</div>
                                </div>
                                {(order as any).createdBy && (
                                    <div className="rounded-2xl border bg-muted/20 p-3">
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{t('orders.details.createdBy') || 'Created By'}</div>
                                        <div className="mt-1 font-medium flex items-center gap-2">
                                            <UsersRound className="h-3.5 w-3.5 text-muted-foreground" />
                                            {creatorProfile?.name || (order as any).createdBy}
                                        </div>
                                    </div>
                                )}
                                <div className="rounded-2xl border bg-muted/20 p-3">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{t('orders.details.expectedDelivery') || 'Expected Delivery'}</div>
                                    <div className="mt-1 font-medium">{order.expectedDeliveryDate ? formatDateTime(order.expectedDeliveryDate) : 'N/A'}</div>
                                </div>
                            </div>
                            <div className="rounded-2xl border bg-background/70 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{t('pos.paymentMethod') || 'Payment Method'}</div>
                                        <div className="mt-1 font-medium">{paymentLabel(t, order.paymentMethod)}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{t('pos.currency') || 'Currency'}</div>
                                        <div className="mt-1 font-medium">{currency.toUpperCase()}</div>
                                    </div>
                                </div>
                            </div>
                            {order.items.some(item => item.originalCurrency !== item.settlementCurrency) && order.exchangeRates && order.exchangeRates.length > 0 && (
                                <div className="rounded-2xl border border-primary/10 bg-primary/5 p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <TrendingUp className="w-4 h-4 text-primary" />
                                            <span className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                                                {t('sales.marketRatesSnapshot') || 'Market Rates Snapshot'}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-muted-foreground italic">
                                            {t('sales.ratesLockedAt') || 'Rates locked at'}: {formatSnapshotTime(order.exchangeRates[0].timestamp)}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        {order.exchangeRates.map((rate, idx) => (
                                            <div key={idx} className="bg-card border border-primary/10 shadow-sm rounded-sm p-3 space-y-1 relative overflow-hidden">
                                                {rate.source && (
                                                    <div className="absolute top-0 right-0 px-1.5 py-0.5 bg-primary/10 text-primary text-[8px] font-bold uppercase tracking-wider rounded-bl-sm border-l border-b border-primary/5">
                                                        {rate.source}
                                                    </div>
                                                )}
                                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                                    {rate.pair}
                                                </div>
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-base font-black">100 {rate.pair.split('/')[0]}</span>
                                                    <span className="text-sm text-muted-foreground font-medium">
                                                        {formatCurrency(rate.rate, rate.pair.split('/')[1].toLowerCase() as any, iqd)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {order.notes && (
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{t('orders.details.notes') || 'Notes'}</div>
                                    <div className="mt-2 whitespace-pre-wrap">{order.notes}</div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>{t('orders.details.activity.title') || 'Activity'}</CardTitle></CardHeader>
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
                                            {isSales ? (t('orders.details.salesOrder') || 'Sales Order') : (t('orders.details.purchaseOrder') || 'Purchase Order')}
                                        </span>
                                        <OrderStatusBadge status={order.status} label={statusLabel(t, order.status)} />
                                        <span className={cn(
                                            'inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em]',
                                            paymentStatus === 'paid'
                                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                                : paymentStatus === 'partial'
                                                    ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                                                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                        )}>
                                            {paymentStatus === 'paid'
                                                ? (t('orders.status.paid') || 'Paid')
                                                : paymentStatus === 'partial'
                                                    ? t('orders.status.partial', { defaultValue: 'Partially Paid' })
                                                    : t('orders.status.unpaid', { defaultValue: 'Unpaid' })}
                                        </span>
                                        {order.isLocked && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300 shadow-sm border border-slate-500/20">
                                                <Lock className="h-2.5 w-2.5" />
                                                {t('orders.details.locked') || 'Locked'}
                                            </span>
                                        )}
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-muted-foreground">{isSales ? (t('orders.details.salesOrderNumber') || 'Sales order number') : (t('orders.details.purchaseOrderNumber') || 'Purchase order number')}</div>
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
                                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <div className="text-xs text-muted-foreground">{t('orders.details.paidAmount', { defaultValue: 'Paid' })}</div>
                                            <div className="font-semibold text-emerald-600">{formatCurrency(paidAmount, currency, iqd)}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-muted-foreground">{t('orders.details.outstanding') || 'Outstanding'}</div>
                                            <div className="font-semibold">{formatCurrency(outstanding, currency, iqd)}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                             <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('orders.details.items') || 'Items'}</div>
                                    <div className="mt-2 text-2xl font-black">{order.items.length}</div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('orders.details.units') || 'Units'}</div>
                                    <div className="mt-2 text-2xl font-black">{totalUnits}</div>
                                </div>
                                {isSales && profit !== null ? (
                                    <>
                                        <div className="rounded-2xl border bg-background/70 p-4">
                                            <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('orders.details.grossProfit') || 'Gross Profit'}</div>
                                            <div className={cn('mt-2 text-2xl font-black', profit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{formatCurrency(profit, currency, iqd)}</div>
                                        </div>
                                        <div className="rounded-2xl border bg-background/70 p-4">
                                            <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('orders.details.margin') || 'Margin'}</div>
                                            <div className="mt-2 text-2xl font-black">{margin?.toFixed(1)}%</div>
                                        </div>
                                    </>
                                ) : null}
                                {!isSales && receivedUnits !== null ? (
                                    <>
                                        <div className="rounded-2xl border bg-background/70 p-4">
                                            <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('orders.details.receivedUnits') || 'Received Units'}</div>
                                            <div className="mt-2 text-2xl font-black">{receivedUnits}</div>
                                        </div>
                                        <div className="rounded-2xl border bg-background/70 p-4">
                                            <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('orders.details.averageUnitCost') || 'Average Unit Cost'}</div>
                                            <div className="mt-2 text-2xl font-black">{formatCurrency(averageUnitCost || 0, currency, iqd)}</div>
                                        </div>
                                    </>
                                ) : null}
                            </div>

                            <div className="mt-6 space-y-2">
                                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    <span>{order.status === 'cancelled' ? (t('orders.details.workflowStopped') || 'Workflow Stopped') : (t('orders.details.workflowProgress') || 'Workflow Progress')}</span>
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
                            <CardTitle>{t('orders.details.orderItems') || 'Order Items'}</CardTitle>
                            <div className="hidden items-center rounded-lg border bg-muted/30 p-1 md:flex">
                                <Button variant="ghost" size="sm" onClick={() => setViewMode('table')} className={cn('h-8 gap-1.5 px-3 text-[10px] font-black uppercase tracking-[0.16em]', viewMode === 'table' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground')}>
                                    <List className="h-3 w-3" />{t('common.table') || 'Table'}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setViewMode('grid')} className={cn('h-8 gap-1.5 px-3 text-[10px] font-black uppercase tracking-[0.16em]', viewMode === 'grid' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground')}>
                                    <LayoutGrid className="h-3 w-3" />{t('common.grid') || 'Grid'}
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
                                                    <div className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-primary">{item.quantity} {t('orders.details.units') || 'units'}</div>
                                                </div>
                                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                                    <div className="rounded-2xl border bg-muted/20 p-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{isSales ? (t('orders.details.sourceStorage') || 'Source Storage') : (t('orders.details.destinationStorage') || 'Destination Storage')}</div>
                                                        <div className="mt-1 font-medium">{storageName(item.storageId || mainStorageId)}</div>
                                                    </div>
                                                    <div className="rounded-2xl border bg-muted/20 p-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('orders.details.lineTotal') || 'Line Total'}</div>
                                                        <div className="mt-1 font-medium">{formatCurrency(item.lineTotal, currency, iqd)}</div>
                                                    </div>
                                                    <div className="rounded-2xl border bg-muted/20 p-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('orders.details.unitPrice') || 'Unit Price'}</div>
                                                        <div className="mt-1 font-medium">{formatCurrency(item.convertedUnitPrice, currency, iqd)}</div>
                                                    </div>
                                                    <div className="rounded-2xl border bg-muted/20 p-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{isSales ? (t('orders.details.itemProfit') || 'Item Profit') : (t('orders.details.receivedUnits') || 'Received Units')}</div>
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
                                                <TableHead>{isSales ? (t('orders.details.sourceStorage') || 'Source Storage') : (t('orders.details.destinationStorage') || 'Destination Storage')}</TableHead>
                                                <TableHead className="text-end">{t('orders.form.table.qty') || 'Qty'}</TableHead>
                                                {!isSales && <TableHead className="text-end">{t('orders.details.received') || 'Received'}</TableHead>}
                                                <TableHead className="text-end">{t('orders.form.table.price') || 'Unit Price'}</TableHead>
                                                {isSales && <TableHead className="text-end">{t('orders.details.costPerUnit') || 'Cost / Unit'}</TableHead>}
                                                <TableHead className="text-end">{t('common.total') || 'Total'}</TableHead>
                                                {isSales && <TableHead className="text-end">{t('orders.details.itemProfit') || 'Item Profit'}</TableHead>}
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
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"><ShoppingCart className="h-4 w-4" />{t('orders.details.subtotal') || 'Subtotal'}</div>
                                    <div className="mt-2 text-xl font-black">{formatCurrency(order.subtotal, currency, iqd)}</div>
                                </div>
                                <div className="rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"><Receipt className="h-4 w-4" />{t('orders.details.discount') || 'Discount'}</div>
                                    <div className="mt-2 text-xl font-black">{formatCurrency(order.discount, currency, iqd)}</div>
                                </div>
                                <div className="rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"><Package className="h-4 w-4" />{isSales ? (t('orders.details.tax') || 'Tax') : (t('common.total') || 'Total')}</div>
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

            <Dialog open={lockConfirm.isOpen} onOpenChange={(open) => !isLocking && setLockConfirm({ isOpen: open })}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                            <Lock className="h-6 w-6 text-amber-600 dark:text-amber-500" />
                        </div>
                        <DialogTitle className="text-xl font-bold">{t('orders.lockTitle') || 'Lock Order?'}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 text-sm text-muted-foreground leading-relaxed">
                        {t('orders.lockDescription') || 'Locking this order will prevent any changes to its payment status. This action cannot be undone.'}
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="ghost"
                            onClick={() => setLockConfirm({ isOpen: false })}
                            disabled={isLocking}
                            className="font-semibold"
                        >
                            {t('common.cancel') || 'Cancel'}
                        </Button>
                        <Button
                            className="bg-amber-600 font-bold text-white hover:bg-amber-700 shadow-lg shadow-amber-600/20 transition-all active:scale-95"
                            onClick={handleLockConfirm}
                            disabled={isLocking}
                        >
                            {isLocking ? (
                                <div className="flex items-center gap-2">
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                    <span>{t('orders.details.locking') || 'Locking...'}</span>
                                </div>
                            ) : (
                                <>
                                    <Lock className="mr-2 h-4 w-4" />
                                    {t('orders.details.lockNow') || 'Lock Now'}
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <PrintPreviewModal
                isOpen={showPrintPreview}
                onClose={() => {
                    setShowPrintPreview(false)
                    customOrderPrint.resetSelection()
                }}
                onConfirm={() => {
                    setShowPrintPreview(false)
                    customOrderPrint.resetSelection()
                }}
                title={customOrderPrint.selectedTemplateLabel
                    ? customOrderPrint.selectedTemplateLabel
                    : isSales
                        ? (t('orders.tabs.sales') || 'Sales Order')
                        : (t('orders.tabs.purchase') || 'Purchase Order')}
                module="orders"
                features={features}
                workspaceName={workspaceName}
                invoiceData={{
                    totalAmount: order.total,
                    settlementCurrency: order.currency,
                    origin: 'sales_order' as const,
                    createdByName: user?.name || 'Unknown',
                    cashierName: user?.name || 'Unknown',
                    printFormat: 'a4' as const
                }}
                pdfBuilder={customOrderPrint.isCustomSelected
                    ? customOrderPrint.buildPdf
                    : async ({ format, effectiveId, printLangOverride }: { format: PrintFormat; effectiveId: string; printLangOverride?: string }) => {
                        const baseLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
                        const printLang = printLangOverride || baseLang
                        return generateTemplatePdf({
                            element: (
                                <OrderDetailsPrintTemplate
                                    workspaceName={workspaceName}
                                    printLang={printLang}
                                    order={order}
                                    installments={installments}
                                    kind={resolved.kind}
                                    iqdPreference={features.iqd_display_preference}
                                    logoUrl={features.logo_url}
                                    qrValue={effectiveId ? `https://asaas-r2-proxy.alanepic360.workers.dev/${workspaceId}/printed-invoices/A4/${effectiveId}.pdf` : undefined}
                                    workspaceFooterContacts={workspaceFooterContacts}
                                />
                            ),
                            format,
                            printLang,
                        })
                    }}
                printTemplate={({ effectiveId }) => {
                    const printLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
                    return (
                        <OrderDetailsPrintTemplate
                            workspaceName={workspaceName}
                            printLang={printLang}
                            order={order}
                            installments={installments}
                            kind={resolved.kind}
                            iqdPreference={features.iqd_display_preference}
                            logoUrl={features.logo_url}
                            qrValue={effectiveId ? `https://asaas-r2-proxy.alanepic360.workers.dev/${workspaceId}/printed-invoices/A4/${effectiveId}.pdf` : undefined}
                            workspaceFooterContacts={workspaceFooterContacts}
                        />
                    )
                }}
                templatePreview={customOrderPrint.isCustomSelected ? customOrderPrint.preview : orderDetailsPreview}
                customTemplate={customOrderPrint.customTemplate}
                initialTemplateLayout={customOrderPrint.initialLayout}
                enableTemplatePreviewSave={customOrderPrint.isCustomSelected}
                generateTemplateLayoutBlob={customOrderPrint.isCustomSelected ? customOrderPrint.buildEditablePdf : undefined}
                printSelectionOptions={customOrderPrint.nativeOptions}
                printSelectionTemplates={customOrderPrint.templateOptions}
                onPrintSelection={customOrderPrint.handleSelection}
            />
        </div>
    )
}
