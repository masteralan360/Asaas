import {
    getOrderBalanceAmount,
    getOrderPaidAmount,
    getOrderPaymentStatus,
    type SalesOrder,
    type PurchaseOrder,
    type OrderInstallment,
    type IQDDisplayPreference
} from '@/local-db'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { platformService } from '@/services/platformService'
import { useTranslation } from 'react-i18next'
import { ReactQRCode } from '@lglab/react-qr-code'
import { Move, MapPin, Phone } from 'lucide-react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import type { CustomTemplateComponentPosition } from '@/lib/pdfPreviewStore'

type OrderTab = 'sales' | 'purchase'

interface OrderListPrintTemplateProps {
    workspaceName?: string | null
    printLang: string
    salesOrders: SalesOrder[]
    purchaseOrders: PurchaseOrder[]
    activeTab: OrderTab
    iqdPreference?: IQDDisplayPreference
    metrics: {
        totalOrders: number
        totalValue: number
        paidCount: number
        unpaidCount: number
    }
    logoUrl?: string | null
    qrValue?: string | null
}

interface WorkspaceContactPair {
    primary?: string
    nonPrimary?: string
}

interface WorkspaceFooterContacts {
    address?: WorkspaceContactPair
    email?: WorkspaceContactPair
    phone?: WorkspaceContactPair
}

interface OrderDetailsPrintTemplateProps {
    workspaceName?: string | null
    printLang: string
    order: SalesOrder | PurchaseOrder
    installments?: OrderInstallment[]
    kind: 'sales' | 'purchase'
    iqdPreference?: IQDDisplayPreference
    logoUrl?: string | null
    qrValue?: string | null
    hideUnit?: boolean
    hideDiscount?: boolean
    componentPositions?: Record<string, CustomTemplateComponentPosition>
    editableComponents?: boolean
    onComponentPositionChange?: (key: string, position: CustomTemplateComponentPosition) => void
    workspaceFooterContacts?: WorkspaceFooterContacts
}

export const ORDER_DETAILS_MOVABLE_COMPONENT_KEYS = {
    customer: 'customer',
    commercials: 'commercials',
    created: 'created',
    expectedDelivery: 'expectedDelivery',
    orderItems: 'orderItems',
    totals: 'totals',
    workspaceName: 'workspaceName',
    title: 'title',
    subtitle: 'subtitle',
    qrCode: 'qrCode',
    logo: 'logo',
    contacts: 'contacts',
    notes: 'notes'
} as const

export function MovableOrderPrintBlock({
    componentKey,
    label,
    position,
    editable,
    onPositionChange,
    wrapperClassName,
    children
}: {
    componentKey: string
    label: string
    position?: CustomTemplateComponentPosition
    editable?: boolean
    onPositionChange?: (key: string, position: CustomTemplateComponentPosition) => void
    wrapperClassName?: string
    children: ReactNode
}) {
    const resolvedPosition = position || { x: 0, y: 0 }

    const updatePosition = (nextPosition: CustomTemplateComponentPosition) => {
        onPositionChange?.(componentKey, nextPosition)
    }

    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        if (!editable || !onPositionChange) return

        event.preventDefault()
        event.stopPropagation()
        const page = event.currentTarget.closest<HTMLElement>('[data-order-print-page]')
        if (!page) return

        const pageRect = page.getBoundingClientRect()
        const mmPerPixel = 210 / pageRect.width
        const startX = event.clientX
        const startY = event.clientY
        const initialPosition = resolvedPosition
        const roundMillimeters = (value: number) => Math.round(value * 100) / 100

        const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
            updatePosition({
                x: roundMillimeters(initialPosition.x + ((moveEvent.clientX - startX) * mmPerPixel)),
                y: roundMillimeters(initialPosition.y + ((moveEvent.clientY - startY) * mmPerPixel))
            })
        }
        const handlePointerUp = () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
            window.removeEventListener('pointercancel', handlePointerUp)
        }

        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
        window.addEventListener('pointercancel', handlePointerUp)
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!editable || !onPositionChange) return
        const step = event.shiftKey ? 5 : 1
        const delta = {
            ArrowLeft: { x: -step, y: 0 },
            ArrowRight: { x: step, y: 0 },
            ArrowUp: { x: 0, y: -step },
            ArrowDown: { x: 0, y: step }
        }[event.key]
        if (!delta) return

        event.preventDefault()
        updatePosition({
            x: resolvedPosition.x + delta.x,
            y: resolvedPosition.y + delta.y
        })
    }

    return (
        <div
            className={[
                editable ? 'group/order-block relative outline outline-1 outline-dashed outline-transparent hover:outline-primary/60' : undefined,
                wrapperClassName
            ].filter(Boolean).join(' ')}
            style={{
                transform: `translate(${resolvedPosition.x}mm, ${resolvedPosition.y}mm)`,
                position: 'relative',
                zIndex: resolvedPosition.x !== 0 || resolvedPosition.y !== 0 ? 20 : undefined
            }}
            data-order-print-component={componentKey}
        >
            {children}
            {editable ? (
                <button
                    type="button"
                    className="order-template-move-handle absolute -top-3 end-1 z-50 inline-flex h-6 touch-none items-center gap-1 rounded border border-primary/30 bg-white px-1.5 text-[9px] font-semibold text-primary opacity-70 shadow-sm hover:opacity-100 focus:opacity-100"
                    onPointerDown={handlePointerDown}
                    onKeyDown={handleKeyDown}
                    aria-label={`Move ${label}`}
                    title={`Move ${label}. Use arrow keys for 1mm steps; hold Shift for 5mm.`}
                >
                    <Move className="h-3 w-3" />
                    <span>{label}</span>
                </button>
            ) : null}
        </div>
    )
}

function isRTL(lang: string): boolean {
    const baseLang = (lang || 'en').split('-')[0]
    return baseLang === 'ar' || baseLang === 'ku'
}

function resolveLogoSrc(logoUrl?: string | null) {
    if (!logoUrl) return null
    return logoUrl.startsWith('http') ? logoUrl : platformService.convertFileSrc(logoUrl)
}

interface OrderPrintHeaderProps {
    workspaceName?: string | null
    title: string
    subtitle?: ReactNode
    logoUrl?: string | null
    qrValue?: string | null
    componentPositions?: Record<string, CustomTemplateComponentPosition>
    editableComponents?: boolean
    onComponentPositionChange?: (key: string, position: CustomTemplateComponentPosition) => void
}

function OrderPrintHeader({
    workspaceName,
    title,
    subtitle,
    logoUrl,
    qrValue,
    componentPositions,
    editableComponents,
    onComponentPositionChange
}: OrderPrintHeaderProps) {
    const { t } = useTranslation()
    const logoSrc = resolveLogoSrc(logoUrl)

    return (
        <div className="border-b border-slate-300 pb-3 mb-4">
            <div className="flex items-start justify-between gap-3">
                <div className="w-1/3 flex flex-col items-start">
                    <MovableOrderPrintBlock
                        componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.logo}
                        label={t('customTemplates.movable.logo', { defaultValue: 'Logo' })}
                        position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.logo]}
                        editable={editableComponents}
                        onPositionChange={onComponentPositionChange}
                    >
                        <div className="flex items-start w-full max-w-[180px]">
                            {logoSrc ? (
                                <img
                                    src={logoSrc}
                                    alt="Workspace Logo"
                                    className="max-h-16 max-w-full object-contain object-left"
                                />
                            ) : (
                                <div className="h-10 flex items-center bg-gray-100 border border-gray-200 justify-center w-40 text-gray-400 font-bold tracking-wider uppercase">
                                    LOGO
                                </div>
                            )}
                        </div>
                    </MovableOrderPrintBlock>
                </div>

                <div className="w-1/3 flex justify-center pt-1">
                    {qrValue ? (
                        <MovableOrderPrintBlock
                            componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.qrCode}
                            label={t('customTemplates.movable.qrCode', { defaultValue: 'QR Code' })}
                            position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.qrCode]}
                            editable={editableComponents}
                            onPositionChange={onComponentPositionChange}
                        >
                            <div className="p-1.5 bg-white border border-slate-200 rounded" data-qr-sharp="true">
                                <ReactQRCode
                                    value={qrValue}
                                    size={64}
                                    level="M"
                                />
                            </div>
                        </MovableOrderPrintBlock>
                    ) : null}
                </div>

                <div className="w-1/3 flex flex-col items-center text-center">
                    <MovableOrderPrintBlock
                        componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.workspaceName}
                        label={t('customTemplates.movable.workspaceName', { defaultValue: 'Workspace Name' })}
                        position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.workspaceName]}
                        editable={editableComponents}
                        onPositionChange={onComponentPositionChange}
                    >
                        <h1 className="text-xl font-bold">{workspaceName || 'Atlas'}</h1>
                    </MovableOrderPrintBlock>
                    <MovableOrderPrintBlock
                        componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.title}
                        label={t('customTemplates.movable.title', { defaultValue: 'Title' })}
                        position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.title]}
                        editable={editableComponents}
                        onPositionChange={onComponentPositionChange}
                    >
                        <p className="text-sm font-semibold">{title}</p>
                    </MovableOrderPrintBlock>
                    {subtitle ? (
                        <MovableOrderPrintBlock
                            componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.subtitle}
                            label={t('customTemplates.movable.subtitle', { defaultValue: 'Subtitle' })}
                            position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.subtitle]}
                            editable={editableComponents}
                            onPositionChange={onComponentPositionChange}
                        >
                            <p className="text-[11px] text-slate-600">{subtitle}</p>
                        </MovableOrderPrintBlock>
                    ) : null}
                </div>
            </div>
        </div>
    )
}

function resolveStatusLabel(t: (key: string) => string, status: string): string {
    const translated = t(`orders.status.${status}`)
    return translated && translated !== `orders.status.${status}` ? translated : status
}

function resolvePaymentLabel(t: (key: string) => string, method?: string | null): string {
    switch (method) {
        case 'cash': return t('pos.cash') || 'Cash'
        case 'fib': return 'FIB'
        case 'qicard': return 'Qi Card'
        case 'zaincash': return 'Zain Cash'
        case 'fastpay': return 'FastPay'
        case 'bank_transfer': return 'Bank Transfer'
        default: return 'Credit'
    }
}

function resolvePaymentStatusLabel(
    t: (key: string, options?: Record<string, unknown>) => string,
    order: SalesOrder | PurchaseOrder
) {
    const status = getOrderPaymentStatus(order)
    if (status === 'paid') return t('orders.status.paid', { defaultValue: 'Paid' })
    if (status === 'partial') return t('orders.status.partial', { defaultValue: 'Partially Paid' })
    return t('orders.status.unpaid', { defaultValue: 'Unpaid' })
}

export function OrderListPrintTemplate({
    workspaceName,
    printLang,
    salesOrders,
    purchaseOrders,
    activeTab,
    iqdPreference = 'IQD',
    metrics,
    logoUrl,
    qrValue
}: OrderListPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const isSales = activeTab === 'sales'
    const title = isSales
        ? (t('orders.tabs.sales') || 'Sales Orders')
        : (t('orders.tabs.purchase') || 'Purchase Orders')

    return (
        <div
            dir={isRTL(printLang) ? 'rtl' : 'ltr'}
            className="bg-white text-black"
            style={{ width: '210mm', minHeight: '297mm', padding: '14mm 12mm' }}
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
@media print {
    @page { margin: 0; size: A4; }
    body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
}
`
                }}
            />

            <OrderPrintHeader
                workspaceName={workspaceName}
                title={title}
                subtitle={formatDateTime(new Date().toISOString())}
                logoUrl={logoUrl}
                qrValue={qrValue}
            />

            <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                <div className="border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500 text-center">{t('orders.print.totalOrders') || 'Total Orders'}</p>
                    <p className="font-bold text-center">{metrics.totalOrders}</p>
                </div>
                <div className="border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500 text-center">{t('orders.print.totalValue') || 'Total Value'}</p>
                    <p className="font-bold text-center">
                        {isSales && salesOrders.length > 0
                            ? formatCurrency(metrics.totalValue, salesOrders[0].currency, iqdPreference)
                            : !isSales && purchaseOrders.length > 0
                                ? formatCurrency(metrics.totalValue, purchaseOrders[0].currency, iqdPreference)
                                : metrics.totalValue}
                    </p>
                </div>
                <div className="border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500 text-center">{t('budget.status.paid') || 'Paid'}</p>
                    <p className="font-bold text-center">{metrics.paidCount}</p>
                </div>
                <div className="border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500 text-center">{t('budget.status.pending') || 'Unpaid'}</p>
                    <p className="font-bold text-center">{metrics.unpaidCount}</p>
                </div>
            </div>

            {isSales ? (
                <table className="w-full border-collapse text-xs">
                    <thead>
                        <tr className="bg-slate-100">
                            <th className="border border-slate-300 p-2 text-start">{t('orders.table.orderNumber') || 'Order #'}</th>
                            <th className="border border-slate-300 p-2 text-start">{t('orders.table.customer') || 'Customer'}</th>
                            <th className="border border-slate-300 p-2 text-center">{t('orders.table.items') || 'Items'}</th>
                            <th className="border border-slate-300 p-2 text-start">{t('common.status') || 'Status'}</th>
                            <th className="border border-slate-300 p-2 text-end">{t('common.total') || 'Total'}</th>
                            <th className="border border-slate-300 p-2 text-start">{t('orders.form.date') || 'Date'}</th>
                            <th className="border border-slate-300 p-2 text-start">{t('pos.paymentMethod') || 'Payment'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {salesOrders.length === 0 ? (
                            <tr>
                                <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={7}>
                                    {t('common.noData') || 'No data'}
                                </td>
                            </tr>
                        ) : salesOrders.map((order) => (
                            <tr key={order.id}>
                                <td className="border border-slate-300 p-2 font-semibold">{order.orderNumber}</td>
                                <td className="border border-slate-300 p-2">{order.customerName}</td>
                                <td className="border border-slate-300 p-2 text-center">{order.items.length}</td>
                                <td className="border border-slate-300 p-2">{resolveStatusLabel(t, order.status)}</td>
                                <td className="border border-slate-300 p-2 text-end font-semibold">{formatCurrency(order.total, order.currency, iqdPreference)}</td>
                                <td className="border border-slate-300 p-2">{formatDate(order.createdAt)}</td>
                                <td className="border border-slate-300 p-2">
                                    <span className={getOrderPaymentStatus(order) !== 'unpaid' ? 'font-semibold' : ''}>
                                        {resolvePaymentStatusLabel(t, order)}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <table className="w-full border-collapse text-xs">
                    <thead>
                        <tr className="bg-slate-100">
                            <th className="border border-slate-300 p-2 text-start">{t('orders.table.orderNumber') || 'Order #'}</th>
                            <th className="border border-slate-300 p-2 text-start">{t('suppliers.title') || 'Supplier'}</th>
                            <th className="border border-slate-300 p-2 text-center">{t('orders.table.items') || 'Items'}</th>
                            <th className="border border-slate-300 p-2 text-start">{t('common.status') || 'Status'}</th>
                            <th className="border border-slate-300 p-2 text-end">{t('common.total') || 'Total'}</th>
                            <th className="border border-slate-300 p-2 text-start">{t('orders.form.date') || 'Date'}</th>
                            <th className="border border-slate-300 p-2 text-start">{t('pos.paymentMethod') || 'Payment'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {purchaseOrders.length === 0 ? (
                            <tr>
                                <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={7}>
                                    {t('common.noData') || 'No data'}
                                </td>
                            </tr>
                        ) : purchaseOrders.map((order) => (
                            <tr key={order.id}>
                                <td className="border border-slate-300 p-2 font-semibold">{order.orderNumber}</td>
                                <td className="border border-slate-300 p-2">{order.supplierName}</td>
                                <td className="border border-slate-300 p-2 text-center">{order.items.length}</td>
                                <td className="border border-slate-300 p-2">{resolveStatusLabel(t, order.status)}</td>
                                <td className="border border-slate-300 p-2 text-end font-semibold">{formatCurrency(order.total, order.currency, iqdPreference)}</td>
                                <td className="border border-slate-300 p-2">{formatDate(order.createdAt)}</td>
                                <td className="border border-slate-300 p-2">
                                    <span className={getOrderPaymentStatus(order) !== 'unpaid' ? 'font-semibold' : ''}>
                                        {resolvePaymentStatusLabel(t, order)}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}

export function OrderDetailsPrintTemplate({
    workspaceName,
    printLang,
    order,
    installments = [],
    kind,
    iqdPreference = 'IQD',
    logoUrl,
    qrValue,
    hideUnit,
    hideDiscount,
    componentPositions,
    editableComponents,
    onComponentPositionChange,
    workspaceFooterContacts
}: OrderDetailsPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const isSales = kind === 'sales'
    const salesOrder = isSales ? (order as SalesOrder) : null
    const purchaseOrder = !isSales ? (order as PurchaseOrder) : null
    const currency = order.currency
    const noteValue = order.notes?.trim()

    const counterpartyLabel = isSales
        ? (t('orders.details.customer') || 'Customer')
        : (t('orders.details.supplier') || 'Supplier')
    const counterpartyName = isSales
        ? salesOrder!.customerName
        : purchaseOrder!.supplierName
    const title = isSales
        ? (t('orders.details.salesOrder') || 'Sales Order')
        : (t('orders.details.purchaseOrder') || 'Purchase Order')

    return (
        <div
            dir={isRTL(printLang) ? 'rtl' : 'ltr'}
            className="bg-white text-black"
            style={{ width: '210mm', minHeight: '297mm', padding: '14mm 12mm' }}
            data-order-print-page
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
@media print {
    @page { margin: 0; size: A4; }
    body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
    .order-template-move-handle { display: none !important; }
}
`
                }}
            />

            <OrderPrintHeader
                workspaceName={workspaceName}
                title={title}
                subtitle={
                    <span className="flex items-center justify-center gap-1">
                        <span className="font-semibold">{order.orderNumber}</span>
                        <span>•</span>
                        <span>{formatDateTime(new Date().toISOString())}</span>
                    </span>
                }
                logoUrl={logoUrl}
                qrValue={qrValue}
                componentPositions={componentPositions}
                editableComponents={editableComponents}
                onComponentPositionChange={onComponentPositionChange}
            />

            <div className="grid grid-cols-2 gap-4 mb-4 text-xs text-center">
                <MovableOrderPrintBlock
                    componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.customer}
                    label={counterpartyLabel}
                    position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.customer]}
                    editable={editableComponents}
                    onPositionChange={onComponentPositionChange}
                >
                <div className="h-full border border-slate-300 rounded-md p-3">
                    <h2 className="font-semibold mb-2">{counterpartyLabel}</h2>
                    <p className="font-bold text-sm">{counterpartyName}</p>
                    {isSales && salesOrder?.shippingAddress ? (
                        <p className="text-slate-600 mt-1">{salesOrder.shippingAddress}</p>
                    ) : null}
                </div>
                </MovableOrderPrintBlock>
                <MovableOrderPrintBlock
                    componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.commercials}
                    label={t('orders.details.commercials') || 'Commercials'}
                    position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.commercials]}
                    editable={editableComponents}
                    onPositionChange={onComponentPositionChange}
                >
                <div className="h-full border border-slate-300 rounded-md p-3">
                    <h2 className="font-semibold mb-2">{t('orders.details.commercials') || 'Order Summary'}</h2>
                    <p>{t('orders.details.subtotal') || 'Subtotal'}: {formatCurrency(order.subtotal, currency, iqdPreference)}</p>
                    {!hideDiscount && <p>{t('orders.details.discount') || 'Discount'}: {formatCurrency(order.discount, currency, iqdPreference)}</p>}
                    {isSales && salesOrder ? (
                        <p>{t('orders.details.tax') || 'Tax'}: {formatCurrency(salesOrder.tax, currency, iqdPreference)}</p>
                    ) : null}
                    <p className="font-bold">{t('common.total') || 'Total'}: {formatCurrency(order.total, currency, iqdPreference)}</p>
                    <p>{t('common.status') || 'Status'}: {resolveStatusLabel(t, order.status)}</p>
                    <p>{t('pos.paymentMethod') || 'Payment'}: {resolvePaymentLabel(t, order.paymentMethod)}</p>
                    <p>{resolvePaymentStatusLabel(t, order)}{order.paidAt ? ` • ${formatDate(order.paidAt)}` : ''}</p>
                    <p>{t('orders.details.paidAmount', { defaultValue: 'Paid' })}: {formatCurrency(getOrderPaidAmount(order), order.currency, iqdPreference)}</p>
                    <p>{t('orders.details.outstanding', { defaultValue: 'Outstanding' })}: {formatCurrency(getOrderBalanceAmount(order), order.currency, iqdPreference)}</p>
                </div>
                </MovableOrderPrintBlock>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                <MovableOrderPrintBlock
                    componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.created}
                    label={t('orders.details.created') || 'Created'}
                    position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.created]}
                    editable={editableComponents}
                    onPositionChange={onComponentPositionChange}
                >
                <div className="h-full border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500 text-center">{t('orders.details.created') || 'Created'}</p>
                    <p className="font-bold text-center">{formatDateTime(order.createdAt)}</p>
                </div>
                </MovableOrderPrintBlock>
                <MovableOrderPrintBlock
                    componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.expectedDelivery}
                    label={t('orders.details.expectedDelivery') || 'Expected Delivery'}
                    position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.expectedDelivery]}
                    editable={editableComponents}
                    onPositionChange={onComponentPositionChange}
                >
                <div className="h-full border border-slate-300 rounded-md p-2">
                    <p className="text-slate-500 text-center">{t('orders.details.expectedDelivery') || 'Expected Delivery'}</p>
                    <p className="font-bold text-center">{order.expectedDeliveryDate ? formatDateTime(order.expectedDeliveryDate) : 'N/A'}</p>
                </div>
                </MovableOrderPrintBlock>
            </div>

            <MovableOrderPrintBlock
                componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.orderItems}
                label={t('orders.details.orderItems') || 'Order Items'}
                position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.orderItems]}
                editable={editableComponents}
                onPositionChange={onComponentPositionChange}
            >
            <h3 className="font-semibold mb-2 text-sm">{t('orders.details.orderItems') || 'Order Items'}</h3>
            <table className="w-full border-collapse text-xs mb-5">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-slate-300 p-2 text-start">{t('products.title') || 'Product'}</th>
                        <th className="border border-slate-300 p-2 text-start">SKU</th>
                        <th className="border border-slate-300 p-2 text-end">{t('orders.form.table.qty') || 'Qty'}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('orders.form.table.price') || 'Unit Price'}</th>
                        <th className="border border-slate-300 p-2 text-end">{t('common.total') || 'Total'}</th>
                    </tr>
                </thead>
                <tbody>
                    {order.items.length === 0 ? (
                        <tr>
                            <td className="border border-slate-300 p-3 text-center text-slate-500" colSpan={5}>
                                {t('common.noData') || 'No data'}
                            </td>
                        </tr>
                    ) : order.items.map((item) => (
                        <tr key={item.id}>
                            <td className="border border-slate-300 p-2 font-medium">{item.productName}</td>
                            <td className="border border-slate-300 p-2 text-slate-600">{item.productSku || '-'}</td>
                            <td className="border border-slate-300 p-2 text-end">
                                {item.quantity}{(!hideUnit && (item as any).unit) ? ` ${(item as any).unit}` : ''}
                            </td>
                            <td className="border border-slate-300 p-2 text-end">{formatCurrency(item.convertedUnitPrice, currency, iqdPreference)}</td>
                            <td className="border border-slate-300 p-2 text-end font-semibold">{formatCurrency(item.lineTotal, currency, iqdPreference)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            </MovableOrderPrintBlock>

            <MovableOrderPrintBlock
                componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.totals}
                label={t('common.total') || 'Totals'}
                position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.totals]}
                editable={editableComponents}
                onPositionChange={onComponentPositionChange}
            >
            <div className="flex justify-end mb-5">
                <div className="w-60 text-xs space-y-1">
                    <div className="flex justify-between">
                        <span className="text-slate-600">{t('orders.details.subtotal') || 'Subtotal'}</span>
                        <span className="font-semibold">{formatCurrency(order.subtotal, currency, iqdPreference)}</span>
                    </div>
                    {!hideDiscount && (
                        <div className="flex justify-between">
                            <span className="text-slate-600">{t('orders.details.discount') || 'Discount'}</span>
                            <span className="font-semibold">{formatCurrency(order.discount, currency, iqdPreference)}</span>
                        </div>
                    )}
                    {isSales && salesOrder ? (
                        <div className="flex justify-between">
                            <span className="text-slate-600">{t('orders.details.tax') || 'Tax'}</span>
                            <span className="font-semibold">{formatCurrency(salesOrder.tax, currency, iqdPreference)}</span>
                        </div>
                    ) : null}
                    <div className="flex justify-between border-t border-slate-300 pt-1 mt-1">
                        <span className="font-bold">{t('common.total') || 'Total'}</span>
                        <span className="font-bold">{formatCurrency(order.total, currency, iqdPreference)}</span>
                    </div>
                </div>
            </div>
            </MovableOrderPrintBlock>

            {installments.length > 0 ? (
                <>
                    <h3 className="font-semibold mb-2 text-sm">
                        {t('orders.details.installmentSchedule', { defaultValue: 'Installment Schedule' })}
                    </h3>
                    <table className="w-full border-collapse text-xs mb-5">
                        <thead>
                            <tr className="bg-slate-100">
                                <th className="border border-slate-300 p-2 text-start">
                                    {t('orders.details.installmentNumber', { defaultValue: 'Installment' })}
                                </th>
                                <th className="border border-slate-300 p-2 text-start">
                                    {t('orders.details.dueDate', { defaultValue: 'Due Date' })}
                                </th>
                                <th className="border border-slate-300 p-2 text-end">
                                    {t('orders.details.plannedAmount', { defaultValue: 'Planned' })}
                                </th>
                                <th className="border border-slate-300 p-2 text-end">
                                    {t('orders.details.paidAmount', { defaultValue: 'Paid' })}
                                </th>
                                <th className="border border-slate-300 p-2 text-end">
                                    {t('orders.details.outstanding', { defaultValue: 'Outstanding' })}
                                </th>
                                <th className="border border-slate-300 p-2 text-start">
                                    {t('common.status', { defaultValue: 'Status' })}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {installments.map((installment) => (
                                <tr key={installment.id}>
                                    <td className="border border-slate-300 p-2 font-medium">#{installment.installmentNo}</td>
                                    <td className="border border-slate-300 p-2">{formatDate(installment.dueDate)}</td>
                                    <td className="border border-slate-300 p-2 text-end">
                                        {formatCurrency(installment.plannedAmount, currency, iqdPreference)}
                                    </td>
                                    <td className="border border-slate-300 p-2 text-end">
                                        {formatCurrency(installment.paidAmount, currency, iqdPreference)}
                                    </td>
                                    <td className="border border-slate-300 p-2 text-end font-semibold">
                                        {formatCurrency(installment.balanceAmount, currency, iqdPreference)}
                                    </td>
                                    <td className="border border-slate-300 p-2">
                                        {installment.status === 'paid' 
                                            ? t('budget.status.paid', { defaultValue: 'Paid' })
                                            : installment.status === 'unpaid'
                                                ? t('budget.status.pending', { defaultValue: 'Unpaid' })
                                                : t(`orders.Status.${installment.status}`, { defaultValue: installment.status })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            ) : null}

            <MovableOrderPrintBlock
                componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.notes}
                label={t('orders.details.notes') || 'Notes'}
                position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.notes]}
                editable={editableComponents}
                onPositionChange={onComponentPositionChange}
            >
                {noteValue ? (
                    <div className="mt-6 text-xs">
                        <div className="font-semibold text-slate-600">{t('orders.details.notes') || 'Notes'}:</div>
                        <div className="mt-2 whitespace-pre-wrap break-words text-[11px] text-slate-800">
                            {noteValue}
                        </div>
                    </div>
                ) : null}
            </MovableOrderPrintBlock>

            <MovableOrderPrintBlock
                componentKey={ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.contacts}
                label={t('orders.print.contacts', { defaultValue: 'Contacts' })}
                position={componentPositions?.[ORDER_DETAILS_MOVABLE_COMPONENT_KEYS.contacts]}
                editable={editableComponents}
                onPositionChange={onComponentPositionChange}
            >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {[
                        {
                            key: 'address',
                            primary: workspaceFooterContacts?.address?.primary?.trim() || '',
                            nonPrimary: workspaceFooterContacts?.address?.nonPrimary?.trim() || '',
                            icon: MapPin,
                        },
                        {
                            key: 'phone',
                            primary: workspaceFooterContacts?.phone?.primary?.trim() || '',
                            nonPrimary: workspaceFooterContacts?.phone?.nonPrimary?.trim() || '',
                            icon: Phone,
                        },
                    ].map((group) => {
                        const entries: Array<{ value: string }> = []
                        if (group.primary) entries.push({ value: group.primary })
                        if (group.nonPrimary) entries.push({ value: group.nonPrimary })
                        return { ...group, entries }
                    }).filter((group) => group.entries.length > 0)
                    .map((group, groupIndex, arr) => (
                        <div key={group.key} className="inline-flex items-center gap-1">
                            <group.icon className="w-3.5 h-3.5 shrink-0" />
                            {group.entries.map((entry, entryIndex) => (
                                <span key={entryIndex}>
                                    {entryIndex > 0 && <span className="mx-0.5 select-none">●</span>}
                                    <span>{entry.value}</span>
                                </span>
                            ))}
                            {groupIndex < arr.length - 1 && (
                                <span className="mx-1 text-slate-300 select-none">│</span>
                            )}
                        </div>
                    ))}
                </div>
            </MovableOrderPrintBlock>
        </div>
    )
}
