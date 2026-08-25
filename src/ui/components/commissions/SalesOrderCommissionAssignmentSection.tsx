import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { Plus, Trash2, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
    getActiveSalesOrderAgentAssignments,
    replaceSalesOrderAgentAssignments,
    type CurrencyCode,
    type ExchangeRateSnapshot,
    type SalesOrder,
    type SalesOrderAgentAssignment,
    useSalesOrderAgentAssignments
} from '@/local-db'
import { getAppliedCurrencyConversion } from '@/lib/orderCurrency'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/ui/components'
import {
    SalesAgentAssignmentFields,
    type SalesAgentAssignmentFieldValue
} from './SalesAgentAssignmentFields'
import { useCommissionAgentDirectory } from './useCommissionAgentDirectory'

export interface SalesOrderCommissionAssignmentHandle {
    validate: () => {
        hasManualCommissionCurrencyConversion: boolean
        hasCommissionPlanCurrencyConversion: boolean
    }
    save: (order: Pick<SalesOrder, 'id' | 'currency' | 'total' | 'exchangeRates'>) => Promise<void>
}

interface SalesOrderCommissionAssignmentSectionProps {
    workspaceId: string
    editingOrderId?: string
    customerCity?: string
    assignedBy?: string | null
    orderCurrency: CurrencyCode
    orderTotal: number
    exchangeRates: ExchangeRateSnapshot[]
    availableCurrencies: CurrencyCode[]
    iqdDisplayPreference?: 'IQD' | 'د.ع'
    disabled?: boolean
}

type AssignmentDraft = SalesAgentAssignmentFieldValue & {
    key: string
    assignmentId?: string
}

function createDraft(orderCurrency: CurrencyCode, assignment?: SalesOrderAgentAssignment, customerCity = ''): AssignmentDraft {
    return {
        key: assignment?.id || crypto.randomUUID(),
        assignmentId: assignment?.id,
        agentId: assignment?.agentId || '',
        customerCity: assignment?.customerCitySnapshot || customerCity,
        deliveryChargeAmount: assignment?.deliveryChargeAmount ? String(assignment.deliveryChargeAmount) : '',
        internalDeliveryCostAmount: assignment?.internalDeliveryCostAmount ? String(assignment.internalDeliveryCostAmount) : '',
        reassignmentReason: '',
        manualCommissionType: assignment?.manualCommissionType || 'fixed_amount',
        manualCommissionAmount: assignment?.manualCommissionSourceAmount ? String(assignment.manualCommissionSourceAmount) : '',
        manualCommissionCurrency: assignment?.manualCommissionSourceCurrency || orderCurrency
    }
}

export const SalesOrderCommissionAssignmentSection = forwardRef<
    SalesOrderCommissionAssignmentHandle,
    SalesOrderCommissionAssignmentSectionProps
>(function SalesOrderCommissionAssignmentSection({
    workspaceId,
    editingOrderId,
    customerCity = '',
    assignedBy,
    orderCurrency,
    orderTotal,
    exchangeRates,
    availableCurrencies,
    iqdDisplayPreference,
    disabled = false
}, ref) {
    const { t } = useTranslation()
    const directory = useCommissionAgentDirectory(workspaceId)
    const assignments = useSalesOrderAgentAssignments(workspaceId)
    const activeAssignments = useMemo(
        () => editingOrderId ? getActiveSalesOrderAgentAssignments(assignments, editingOrderId) : [],
        [assignments, editingOrderId]
    )
    const [drafts, setDrafts] = useState<AssignmentDraft[]>(() => [createDraft(orderCurrency, undefined, customerCity)])

    useEffect(() => {
        if (!editingOrderId) return
        setDrafts(activeAssignments.length > 0
            ? activeAssignments.map((assignment) => createDraft(orderCurrency, assignment, customerCity))
            : [createDraft(orderCurrency, undefined, customerCity)])
    }, [activeAssignments, customerCity, editingOrderId, orderCurrency])

    useEffect(() => {
        if (editingOrderId || !customerCity) return
        setDrafts((current) => current.map((draft) => draft.customerCity
            ? draft
            : { ...draft, customerCity }))
    }, [customerCity, editingOrderId])

    useEffect(() => {
        setDrafts((current) => current.map((draft) => draft.manualCommissionType === 'percentage'
            && draft.manualCommissionCurrency !== orderCurrency
            ? { ...draft, manualCommissionCurrency: orderCurrency }
            : draft))
    }, [orderCurrency])

    const selectedAgentIds = useMemo(
        () => new Set(drafts.map((draft) => draft.agentId).filter(Boolean)),
        [drafts]
    )
    const updateDraft = useCallback((key: string, value: SalesAgentAssignmentFieldValue) => {
        setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...value } : draft))
    }, [])
    const removeDraft = useCallback((key: string) => {
        setDrafts((current) => {
            const next = current.filter((draft) => draft.key !== key)
            return next.length > 0 ? next : [createDraft(orderCurrency, undefined, customerCity)]
        })
    }, [customerCity, orderCurrency])
    const addDraft = useCallback(() => {
        setDrafts((current) => [...current, createDraft(orderCurrency, undefined, customerCity)])
    }, [customerCity, orderCurrency])

    const resolveSelectedAgent = useCallback((draft: AssignmentDraft) => (
        directory.eligibleAgents.find((entry) => entry.agent.id === draft.agentId)
        || directory.agentById.get(draft.agentId)
    ), [directory.agentById, directory.eligibleAgents])

    const getManualCommissionInput = useCallback((
        draft: AssignmentDraft,
        order: Pick<SalesOrder, 'currency' | 'total' | 'exchangeRates'>
    ) => {
        const selectedAgent = resolveSelectedAgent(draft)
        if (!draft.agentId || selectedAgent?.plan) return null
        const amount = Number(draft.manualCommissionAmount)
        if (!draft.manualCommissionAmount.trim()) return null
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error(t('salesAgentCommissions.errors.manualCommissionPositive'))
        }
        if (draft.manualCommissionType === 'percentage') {
            if (amount > 100) throw new Error(t('salesAgentCommissions.errors.manualCommissionPercentageMax'))
            return {
                type: 'percentage' as const,
                amount,
                currency: order.currency,
                exchangeRates: []
            }
        }
        const conversion = getAppliedCurrencyConversion(
            amount,
            draft.manualCommissionCurrency,
            order.currency,
            order.exchangeRates ?? exchangeRates
        )
        if (!conversion) throw new Error(t('salesAgentCommissions.errors.commissionExchangeRateUnavailable'))
        return {
            type: 'fixed_amount' as const,
            amount,
            currency: draft.manualCommissionCurrency,
            exchangeRates: conversion.exchangeRates
        }
    }, [exchangeRates, resolveSelectedAgent, t])

    const validate = useCallback(() => {
        let hasManualCommissionCurrencyConversion = false
        let hasCommissionPlanCurrencyConversion = false
        const seenAgentIds = new Set<string>()
        for (const draft of drafts) {
            if (!draft.agentId) continue
            if (seenAgentIds.has(draft.agentId)) {
                throw new Error(t('salesAgentCommissions.errors.duplicateSalesAgent'))
            }
            seenAgentIds.add(draft.agentId)
            const manual = getManualCommissionInput(draft, {
                currency: orderCurrency,
                total: orderTotal,
                exchangeRates
            })
            const selectedAgent = resolveSelectedAgent(draft)
            const fixedPlanCurrency = selectedAgent?.plan?.commissionType === 'fixed_amount'
                ? selectedAgent.plan.fixedCurrency
                : null
            const requiresPlanConversion = Boolean(fixedPlanCurrency && fixedPlanCurrency !== orderCurrency)
            if (requiresPlanConversion && !getAppliedCurrencyConversion(
                1,
                fixedPlanCurrency!,
                orderCurrency,
                exchangeRates
            )) {
                throw new Error(t('salesAgentCommissions.errors.commissionExchangeRateUnavailable'))
            }
            hasManualCommissionCurrencyConversion ||= Boolean(
                manual?.type === 'fixed_amount' && manual.currency !== orderCurrency
            )
            hasCommissionPlanCurrencyConversion ||= requiresPlanConversion
        }
        return { hasManualCommissionCurrencyConversion, hasCommissionPlanCurrencyConversion }
    }, [drafts, exchangeRates, getManualCommissionInput, orderCurrency, orderTotal, resolveSelectedAgent, t])

    const save = useCallback(async (order: Pick<SalesOrder, 'id' | 'currency' | 'total' | 'exchangeRates'>) => {
        validate()
        const selectedDrafts = drafts.filter((draft) => draft.agentId)
        await replaceSalesOrderAgentAssignments(workspaceId, {
            orderId: order.id,
            assignedBy: assignedBy || undefined,
            assignments: selectedDrafts.map((draft) => ({
                agentId: draft.agentId,
                reason: draft.reassignmentReason.trim() || undefined,
                customerCitySnapshot: draft.customerCity.trim() || undefined,
                deliveryChargeAmount: Math.max(0, Number(draft.deliveryChargeAmount) || 0),
                internalDeliveryCostAmount: Math.max(0, Number(draft.internalDeliveryCostAmount) || 0),
                manualCommission: getManualCommissionInput(draft, order)
            }))
        })
    }, [assignedBy, drafts, getManualCommissionInput, validate, workspaceId])

    useImperativeHandle(ref, () => ({ validate, save }), [save, validate])

    return (
        <Card className="border-violet-500/20 bg-violet-500/[0.02]">
            <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                    <UsersRound className="h-5 w-5 text-violet-600" />
                    {t('salesAgentCommissions.salesAgentBeneficiaries')}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                    {t('salesAgentCommissions.salesAgentBeneficiariesDescription')}
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {drafts.map((draft, index) => {
                    const currentAgent = resolveSelectedAgent(draft)
                    const availableAgents = directory.eligibleAgents.filter((entry) => (
                        entry.agent.id === draft.agentId || !selectedAgentIds.has(entry.agent.id)
                    ))
                    return (
                        <div key={draft.key} className="space-y-4 rounded-2xl border bg-background/70 p-4 sm:p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold">
                                    {t('salesAgentCommissions.salesAgent')} {index + 1}
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="gap-1.5 text-muted-foreground hover:text-destructive"
                                    onClick={() => removeDraft(draft.key)}
                                    disabled={disabled}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {t('salesAgentCommissions.removeSalesAgent')}
                                </Button>
                            </div>
                            <SalesAgentAssignmentFields
                                idPrefix={`sales-order-agent-${draft.key}`}
                                value={draft}
                                onChange={(value) => updateDraft(draft.key, value)}
                                agents={availableAgents}
                                currentAgent={currentAgent}
                                orderCurrency={orderCurrency}
                                orderTotal={orderTotal}
                                exchangeRates={exchangeRates}
                                availableCurrencies={availableCurrencies}
                                iqdDisplayPreference={iqdDisplayPreference}
                                showReason={Boolean(draft.assignmentId)}
                                disabled={disabled}
                            />
                        </div>
                    )
                })}
                <Button type="button" variant="outline" className="w-full gap-2" onClick={addDraft} disabled={disabled}>
                    <Plus className="h-4 w-4" />
                    {t('salesAgentCommissions.addSalesAgent')}
                </Button>
            </CardContent>
        </Card>
    )
})
