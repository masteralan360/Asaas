import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BadgePercent, Link2, Loader2, ShoppingCart, UserRound, X } from 'lucide-react'

import type { CartItem } from '@/types'
import {
    useAgents,
    useBusinessPartners,
    type BusinessPartner,
    type CurrencyCode,
    type ExchangeRateSnapshot,
    type InstallmentFrequency,
    type PaymentAccount,
    type SalesOrder
} from '@/local-db'
import { formatCurrency } from '@/lib/utils'
import {
    ORDER_FINANCING_PAYMENT_METHODS,
    STANDARD_PAYMENT_METHODS,
    type PaymentMethodOption
} from '@/lib/paymentMethods'
import {
    AppDialogBody,
    AppDialogDescription,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
    Button,
    DateTimePicker,
    Label,
    MultipleModalLayout,
    Progress,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/components'
import { PartnerAutocompleteInput } from '@/ui/components/crm/PartnerAutocompleteInput'
import { PaymentMethodSelect } from '@/ui/components/payments/PaymentMethodSelect'
import { PaymentAccountSelector } from '@/ui/components/payments/PaymentAccountSelector'
import {
    SalesOrderCommissionAssignmentSection,
    type SalesOrderCommissionAssignmentHandle
} from '@/ui/components/commissions/SalesOrderCommissionAssignmentSection'

export type QuickOrderCheckoutData = {
    customer: BusinessPartner
    salesAccountAgentId?: string | null
    commissionEnabled: boolean
    paymentMethod: PaymentMethodOption
    installmentCount: number
    installmentFrequency: InstallmentFrequency
    firstDueDate: string | null
    paymentAccountId?: string | null
    paymentAccountNameSnapshot?: string | null
}

export type QuickOrderSubmissionOptions = {
    onOrderCreated?: (order: SalesOrder) => Promise<void>
}

export type QuickOrderProgressStage = 'preparing' | 'creating' | 'reserving' | 'completing' | null

interface QuickOrderModalProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    cart: CartItem[]
    totalAmount: number
    settlementCurrency: CurrencyCode
    iqdPreference: 'IQD' | 'د.ع'
    loansEnabled: boolean
    installmentsEnabled: boolean
    agentSalesAccountsEnabled: boolean
    commissionAssignmentsEnabled: boolean
    commissionExchangeRates: ExchangeRateSnapshot[]
    commissionCurrencies: CurrencyCode[]
    commissionAssignedBy?: string | null
    isSubmitting: boolean
    progressStage: QuickOrderProgressStage
    onSubmit: (data: QuickOrderCheckoutData, options?: QuickOrderSubmissionOptions) => Promise<void>
}

export function QuickOrderModal({
    isOpen,
    onOpenChange,
    workspaceId,
    cart,
    totalAmount,
    settlementCurrency,
    iqdPreference,
    loansEnabled,
    installmentsEnabled,
    agentSalesAccountsEnabled,
    commissionAssignmentsEnabled,
    commissionExchangeRates,
    commissionCurrencies,
    commissionAssignedBy,
    isSubmitting,
    progressStage,
    onSubmit
}: QuickOrderModalProps) {
    const { t } = useTranslation()
    const commissionTriggerRef = useRef<HTMLButtonElement>(null)
    const commissionAssignmentRef = useRef<SalesOrderCommissionAssignmentHandle>(null)
    const [customerSearch, setCustomerSearch] = useState('')
    const [customer, setCustomer] = useState<BusinessPartner | null>(null)
    const [salesAccountAgentId, setSalesAccountAgentId] = useState('')
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethodOption>('cash')
    const [paymentAccount, setPaymentAccount] = useState<PaymentAccount | null>(null)
    const [firstDueDate, setFirstDueDate] = useState('')
    const [isCommissionPanelOpen, setIsCommissionPanelOpen] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const canLoadAgents = agentSalesAccountsEnabled || commissionAssignmentsEnabled
    const agentPartners = useBusinessPartners(
        canLoadAgents ? workspaceId : undefined,
        { roles: ['agent'], includeAgentRoles: true }
    )
    const agents = useAgents(canLoadAgents ? workspaceId : undefined)
    const selectedSalesAccount = useMemo(() => {
        if (!agentSalesAccountsEnabled) return null
        const agent = agents.find((candidate) => (
            candidate.id === salesAccountAgentId
            && !candidate.isDeleted
            && candidate.status === 'active'
            && candidate.salesAccountEnabled
        ))
        if (!agent) return null
        const partner = agentPartners.find((candidate) => candidate.id === agent.businessPartnerId)
        return partner ? { agent, partner } : null
    }, [agentPartners, agentSalesAccountsEnabled, agents, salesAccountAgentId])
    const customerCommissionAgent = useMemo(() => {
        if (!commissionAssignmentsEnabled || !customer) return null
        return agents.find((agent) => (
            agent.businessPartnerId === customer.id
            && !agent.isDeleted
            && agent.status === 'active'
            && agent.agentType === 'field_agent'
        )) ?? null
    }, [agents, commissionAssignmentsEnabled, customer])
    const commissionRecipient = commissionAssignmentsEnabled
        ? selectedSalesAccount?.agent ?? customerCommissionAgent
        : null

    const paymentMethods = useMemo<PaymentMethodOption[]>(() => [
        ...STANDARD_PAYMENT_METHODS,
        ...(loansEnabled ? [ORDER_FINANCING_PAYMENT_METHODS[0]] : []),
        ...(installmentsEnabled ? [ORDER_FINANCING_PAYMENT_METHODS[1]] : [])
    ], [installmentsEnabled, loansEnabled])
    const isInstallmentBased = paymentMethod === 'installments'
    const orderCounterparty = selectedSalesAccount?.partner ?? customer
    const isQuickOrderValid = Boolean(orderCounterparty && paymentMethod && (!isInstallmentBased || firstDueDate))
    const canCreditCommission = Boolean(commissionRecipient && isQuickOrderValid)
    const progress = progressStage === 'preparing'
        ? { value: 15, label: t('pos.quickOrder.progress.preparing') }
        : progressStage === 'creating'
            ? { value: 40, label: t('pos.quickOrder.progress.creating') }
            : progressStage === 'reserving'
                ? { value: 65, label: t('pos.quickOrder.progress.reserving') }
                : progressStage === 'completing'
                    ? { value: 90, label: t('pos.quickOrder.progress.completing') }
                    : null

    useEffect(() => {
        if (!isOpen) return
        setCustomerSearch('')
        setCustomer(null)
        setSalesAccountAgentId('')
        setPaymentMethod('cash')
        setPaymentAccount(null)
        setFirstDueDate('')
        setIsCommissionPanelOpen(false)
        setSubmitError(null)
    }, [isOpen])

    const validateQuickOrder = () => {
        if (!orderCounterparty) {
            setSubmitError(t('orders.form.selectCustomer'))
            return false
        }
        if (!paymentMethod) {
            setSubmitError(t('orders.form.errors.paymentMethodRequired'))
            return false
        }
        if (isInstallmentBased && !firstDueDate) {
            setSubmitError(t('orders.form.errors.firstInstallmentDueDateRequired'))
            return false
        }
        setSubmitError(null)
        return true
    }

    const closeCommissionPanel = () => {
        if (isSubmitting) return
        setIsCommissionPanelOpen(false)
    }

    const openCommissionPanel = () => {
        if (!validateQuickOrder() || !commissionRecipient) return
        setIsCommissionPanelOpen(true)
    }

    const handleSubmit = async (includeCommission = false) => {
        if (!validateQuickOrder()) return
        if (includeCommission) {
            if (!commissionRecipient || !commissionAssignmentRef.current) return
            try {
                commissionAssignmentRef.current.validate()
            } catch (error) {
                setSubmitError(error instanceof Error ? error.message : t('salesAgentCommissions.assignmentNeedsAttentionDescription'))
                return
            }
        }

        try {
            await onSubmit({
                customer: orderCounterparty!,
                salesAccountAgentId: selectedSalesAccount?.agent.id ?? null,
                commissionEnabled: includeCommission,
                paymentMethod,
                installmentCount: 3,
                installmentFrequency: 'monthly',
                firstDueDate: isInstallmentBased ? firstDueDate : null,
                paymentAccountId: paymentAccount?.id ?? null,
                paymentAccountNameSnapshot: paymentAccount?.name ?? null,
            }, includeCommission ? {
                onOrderCreated: async (order) => commissionAssignmentRef.current?.save(order)
            } : undefined)
        } catch (error) {
            const message = error instanceof Error ? error.message : ''
            setSubmitError(message === 'agent_sales_accounts_not_enabled'
                ? t('agentSalesAccounts.notEnabled')
                : message === 'agent_sales_account_unavailable'
                    ? t('agentSalesAccounts.unavailable')
                    : message || t('orders.form.errors.saveSalesFailed'))
        }
    }

    const primaryPanel = (
        <div className="flex min-h-0 flex-1 flex-col">
            <AppDialogHeader className="relative border-b bg-muted/30 px-6 py-5 text-start">
                <AppDialogTitle className="flex items-center gap-2 text-xl">
                    <ShoppingCart className="h-5 w-5 text-primary" />
                    {t('pos.quickOrder.title')}
                </AppDialogTitle>
                <AppDialogDescription>{t('pos.quickOrder.description')}</AppDialogDescription>
                {!isCommissionPanelOpen ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute end-4 top-4 h-8 w-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                        aria-label={t('common.close')}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                ) : null}
            </AppDialogHeader>

            <AppDialogBody className="space-y-5 px-6 py-5">
                {isSubmitting && progress ? (
                    <div role="status" aria-live="polite" className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-primary">{progress.label}</span>
                            <span className="tabular-nums text-xs font-semibold text-primary/80">{progress.value}%</span>
                        </div>
                        <Progress value={progress.value} className="h-2 bg-primary/15" indicatorClassName="bg-primary" />
                    </div>
                ) : null}

                {agentSalesAccountsEnabled ? (
                    <div className="grid gap-2">
                        <Label htmlFor="quick-order-sales-account" className="flex items-center gap-2">
                            <UserRound className="h-4 w-4 text-muted-foreground" />
                            {t('agentSalesAccounts.salesAccount')}
                        </Label>
                        <Select
                            value={salesAccountAgentId || 'workspace'}
                            onValueChange={(value) => {
                                setSalesAccountAgentId(value === 'workspace' ? '' : value)
                                setCustomer(null)
                                setCustomerSearch('')
                                setIsCommissionPanelOpen(false)
                            }}
                            disabled={isSubmitting || isCommissionPanelOpen}
                        >
                            <SelectTrigger id="quick-order-sales-account"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="workspace">{t('agentSalesAccounts.workspaceAccount')}</SelectItem>
                                {agents
                                    .filter((agent) => !agent.isDeleted && agent.status === 'active' && agent.salesAccountEnabled)
                                    .map((agent) => {
                                        const partner = agentPartners.find((candidate) => candidate.id === agent.businessPartnerId)
                                        return partner ? <SelectItem key={agent.id} value={agent.id}>{partner.name}</SelectItem> : null
                                    })}
                            </SelectContent>
                        </Select>
                        <p className="text-xs leading-5 text-muted-foreground">{t('agentSalesAccounts.salesAccountPosHint')}</p>
                    </div>
                ) : null}

                <div className="grid gap-2">
                    <Label className="flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-muted-foreground" />
                        {selectedSalesAccount ? t('agentSalesAccounts.sellingAgent') : t('orders.form.customer')}
                        <span className="text-destructive">*</span>
                    </Label>
                    {!selectedSalesAccount ? (
                        <PartnerAutocompleteInput
                            workspaceId={workspaceId}
                            roles={['customer']}
                            value={customerSearch}
                            onChange={(value) => {
                                setCustomerSearch(value)
                                setCustomer(null)
                                setIsCommissionPanelOpen(false)
                            }}
                            onSelectPartner={(partner) => {
                                setCustomer(partner)
                                setCustomerSearch(partner.name)
                                setIsCommissionPanelOpen(false)
                            }}
                            disabled={isSubmitting || isCommissionPanelOpen}
                            placeholder={t('orders.form.selectCustomer')}
                        />
                    ) : null}
                    {orderCounterparty ? (
                        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                            <Link2 className="h-4 w-4 shrink-0 text-primary" />
                            <div className="min-w-0">
                                <div className="text-[11px] font-bold uppercase tracking-wide text-primary">
                                    {t('businessPartners.linked')} {t('businessPartners.title')}
                                </div>
                                <div className="truncate text-sm font-semibold">{orderCounterparty.name}</div>
                            </div>
                            {!selectedSalesAccount ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="ml-auto h-8 shrink-0 px-2 text-muted-foreground"
                                    onClick={() => {
                                        setCustomer(null)
                                        setCustomerSearch('')
                                        setIsCommissionPanelOpen(false)
                                    }}
                                    disabled={isSubmitting || isCommissionPanelOpen}
                                >
                                    {t('common.remove')}
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="quick-order-payment">
                        {t('pos.paymentMethod')} <span className="text-destructive">*</span>
                    </Label>
                    <PaymentMethodSelect
                        id="quick-order-payment"
                        value={paymentMethod}
                        onValueChange={(value) => {
                            setPaymentMethod(value)
                            setIsCommissionPanelOpen(false)
                        }}
                        onLinkedPaymentAccountSelect={setPaymentAccount}
                        workspaceId={workspaceId}
                        methods={paymentMethods}
                        disabled={isSubmitting || isCommissionPanelOpen}
                    />
                </div>

                {paymentMethod !== 'loan' && paymentMethod !== 'installments' ? (
                    <PaymentAccountSelector
                        workspaceId={workspaceId}
                        value={paymentAccount?.id ?? null}
                        onValueChange={setPaymentAccount}
                        disabled={isSubmitting || isCommissionPanelOpen}
                        cashDrawerOnly={paymentMethod === 'cash'}
                    />
                ) : null}

                {isInstallmentBased ? (
                    <div className="grid gap-2 rounded-2xl border bg-muted/20 p-4">
                        <Label htmlFor="quick-order-first-due-date">
                            {t('orders.form.firstInstallmentDueDate')} <span className="text-destructive">*</span>
                        </Label>
                        <DateTimePicker
                            id="quick-order-first-due-date"
                            mode="date"
                            date={firstDueDate ? new Date(`${firstDueDate}T00:00:00`) : undefined}
                            setDate={(date) => {
                                setFirstDueDate(date ? date.toISOString().slice(0, 10) : '')
                                setIsCommissionPanelOpen(false)
                            }}
                            disabled={isSubmitting || isCommissionPanelOpen}
                            placeholder={t('orders.form.firstInstallmentDueDate')}
                        />
                        <p className="text-xs text-muted-foreground">{t('pos.quickOrder.installmentHint')}</p>
                    </div>
                ) : null}

                {canCreditCommission ? (
                    <div className="flex flex-col items-center gap-2 py-1 text-center">
                        <Button
                            ref={commissionTriggerRef}
                            type="button"
                            variant="outline"
                            className="min-h-11 gap-2 border-violet-500/30 bg-violet-500/[0.04] px-5 text-violet-700 hover:bg-violet-500/[0.1] hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
                            onClick={openCommissionPanel}
                            disabled={isSubmitting || isCommissionPanelOpen}
                        >
                            <BadgePercent className="h-4 w-4" />
                            {t('pos.quickOrder.creditCommission')}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            {t('pos.quickOrder.creditCommissionFor', { agent: selectedSalesAccount?.partner.name ?? customer?.name })}
                        </p>
                    </div>
                ) : null}

                <div className="rounded-2xl border bg-muted/20 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-sm font-semibold">{t('pos.quickOrder.summary')}</div>
                            <div className="text-xs text-muted-foreground">{t('pos.quickOrder.itemCount', { count: cart.length })}</div>
                        </div>
                        <div className="text-right text-base font-bold text-primary">
                            {formatCurrency(totalAmount, settlementCurrency, iqdPreference)}
                        </div>
                    </div>
                    <div className="max-h-32 space-y-2 overflow-y-auto pe-1">
                        {cart.map((item) => (
                            <div key={`${item.product_id}:${item.storageId || ''}`} className="flex justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate">{item.name}</span>
                                <span className="shrink-0 text-muted-foreground">× {item.quantity}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {submitError ? (
                    <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{submitError}</p>
                ) : null}
            </AppDialogBody>

            <AppDialogFooter className="border-t bg-muted/10 px-6 py-4 sm:justify-between">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                    {t('common.cancel')}
                </Button>
                {!isCommissionPanelOpen ? (
                    <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || !isQuickOrderValid}>
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {t('pos.quickOrder.save')}
                    </Button>
                ) : null}
            </AppDialogFooter>
        </div>
    )

    return (
        <MultipleModalLayout
            open={isOpen}
            onOpenChange={(open) => {
                if (!open && !isSubmitting) onOpenChange(false)
            }}
            closeDisabled={isSubmitting}
            onCloseLastPanel={isCommissionPanelOpen ? closeCommissionPanel : undefined}
            lastPanelTriggerRef={commissionTriggerRef}
            breakpoint="xl"
            align="center"
            gapClassName="gap-5"
            panels={[
                {
                    id: 'quick-order',
                    label: t('pos.quickOrder.title'),
                    className: 'w-full xl:w-[34rem] xl:flex-none',
                    content: primaryPanel
                },
                ...(isCommissionPanelOpen && commissionRecipient ? [{
                    id: 'quick-order-commission',
                    label: t('pos.quickOrder.commissionTitle'),
                    className: 'w-full xl:w-[28rem] xl:flex-none',
                    content: (
                        <div className="flex min-h-0 flex-1 flex-col">
                            <AppDialogHeader className="relative border-b bg-violet-500/[0.03] px-6 py-5 text-start">
                                <AppDialogTitle className="flex items-center gap-2 text-xl">
                                    <BadgePercent className="h-5 w-5 text-violet-600" />
                                    {t('pos.quickOrder.commissionTitle')}
                                </AppDialogTitle>
                                <AppDialogDescription>{t('pos.quickOrder.commissionDescription')}</AppDialogDescription>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute end-4 top-4 h-8 w-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    onClick={closeCommissionPanel}
                                    disabled={isSubmitting}
                                    aria-label={t('common.close')}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </AppDialogHeader>
                            <AppDialogBody className="px-6 py-5">
                                <SalesOrderCommissionAssignmentSection
                                    ref={commissionAssignmentRef}
                                    workspaceId={workspaceId}
                                    salesAccountAgentId={selectedSalesAccount?.agent.id ?? null}
                                    fixedRecipientAgentId={commissionRecipient.id}
                                    fixedRecipientAssignmentSource={selectedSalesAccount ? 'sales_account' : 'manual'}
                                    customerCity={orderCounterparty?.city || ''}
                                    assignedBy={commissionAssignedBy}
                                    orderCurrency={settlementCurrency}
                                    orderTotal={totalAmount}
                                    exchangeRates={commissionExchangeRates}
                                    availableCurrencies={commissionCurrencies}
                                    iqdDisplayPreference={iqdPreference}
                                    showOperationalFields={false}
                                    requireManualCommissionWhenNoPlan
                                    compact
                                    disabled={isSubmitting}
                                />
                            </AppDialogBody>
                            <AppDialogFooter className="border-t bg-muted/10 px-6 py-4 sm:justify-between">
                                <Button type="button" variant="outline" onClick={closeCommissionPanel} disabled={isSubmitting}>
                                    {t('pos.quickOrder.backToQuickOrder')}
                                </Button>
                                <Button type="button" onClick={() => void handleSubmit(true)} disabled={isSubmitting}>
                                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {t('pos.quickOrder.save')}
                                </Button>
                            </AppDialogFooter>
                        </div>
                    )
                }] : [])
            ]}
        />
    )
}
