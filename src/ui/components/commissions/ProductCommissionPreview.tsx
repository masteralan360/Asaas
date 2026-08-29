import { PackageCheck, UserRound } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
    activeProductCommissionRule,
    type CurrencyCode,
    type ExchangeRateSnapshot,
    type ProductCommissionRule,
    type ProductCommissionRuleAgent,
    useProductCommissionRuleAgents,
    useProductCommissionRules
} from '@/local-db'
import { getAppliedCurrencyConversion } from '@/lib/orderCurrency'
import { formatCurrency } from '@/lib/utils'

export type ProductCommissionPreviewItem = {
    id?: string
    productId: string
    productName: string
    quantity: number
    convertedUnitPrice?: number
    lineTotal?: number
}

export type ProductCommissionPreviewAgent = {
    id: string
    name: string
}

/** True when at least one selected beneficiary qualifies for a cart line. */
export function hasEligibleProductCommission({
    items,
    agentIds,
    rules,
    recipients,
    at
}: {
    items: readonly ProductCommissionPreviewItem[]
    agentIds: readonly string[]
    rules: readonly ProductCommissionRule[]
    recipients: readonly ProductCommissionRuleAgent[]
    at: string
}) {
    const selectedAgentIds = [...new Set(agentIds.filter(Boolean))]
    return items.some((item) => {
        if (Number(item.quantity || 0) <= 0) return false
        const rule = activeProductCommissionRule(rules, item.productId, at)
        if (!rule) return false
        return rule.recipientScope === 'all_assigned'
            ? selectedAgentIds.length > 0
            : selectedAgentIds.some((agentId) => recipients.some((recipient) => (
                recipient.ruleId === rule.id && recipient.agentId === agentId
            )))
    })
}

/** Read-only form/POS preview. Final amounts are locked at completion. */
export function ProductCommissionPreview({
    workspaceId,
    items,
    agentIds,
    agents = [],
    currency,
    exchangeRates,
    iqdPreference
}: {
    workspaceId: string
    items: ProductCommissionPreviewItem[]
    agentIds: string[]
    agents?: ProductCommissionPreviewAgent[]
    currency: CurrencyCode
    exchangeRates: ExchangeRateSnapshot[]
    iqdPreference: 'IQD' | 'د.ع'
}) {
    const { t } = useTranslation()
    const rules = useProductCommissionRules(workspaceId)
    const recipients = useProductCommissionRuleAgents(workspaceId)
    const now = new Date().toISOString()
    const agentNameById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])
    const rows = useMemo(() => items.flatMap((item) => {
        const rule = activeProductCommissionRule(rules, item.productId, now)
        if (!rule || Number(item.quantity || 0) <= 0) return []
        const allowed = rule.recipientScope === 'all_assigned'
            ? agentIds
            : agentIds.filter((agentId) => recipients.some((recipient) => recipient.ruleId === rule.id && recipient.agentId === agentId))
        if (allowed.length === 0) return []
        const basePerUnit = Math.max(0, Number(item.convertedUnitPrice || 0))
        const fixedConversion = rule.commissionType === 'fixed_amount' && rule.fixedCurrency
            ? getAppliedCurrencyConversion(Number(rule.fixedAmount || 0), rule.fixedCurrency, currency, exchangeRates)
            : null
        const unavailableConversion = rule.commissionType === 'fixed_amount' && !fixedConversion
        const perUnit = rule.commissionType === 'fixed_amount'
            ? Number(fixedConversion?.convertedAmount || 0)
            : basePerUnit * Number(rule.ratePercent || 0) / 100
        return allowed.map((agentId) => ({
            item,
            agentId,
            agentName: agentNameById.get(agentId) || t('salesAgentCommissions.salesAgent'),
            perUnit,
            total: perUnit * Number(item.quantity || 0),
            rule,
            unavailableConversion
        }))
    }), [agentIds, agentNameById, currency, exchangeRates, items, now, recipients, rules, t])

    if (rows.length === 0) return null
    return (
        <div className="space-y-3 rounded-2xl border border-violet-500/25 bg-violet-500/[0.035] p-4">
            <div className="flex items-center gap-2 font-semibold">
                <PackageCheck className="h-4 w-4 text-violet-600" />
                {t('salesAgentCommissions.productCommission.previewTitle')}
            </div>
            <p className="text-xs text-muted-foreground">{t('salesAgentCommissions.productCommission.previewHint')}</p>
            <div className="space-y-2">
                {rows.map(({ item, agentId, agentName, perUnit, total, rule, unavailableConversion }) => (
                    <div key={`${item.id || item.productId}:${rule.id}:${agentId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/70 px-3 py-2 text-sm">
                        <div>
                            <div className="font-medium">{item.productName}</div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <UserRound className="h-3 w-3" />
                                <span>{agentName}</span>
                                <span>·</span>
                                <span>{unavailableConversion
                                    ? t('salesAgentCommissions.errors.commissionExchangeRateUnavailable')
                                    : formatCurrency(perUnit, currency, iqdPreference)}</span>
                            </div>
                        </div>
                        <div className="font-bold tabular-nums">{unavailableConversion ? '—' : formatCurrency(total, currency, iqdPreference)}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}
