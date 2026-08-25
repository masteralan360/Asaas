import { BadgePercent, MapPin, Truck, UserRound } from 'lucide-react'

import { getAppliedCurrencyConversion } from '@/lib/orderCurrency'
import { formatCurrency, formatNumericInput, sanitizeNumericInput } from '@/lib/utils'
import type { CurrencyCode, ExchangeRateSnapshot, ManualSalesAgentCommissionType } from '@/local-db'
import type { CommissionAgentDirectoryEntry } from './useCommissionAgentDirectory'
import {
    Badge,
    CurrencySelector,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Textarea
} from '@/ui/components'

const UNASSIGNED_VALUE = '__unassigned__'

export interface SalesAgentAssignmentFieldValue {
    agentId: string
    customerCity: string
    deliveryChargeAmount: string
    internalDeliveryCostAmount: string
    reassignmentReason: string
    manualCommissionType: ManualSalesAgentCommissionType
    manualCommissionAmount: string
    manualCommissionCurrency: CurrencyCode
}

interface SalesAgentAssignmentFieldsProps {
    value: SalesAgentAssignmentFieldValue
    onChange: (value: SalesAgentAssignmentFieldValue) => void
    agents: CommissionAgentDirectoryEntry[]
    currentAgent?: CommissionAgentDirectoryEntry
    orderCurrency: CurrencyCode
    orderTotal: number
    exchangeRates: ExchangeRateSnapshot[]
    availableCurrencies: CurrencyCode[]
    iqdDisplayPreference?: Parameters<typeof CurrencySelector>[0]['iqdDisplayPreference']
    showReason?: boolean
    disabled?: boolean
}

export function SalesAgentAssignmentFields({
    value,
    onChange,
    agents,
    currentAgent,
    orderCurrency,
    orderTotal,
    exchangeRates,
    availableCurrencies,
    iqdDisplayPreference,
    showReason = false,
    disabled = false
}: SalesAgentAssignmentFieldsProps) {
    const selectedAgent = agents.find((entry) => entry.agent.id === value.agentId)
        || (currentAgent?.agent.id === value.agentId ? currentAgent : undefined)
    const selectableAgents = currentAgent && !agents.some((entry) => entry.agent.id === currentAgent.agent.id)
        ? [currentAgent, ...agents]
        : agents

    const update = <Key extends keyof SalesAgentAssignmentFieldValue>(
        key: Key,
        nextValue: SalesAgentAssignmentFieldValue[Key]
    ) => onChange({ ...value, [key]: nextValue })
    const selectAgent = (agentId: string) => {
        const nextAgentId = agentId === UNASSIGNED_VALUE ? '' : agentId
        if (nextAgentId === value.agentId) return
        onChange({
            ...value,
            agentId: nextAgentId,
            manualCommissionType: 'fixed_amount',
            manualCommissionAmount: '',
            manualCommissionCurrency: orderCurrency
        })
    }
    const usesManualCommission = Boolean(selectedAgent && !selectedAgent.plan)
    const manualAmount = Number(value.manualCommissionAmount)
    const manualConversion = usesManualCommission && value.manualCommissionType === 'fixed_amount'
        ? getAppliedCurrencyConversion(manualAmount, value.manualCommissionCurrency, orderCurrency, exchangeRates)
        : null
    const percentageCommission = usesManualCommission && value.manualCommissionType === 'percentage'
        && Number.isFinite(manualAmount) && manualAmount > 0
        ? Math.max(0, orderTotal) * manualAmount / 100
        : null

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="sales-agent-assignment">Assigned sales agent</Label>
                <Select
                    value={value.agentId || UNASSIGNED_VALUE}
                    onValueChange={selectAgent}
                    disabled={disabled}
                >
                    <SelectTrigger id="sales-agent-assignment" className="min-h-11">
                        <SelectValue placeholder="No sales agent assigned" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={UNASSIGNED_VALUE}>No sales agent assigned</SelectItem>
                        {selectableAgents.map((entry) => (
                            <SelectItem
                                key={entry.agent.id}
                                value={entry.agent.id}
                                disabled={!entry.isEligible && entry.agent.id !== currentAgent?.agent.id}
                            >
                                {entry.name}{entry.plan ? ` · ${entry.plan.name} (${entry.plan.ratePercent}%)` : ' · No commission plan'}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    This credits the sale independently from the workspace user who created the order.
                </p>
            </div>

            {selectedAgent ? (
                <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="gap-1.5">
                        <UserRound className="h-3.5 w-3.5" />
                        {selectedAgent.name}
                    </Badge>
                    {selectedAgent.plan ? (
                        <Badge variant="outline" className="gap-1.5 border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                            <BadgePercent className="h-3.5 w-3.5" />
                            {selectedAgent.plan.name} · {selectedAgent.plan.ratePercent}%
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                            Assignment only · no commission plan
                        </Badge>
                    )}
                </div>
            ) : null}

            {usesManualCommission ? (
                <div className="space-y-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
                    <div>
                        <h3 className="font-semibold text-amber-950 dark:text-amber-100">Manual order commission</h3>
                        <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/80">
                            This agent has no commission plan. Set an optional commission for this order only.
                        </p>
                    </div>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="sales-agent-manual-commission-type">Commission Type</Label>
                            <Select
                                value={value.manualCommissionType}
                                onValueChange={(type) => onChange({
                                    ...value,
                                    manualCommissionType: type as ManualSalesAgentCommissionType,
                                    manualCommissionAmount: '',
                                    manualCommissionCurrency: orderCurrency
                                })}
                                disabled={disabled}
                            >
                                <SelectTrigger id="sales-agent-manual-commission-type" className="min-h-11">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                                    <SelectItem value="percentage">Percentage</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {value.manualCommissionType === 'fixed_amount' ? (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="sales-agent-manual-commission-amount">Commission amount</Label>
                                    <Input
                                        id="sales-agent-manual-commission-amount"
                                        inputMode="decimal"
                                        value={formatNumericInput(value.manualCommissionAmount)}
                                        onChange={(event) => update('manualCommissionAmount', sanitizeNumericInput(event.target.value, {
                                            allowDecimal: true,
                                            maxFractionDigits: 3
                                        }))}
                                        disabled={disabled}
                                        placeholder="0"
                                    />
                                </div>
                                <CurrencySelector
                                    value={value.manualCommissionCurrency}
                                    onChange={(currency) => update('manualCommissionCurrency', currency)}
                                    label="Commission currency"
                                    iqdDisplayPreference={iqdDisplayPreference}
                                    allowedCurrencies={availableCurrencies}
                                    disabled={disabled}
                                />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Label htmlFor="sales-agent-manual-commission-amount">Commission percentage</Label>
                                <Input
                                    id="sales-agent-manual-commission-amount"
                                    inputMode="decimal"
                                    value={formatNumericInput(value.manualCommissionAmount)}
                                    onChange={(event) => update('manualCommissionAmount', sanitizeNumericInput(event.target.value, {
                                        allowDecimal: true,
                                        maxFractionDigits: 6
                                    }))}
                                    disabled={disabled}
                                    placeholder="0%"
                                />
                            </div>
                        )}
                        <div className="space-y-2 rounded-xl border bg-background/70 p-3">
                            <div className="text-xs font-medium text-muted-foreground">
                                {value.manualCommissionType === 'fixed_amount' ? 'Applied commission' : 'Commission on order total'}
                            </div>
                            <div className="text-base font-bold">
                                {value.manualCommissionType === 'fixed_amount'
                                    ? manualConversion
                                        ? formatCurrency(manualConversion.convertedAmount, orderCurrency, iqdDisplayPreference)
                                        : manualAmount > 0
                                            ? 'Exchange rate unavailable'
                                            : formatCurrency(0, orderCurrency, iqdDisplayPreference)
                                    : percentageCommission !== null
                                        ? formatCurrency(percentageCommission, orderCurrency, iqdDisplayPreference)
                                        : formatCurrency(0, orderCurrency, iqdDisplayPreference)}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {value.manualCommissionType === 'fixed_amount'
                                    ? `Converted and stored in ${orderCurrency.toUpperCase()} using the order rate snapshot.`
                                    : `Calculated from the current order total: ${formatCurrency(orderTotal, orderCurrency, iqdDisplayPreference)}.`}
                            </p>
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="sales-agent-customer-city" className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        Customer city snapshot
                    </Label>
                    <Input
                        id="sales-agent-customer-city"
                        value={value.customerCity}
                        onChange={(event) => update('customerCity', event.target.value)}
                        disabled={disabled || !value.agentId}
                        placeholder="City credited with this order"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="sales-agent-delivery-charge" className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        Customer delivery charge
                    </Label>
                    <Input
                        id="sales-agent-delivery-charge"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={value.deliveryChargeAmount}
                        onChange={(event) => update('deliveryChargeAmount', event.target.value)}
                        disabled={disabled || !value.agentId}
                        placeholder="0"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="sales-agent-internal-delivery-cost">Internal delivery cost</Label>
                    <Input
                        id="sales-agent-internal-delivery-cost"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={value.internalDeliveryCostAmount}
                        onChange={(event) => update('internalDeliveryCostAmount', event.target.value)}
                        disabled={disabled || !value.agentId}
                        placeholder="0"
                    />
                </div>
            </div>

            {showReason ? (
                <div className="space-y-2">
                    <Label htmlFor="sales-agent-reassignment-reason">Reassignment reason</Label>
                    <Textarea
                        id="sales-agent-reassignment-reason"
                        value={value.reassignmentReason}
                        onChange={(event) => update('reassignmentReason', event.target.value)}
                        disabled={disabled}
                        rows={3}
                        placeholder="Optional audit note"
                    />
                </div>
            ) : null}
        </div>
    )
}
