import { useMemo } from 'react'
import { ArrowLeft, CalendarDays, CreditCard, Eye, Mail, MapPin, Phone, Receipt, ShoppingCart, Truck, UsersRound, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import { getTravelSaleCost, getTravelStatusLabel } from '@/lib/travelAgency'
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import {
    useBusinessPartner,
    useCustomerSalesOrders,
    useLoans,
    useSupplierPurchaseOrders,
    useSupplierTravelAgencySales,
    type Loan,
    type PurchaseOrder,
    type SalesOrder,
    type TravelAgencySale
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
import { useWorkspace } from '@/workspace'

type PartnerViewKind = 'customer' | 'supplier' | 'business_partner'

type ActivityRow = {
    id: string
    reference: string
    source: 'sales_order' | 'purchase_order' | 'travel_sale' | 'loan'
    date: string
    status: string
    statusLabel: string
    paymentLabel: string
    total: number
    currency: string
    summary: string
    href: string
}

function roleIncludesCustomer(role: 'customer' | 'supplier' | 'both') {
    return role === 'customer' || role === 'both'
}

function roleIncludesSupplier(role: 'customer' | 'supplier' | 'both') {
    return role === 'supplier' || role === 'both'
}

function roleBadgeLabel(role: 'customer' | 'supplier' | 'both', t: (key: string, options?: Record<string, unknown>) => string) {
    switch (role) {
        case 'customer':
            return t('customers.title') || 'Customer'
        case 'supplier':
            return t('suppliers.title') || 'Supplier'
        default:
            return t('businessPartners.roles.both') || 'Both'
    }
}

function roleBadgeVariant(role: 'customer' | 'supplier' | 'both') {
    switch (role) {
        case 'customer':
            return 'secondary'
        case 'supplier':
            return 'outline'
        default:
            return 'default'
    }
}

function normalizeSalesOrder(order: SalesOrder): ActivityRow {
    return {
        id: order.id,
        reference: order.orderNumber,
        source: 'sales_order',
        date: order.actualDeliveryDate || order.paidAt || order.updatedAt || order.createdAt,
        status: order.status,
        statusLabel: order.status,
        paymentLabel: order.isPaid ? 'Paid' : 'Unpaid',
        total: order.total,
        currency: order.currency,
        summary: order.items.slice(0, 2).map((item) => item.productName).join(', ') || order.customerName,
        href: `/orders/${order.id}`
    }
}

function normalizePurchaseOrder(order: PurchaseOrder): ActivityRow {
    return {
        id: order.id,
        reference: order.orderNumber,
        source: 'purchase_order',
        date: order.actualDeliveryDate || order.paidAt || order.updatedAt || order.createdAt,
        status: order.status,
        statusLabel: order.status,
        paymentLabel: order.isPaid ? 'Paid' : 'Unpaid',
        total: order.total,
        currency: order.currency,
        summary: order.items.slice(0, 2).map((item) => item.productName).join(', ') || order.supplierName,
        href: `/orders/${order.id}`
    }
}

function normalizeTravelSale(sale: TravelAgencySale): ActivityRow {
    return {
        id: sale.id,
        reference: sale.saleNumber,
        source: 'travel_sale',
        date: sale.paidAt || sale.updatedAt || sale.saleDate || sale.createdAt,
        status: sale.status,
        statusLabel: getTravelStatusLabel(sale.status),
        paymentLabel: sale.isPaid ? 'Paid' : 'Unpaid',
        total: getTravelSaleCost(sale),
        currency: sale.currency,
        summary: sale.travelPackages.join(', ') || sale.groupName || `${sale.touristCount} travellers`,
        href: `/travel-agency/${sale.id}/view`
    }
}

function normalizeLoan(loan: Loan): ActivityRow {
    return {
        id: loan.id,
        reference: loan.loanNo,
        source: 'loan',
        date: loan.updatedAt || loan.createdAt,
        status: loan.status,
        statusLabel: loan.status,
        paymentLabel: loan.balanceAmount > 0 ? 'Open' : 'Settled',
        total: loan.balanceAmount,
        currency: loan.settlementCurrency,
        summary: loan.borrowerName,
        href: '/loans'
    }
}

export function PartnerDetailsView({
    workspaceId,
    partnerId,
    kind
}: {
    workspaceId: string
    partnerId: string
    kind: PartnerViewKind
}) {
    const { t } = useTranslation()
    const { features } = useWorkspace()
    const [, navigate] = useLocation()
    const partner = useBusinessPartner(partnerId)
    const salesOrders = useCustomerSalesOrders(partnerId, workspaceId)
    const purchaseOrders = useSupplierPurchaseOrders(partnerId, workspaceId)
    const travelSales = useSupplierTravelAgencySales(partnerId, workspaceId)
    const loans = useLoans(workspaceId)

    const partnerLoans = useMemo(
        () => loans.filter((loan) => loan.linkedPartyType === 'business_partner' && loan.linkedPartyId === partner?.id),
        [loans, partner?.id]
    )

    const activityRows = useMemo(() => {
        const rows: ActivityRow[] = [
            ...salesOrders.map(normalizeSalesOrder),
            ...purchaseOrders.map(normalizePurchaseOrder),
            ...travelSales.map(normalizeTravelSale),
            ...partnerLoans.map(normalizeLoan)
        ]

        return rows.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    }, [partnerLoans, purchaseOrders, salesOrders, travelSales])

    const allowedByRoute = useMemo(() => {
        if (!partner) {
            return false
        }
        if (kind === 'customer') {
            return roleIncludesCustomer(partner.role)
        }
        if (kind === 'supplier') {
            return roleIncludesSupplier(partner.role)
        }
        return true
    }, [kind, partner])

    const listHref = kind === 'customer'
        ? '/customers'
        : kind === 'supplier'
            ? '/suppliers'
            : '/business-partners'
    const listLabel = kind === 'customer'
        ? (t('customers.title') || 'Customers')
        : kind === 'supplier'
            ? (t('suppliers.title') || 'Suppliers')
            : (t('businessPartners.title') || 'Business Partners')

    if (!partner || !allowedByRoute) {
        return (
            <Card>
                <CardContent className="space-y-4 py-10 text-center">
                    <div className="text-lg font-semibold">
                        {t('businessPartners.notFound') || 'Business partner not found'}
                    </div>
                    <div className="text-sm text-muted-foreground">
                        {t('businessPartners.notFoundDescription') || 'The requested record may have been deleted or moved out of this workspace.'}
                    </div>
                    <div>
                        <Button variant="outline" onClick={() => navigate(listHref)}>
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            {listLabel}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        )
    }

    const locationLabel = [partner.city, partner.country].filter(Boolean).join(', ') || 'N/A'

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
                <div className="flex flex-wrap gap-2">
                    <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide', roleBadgeVariant(partner.role) === 'default' ? 'border-primary/20 bg-primary/10 text-primary' : roleBadgeVariant(partner.role) === 'secondary' ? 'border-secondary bg-secondary text-secondary-foreground' : 'border-border bg-background text-foreground')}>
                        {roleBadgeLabel(partner.role, t)}
                    </span>
                    <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-foreground">
                        {partner.defaultCurrency.toUpperCase()}
                    </span>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <Card>
                    <CardHeader>
                        <CardTitle>{t('businessPartners.profile') || 'Partner Profile'}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        <div className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-4">
                            <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                <UsersRound className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-lg font-semibold">{partner.name}</div>
                                <div className="mt-1 flex flex-wrap gap-2">
                                    <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide', roleBadgeVariant(partner.role) === 'default' ? 'border-primary/20 bg-primary/10 text-primary' : roleBadgeVariant(partner.role) === 'secondary' ? 'border-secondary bg-secondary text-secondary-foreground' : 'border-border bg-background text-foreground')}>
                                        {roleBadgeLabel(partner.role, t)}
                                    </span>
                                    <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-foreground">
                                        {formatDate(partner.createdAt)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border bg-background/70 p-4">
                            <div className="flex items-start gap-3">
                                <UsersRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        {t('suppliers.form.contactName', { defaultValue: 'Contact Name' })}
                                    </div>
                                    <div className="font-medium">{partner.contactName || 'N/A'}</div>
                                </div>
                            </div>
                        </div>

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

                <div className="space-y-4 lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('businessPartners.relationship') || 'Relationship Summary'}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                                <div className="rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        <CreditCard className="h-4 w-4" />
                                        {t('customers.form.creditLimit', { defaultValue: 'Credit Limit' })}
                                    </div>
                                    <div className="mt-2 text-xl font-black">
                                        {formatCurrency(partner.creditLimit || 0, partner.defaultCurrency, features.iqd_display_preference)}
                                    </div>
                                </div>
                                <div className="rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        <Receipt className="h-4 w-4" />
                                        {t('businessPartners.receivable') || 'Receivable'}
                                    </div>
                                    <div className="mt-2 text-xl font-black">
                                        {formatCurrency(partner.receivableBalance, partner.defaultCurrency, features.iqd_display_preference)}
                                    </div>
                                </div>
                                <div className="rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        <Truck className="h-4 w-4" />
                                        {t('businessPartners.payable') || 'Payable'}
                                    </div>
                                    <div className="mt-2 text-xl font-black">
                                        {formatCurrency(partner.payableBalance, partner.defaultCurrency, features.iqd_display_preference)}
                                    </div>
                                </div>
                                <div className="rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        <Wallet className="h-4 w-4" />
                                        {t('businessPartners.loans') || 'Loans'}
                                    </div>
                                    <div className="mt-2 text-xl font-black">
                                        {formatCurrency(partner.loanOutstandingBalance, partner.defaultCurrency, features.iqd_display_preference)}
                                    </div>
                                </div>
                                <div className="rounded-2xl border bg-primary/5 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                        <ShoppingCart className="h-4 w-4" />
                                        {t('businessPartners.netExposure') || 'Net Exposure'}
                                    </div>
                                    <div className="mt-2 text-xl font-black">
                                        {formatCurrency(partner.netExposure, partner.defaultCurrency, features.iqd_display_preference)}
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                        {t('orders.tabs.sales', { defaultValue: 'Sales Orders' })}
                                    </div>
                                    <div className="mt-2 text-2xl font-black">{partner.totalSalesOrders}</div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                        {t('orders.tabs.purchase', { defaultValue: 'Purchase Orders' })}
                                    </div>
                                    <div className="mt-2 text-2xl font-black">{partner.totalPurchaseOrders}</div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                        {t('loans.title', { defaultValue: 'Loans' })}
                                    </div>
                                    <div className="mt-2 text-2xl font-black">{partner.totalLoanCount}</div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                        <CalendarDays className="h-4 w-4" />
                                        {t('businessPartners.lastActivity') || 'Last Activity'}
                                    </div>
                                    <div className="mt-2 text-base font-black">
                                        {activityRows[0] ? formatDate(activityRows[0].date) : 'N/A'}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t('businessPartners.activityTimeline') || 'Unified Activity Timeline'}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {activityRows.length === 0 ? (
                                <div className="rounded-2xl border py-12 text-center text-muted-foreground">
                                    {t('businessPartners.noActivity') || 'No related activity yet.'}
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-2xl border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>{t('common.reference', { defaultValue: 'Reference' })}</TableHead>
                                                <TableHead>{t('common.date', { defaultValue: 'Date' })}</TableHead>
                                                <TableHead>{t('common.status', { defaultValue: 'Status' })}</TableHead>
                                                <TableHead>{t('common.details', { defaultValue: 'Details' })}</TableHead>
                                                <TableHead>{t('pos.paymentMethod', { defaultValue: 'Payment' })}</TableHead>
                                                <TableHead className="text-end">{t('common.total', { defaultValue: 'Total' })}</TableHead>
                                                <TableHead className="text-end">{t('common.actions', { defaultValue: 'Actions' })}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {activityRows.map((row) => (
                                                <TableRow key={row.id}>
                                                    <TableCell className="font-semibold">{row.reference}</TableCell>
                                                    <TableCell>{formatDateTime(row.date)}</TableCell>
                                                    <TableCell>
                                                        <span className={cn(
                                                            'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
                                                            row.status === 'completed' || row.status === 'received'
                                                                ? 'border-emerald-200 bg-emerald-500/10 text-emerald-700'
                                                                : row.status === 'overdue'
                                                                    ? 'border-amber-200 bg-amber-500/10 text-amber-700'
                                                                    : 'border-border bg-muted text-foreground'
                                                        )}>
                                                            {row.statusLabel}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell>{row.summary}</TableCell>
                                                    <TableCell>{row.paymentLabel}</TableCell>
                                                    <TableCell className="text-end font-semibold">
                                                        {formatCurrency(row.total, row.currency as any, features.iqd_display_preference)}
                                                    </TableCell>
                                                    <TableCell className="text-end">
                                                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(row.href)}>
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
