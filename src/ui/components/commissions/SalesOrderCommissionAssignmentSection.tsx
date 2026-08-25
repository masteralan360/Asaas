import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'

import {
    assignSalesOrderAgent,
    getActiveSalesOrderAgentAssignment,
    type CurrencyCode,
    type ExchangeRateSnapshot,
    type SalesOrder,
    useSalesOrderAgentAssignments
} from '@/local-db'
import { getAppliedCurrencyConversion } from '@/lib/orderCurrency'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components'
import {
    SalesAgentAssignmentFields,
    type SalesAgentAssignmentFieldValue
} from './SalesAgentAssignmentFields'
import { useCommissionAgentDirectory } from './useCommissionAgentDirectory'

export interface SalesOrderCommissionAssignmentHandle {
    validate: () => { hasManualCommissionCurrencyConversion: boolean }
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

function createEmptyAssignmentValue(orderCurrency: CurrencyCode): SalesAgentAssignmentFieldValue {
    return {
    agentId: '',
    customerCity: '',
    deliveryChargeAmount: '',
    internalDeliveryCostAmount: '',
    reassignmentReason: '',
    manualCommissionType: 'fixed_amount',
    manualCommissionAmount: '',
    manualCommissionCurrency: orderCurrency
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
    const directory = useCommissionAgentDirectory(workspaceId)
    const assignments = useSalesOrderAgentAssignments(workspaceId)
    const activeAssignment = useMemo(
        () => editingOrderId ? getActiveSalesOrderAgentAssignment(assignments, editingOrderId) : undefined,
        [assignments, editingOrderId]
    )
    const currentAgent = activeAssignment ? directory.agentById.get(activeAssignment.agentId) : undefined
    const [value, setValue] = useState<SalesAgentAssignmentFieldValue>(() => createEmptyAssignmentValue(orderCurrency))

    useEffect(() => {
        if (!editingOrderId) return
        setValue({
            agentId: activeAssignment?.agentId || '',
            customerCity: activeAssignment?.customerCitySnapshot || customerCity,
            deliveryChargeAmount: activeAssignment?.deliveryChargeAmount
                ? String(activeAssignment.deliveryChargeAmount)
                : '',
            internalDeliveryCostAmount: activeAssignment?.internalDeliveryCostAmount
                ? String(activeAssignment.internalDeliveryCostAmount)
                : '',
            reassignmentReason: '',
            manualCommissionType: activeAssignment?.manualCommissionType || 'fixed_amount',
            manualCommissionAmount: activeAssignment?.manualCommissionSourceAmount
                ? String(activeAssignment.manualCommissionSourceAmount)
                : '',
            manualCommissionCurrency: activeAssignment?.manualCommissionSourceCurrency || orderCurrency
        })
    }, [activeAssignment, customerCity, editingOrderId, orderCurrency])

    useEffect(() => {
        if (editingOrderId || !customerCity) return
        setValue((current) => current.customerCity ? current : { ...current, customerCity })
    }, [customerCity, editingOrderId])

    useEffect(() => {
        setValue((current) => current.manualCommissionType === 'percentage'
            && current.manualCommissionCurrency !== orderCurrency
            ? { ...current, manualCommissionCurrency: orderCurrency }
            : current)
    }, [orderCurrency])

    const selectedAgent = useMemo(() => directory.eligibleAgents.find((entry) => entry.agent.id === value.agentId)
        || (currentAgent?.agent.id === value.agentId ? currentAgent : undefined), [currentAgent, directory.eligibleAgents, value.agentId])
    const getManualCommissionInput = useCallback((order: Pick<SalesOrder, 'currency' | 'total' | 'exchangeRates'>) => {
        if (!value.agentId || selectedAgent?.plan) return null
        const amount = Number(value.manualCommissionAmount)
        if (!value.manualCommissionAmount.trim()) return null
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Enter a manual commission greater than zero')
        }
        if (value.manualCommissionType === 'percentage') {
            if (amount > 100) throw new Error('Manual commission percentage cannot exceed 100%')
            return {
                type: 'percentage' as const,
                amount,
                currency: order.currency,
                exchangeRates: []
            }
        }
        const conversion = getAppliedCurrencyConversion(
            amount,
            value.manualCommissionCurrency,
            order.currency,
            order.exchangeRates ?? exchangeRates
        )
        if (!conversion) throw new Error('Exchange rate unavailable for the selected commission currency')
        return {
            type: 'fixed_amount' as const,
            amount,
            currency: value.manualCommissionCurrency,
            exchangeRates: conversion.exchangeRates
        }
    }, [exchangeRates, selectedAgent?.plan, value.agentId, value.manualCommissionAmount, value.manualCommissionCurrency, value.manualCommissionType])

    const validate = useCallback(() => {
        const manual = getManualCommissionInput({
            currency: orderCurrency,
            total: orderTotal,
            exchangeRates
        })
        return {
            hasManualCommissionCurrencyConversion: Boolean(
                manual?.type === 'fixed_amount' && manual.currency !== orderCurrency
            )
        }
    }, [exchangeRates, getManualCommissionInput, orderCurrency, orderTotal])

    const save = useCallback(async (order: Pick<SalesOrder, 'id' | 'currency' | 'total' | 'exchangeRates'>) => {
        const nextAgentId = value.agentId || null
        if (!nextAgentId && !activeAssignment) return

        await assignSalesOrderAgent(workspaceId, {
            orderId: order.id,
            agentId: nextAgentId,
            assignedBy: assignedBy || undefined,
            reason: value.reassignmentReason.trim() || undefined,
            customerCitySnapshot: value.customerCity.trim() || undefined,
            deliveryChargeAmount: Math.max(0, Number(value.deliveryChargeAmount) || 0),
            internalDeliveryCostAmount: Math.max(0, Number(value.internalDeliveryCostAmount) || 0),
            manualCommission: getManualCommissionInput(order)
        })
    }, [activeAssignment, assignedBy, getManualCommissionInput, value, workspaceId])

    useImperativeHandle(ref, () => ({ validate, save }), [save, validate])

    return (
        <Card className="border-violet-500/20 bg-violet-500/[0.02]">
            <CardHeader className="space-y-1">
                <CardTitle>Sales agent assignment</CardTitle>
                <p className="text-sm text-muted-foreground">
                    Optional workspace attribution and delivery snapshots. Post Service is not required.
                </p>
            </CardHeader>
            <CardContent>
                <SalesAgentAssignmentFields
                    value={value}
                    onChange={setValue}
                    agents={directory.eligibleAgents}
                    currentAgent={currentAgent}
                    orderCurrency={orderCurrency}
                    orderTotal={orderTotal}
                    exchangeRates={exchangeRates}
                    availableCurrencies={availableCurrencies}
                    iqdDisplayPreference={iqdDisplayPreference}
                    showReason={Boolean(activeAssignment)}
                    disabled={disabled}
                />
            </CardContent>
        </Card>
    )
})
