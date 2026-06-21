import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowLeftRight, CalendarDays, Car, CreditCard, Eye, Mail, MapPin, Package, Phone, Printer, Receipt, ShoppingCart, Truck, UserRound, UsersRound, TrendingUp, TrendingDown, Activity } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import { isSupabaseConfigured, useAuth } from '@/auth'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { buildConversionRates } from '@/lib/budget'
import { convertToStoreBase } from '@/lib/currency'
import {
    PARTNER_DETAILS_TEMPLATE_KEY,
    buildCustomTemplateLayoutPdf,
    createCustomTemplatePreview,
    getCustomTemplatePrintLanguageWarning,
    getCustomTemplateTarget,
    getStoredCustomTemplateLabel,
    isCustomTemplatePrintLanguageCompatible,
    readCustomTemplateLayout,
    resolveCustomTemplatePrintLanguage,
    type StoredCustomTemplateRow
} from '@/lib/customTemplates'
import { convertCurrencyAmountWithAvailableSnapshot, convertCurrencyAmountWithSnapshot } from '@/lib/orderCurrency'
import { getLoanDetailsPath, getLoanDirection, getLoanDirectionLabel, isSimpleLoan } from '@/lib/loanPresentation'
import type { CustomTemplateLayout } from '@/lib/pdfPreviewStore'

import { getTravelSaleCost, getTravelStatusLabel } from '@/lib/travelAgency'
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import {
    useAgent,
    useBusinessPartner,
    useCustomerSalesOrders,
    useLoans,
    usePaymentTransactions,
    useSales,
    useSupplierPurchaseOrders,
    useSupplierTravelAgencySales,
    useWorkspaceUsers,
    type BusinessPartnerRole,
    type Loan,
    type PurchaseOrder,
    type PaymentTransaction,
    type SalesOrder,
    type TravelAgencySale,
    type LoanInstallment,
    db,
} from '@/local-db'
import { fetchCachedCustomTemplates } from '@/lib/cachedCustomTemplates'
import { Button } from '@/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/card'
import { PrintPreviewModal } from '@/ui/components/PrintPreviewModal'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/components/table'
import { useWorkspace } from '@/workspace'
import { useDateRange } from '@/context/DateRangeContext'
import { DateRangeFilters } from '@/ui/components/DateRangeFilters'
import type { PartnerDetailsPrintData } from '@/ui/components/crm/PartnerDetailsPrintTemplate'
import type { PrintFormat } from '@/services/pdfGenerator'
import { platformService } from '@/services/platformService'

type PartnerKind = 'customer' | 'supplier' | 'agent' | 'business_partner'
type RelatedProductOrder = SalesOrder | PurchaseOrder
type RelatedTransaction = {
    id: string
    source: 'sales_order' | 'purchase_order' | 'travel_sale' | 'loan' | 'simple_loan' | 'direct_transaction'
    reference: string
    displayDate: string
    sortDate: string
    activityDate: string
    status: string
    statusLabel: string
    isPaid: boolean
    summary: string
    total: number
    originalAmount: number
    paidAmount: number
    remainingAmount: number
    currency: SalesOrder['currency']
    totalInPartnerCurrency: number
    units: number
    viewHref: string
    isActive: boolean
    isCompleted: boolean
    isOutstanding: boolean
    financingReference?: string | null
    financingLabel?: string | null
    financingStatus?: string | null
    financingStatusLabel?: string | null
}
type TranslationFn = (key: string, options?: Record<string, unknown>) => string
const LOAN_REPAYMENT_SOURCE_TYPES = new Set(['loan_payment', 'simple_loan', 'loan_installment'])

function roleIncludesCustomer(role: BusinessPartnerRole) {
    return role === 'customer' || role === 'both'
}

function roleIncludesSupplier(role: BusinessPartnerRole) {
    return role === 'supplier' || role === 'both'
}

function roleBadgeLabel(role: BusinessPartnerRole, t: TranslationFn) {
    switch (role) {
        case 'customer':
            return t('customers.title', { defaultValue: 'Customer' })
        case 'supplier':
            return t('suppliers.title', { defaultValue: 'Supplier' })
        case 'buyer':
            return t('businessPartners.roles.buyer', { defaultValue: 'Buyer' })
        case 'seller':
            return t('businessPartners.roles.seller', { defaultValue: 'Seller' })
        case 'agent':
            return t('businessPartners.roles.agent', { defaultValue: 'Agent' })
        default:
            return t('businessPartners.roles.both', { defaultValue: 'Both' })
    }
}

function sourceLabel(source: RelatedTransaction['source'], t: TranslationFn) {
    switch (source) {
        case 'sales_order':
            return t('orders.tabs.sales', { defaultValue: 'Sales Order' })
        case 'purchase_order':
            return t('orders.tabs.purchase', { defaultValue: 'Purchase Order' })
        case 'travel_sale':
            return t('travelAgency.title', { defaultValue: 'Travel Sale' })
        case 'simple_loan':
            return t('loans.simpleTab', { defaultValue: 'Loans' })
        case 'direct_transaction':
            return t('ledger.type.direct_transaction', { defaultValue: 'Direct Transaction' })
        default:
            return t('loans.installmentRepayment', { defaultValue: 'Installment Repayment' })
    }
}

function sourceBadgeClass(source: RelatedTransaction['source']) {
    switch (source) {
        case 'sales_order':
            return 'border-emerald-200 bg-emerald-500/10 text-emerald-700'
        case 'purchase_order':
            return 'border-sky-200 bg-sky-500/10 text-sky-700'
        case 'travel_sale':
            return 'border-violet-200 bg-violet-500/10 text-violet-700'
        case 'direct_transaction':
            return 'border-fuchsia-200 bg-fuchsia-500/10 text-fuchsia-700'
        default:
            return 'border-orange-200 bg-orange-500/10 text-orange-700'
    }
}

function statusBadgeClass(status: string) {
    if (status === 'draft') return 'bg-slate-100 text-slate-700 border-slate-200'
    if (status === 'pending') return 'bg-amber-100 text-amber-800 border-amber-200'
    if (status === 'ordered') return 'bg-blue-100 text-blue-800 border-blue-200'
    if (status === 'received') return 'bg-cyan-100 text-cyan-800 border-cyan-200'
    if (status === 'completed') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    if (status === 'cancelled') return 'bg-rose-100 text-rose-800 border-rose-200'
    if (status === 'active') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    if (status === 'inactive') return 'bg-slate-100 text-slate-700 border-slate-200'
    if (status === 'blocked') return 'bg-rose-100 text-rose-800 border-rose-200'
    if (status === 'overdue') return 'bg-rose-100 text-rose-800 border-rose-200'
    return 'bg-muted text-muted-foreground border-border'
}

function statusLabel(t: TranslationFn, status: string) {
    return t(`orders.status.${status}`, { defaultValue: status })
}

function getOrderSummary(items: Array<{ productName: string }>) {
    const firstItems = items.slice(0, 2).map((item) => item.productName)
    if (items.length <= 2) return firstItems.join(', ')
    return `${firstItems.join(', ')} +${items.length - 2}`
}

function getTravelSaleSummary(sale: TravelAgencySale) {
    if (sale.travelPackages.length > 0) {
        return sale.travelPackages.join(', ')
    }

    return sale.touristCount === 1 ? '1 traveller' : `${sale.touristCount} travellers`
}

function toPartnerCurrency(order: RelatedProductOrder, currency: SalesOrder['currency']) {
    return convertCurrencyAmountWithSnapshot(order.total, order.currency, currency, order.exchangeRates)
}

function toPartnerCurrencyFromTravelSale(sale: TravelAgencySale, currency: SalesOrder['currency']) {
    return convertCurrencyAmountWithSnapshot(
        getTravelSaleCost(sale),
        sale.currency,
        currency,
        sale.exchangeRateSnapshot ? [sale.exchangeRateSnapshot] as any : undefined
    )
}

function linkedOrderFinancingFields(loan: Loan | undefined, t: TranslationFn) {
    if (!loan) return {}
    return {
        financingReference: loan.loanNo,
        financingLabel: isSimpleLoan(loan)
            ? t('businessPartners.orderLoan', { defaultValue: 'Order Loan' })
            : t('businessPartners.orderInstallments', { defaultValue: 'Order Installments' }),
        financingStatus: loan.status,
        financingStatusLabel: loanStatusLabel(t, loan.status)
    }
}

function normalizeSalesOrder(order: SalesOrder, currency: SalesOrder['currency'], t: TranslationFn, linkedLoan?: Loan): RelatedTransaction {
    const paidAmount = Math.min(order.total, Math.max(0, order.paidAmount ?? (order.isPaid ? order.total : 0)))
    const remainingAmount = Math.max(0, order.balanceAmount ?? order.total - paidAmount)
    const financingFields = linkedOrderFinancingFields(linkedLoan, t)
    return {
        id: order.id,
        source: 'sales_order',
        reference: order.orderNumber,
        displayDate: order.createdAt,
        sortDate: order.updatedAt || order.createdAt,
        activityDate: order.actualDeliveryDate || order.paidAt || order.updatedAt || order.createdAt,
        status: order.status,
        statusLabel: statusLabel(t, order.status),
        isPaid: order.isPaid,
        summary: linkedLoan
            ? `${getOrderSummary(order.items)} · ${financingFields.financingLabel}`
            : getOrderSummary(order.items),
        total: order.total,
        originalAmount: order.total,
        paidAmount,
        remainingAmount,
        currency: order.currency,
        totalInPartnerCurrency: toPartnerCurrency(order, currency),
        units: order.items.reduce((sum, item) => sum + item.quantity, 0),
        viewHref: `/orders/${order.id}`,
        isActive: order.status !== 'cancelled',
        isCompleted: order.status === 'completed',
        isOutstanding: remainingAmount > 0 && (order.status === 'pending' || order.status === 'completed'),
        ...financingFields
    }
}

function normalizePurchaseOrder(order: PurchaseOrder, currency: SalesOrder['currency'], t: TranslationFn, linkedLoan?: Loan): RelatedTransaction {
    const paidAmount = Math.min(order.total, Math.max(0, order.paidAmount ?? (order.isPaid ? order.total : 0)))
    const remainingAmount = Math.max(0, order.balanceAmount ?? order.total - paidAmount)
    const financingFields = linkedOrderFinancingFields(linkedLoan, t)
    return {
        id: order.id,
        source: 'purchase_order',
        reference: order.orderNumber,
        displayDate: order.createdAt,
        sortDate: order.updatedAt || order.createdAt,
        activityDate: order.actualDeliveryDate || order.paidAt || order.updatedAt || order.createdAt,
        status: order.status,
        statusLabel: statusLabel(t, order.status),
        isPaid: order.isPaid,
        summary: linkedLoan
            ? `${getOrderSummary(order.items)} · ${financingFields.financingLabel}`
            : getOrderSummary(order.items),
        total: order.total,
        originalAmount: order.total,
        paidAmount,
        remainingAmount,
        currency: order.currency,
        totalInPartnerCurrency: toPartnerCurrency(order, currency),
        units: order.items.reduce((sum, item) => sum + item.quantity, 0),
        viewHref: `/orders/${order.id}`,
        isActive: order.status !== 'cancelled',
        isCompleted: order.status === 'received' || order.status === 'completed',
        isOutstanding: remainingAmount > 0 && (order.status === 'ordered' || order.status === 'received' || order.status === 'completed'),
        ...financingFields
    }
}

function normalizeTravelSale(sale: TravelAgencySale, currency: SalesOrder['currency']): RelatedTransaction {
    const cost = getTravelSaleCost(sale)
    return {
        id: sale.id,
        source: 'travel_sale',
        reference: sale.saleNumber,
        displayDate: sale.saleDate,
        sortDate: sale.updatedAt || sale.saleDate || sale.createdAt,
        activityDate: sale.paidAt || sale.updatedAt || sale.saleDate || sale.createdAt,
        status: sale.status,
        statusLabel: getTravelStatusLabel(sale.status),
        isPaid: sale.isPaid,
        summary: getTravelSaleSummary(sale),
        total: cost,
        originalAmount: cost,
        paidAmount: sale.paidAmount,
        remainingAmount: cost - sale.paidAmount,
        currency: sale.currency,
        totalInPartnerCurrency: toPartnerCurrencyFromTravelSale(sale, currency),
        units: 0,
        viewHref: `/travel-agency/${sale.id}/view`,
        isActive: sale.status !== 'draft',
        isCompleted: sale.status === 'completed',
        isOutstanding: !sale.isPaid && sale.status === 'completed'
    }
}

function loanStatusLabel(t: TranslationFn, status: Loan['status']) {
    if (status === 'active') return t('sales.loanActive', { defaultValue: 'Loan Active' })
    if (status === 'overdue') return t('sales.loanOverdue', { defaultValue: 'Loan Overdue' })
    if (status === 'completed') return t('sales.loanCompleted', { defaultValue: 'Loan Completed' })
    return status
}

function normalizeLoan(
    loan: Loan,
    currency: SalesOrder['currency'],
    t: TranslationFn,
    installments?: LoanInstallment[],
    linkedSaleReference?: string
): RelatedTransaction {
    const direction = getLoanDirection(loan)
    const directionLabel = getLoanDirectionLabel(direction, t)
    const totalInPartnerCurrency = convertCurrencyAmountWithAvailableSnapshot(
        loan.balanceAmount,
        loan.settlementCurrency,
        currency,
        loan.exchangeRateSnapshot
    ) ?? 0
    const paidInsts = installments?.filter((i) => i.status === 'paid' || i.balanceAmount <= 0).length ?? 0
    const totalInsts = installments?.length ?? 0
    const installmentSummary = totalInsts > 0
        ? ` • ${paidInsts} ${t('loans.of', { defaultValue: 'of' })} ${totalInsts} ${t('loans.installments', { defaultValue: 'installments' })}`
        : ''
    const installmentSourceReference = linkedSaleReference
        || (loan.saleId ? `SALE-${loan.saleId.slice(0, 8).toUpperCase()}` : loan.loanNo)

    return {
        id: loan.id,
        source: isSimpleLoan(loan) ? 'simple_loan' : 'loan',
        reference: loan.loanNo,
        displayDate: loan.createdAt,
        sortDate: loan.updatedAt || loan.createdAt,
        activityDate: loan.updatedAt || loan.createdAt,
        status: loan.status,
        statusLabel: loanStatusLabel(t, loan.status),
        isPaid: loan.balanceAmount <= 0 || loan.status === 'completed',
        summary: isSimpleLoan(loan)
            ? `${directionLabel} • ${loan.borrowerName}`
            : `${installmentSourceReference}${installmentSummary}`,
        total: loan.principalAmount,
        originalAmount: loan.principalAmount,
        paidAmount: loan.totalPaidAmount,
        remainingAmount: loan.balanceAmount,
        currency: loan.settlementCurrency,
        totalInPartnerCurrency,
        units: 0,
        viewHref: getLoanDetailsPath(loan, loan.id),
        isActive: loan.status !== 'completed',
        isCompleted: loan.status === 'completed',
        isOutstanding: loan.balanceAmount > 0
    }
}

function normalizePaymentTransaction(
    tx: PaymentTransaction,
    baseCurrency: string,
    conversionRates: any,
    t: TranslationFn
): RelatedTransaction {
    const isIncoming = tx.direction === 'incoming'
    return {
        id: tx.id,
        source: 'direct_transaction',
        reference: tx.referenceLabel || tx.note || t('ledger.type.direct_transaction', { defaultValue: 'Direct Transaction' }),
        displayDate: tx.paidAt || tx.createdAt,
        sortDate: tx.updatedAt || tx.paidAt || tx.createdAt,
        activityDate: tx.updatedAt || tx.paidAt || tx.createdAt,
        status: 'completed',
        statusLabel: t('ledger.directionFilter.' + tx.direction, { defaultValue: isIncoming ? 'Inflow' : 'Outflow' }),
        isPaid: true,
        summary: tx.note || (isIncoming ? t('ledger.type.direct_inflow', { defaultValue: 'Direct Inflow' }) : t('ledger.type.direct_outflow', { defaultValue: 'Direct Outflow' })),
        total: tx.amount,
        originalAmount: tx.amount,
        paidAmount: tx.amount,
        remainingAmount: 0,
        currency: tx.currency,
        totalInPartnerCurrency: convertToStoreBase(tx.amount, tx.currency, baseCurrency, conversionRates),
        units: 0,
        viewHref: `/ledger`,
        isActive: true,
        isCompleted: true,
        isOutstanding: false
    }
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
    const { t, i18n } = useTranslation()
    const { user } = useAuth()
    const {
        features,
        workspaceName,
        isLocalMode
    } = useWorkspace()
    const { exchangeData, eurRates, tryRates } = useExchangeRate()
    const conversionRates = useMemo(() => buildConversionRates(exchangeData, eurRates, tryRates), [exchangeData, eurRates, tryRates])
    const [, navigate] = useLocation()
    const partner = useBusinessPartner(partnerId)
    const agent = useAgent(partner?.agentFacetId)
    const workspaceUsers = useWorkspaceUsers(workspaceId)
    const customerOrders = useCustomerSalesOrders(partnerId, workspaceId)
    const supplierOrders = useSupplierPurchaseOrders(partnerId, workspaceId)
    const supplierTravelSales = useSupplierTravelAgencySales(partnerId, workspaceId)
    const sales = useSales(workspaceId)
    const loans = useLoans(workspaceId)
    const paymentTransactions = usePaymentTransactions(workspaceId)
    const { dateRange, customDates } = useDateRange()
    const [customPrintTemplates, setCustomPrintTemplates] = useState<StoredCustomTemplateRow[]>([])
    const [selectedPrintTemplate, setSelectedPrintTemplate] = useState<StoredCustomTemplateRow | null>(null)
    const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false)

    useEffect(() => {
        if (!workspaceId || (!isLocalMode && !isSupabaseConfigured)) {
            setCustomPrintTemplates([])
            return
        }

        let cancelled = false

        void (async () => {
            try {
                const templates = await fetchCachedCustomTemplates(workspaceId, {
                    moduleTypeKey: PARTNER_DETAILS_TEMPLATE_KEY,
                    activeOnly: true
                })
                if (!cancelled) {
                    setCustomPrintTemplates(templates as StoredCustomTemplateRow[])
                }
            } catch (error) {
                console.error('[PartnerDetails] Failed to load custom print templates:', error)
                if (!cancelled) {
                    setCustomPrintTemplates([])
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [isLocalMode, workspaceId])

    const dateBounds = useMemo(() => {
        const now = new Date()
        if (dateRange === 'today') {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            const end = new Date(start)
            end.setDate(end.getDate() + 1)
            return { startDate: start.toISOString(), endDate: end.toISOString() }
        }
        if (dateRange === 'month') {
            const start = new Date(now.getFullYear(), now.getMonth(), 1)
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
            return { startDate: start.toISOString(), endDate: end.toISOString() }
        }
        if (dateRange === 'custom' && (customDates.start || customDates.end)) {
            const start = customDates.start ? new Date(customDates.start) : undefined
            const end = customDates.end ? new Date(customDates.end) : undefined
            return { startDate: start?.toISOString(), endDate: end?.toISOString() }
        }
        return { startDate: undefined, endDate: undefined }
    }, [dateRange, customDates])

    const partnerLoans = useMemo(
        () => loans.filter((loan) => loan.linkedPartyType === 'business_partner' && loan.linkedPartyId === partner?.id),
        [loans, partner?.id]
    )
    const filterByDate = useCallback(<T extends { updatedAt?: string; createdAt: string },>(
        items: T[],
        dateField?: (item: T) => string
    ) => dateRange === 'allTime' ? items : items.filter((item) => {
        const d = dateField ? dateField(item) : (item.updatedAt || item.createdAt)
        if (dateBounds.startDate && d < dateBounds.startDate) return false
        if (dateBounds.endDate && d >= dateBounds.endDate) return false
        return true
    }), [dateBounds.endDate, dateBounds.startDate, dateRange])
    const dateFilteredCustomerOrders = useMemo(() => filterByDate(customerOrders), [customerOrders, filterByDate])
    const dateFilteredSupplierOrders = useMemo(() => filterByDate(supplierOrders), [filterByDate, supplierOrders])
    const dateFilteredTravelSales = useMemo(
        () => filterByDate(supplierTravelSales, (s) => s.updatedAt || s.saleDate || s.createdAt),
        [filterByDate, supplierTravelSales]
    )
    const dateFilteredLoans = useMemo(() => filterByDate(partnerLoans), [filterByDate, partnerLoans])
    const standaloneDateFilteredLoans = useMemo(
        () => dateFilteredLoans.filter((loan) => loan.source !== 'order'),
        [dateFilteredLoans]
    )
    const linkedLoanByOrderId = useMemo(
        () => new Map(
            partnerLoans
                .filter((loan) => loan.source === 'order' && !!loan.orderId)
                .map((loan) => [loan.orderId as string, loan])
        ),
        [partnerLoans]
    )
    const directTransactions = useMemo(
        () => paymentTransactions.filter(tx => tx.sourceType === 'direct_transaction' && tx.metadata?.businessPartnerId === partnerId),
        [paymentTransactions, partnerId]
    )
    const dateFilteredPayments = useMemo(
        () => filterByDate(directTransactions, (tx) => tx.paidAt || tx.createdAt),
        [directTransactions, filterByDate]
    )
    const dateFilteredAllPayments = useMemo(
        () => filterByDate(paymentTransactions, (tx) => tx.paidAt || tx.createdAt),
        [filterByDate, paymentTransactions]
    )
    const partnerLoanIds = useMemo(() => partnerLoans.map(l => l.id), [partnerLoans])
    const linkedSaleReferenceById = useMemo(
        () => new Map(sales.map((sale) => [
            sale.id,
            sale.sequenceId
                ? `SALE-${sale.sequenceId}`
                : `SALE-${sale.id.slice(0, 8).toUpperCase()}`
        ])),
        [sales]
    )
    const queriedInstallments = useLiveQuery(
        () => partnerLoanIds.length > 0
            ? db.loan_installments.where('loanId').anyOf(partnerLoanIds).toArray()
            : [],
        [partnerLoanIds]
    )
    const allInstallments = useMemo(
        () => queriedInstallments ?? [],
        [queriedInstallments]
    )
    const dateFilteredInstallments = useMemo(
        () => filterByDate(allInstallments, (inst) => inst.updatedAt || inst.createdAt),
        [filterByDate, allInstallments]
    )
    const allowedByRoute = useMemo(() => {
        if (!partner) {
            return false
        }
        if (partner.role === 'agent' && !features.agents) {
            return false
        }
        if (kind === 'customer') {
            return roleIncludesCustomer(partner.role)
        }
        if (kind === 'supplier') {
            return roleIncludesSupplier(partner.role)
        }
        if (kind === 'agent') {
            return partner.role === 'agent'
        }
        return true
    }, [features.agents, kind, partner])

    const defaultCurrency = partner?.defaultCurrency ?? features.default_currency
    const iqdPreference = features.iqd_display_preference
    const listHref = kind === 'customer'
        ? '/customers'
        : kind === 'supplier'
            ? '/suppliers'
            : kind === 'agent'
                ? '/agents'
            : '/business-partners'
    const listLabel = kind === 'customer'
        ? t('customers.title', { defaultValue: 'Customers' })
        : kind === 'supplier'
            ? t('suppliers.title', { defaultValue: 'Suppliers' })
            : kind === 'agent'
                ? t('agents.title', { defaultValue: 'Agents' })
            : t('businessPartners.title', { defaultValue: 'Business Partners' })
    const typeLabel = partner ? roleBadgeLabel(partner.role, t) : t('businessPartners.title', { defaultValue: 'Business Partner' })
    const contactName = partner?.contactName
    const linkedAgentUser = agent?.linkedUserId
        ? workspaceUsers.find((workspaceUser) => workspaceUser.id === agent.linkedUserId)
        : undefined
    const emptyRelatedLabel = t('businessPartners.noActivity', { defaultValue: 'No related activity yet.' })
    const completedLabel = t('businessPartners.completedItems', { defaultValue: 'Completed Items' })
    const paidLabel = t('businessPartners.settledItems', { defaultValue: 'Settled Items' })
    const providedByYouLabel = t('businessPartners.providedByYou', { defaultValue: 'What You Provided' })
    const providedByPartnerLabel = t('businessPartners.providedByPartner', { defaultValue: 'What the Partner Provided' })
    const amountLabel = t('common.amount', { defaultValue: 'Amount' })
    const paidLabel2 = t('common.paid', { defaultValue: 'Paid' })
    const remainingLabel = t('common.remaining', { defaultValue: 'Remaining' })
    const overviewTitle = t('businessPartners.overview', { defaultValue: 'Partner Overview' })
    const lastActivityLabel = t('businessPartners.lastActivity', { defaultValue: 'Last Activity' })
    const firstActivityLabel = t('businessPartners.firstActivity', { defaultValue: 'First Activity' })
    const detailsColumnLabel = t('common.details', { defaultValue: 'Details' })
    const referenceColumnLabel = t('common.reference', { defaultValue: 'Reference' })
    const partnerRelationshipName = contactName?.trim() || partner?.name || t('businessPartners.title', { defaultValue: 'Business Partner' })
    const workspaceRelationshipName = workspaceName?.trim() || t('businessPartners.ourBusiness', { defaultValue: 'Our business' })
    const relationshipReceivable = Math.max(partner?.receivableBalance || 0, 0)
    const relationshipPayable = Math.max(partner?.payableBalance || 0, 0)
    const filteredProductOrders = useMemo(
        () => [...dateFilteredCustomerOrders, ...dateFilteredSupplierOrders],
        [dateFilteredCustomerOrders, dateFilteredSupplierOrders]
    )

    const relatedTransactions = useMemo(
        () => [
            ...dateFilteredCustomerOrders.map((order) => normalizeSalesOrder(order, defaultCurrency, t, linkedLoanByOrderId.get(order.id))),
            ...dateFilteredSupplierOrders.map((order) => normalizePurchaseOrder(order, defaultCurrency, t, linkedLoanByOrderId.get(order.id))),
            ...dateFilteredTravelSales.map((sale) => normalizeTravelSale(sale, defaultCurrency)),
            ...standaloneDateFilteredLoans.map((loan) => normalizeLoan(
                loan,
                defaultCurrency,
                t,
                undefined,
                loan.saleId ? linkedSaleReferenceById.get(loan.saleId) : undefined
            )),
            ...dateFilteredPayments.map((tx) => normalizePaymentTransaction(tx, defaultCurrency, conversionRates, t))
        ],
        [dateFilteredCustomerOrders, defaultCurrency, standaloneDateFilteredLoans, dateFilteredSupplierOrders, dateFilteredTravelSales, dateFilteredPayments, conversionRates, linkedLoanByOrderId, linkedSaleReferenceById, t]
    )
    const sortedTransactions = useMemo(
        () => [...relatedTransactions].sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime()),
        [relatedTransactions]
    )
    const filteredTransactions = useMemo(
        () => dateRange === 'allTime'
            ? sortedTransactions
            : sortedTransactions.filter((tx) => {
                if (dateBounds.startDate && tx.sortDate < dateBounds.startDate) return false
                if (dateBounds.endDate && tx.sortDate >= dateBounds.endDate) return false
                return true
            }),
        [sortedTransactions, dateRange, dateBounds]
    )
    const filteredRelatedTransactions = useMemo(
        () => dateRange === 'allTime'
            ? relatedTransactions
            : relatedTransactions.filter((tx) => {
                if (dateBounds.startDate && tx.sortDate < dateBounds.startDate) return false
                if (dateBounds.endDate && tx.sortDate >= dateBounds.endDate) return false
                return true
            }),
        [relatedTransactions, dateRange, dateBounds]
    )
    const filteredActive = useMemo(
        () => filteredRelatedTransactions.filter((tx) => tx.isActive),
        [filteredRelatedTransactions]
    )
    const filteredSettled = useMemo(
        () => filteredActive.filter((tx) => tx.isPaid),
        [filteredActive]
    )
    const filteredCompleted = useMemo(
        () => filteredActive.filter((tx) => tx.isCompleted),
        [filteredActive]
    )
    const providedByYou = useMemo(() => {
        const rows: RelatedTransaction[] = [
            ...dateFilteredCustomerOrders.map((order) => normalizeSalesOrder(order, defaultCurrency, t, linkedLoanByOrderId.get(order.id))),
            ...dateFilteredPayments
                .filter((tx) => tx.direction === 'outgoing')
                .map((tx) => normalizePaymentTransaction(tx, defaultCurrency, conversionRates, t)),
        ]
        for (const loan of standaloneDateFilteredLoans) {
            const direction = getLoanDirection(loan)
            const isProvidedByYou = isSimpleLoan(loan)
                ? direction !== 'borrowed'
                : direction === 'borrowed'
            if (isProvidedByYou) {
                rows.push(normalizeLoan(
                    loan,
                    defaultCurrency,
                    t,
                    dateFilteredInstallments.filter((i: any) => i.loanId === loan.id),
                    loan.saleId ? linkedSaleReferenceById.get(loan.saleId) : undefined
                ))
            }
        }
        return rows.sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime())
    }, [dateFilteredCustomerOrders, dateFilteredPayments, standaloneDateFilteredLoans, dateFilteredInstallments, defaultCurrency, conversionRates, linkedLoanByOrderId, linkedSaleReferenceById, t])
    const providedByPartner = useMemo(() => {
        const rows: RelatedTransaction[] = [
            ...dateFilteredSupplierOrders.map((order) => normalizePurchaseOrder(order, defaultCurrency, t, linkedLoanByOrderId.get(order.id))),
            ...dateFilteredTravelSales.map((sale) => normalizeTravelSale(sale, defaultCurrency)),
            ...dateFilteredPayments
                .filter((tx) => tx.direction === 'incoming')
                .map((tx) => normalizePaymentTransaction(tx, defaultCurrency, conversionRates, t)),
        ]
        for (const loan of standaloneDateFilteredLoans) {
            const direction = getLoanDirection(loan)
            const isProvidedByPartner = isSimpleLoan(loan)
                ? direction === 'borrowed'
                : direction !== 'borrowed'
            if (isProvidedByPartner) {
                rows.push(normalizeLoan(
                    loan,
                    defaultCurrency,
                    t,
                    dateFilteredInstallments.filter((i: any) => i.loanId === loan.id),
                    loan.saleId ? linkedSaleReferenceById.get(loan.saleId) : undefined
                ))
            }
        }
        return rows.sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime())
    }, [dateFilteredSupplierOrders, dateFilteredTravelSales, dateFilteredPayments, standaloneDateFilteredLoans, dateFilteredInstallments, defaultCurrency, conversionRates, linkedLoanByOrderId, linkedSaleReferenceById, t])
    const directTransactionsVolume = useMemo(
        () => dateFilteredPayments.reduce((sum, tx) => sum + convertToStoreBase(tx.amount, tx.currency, defaultCurrency, conversionRates), 0),
        [dateFilteredPayments, defaultCurrency, conversionRates]
    )

    const totalValue = dateFilteredCustomerOrders.reduce(
        (sum, o) => sum + convertCurrencyAmountWithSnapshot(o.total, o.currency, defaultCurrency, o.exchangeRates), 0
    ) + dateFilteredSupplierOrders.reduce(
        (sum, o) => sum + convertCurrencyAmountWithSnapshot(o.total, o.currency, defaultCurrency, o.exchangeRates), 0
    ) + dateFilteredTravelSales.reduce(
        (sum, s) => sum + convertCurrencyAmountWithSnapshot(getTravelSaleCost(s), s.currency, defaultCurrency, s.exchangeRateSnapshot ? [s.exchangeRateSnapshot] as any : undefined), 0
    ) + directTransactionsVolume
    const outstandingValue = (partner?.receivableBalance || 0) + (partner?.payableBalance || 0)
    const averageOrderItemsCount = dateFilteredCustomerOrders.length + dateFilteredSupplierOrders.length + dateFilteredTravelSales.length + dateFilteredPayments.length
    const averageOrderValue = averageOrderItemsCount > 0
        ? totalValue / averageOrderItemsCount
        : 0
    const totalUnits = useMemo(
        () => filteredProductOrders
            .filter((order) => order.status !== 'cancelled')
            .reduce((sum, order) => sum + order.items.reduce((lineSum, item) => lineSum + item.quantity, 0), 0),
        [filteredProductOrders]
    )
    const settledPercent = filteredRelatedTransactions.length > 0 ? Math.min(100, (filteredSettled.length / filteredRelatedTransactions.length) * 100) : 0
    const creditUsagePercent = partner?.creditLimit && partner.creditLimit > 0 ? Math.min(100, (Math.max(partner.netExposure, 0) / partner.creditLimit) * 100) : 0
    const latestTransaction = filteredTransactions[0]
    const earliestTransaction = filteredTransactions[filteredTransactions.length - 1]
    const locationLabel = partner ? [partner.city, partner.country].filter(Boolean).join(', ') || 'N/A' : 'N/A'
    const activityRows = useMemo(
        () => filteredTransactions.slice(0, 8).map((transaction) => ({
            id: transaction.id,
            date: transaction.activityDate,
            title: transaction.reference,
            statusLabel: transaction.statusLabel,
            total: transaction.total,
            currency: transaction.currency,
            source: transaction.source
        })),
        [filteredTransactions]
    )

    const partnerFlows = useMemo(() => {
        let incoming = 0
        let outgoing = 0

        const customerOrderIds = new Set(dateFilteredCustomerOrders.map(o => o.id))
        const supplierOrderIds = new Set(dateFilteredSupplierOrders.map(o => o.id))
        const partnerLoanIds = new Set(dateFilteredLoans.map(l => l.id))

        for (const tx of dateFilteredAllPayments) {
            let isRelated = false
            if (tx.metadata?.businessPartnerId === partnerId) {
                isRelated = true
            } else if (tx.sourceType === 'sales_order' && customerOrderIds.has(tx.sourceRecordId)) {
                isRelated = true
            } else if (tx.sourceType === 'purchase_order' && supplierOrderIds.has(tx.sourceRecordId)) {
                isRelated = true
            } else if (tx.sourceModule === 'loans' && partnerLoanIds.has(tx.sourceRecordId)) {
                isRelated = true
            }

            if (isRelated) {
                const amountBase = convertToStoreBase(tx.amount, tx.currency, defaultCurrency, conversionRates)
                if (tx.direction === 'incoming') {
                    incoming += amountBase
                } else if (tx.direction === 'outgoing') {
                    outgoing += amountBase
                }
            }
        }

        return {
            incoming,
            outgoing,
            net: incoming - outgoing
        }
    }, [
        dateFilteredAllPayments,
        partnerId,
        dateFilteredCustomerOrders,
        dateFilteredSupplierOrders,
        dateFilteredLoans,
        defaultCurrency,
        conversionRates
    ])
    const totalLoanPaidByPartner = useMemo(
        () => dateFilteredLoans
            .filter((loan) => (loan.direction ?? 'lent') !== 'borrowed')
            .reduce((sum, loan) => sum + (convertCurrencyAmountWithAvailableSnapshot(
                loan.totalPaidAmount,
                loan.settlementCurrency,
                defaultCurrency,
                loan.exchangeRateSnapshot
            ) ?? 0), 0),
        [dateFilteredLoans, defaultCurrency]
    )
    const totalLoanPaidToPartner = useMemo(
        () => dateFilteredLoans
            .filter((loan) => loan.direction === 'borrowed')
            .reduce((sum, loan) => sum + (convertCurrencyAmountWithAvailableSnapshot(
                loan.totalPaidAmount,
                loan.settlementCurrency,
                defaultCurrency,
                loan.exchangeRateSnapshot
            ) ?? 0), 0),
        [dateFilteredLoans, defaultCurrency]
    )
    const remainingReceivableLoans = useMemo(
        () => partnerLoans
            .filter((loan) => (loan.direction ?? 'lent') !== 'borrowed')
            .reduce((sum, loan) => sum + (convertCurrencyAmountWithAvailableSnapshot(
                loan.balanceAmount,
                loan.settlementCurrency,
                defaultCurrency,
                loan.exchangeRateSnapshot
            ) ?? 0), 0),
        [defaultCurrency, partnerLoans]
    )
    const remainingPayableLoans = useMemo(
        () => partnerLoans
            .filter((loan) => loan.direction === 'borrowed')
            .reduce((sum, loan) => sum + (convertCurrencyAmountWithAvailableSnapshot(
                loan.balanceAmount,
                loan.settlementCurrency,
                defaultCurrency,
                loan.exchangeRateSnapshot
            ) ?? 0), 0),
        [defaultCurrency, partnerLoans]
    )
    const periodLoanPayments = useMemo(() => {
        const relatedLoanIds = new Set(partnerLoans.map((loan) => loan.id))
        let received = 0
        let made = 0

        for (const transaction of dateFilteredAllPayments) {
            if (
                transaction.reversalOfTransactionId
                || transaction.sourceModule !== 'loans'
                || !LOAN_REPAYMENT_SOURCE_TYPES.has(transaction.sourceType)
                || !relatedLoanIds.has(transaction.sourceRecordId)
            ) {
                continue
            }

            const amount = convertToStoreBase(
                transaction.amount,
                transaction.currency,
                defaultCurrency,
                conversionRates
            )
            if (transaction.direction === 'incoming') {
                received += amount
            } else {
                made += amount
            }
        }

        return { received, made }
    }, [conversionRates, dateFilteredAllPayments, defaultCurrency, partnerLoans])
    const printPeriod = useMemo<PartnerDetailsPrintData['period']>(() => {
        if (dateRange === 'custom') {
            return {
                type: dateRange,
                start: customDates.start || undefined,
                end: customDates.end || undefined
            }
        }

        if (dateRange === 'today' || dateRange === 'month') {
            const inclusiveEnd = dateBounds.endDate
                ? new Date(new Date(dateBounds.endDate).getTime() - 1).toISOString()
                : undefined
            return {
                type: dateRange,
                start: dateBounds.startDate,
                end: inclusiveEnd
            }
        }

        return { type: 'allTime' }
    }, [customDates.end, customDates.start, dateBounds.endDate, dateBounds.startDate, dateRange])
    const topProducts = useMemo(() => {
        const rows = new Map<string, { id: string; name: string; quantity: number; amount: number }>()
        for (const order of filteredProductOrders.filter((row) => row.status !== 'cancelled')) {
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
    }, [defaultCurrency, filteredProductOrders])
    const printLang = features.print_lang && features.print_lang !== 'auto'
        ? features.print_lang
        : i18n.language
    const currentTemplatePrintLanguage = resolveCustomTemplatePrintLanguage(printLang)
    const partnerPrintData = useMemo<PartnerDetailsPrintData | null>(() => {
        if (!partner) return null

        return {
            partner: {
                name: partner.name,
                role: partner.role,
                contactName: partner.contactName,
                email: partner.email,
                phone: partner.phone,
                address: partner.address,
                city: partner.city,
                country: partner.country,
                defaultCurrency,
                createdAt: partner.createdAt,
                notes: partner.notes
            },
            period: printPeriod,
            generatedAt: new Date().toISOString(),
            loanSummary: {
                remainingReceivable: remainingReceivableLoans,
                remainingPayable: remainingPayableLoans,
                paymentsReceived: periodLoanPayments.received,
                paymentsMade: periodLoanPayments.made
            },
            metrics: {
                moneyIn: partnerFlows.incoming,
                moneyOut: partnerFlows.outgoing
            },
            relationshipSummary: {
                receivable: Math.max(partner.receivableBalance || 0, 0),
                payable: Math.max(partner.payableBalance || 0, 0)
            },
            providedByYou: providedByYou.map((transaction) => ({
                id: transaction.id,
                source: transaction.source,
                reference: transaction.reference,
                displayDate: transaction.displayDate,
                status: transaction.status,
                statusLabel: transaction.statusLabel,
                summary: transaction.summary,
                originalAmount: transaction.originalAmount,
                paidAmount: transaction.paidAmount,
                remainingAmount: transaction.remainingAmount,
                currency: transaction.currency
            })),
            providedByPartner: providedByPartner.map((transaction) => ({
                id: transaction.id,
                source: transaction.source,
                reference: transaction.reference,
                displayDate: transaction.displayDate,
                status: transaction.status,
                statusLabel: transaction.statusLabel,
                summary: transaction.summary,
                originalAmount: transaction.originalAmount,
                paidAmount: transaction.paidAmount,
                remainingAmount: transaction.remainingAmount,
                currency: transaction.currency
            })),
            salesOrders: dateFilteredCustomerOrders.map((order) => {
                const transaction = normalizeSalesOrder(order, defaultCurrency, t, linkedLoanByOrderId.get(order.id))
                return {
                    id: transaction.id,
                    source: transaction.source,
                    reference: transaction.reference,
                    displayDate: transaction.displayDate,
                    status: transaction.status,
                    statusLabel: transaction.statusLabel,
                    summary: transaction.summary,
                    originalAmount: transaction.originalAmount,
                    paidAmount: transaction.paidAmount,
                    remainingAmount: transaction.remainingAmount,
                    currency: transaction.currency
                }
            }),
            purchaseOrders: dateFilteredSupplierOrders.map((order) => {
                const transaction = normalizePurchaseOrder(order, defaultCurrency, t, linkedLoanByOrderId.get(order.id))
                return {
                    id: transaction.id,
                    source: transaction.source,
                    reference: transaction.reference,
                    displayDate: transaction.displayDate,
                    status: transaction.status,
                    statusLabel: transaction.statusLabel,
                    summary: transaction.summary,
                    originalAmount: transaction.originalAmount,
                    paidAmount: transaction.paidAmount,
                    remainingAmount: transaction.remainingAmount,
                    currency: transaction.currency
                }
            }),
            topProducts
        }
    }, [
        dateFilteredCustomerOrders,
        dateFilteredSupplierOrders,
        defaultCurrency,
        linkedLoanByOrderId,
        partner,
        partnerFlows.incoming,
        partnerFlows.outgoing,
        periodLoanPayments.made,
        periodLoanPayments.received,
        printPeriod,
        providedByPartner,
        providedByYou,
        remainingPayableLoans,
        remainingReceivableLoans,
        t,
        topProducts,
    ])
    const partnerPrintTarget = useMemo(
        () => getCustomTemplateTarget(PARTNER_DETAILS_TEMPLATE_KEY),
        []
    )
    const availablePrintTemplates = useMemo(
        () => customPrintTemplates.filter((template) =>
            template.module_type_key === PARTNER_DETAILS_TEMPLATE_KEY
            && template.active
            && Boolean(readCustomTemplateLayout(template))
        ),
        [customPrintTemplates]
    )
    const selectedPrintLayout = useMemo(
        () => selectedPrintTemplate
            && isCustomTemplatePrintLanguageCompatible(selectedPrintTemplate, currentTemplatePrintLanguage)
            ? readCustomTemplateLayout(selectedPrintTemplate)
            : null,
        [currentTemplatePrintLanguage, selectedPrintTemplate]
    )
    const activePrintLayout = useMemo<CustomTemplateLayout | null>(() => {
        if (selectedPrintTemplate) return selectedPrintLayout
        if (!partnerPrintTarget) return null

        return {
            version: 1,
            label: t('businessPartners.nativeA4Template', { defaultValue: 'Partner Details A4' }),
            moduleTypeKey: PARTNER_DETAILS_TEMPLATE_KEY,
            nativeTemplateKey: partnerPrintTarget.nativeTemplateKey,
            page: partnerPrintTarget.page,
            fields: {},
            annotations: [],
            texts: [],
            images: [],
            updatedAt: new Date().toISOString()
        }
    }, [partnerPrintTarget, selectedPrintLayout, selectedPrintTemplate, t])
    const partnerPrintPreview = useMemo(
        () => partnerPrintTarget && partnerPrintData
            ? createCustomTemplatePreview(partnerPrintTarget, {
                workspaceId,
                workspaceName,
                features,
                partnerDetailsData: partnerPrintData,
                printLang
            })
            : undefined,
        [features, partnerPrintData, partnerPrintTarget, printLang, workspaceId, workspaceName]
    )
    const partnerPrintInvoiceData = useMemo(() => {
        if (!partner) return undefined

        return {
            invoiceid: `PARTNER-${partner.id}`,
            totalAmount: remainingReceivableLoans + remainingPayableLoans,
            settlementCurrency: defaultCurrency,
            origin: 'manual' as const,
            createdBy: user?.id,
            createdByName: user?.name || 'Unknown',
            cashierName: user?.name || 'Unknown',
            printFormat: 'a4' as const
        }
    }, [
        defaultCurrency,
        partner,
        remainingPayableLoans,
        remainingReceivableLoans,
        user?.id,
        user?.name
    ])
    const buildPartnerPrintPdf = useCallback(async ({ effectiveId }: { format: PrintFormat; effectiveId: string }) => {
        if (!partnerPrintTarget || !partnerPrintData || !activePrintLayout) {
            throw new Error('Partner details print data is not available.')
        }

        return buildCustomTemplateLayoutPdf({
            target: partnerPrintTarget,
            layout: activePrintLayout,
            values: {},
            options: {
                workspaceId,
                workspaceName,
                features,
                partnerDetailsData: partnerPrintData,
                printLang
            },
            effectiveId,
            fieldMode: 'layoutOverrides'
        })
    }, [activePrintLayout, features, partnerPrintData, partnerPrintTarget, printLang, workspaceId, workspaceName])
    const buildEditablePartnerPrintPdf = useCallback(async (
        layout: CustomTemplateLayout,
        printLangOverride?: string,
        effectiveId?: string
    ) => {
        if (!partnerPrintTarget || !partnerPrintData) {
            throw new Error('Partner details print data is not available.')
        }

        return buildCustomTemplateLayoutPdf({
            target: partnerPrintTarget,
            layout,
            values: {},
            options: {
                workspaceId,
                workspaceName,
                features,
                partnerDetailsData: partnerPrintData,
                printLang: printLangOverride || printLang
            },
            effectiveId,
            fieldMode: 'layoutOverrides'
        })
    }, [features, partnerPrintData, partnerPrintTarget, printLang, workspaceId, workspaceName])
    const partnerPrintSelectionOptions = useMemo(() => [{
        format: 'a4' as const,
        label: t('businessPartners.nativeA4Template', { defaultValue: 'Partner Details A4' }),
        description: t('businessPartners.nativeA4TemplateDescription', {
            defaultValue: 'Use the built-in Partner Details A4 layout.'
        })
    }], [t])
    const partnerCustomPrintOptions = useMemo(
        () => availablePrintTemplates.map((template) => ({
            format: 'a4' as const,
            template,
            label: getStoredCustomTemplateLabel(template),
            description: t('businessPartners.customA4TemplateDescription', {
                defaultValue: 'Use this saved custom Partner Details layout.'
            }),
            primary: template.primary,
            disabled: !isCustomTemplatePrintLanguageCompatible(template, currentTemplatePrintLanguage),
            warning: getCustomTemplatePrintLanguageWarning(template, currentTemplatePrintLanguage, t)
        })),
        [availablePrintTemplates, currentTemplatePrintLanguage, t]
    )
    const handlePrintSelection = useCallback((
        _format: PrintFormat,
        template?: StoredCustomTemplateRow
    ) => {
        if (template && !isCustomTemplatePrintLanguageCompatible(template, currentTemplatePrintLanguage)) {
            return
        }
        setSelectedPrintTemplate(template || null)
    }, [currentTemplatePrintLanguage])
    const handlePrintClick = useCallback(() => {
        setSelectedPrintTemplate(null)
        setIsPrintPreviewOpen(true)
    }, [])

    if (!partner || !allowedByRoute) {
        return (
            <Card>
                <CardContent className="space-y-4 py-10 text-center">
                    <div className="text-lg font-semibold">
                        {t('businessPartners.notFound', { defaultValue: 'Business partner not found' })}
                    </div>
                    <div className="text-sm text-muted-foreground">
                        {t('businessPartners.notFoundDescription', { defaultValue: 'The requested record may have been deleted or moved out of this workspace.' })}
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
                <Button
                    variant="outline"
                    className="h-10 gap-2 rounded-xl px-4 print:hidden"
                    allowViewer={true}
                    onClick={handlePrintClick}
                    disabled={!partnerPrintPreview || !activePrintLayout}
                >
                    <Printer className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('common.print', { defaultValue: 'Print' })}</span>
                </Button>
            </div>

            <DateRangeFilters />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('businessPartners.profile', { defaultValue: 'Partner Profile' })}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
                                    {agent?.imageUrl ? (
                                        <img
                                            src={platformService.convertFileSrc(agent.imageUrl)}
                                            alt={partner.name}
                                            className="h-full w-full object-cover"
                                        />
                                    ) : partner.role === 'supplier' ? (
                                        <Truck className="h-4 w-4" />
                                    ) : partner.role === 'agent' ? (
                                        <UserRound className="h-5 w-5" />
                                    ) : (
                                        <UsersRound className="h-4 w-4" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{typeLabel}</div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="truncate text-lg font-semibold">{partner.name}</div>
                                        {partner.isEcommerce ? (
                                            <span className="inline-flex rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                                                {t('ecommerce.title', { defaultValue: 'E-Commerce' })}
                                            </span>
                                        ) : null}
                                    </div>
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

                            {partner.role === 'agent' && agent ? (
                                <div className="space-y-3 rounded-2xl border bg-background/70 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            {t('businessPartners.agent.operationalProfile', { defaultValue: 'Operational Profile' })}
                                        </div>
                                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${statusBadgeClass(agent.status)}`}>
                                            {t(`businessPartners.agent.statuses.${agent.status}`, { defaultValue: agent.status })}
                                        </span>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div>
                                            <div className="text-xs text-muted-foreground">
                                                {t('businessPartners.agent.zone', { defaultValue: 'Operational Territory' })}
                                            </div>
                                            <div className="font-medium">{agent.zone}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-muted-foreground">
                                                {t('businessPartners.agent.type', { defaultValue: 'Agent Type' })}
                                            </div>
                                            <div className="font-medium">
                                                {agent.agentType === 'driver'
                                                    ? t('businessPartners.agent.types.driver', { defaultValue: 'Driver' })
                                                    : t('businessPartners.agent.types.fieldAgent', { defaultValue: 'Field Agent' })}
                                            </div>
                                        </div>
                                        {agent.agentType === 'driver' ? (
                                            <>
                                                <div className="flex items-start gap-2">
                                                    <Car className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                                    <div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {t('businessPartners.agent.carModel', { defaultValue: 'Car Model' })}
                                                        </div>
                                                        <div className="font-medium">{agent.carModel || 'N/A'}</div>
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {t('businessPartners.agent.plateNumber', { defaultValue: 'Plate Number' })}
                                                    </div>
                                                    <div className="font-medium">{agent.plateNumber || 'N/A'}</div>
                                                </div>
                                            </>
                                        ) : null}
                                        <div className="sm:col-span-2">
                                            <div className="text-xs text-muted-foreground">
                                                {t('businessPartners.agent.linkedUser', { defaultValue: 'Workspace User' })}
                                            </div>
                                            <div className="font-medium">
                                                {linkedAgentUser?.name || linkedAgentUser?.email || t('businessPartners.agent.noLinkedUser', { defaultValue: 'Not linked' })}
                                            </div>
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

                    <Card>
                        <CardHeader>
                            <CardTitle>{t('orders.details.activity.title', { defaultValue: 'Activity' })}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {activityRows.length === 0 ? (
                                <div className="py-6 text-sm text-muted-foreground">
                                    {emptyRelatedLabel}
                                </div>
                            ) : (
                                <div className="relative space-y-6 ps-4 before:absolute before:bottom-2 before:start-0 before:top-2 before:w-0.5 before:bg-border/60">
                                    {activityRows.map((row) => (
                                        <div key={row.id} className="group relative">
                                            <div className="absolute -start-[1.375rem] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary shadow-[0_0_8px_rgba(59,130,246,0.35)] transition-transform group-hover:scale-125" />
                                            <div className="space-y-0.5">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="font-bold leading-none transition-colors group-hover:text-primary">{row.title}</div>
                                                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', sourceBadgeClass(row.source))}>
                                                        {sourceLabel(row.source, t)}
                                                    </span>
                                                </div>
                                                <div className="pt-1 text-xs font-medium text-muted-foreground">
                                                    {row.statusLabel}
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
                            <CardTitle>{overviewTitle}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="mt-6">
                                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    {t('businessPartners.loans', { defaultValue: 'Loans' })}
                                </h3>
                                <div className="mb-4 rounded-3xl border bg-muted/20 p-5 sm:p-6">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-foreground/70">
                                        <ArrowLeftRight className="h-5 w-5 text-primary" />
                                        {t('businessPartners.whoOwesWhom', { defaultValue: 'Who owes whom?' })}
                                    </div>
                                    <div className={cn(
                                        'mt-4 grid gap-3',
                                        relationshipReceivable > 0 && relationshipPayable > 0 && 'sm:grid-cols-2'
                                    )}>
                                        {relationshipReceivable > 0 ? (
                                            <div className="rounded-2xl border border-emerald-200/50 bg-emerald-500/[0.06] p-4">
                                                <div className="text-base font-semibold leading-relaxed text-emerald-800 dark:text-emerald-300">
                                                    {t('businessPartners.owesAmountTo', {
                                                        debtor: partnerRelationshipName,
                                                        amount: formatCurrency(relationshipReceivable, defaultCurrency, iqdPreference),
                                                        creditor: workspaceRelationshipName,
                                                        defaultValue: '{{debtor}} owes {{amount}} to {{creditor}}'
                                                    })}
                                                </div>
                                            </div>
                                        ) : null}
                                        {relationshipPayable > 0 ? (
                                            <div className="rounded-2xl border border-amber-200/50 bg-amber-500/[0.06] p-4">
                                                <div className="text-base font-semibold leading-relaxed text-amber-800 dark:text-amber-300">
                                                    {t('businessPartners.owesAmountTo', {
                                                        debtor: workspaceRelationshipName,
                                                        amount: formatCurrency(relationshipPayable, defaultCurrency, iqdPreference),
                                                        creditor: partnerRelationshipName,
                                                        defaultValue: '{{debtor}} owes {{amount}} to {{creditor}}'
                                                    })}
                                                </div>
                                            </div>
                                        ) : null}
                                        {relationshipReceivable <= 0 && relationshipPayable <= 0 ? (
                                            <div className="rounded-2xl border bg-background/70 p-4 text-base font-semibold leading-relaxed text-muted-foreground">
                                                {t('businessPartners.noOutstandingDebtBetween', {
                                                    first: partnerRelationshipName,
                                                    second: workspaceRelationshipName,
                                                    defaultValue: '{{first}} and {{second}} do not owe each other anything.'
                                                })}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="rounded-3xl border border-emerald-200/50 bg-emerald-500/[0.04] p-6">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
                                            <TrendingUp className="h-5 w-5" />
                                            {t('businessPartners.receivable', { defaultValue: 'Receivable' })}
                                            <span className="ml-auto rounded-full border border-emerald-200/50 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                                {t('businessPartners.theyOweUs', { defaultValue: 'They owe us' })}
                                            </span>
                                        </div>
                                        <div className="mt-3 text-4xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
                                            {formatCurrency(partner.receivableBalance || 0, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                    <div className="rounded-3xl border border-amber-200/50 bg-amber-500/[0.04] p-6">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
                                            <TrendingDown className="h-5 w-5" />
                                            {t('businessPartners.payable', { defaultValue: 'Payable' })}
                                            <span className="ml-auto rounded-full border border-amber-200/50 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                                {t('businessPartners.weOweThem', { defaultValue: 'We owe them' })}
                                            </span>
                                        </div>
                                        <div className="mt-3 text-4xl font-black tracking-tight text-amber-600 dark:text-amber-400">
                                            {formatCurrency(partner.payableBalance || 0, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="rounded-2xl border border-emerald-200/30 bg-emerald-500/[0.02] p-5">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
                                                {t('businessPartners.loanPaymentsReceived', { defaultValue: 'Loan payments received' })}
                                            </div>
                                            <span className="rounded-full border border-emerald-200/30 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                                {t('customers.details.paid', { defaultValue: 'Collected' })}
                                            </span>
                                        </div>
                                        <div className="mt-2 text-2xl font-black tracking-tight text-emerald-600/80 dark:text-emerald-400/80">
                                            {formatCurrency(totalLoanPaidByPartner, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-amber-200/30 bg-amber-500/[0.02] p-5">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">
                                                {t('businessPartners.loanPaymentsMade', { defaultValue: 'Loan payments made' })}
                                            </div>
                                            <span className="rounded-full border border-amber-200/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                                {t('customers.details.settled', { defaultValue: 'Settled' })}
                                            </span>
                                        </div>
                                        <div className="mt-2 text-2xl font-black tracking-tight text-amber-600/80 dark:text-amber-400/80">
                                            {formatCurrency(totalLoanPaidToPartner, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6">
                                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    {t('businessPartners.cashFlow', { defaultValue: 'Cash Flow' })}
                                </h3>
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-2xl border bg-emerald-500/5 p-4">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
                                                <TrendingUp className="h-4 w-4" />
                                                {t('ledger.incoming', { defaultValue: 'Incoming' })}
                                            </div>
                                            <span className="rounded-full border border-emerald-200/30 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                                {t('businessPartners.moneyIn', { defaultValue: 'Money in' })}
                                            </span>
                                        </div>
                                        <div className="mt-2 text-2xl font-black text-emerald-600 dark:text-emerald-400">
                                            {formatCurrency(partnerFlows.incoming, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border bg-amber-500/5 p-4">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
                                                <TrendingDown className="h-4 w-4" />
                                                {t('ledger.outgoing', { defaultValue: 'Outgoing' })}
                                            </div>
                                            <span className="rounded-full border border-amber-200/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                                {t('businessPartners.moneyOut', { defaultValue: 'Money out' })}
                                            </span>
                                        </div>
                                        <div className="mt-2 text-2xl font-black text-amber-600 dark:text-amber-400">
                                            {formatCurrency(partnerFlows.outgoing, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                    <div className={cn("rounded-2xl border p-4", partnerFlows.net < 0 ? "bg-amber-500/5" : "bg-emerald-500/5")}>
                                        <div className="flex items-center justify-between gap-2">
                                            <div className={cn("flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em]", partnerFlows.net < 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                                                <Activity className="h-4 w-4" />
                                                {t('ledger.netFlow', { defaultValue: 'Net Flow' })}
                                            </div>
                                            <span className={cn("rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider", partnerFlows.net < 0 ? "border-amber-200/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-emerald-200/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>
                                                {t('businessPartners.balance', { defaultValue: 'Balance' })}
                                            </span>
                                        </div>
                                        <div className={cn("mt-2 text-2xl font-black", partnerFlows.net < 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                                            {formatCurrency(partnerFlows.net, defaultCurrency, iqdPreference)}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                                <div className="rounded-2xl border bg-muted/20 p-5">
                                    <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                        {t('businessPartners.relationship', { defaultValue: 'Relationship Summary' })}
                                    </h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="rounded-xl border border-border/40 bg-background/60 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{completedLabel}</div>
                                                <span className="rounded-full border border-emerald-200/30 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                                    {t('common.done', { defaultValue: 'Done' })}
                                                </span>
                                            </div>
                                            <div className="mt-1 text-2xl font-bold text-emerald-500">{filteredCompleted.length}</div>
                                        </div>
                                        <div className="rounded-xl border border-border/40 bg-background/60 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{paidLabel}</div>
                                                <span className="rounded-full border border-blue-200/30 bg-blue-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                                    {t('customers.details.paid', { defaultValue: 'Paid' })}
                                                </span>
                                            </div>
                                            <div className="mt-1 text-2xl font-bold text-blue-500">{filteredSettled.length}</div>
                                        </div>
                                    </div>
                                    <div className="mt-4 space-y-1.5">
                                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                            <span>{t('businessPartners.settlementProgress', { defaultValue: 'Settlement Progress' })}</span>
                                            <span>{Math.round(settledPercent)}%</span>
                                        </div>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
                                            <div
                                                className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)] transition-all duration-500"
                                                style={{ width: `${settledPercent}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-2xl border bg-muted/20 p-5">
                                    <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                        {t('businessPartners.creditUsage', { defaultValue: 'Credit Usage' })}
                                    </h3>
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                            <span>{t('businessPartners.creditUsage', { defaultValue: 'Credit Usage' })}</span>
                                            <span>{Math.round(creditUsagePercent)}%</span>
                                        </div>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-background/80">
                                            <div
                                                className={cn(
                                                    'h-full rounded-full transition-all duration-500',
                                                    creditUsagePercent >= 80 ? 'bg-rose-500' : creditUsagePercent >= 50 ? 'bg-amber-500' : 'bg-primary'
                                                )}
                                                style={{ width: `${creditUsagePercent}%` }}
                                            />
                                        </div>
                                    </div>
                                    <div className="mt-4 grid grid-cols-2 gap-3">
                                        <div className="rounded-xl border border-border/40 bg-background/60 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                    <CreditCard className="h-3 w-3" />
                                                    {t('customers.form.creditLimit', { defaultValue: 'Limit' })}
                                                </div>
                                                <span className="rounded-full border border-muted-foreground/20 bg-muted-foreground/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-muted-foreground">
                                                    {t('businessPartners.ceiling', { defaultValue: 'Ceiling' })}
                                                </span>
                                            </div>
                                            <div className="mt-1 text-lg font-black">{formatCurrency(partner.creditLimit || 0, defaultCurrency, iqdPreference)}</div>
                                        </div>
                                        <div className="rounded-xl border border-border/40 bg-background/60 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                    <Receipt className="h-3 w-3" />
                                                    {t('orders.details.outstanding', { defaultValue: 'Outstanding' })}
                                                </div>
                                                <span className="rounded-full border border-amber-200/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                                    {t('orders.details.due', { defaultValue: 'Due' })}
                                                </span>
                                            </div>
                                            <div className="mt-1 text-lg font-black">{formatCurrency(outstandingValue, defaultCurrency, iqdPreference)}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-4">
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            <ShoppingCart className="h-4 w-4" />
                                            {t('businessPartners.averageDocument', { defaultValue: 'Average Document' })}
                                        </div>
                                        <span className="rounded-full border border-muted-foreground/20 bg-muted-foreground/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-muted-foreground">
                                            {t('businessPartners.perDocument', { defaultValue: 'Per doc' })}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-xl font-black">
                                        {formatCurrency(averageOrderValue, defaultCurrency, iqdPreference)}
                                    </div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            <CalendarDays className="h-4 w-4" />
                                            {firstActivityLabel}
                                        </div>
                                        <span className="rounded-full border border-sky-200/30 bg-sky-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-400">
                                            {t('businessPartners.started', { defaultValue: 'Started' })}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-xl font-black">
                                        {earliestTransaction ? formatDate(earliestTransaction.displayDate) : 'N/A'}
                                    </div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            <Activity className="h-4 w-4" />
                                            {lastActivityLabel}
                                        </div>
                                        <span className="rounded-full border border-violet-200/30 bg-violet-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-400">
                                            {t('businessPartners.recent', { defaultValue: 'Recent' })}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-xl font-black">
                                        {latestTransaction ? formatDate(latestTransaction.displayDate) : 'N/A'}
                                    </div>
                                </div>
                                <div className="rounded-2xl border bg-background/70 p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                            <Package className="h-4 w-4" />
                                            {t('orders.details.units', { defaultValue: 'Units' })}
                                        </div>
                                        <span className="rounded-full border border-muted-foreground/20 bg-muted-foreground/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-muted-foreground">
                                            {t('businessPartners.count', { defaultValue: 'Count' })}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-xl font-black">{totalUnits}</div>
                                </div>
                            </div>

                            <div className="mt-6 rounded-2xl border bg-background/70 p-4">
                                <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                    <Package className="h-4 w-4" />
                                    {t('products.topProducts', { defaultValue: 'Top Products' })}
                                </div>
                                {topProducts.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">
                                        {t('businessPartners.topProductsEmpty', { defaultValue: 'Product activity will appear once orders are added.' })}
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

                    {[{
                        title: providedByYouLabel,
                        rows: providedByYou,
                        key: 'you'
                    }, {
                        title: providedByPartnerLabel,
                        rows: providedByPartner,
                        key: 'partner'
                    }].map(({ title, rows, key }) => (
                        <Card key={key}>
                            <CardHeader>
                                <CardTitle>{title}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {rows.length === 0 ? (
                                    <div className="rounded-2xl border py-12 text-center text-muted-foreground">
                                        {emptyRelatedLabel}
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto rounded-2xl border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>{t('common.date', { defaultValue: 'Date' })}</TableHead>
                                                    <TableHead>{t('common.type', { defaultValue: 'Type' })}</TableHead>
                                                    <TableHead>{referenceColumnLabel}</TableHead>
                                                    <TableHead>{detailsColumnLabel}</TableHead>
                                                    <TableHead className="text-end">{amountLabel}</TableHead>
                                                    <TableHead className="text-end">{paidLabel2}</TableHead>
                                                    <TableHead className="text-end">{remainingLabel}</TableHead>
                                                    <TableHead>{t('common.status', { defaultValue: 'Status' })}</TableHead>
                                                    <TableHead className="text-end">{t('common.actions', { defaultValue: 'Actions' })}</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {rows.map((tx) => (
                                                    <TableRow key={tx.id} className={cn(tx.financingReference && 'bg-orange-500/[0.025]')}>
                                                        <TableCell>{formatDate(tx.displayDate)}</TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col items-start gap-1">
                                                                <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', sourceBadgeClass(tx.source))}>
                                                                    {sourceLabel(tx.source, t)}
                                                                </span>
                                                                {tx.financingLabel ? (
                                                                    <span className="inline-flex rounded-full border border-orange-200 bg-orange-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700">
                                                                        {tx.financingLabel}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="font-semibold">
                                                            <div>{tx.reference}</div>
                                                            {tx.financingReference ? (
                                                                <div className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                                                                    {t('businessPartners.financingReference', { defaultValue: 'Financing' })}: {tx.financingReference}
                                                                </div>
                                                            ) : null}
                                                        </TableCell>
                                                        <TableCell>{tx.summary}</TableCell>
                                                        <TableCell className="text-end font-semibold">
                                                            {formatCurrency(tx.originalAmount, tx.currency, iqdPreference)}
                                                        </TableCell>
                                                        <TableCell className="text-end font-semibold">
                                                            {formatCurrency(tx.paidAmount, tx.currency, iqdPreference)}
                                                        </TableCell>
                                                        <TableCell className="text-end font-semibold">
                                                            {tx.remainingAmount === 0 || tx.remainingAmount < 0.001
                                                                ? '\u2014'
                                                                : formatCurrency(tx.remainingAmount, tx.currency, iqdPreference)}
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col items-start gap-1">
                                                                <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide', statusBadgeClass(tx.status))}>
                                                                    {tx.statusLabel}
                                                                </span>
                                                                {tx.financingStatus && tx.financingStatusLabel ? (
                                                                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide', statusBadgeClass(tx.financingStatus))}>
                                                                        {tx.financingStatusLabel}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-end">
                                                            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(tx.viewHref)}>
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
                    ))}
                </div>
            </div>

            {partnerPrintPreview && partnerPrintTarget && activePrintLayout && partnerPrintData ? (
                <PrintPreviewModal
                    isOpen={isPrintPreviewOpen}
                    onClose={() => {
                        setIsPrintPreviewOpen(false)
                        setSelectedPrintTemplate(null)
                    }}
                    onConfirm={() => {
                        setIsPrintPreviewOpen(false)
                        setSelectedPrintTemplate(null)
                    }}
                    title={t('businessPartners.printA4', { defaultValue: 'Print A4' })}
                    documentId={partner.id}
                    invoiceData={partnerPrintInvoiceData}
                    pdfBuilder={buildPartnerPrintPdf}
                    templatePreview={partnerPrintPreview}
                    customTemplate={{
                        moduleTypeKey: PARTNER_DETAILS_TEMPLATE_KEY,
                        nativeTemplateKey: partnerPrintTarget.nativeTemplateKey,
                        templateId: selectedPrintTemplate?.id,
                        label: selectedPrintTemplate
                            ? getStoredCustomTemplateLabel(selectedPrintTemplate)
                            : t('businessPartners.nativeA4Template', { defaultValue: 'Partner Details A4' })
                    }}
                    initialTemplateLayout={activePrintLayout}
                    enableTemplatePreviewSave
                    generateTemplateLayoutBlob={buildEditablePartnerPrintPdf}
                    features={features}
                    workspaceName={workspaceName}
                    module="businessPartners"
                    printSelectionOptions={partnerPrintSelectionOptions}
                    printSelectionTemplates={partnerCustomPrintOptions}
                    onPrintSelection={handlePrintSelection}
                />
            ) : null}
        </div>
    )
}
