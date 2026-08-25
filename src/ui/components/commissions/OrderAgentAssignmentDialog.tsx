import { useEffect, useMemo, useState } from 'react'
import { UserRoundCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getAppliedCurrencyConversion } from '@/lib/orderCurrency'
import {
    assignSalesOrderAgent,
    type CurrencyCode,
    type SalesOrderAgentAssignment,
    useSalesOrder
} from '@/local-db'
import { useWorkspace } from '@/workspace'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogDescription,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
    Button,
    useToast
} from '@/ui/components'
import {
    SalesAgentAssignmentFields,
    type SalesAgentAssignmentFieldValue
} from './SalesAgentAssignmentFields'
import { useCommissionAgentDirectory } from './useCommissionAgentDirectory'

interface OrderAgentAssignmentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    orderId: string
    activeAssignment?: SalesOrderAgentAssignment
    defaultCustomerCity?: string
    assignedBy?: string | null
}

function toFormValue(
    assignment?: SalesOrderAgentAssignment,
    defaultCustomerCity = '',
    orderCurrency: CurrencyCode = 'usd'
): SalesAgentAssignmentFieldValue {
    return {
        agentId: assignment?.agentId || '',
        customerCity: assignment?.customerCitySnapshot || defaultCustomerCity,
        deliveryChargeAmount: assignment?.deliveryChargeAmount ? String(assignment.deliveryChargeAmount) : '',
        internalDeliveryCostAmount: assignment?.internalDeliveryCostAmount ? String(assignment.internalDeliveryCostAmount) : '',
        reassignmentReason: '',
        manualCommissionType: assignment?.manualCommissionType || 'fixed_amount',
        manualCommissionAmount: assignment?.manualCommissionSourceAmount ? String(assignment.manualCommissionSourceAmount) : '',
        manualCommissionCurrency: assignment?.manualCommissionSourceCurrency || orderCurrency
    }
}

export function OrderAgentAssignmentDialog({
    open,
    onOpenChange,
    workspaceId,
    orderId,
    activeAssignment,
    defaultCustomerCity = '',
    assignedBy
}: OrderAgentAssignmentDialogProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { features } = useWorkspace()
    const order = useSalesOrder(orderId)
    const orderCurrency = order?.currency || features.default_currency
    const orderTotal = order?.total || 0
    const availableCurrencies = useMemo(
        () => Array.from(new Set([features.default_currency, ...features.allowed_currencies])) as CurrencyCode[],
        [features.allowed_currencies, features.default_currency]
    )
    const directory = useCommissionAgentDirectory(open ? workspaceId : undefined)
    const [value, setValue] = useState<SalesAgentAssignmentFieldValue>(() => toFormValue(activeAssignment, defaultCustomerCity, orderCurrency))
    const [isSaving, setIsSaving] = useState(false)
    const currentAgent = useMemo(
        () => activeAssignment ? directory.agentById.get(activeAssignment.agentId) : undefined,
        [activeAssignment, directory.agentById]
    )
    const selectedAgent = useMemo(() => directory.eligibleAgents.find((entry) => entry.agent.id === value.agentId)
        || (currentAgent?.agent.id === value.agentId ? currentAgent : undefined), [currentAgent, directory.eligibleAgents, value.agentId])

    useEffect(() => {
        if (!open) return
        setValue(toFormValue(activeAssignment, defaultCustomerCity, orderCurrency))
    }, [activeAssignment, defaultCustomerCity, open, orderCurrency])

    async function handleSave() {
        setIsSaving(true)
        try {
            if (
                selectedAgent?.plan?.commissionType === 'fixed_amount'
                && selectedAgent.plan.fixedCurrency
                && selectedAgent.plan.fixedCurrency !== orderCurrency
                && !getAppliedCurrencyConversion(
                    1,
                    selectedAgent.plan.fixedCurrency,
                    orderCurrency,
                    order?.exchangeRates
                )
            ) {
                throw new Error(t('salesAgentCommissions.errors.commissionExchangeRateUnavailable'))
            }
            await assignSalesOrderAgent(workspaceId, {
                orderId,
                agentId: value.agentId || null,
                assignedBy: assignedBy || undefined,
                reason: value.reassignmentReason.trim() || undefined,
                customerCitySnapshot: value.customerCity.trim() || undefined,
                deliveryChargeAmount: Math.max(0, Number(value.deliveryChargeAmount) || 0),
                internalDeliveryCostAmount: Math.max(0, Number(value.internalDeliveryCostAmount) || 0),
                manualCommission: value.agentId && !selectedAgent?.plan && value.manualCommissionAmount.trim()
                    ? {
                        type: value.manualCommissionType,
                        amount: Number(value.manualCommissionAmount),
                        currency: value.manualCommissionType === 'percentage' ? orderCurrency : value.manualCommissionCurrency,
                        exchangeRates: order?.exchangeRates ?? []
                    }
                    : null
            })
            toast({ title: value.agentId ? t('salesAgentCommissions.assignmentSaved') : t('salesAgentCommissions.assignmentCleared') })
            onOpenChange(false)
        } catch (error: any) {
            toast({
                title: t('salesAgentCommissions.couldNotSaveAssignment'),
                description: error?.message || t('salesAgentCommissions.tryAgain'),
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <AppDialog open={open} onOpenChange={(nextOpen) => {
            if (isSaving && !nextOpen) return
            onOpenChange(nextOpen)
        }}>
            <AppDialogContent className="max-w-2xl">
                <AppDialogHeader>
                    <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-violet-500/10 p-2 text-violet-700 dark:text-violet-300">
                            <UserRoundCheck className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                            <AppDialogTitle>{t('salesAgentCommissions.assignSalesAgent')}</AppDialogTitle>
                            <AppDialogDescription>
                                {t('salesAgentCommissions.assignSalesAgentDescription')}
                            </AppDialogDescription>
                        </div>
                    </div>
                </AppDialogHeader>
                <AppDialogBody className="space-y-5">
                    <SalesAgentAssignmentFields
                        value={value}
                        onChange={setValue}
                        agents={directory.eligibleAgents}
                        currentAgent={currentAgent}
                        orderCurrency={orderCurrency}
                        orderTotal={orderTotal}
                        exchangeRates={order?.exchangeRates ?? []}
                        availableCurrencies={availableCurrencies}
                        iqdDisplayPreference={features.iqd_display_preference}
                        showReason={Boolean(activeAssignment)}
                        disabled={isSaving}
                    />
                    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-4 text-sm text-sky-800 dark:text-sky-200">
                        {t('salesAgentCommissions.postServiceOptionalDescription')}
                    </div>
                </AppDialogBody>
                <AppDialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        {t('salesAgentCommissions.cancel')}
                    </Button>
                    <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
                        {isSaving ? t('salesAgentCommissions.saving') : t('salesAgentCommissions.saveAssignment')}
                    </Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}
