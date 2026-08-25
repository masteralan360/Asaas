import { useEffect, useMemo, useState } from 'react'
import { Plus, ShieldCheck, Trash2, Truck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatLocalDateValue, formatNumericInput, generateId, parseLocalDateValue, sanitizeNumericInput } from '@/lib/utils'

import {
    createAgentCommissionPlan,
    setAgentCommissionMembership,
    updateAgentCommissionPlan,
    type AgentCommissionPlan,
    type CommissionCalculationBasis,
    type CommissionPlanLevel
} from '@/local-db'
import {
    Badge,
    Button,
    Card,
    CardContent,
    DateTimePicker,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    Textarea,
    useToast
} from '@/ui/components'
import { getCurrentCommissionPlanRevision } from './agentCommissionPresentation'
import { useCommissionAgentDirectory } from './useCommissionAgentDirectory'

const NO_PLAN_VALUE = '__no_plan__'

type PlanDraft = {
    id?: string
    level: CommissionPlanLevel
    name: string
    ratePercent: string
    calculationBasis: CommissionCalculationBasis
    includeTax: boolean
    includeDeliveryCharge: boolean
    effectiveFrom: string
    effectiveTo: string
    isActive: boolean
    notes: string
}

function dateInputValue(value?: string | null) {
    return formatLocalDateValue(value)
}

function createPlanDraft(plan?: AgentCommissionPlan): PlanDraft {
    return {
        id: plan?.id,
        level: plan?.level || `commission-level-${generateId()}`,
        name: plan?.name || '',
        ratePercent: String(plan?.ratePercent ?? 0),
        calculationBasis: plan?.calculationBasis || 'net_profit',
        includeTax: plan?.includeTax || false,
        includeDeliveryCharge: plan?.includeDeliveryCharge || false,
        effectiveFrom: dateInputValue(plan?.effectiveFrom) || new Date().toISOString().slice(0, 10),
        effectiveTo: dateInputValue(plan?.effectiveTo),
        isActive: plan?.isActive ?? true,
        notes: plan?.notes || ''
    }
}

function planToken(draft: Pick<PlanDraft, 'id' | 'level'>) {
    return draft.id || draft.level
}

interface AgentCommissionSettingsFormProps {
    workspaceId: string
    userId?: string | null
    onCancel?: () => void
}

export function AgentCommissionSettingsForm({
    workspaceId,
    userId,
    onCancel
}: AgentCommissionSettingsFormProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const directory = useCommissionAgentDirectory(workspaceId)
    const [planDrafts, setPlanDrafts] = useState<PlanDraft[]>([])
    const [membershipSelections, setMembershipSelections] = useState<Record<string, string>>({})
    const [isSaving, setIsSaving] = useState(false)
    const fieldAgents = useMemo(
        () => directory.agents.filter((entry) => entry.agent.agentType === 'field_agent'),
        [directory.agents]
    )

    useEffect(() => {
        const levels = Array.from(new Set(directory.plans
            .filter((plan) => !plan.isDeleted)
            .map((plan) => plan.level)))
        const nextDrafts = levels
            .map((level) => getCurrentCommissionPlanRevision(directory.plans, level))
            .filter((plan): plan is AgentCommissionPlan => Boolean(plan))
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((plan) => createPlanDraft(plan))
        setPlanDrafts(nextDrafts)
        setMembershipSelections(Object.fromEntries(fieldAgents.map((entry) => [
            entry.agent.id,
            entry.membership?.planId || NO_PLAN_VALUE
        ])))
    }, [directory.plans, fieldAgents])

    function updateDraft(level: CommissionPlanLevel, patch: Partial<PlanDraft>) {
        setPlanDrafts((current) => current.map((draft) => draft.level === level ? { ...draft, ...patch } : draft))
    }

    function addPlanDraft() {
        setPlanDrafts((current) => [...current, createPlanDraft()])
    }

    function removeUnsavedPlanDraft(level: CommissionPlanLevel) {
        setPlanDrafts((current) => current.filter((draft) => draft.id || draft.level !== level))
        setMembershipSelections((current) => Object.fromEntries(Object.entries(current).map(([agentId, planId]) => [
            agentId,
            planId === level ? NO_PLAN_VALUE : planId
        ])))
    }

    async function handleSave() {
        const invalidDraft = planDrafts.find((draft) => !draft.name.trim() || !Number.isFinite(Number(draft.ratePercent)) || Number(draft.ratePercent) < 0 || Number(draft.ratePercent) > 100)
        if (invalidDraft) {
            toast({
                title: t('salesAgentCommissions.checkPlans'),
                description: t('salesAgentCommissions.invalidPlanDescription', {
                    level: invalidDraft.name.trim() || t('salesAgentCommissions.newCommissionLevel')
                }),
                variant: 'destructive'
            })
            return
        }

        setIsSaving(true)
        try {
            const savedPlans = await Promise.all(planDrafts.map(async (draft) => {
                const input = {
                    name: draft.name.trim(),
                    level: draft.level,
                    ratePercent: Number(draft.ratePercent),
                    calculationBasis: draft.calculationBasis,
                    includeTax: draft.includeTax,
                    includeDeliveryCharge: draft.includeDeliveryCharge,
                    effectiveFrom: draft.effectiveFrom,
                    effectiveTo: draft.effectiveTo || null,
                    isActive: draft.isActive,
                    notes: draft.notes.trim() || null,
                    createdBy: userId || null
                }
                return draft.id
                    ? updateAgentCommissionPlan(draft.id, input)
                    : createAgentCommissionPlan(workspaceId, input)
            }))
            const savedPlanByToken = new Map(planDrafts.map((draft, index) => [planToken(draft), savedPlans[index]]))
            const planIdByToken = new Map<string, string | null>()
            for (const [token, plan] of savedPlanByToken) {
                const selectablePlanId = plan.isActive ? plan.id : null
                planIdByToken.set(token, selectablePlanId)
                planIdByToken.set(plan.id, selectablePlanId)
            }

            await Promise.all(fieldAgents.flatMap((entry) => {
                const desiredToken = membershipSelections[entry.agent.id] || NO_PLAN_VALUE
                const desiredPlanId = desiredToken === NO_PLAN_VALUE
                    ? null
                    : planIdByToken.has(desiredToken)
                        ? planIdByToken.get(desiredToken) ?? null
                        : desiredToken
                const currentPlanId = entry.membership?.planId || null
                if (desiredPlanId === currentPlanId) return []

                return [setAgentCommissionMembership(workspaceId, {
                    agentId: entry.agent.id,
                    planId: desiredPlanId,
                    assignedBy: userId || undefined
                })]
            }))

            toast({ title: t('salesAgentCommissions.settingsSaved') })
        } catch (error: any) {
            toast({
                title: t('salesAgentCommissions.couldNotSaveSettings'),
                description: error?.message || t('salesAgentCommissions.tryAgain'),
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <form onSubmit={(event) => {
            event.preventDefault()
            void handleSave()
        }} className="space-y-6">
            <Card className="overflow-hidden border-violet-500/20">
                <CardContent className="space-y-6 pt-6">
                    <section className="space-y-3" aria-labelledby="commission-plans-heading">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h3 id="commission-plans-heading" className="font-semibold">{t('salesAgentCommissions.commissionPlans')}</h3>
                                <p className="text-sm text-muted-foreground">
                                    {t('salesAgentCommissions.plansHelp')}
                                </p>
                            </div>
                            <Button type="button" variant="outline" className="gap-2 self-start" onClick={addPlanDraft} disabled={isSaving}>
                                <Plus className="h-4 w-4" />
                                {t('salesAgentCommissions.addCommissionLevel')}
                            </Button>
                        </div>
                        {planDrafts.length === 0 ? (
                            <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                {t('salesAgentCommissions.noCommissionLevels')}
                            </div>
                        ) : <div className="grid gap-4 xl:grid-cols-3">
                            {planDrafts.map((draft) => (
                                <div key={draft.level} className="space-y-4 rounded-2xl border bg-muted/15 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                                            {draft.name.trim() || t('salesAgentCommissions.newCommissionLevel')}
                                        </Badge>
                                        <div className="flex items-center gap-2">
                                            {!draft.id ? (
                                                <Button
                                                    type="button"
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                    onClick={() => removeUnsavedPlanDraft(draft.level)}
                                                    disabled={isSaving}
                                                    title={t('salesAgentCommissions.removeLevel')}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            ) : null}
                                            <Label htmlFor={`commission-active-${draft.level}`} className="text-xs">{t('salesAgentCommissions.active')}</Label>
                                            <Switch
                                                id={`commission-active-${draft.level}`}
                                                checked={draft.isActive}
                                                onCheckedChange={(isActive) => updateDraft(draft.level, { isActive })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor={`commission-name-${draft.level}`}>{t('salesAgentCommissions.levelName')}</Label>
                                        <Input
                                            id={`commission-name-${draft.level}`}
                                            value={draft.name}
                                            onChange={(event) => updateDraft(draft.level, { name: event.target.value })}
                                            disabled={isSaving}
                                            placeholder={t('salesAgentCommissions.levelNamePlaceholder')}
                                        />
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor={`commission-rate-${draft.level}`}>{t('salesAgentCommissions.ratePercent')}</Label>
                                            <Input
                                                id={`commission-rate-${draft.level}`}
                                                type="text"
                                                inputMode="decimal"
                                                value={formatNumericInput(draft.ratePercent)}
                                                onChange={(event) => updateDraft(draft.level, {
                                                    ratePercent: sanitizeNumericInput(event.target.value, {
                                                        allowDecimal: true,
                                                        maxFractionDigits: 2
                                                    })
                                                })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>{t('salesAgentCommissions.basis')}</Label>
                                            <Select
                                                value={draft.calculationBasis}
                                                onValueChange={(calculationBasis) => updateDraft(draft.level, { calculationBasis: calculationBasis as CommissionCalculationBasis })}
                                                disabled={isSaving}
                                            >
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="net_profit">{t('salesAgentCommissions.netProfit')}</SelectItem>
                                                    <SelectItem value="net_revenue">{t('salesAgentCommissions.netRevenue')}</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor={`commission-start-${draft.level}`}>{t('salesAgentCommissions.effectiveFrom')}</Label>
                                            <DateTimePicker
                                                id={`commission-start-${draft.level}`}
                                                mode="date"
                                                date={parseLocalDateValue(draft.effectiveFrom)}
                                                setDate={(date) => date && updateDraft(draft.level, { effectiveFrom: formatLocalDateValue(date) })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor={`commission-end-${draft.level}`}>{t('salesAgentCommissions.effectiveTo')}</Label>
                                            <DateTimePicker
                                                id={`commission-end-${draft.level}`}
                                                mode="date"
                                                date={parseLocalDateValue(draft.effectiveTo)}
                                                setDate={(date) => updateDraft(draft.level, { effectiveTo: date ? formatLocalDateValue(date) : '' })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-3 rounded-xl border bg-background/70 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <Label htmlFor={`commission-tax-${draft.level}`} className="text-sm">{t('salesAgentCommissions.includeTax')}</Label>
                                            <Switch
                                                id={`commission-tax-${draft.level}`}
                                                checked={draft.includeTax}
                                                onCheckedChange={(includeTax) => updateDraft(draft.level, { includeTax })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <Label htmlFor={`commission-delivery-${draft.level}`} className="text-sm">{t('salesAgentCommissions.includeCustomerDeliveryCharge')}</Label>
                                            <Switch
                                                id={`commission-delivery-${draft.level}`}
                                                checked={draft.includeDeliveryCharge}
                                                onCheckedChange={(includeDeliveryCharge) => updateDraft(draft.level, { includeDeliveryCharge })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor={`commission-notes-${draft.level}`}>{t('salesAgentCommissions.notes')}</Label>
                                        <Textarea
                                            id={`commission-notes-${draft.level}`}
                                            value={draft.notes}
                                            onChange={(event) => updateDraft(draft.level, { notes: event.target.value })}
                                            rows={2}
                                            disabled={isSaving}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>}
                    </section>

                    <section className="space-y-3" aria-labelledby="commission-memberships-heading">
                        <div>
                            <h3 id="commission-memberships-heading" className="font-semibold">{t('salesAgentCommissions.fieldAgentMemberships')}</h3>
                            <p className="text-sm text-muted-foreground">
                                {t('salesAgentCommissions.membershipDescription')}
                            </p>
                        </div>
                        {fieldAgents.length === 0 ? (
                            <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                {t('salesAgentCommissions.noFieldAgents')}
                            </div>
                        ) : (
                            <div className="divide-y overflow-hidden rounded-2xl border">
                                {fieldAgents.map((entry) => (
                                    <div key={entry.agent.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)] sm:items-center">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="truncate font-semibold">{entry.name}</span>
                                                <Badge variant="outline" className={entry.agent.status === 'active'
                                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                                    : 'text-muted-foreground'}
                                                >
                                                    {entry.agent.status === 'active' ? t('salesAgentCommissions.active') : t('salesAgentCommissions.inactive')}
                                                </Badge>
                                            </div>
                                            <div className="mt-1 text-xs text-muted-foreground">{entry.agent.zone}</div>
                                        </div>
                                        <Select
                                            value={membershipSelections[entry.agent.id] || NO_PLAN_VALUE}
                                            onValueChange={(planId) => setMembershipSelections((current) => ({ ...current, [entry.agent.id]: planId }))}
                                            disabled={isSaving}
                                        >
                                            <SelectTrigger><SelectValue placeholder={t('salesAgentCommissions.noCommissionPlan')} /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value={NO_PLAN_VALUE}>{t('salesAgentCommissions.noCommissionPlan')}</SelectItem>
                                                {planDrafts.map((draft) => (
                                                    <SelectItem key={draft.level} value={planToken(draft)} disabled={!draft.isActive}>
                                                        {draft.name || t('salesAgentCommissions.unnamedCommissionLevel')} · {Number(draft.ratePercent) || 0}%
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm">
                            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
                            <div>
                                <div className="font-semibold">{t('salesAgentCommissions.workspaceOnly')}</div>
                                <p className="mt-1 text-muted-foreground">{t('salesAgentCommissions.workspaceOnlyDescription')}</p>
                            </div>
                        </div>
                        <div className="flex gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-4 text-sm">
                            <Truck className="mt-0.5 h-5 w-5 shrink-0 text-sky-700 dark:text-sky-300" />
                            <div>
                                <div className="font-semibold">{t('salesAgentCommissions.postServiceIsOptional')}</div>
                                <p className="mt-1 text-muted-foreground">{t('salesAgentCommissions.postServiceSettingsDescription')}</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
                {onCancel ? (
                    <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
                        {t('salesAgentCommissions.cancel')}
                    </Button>
                ) : null}
                <Button type="submit" disabled={isSaving}>
                    {isSaving ? t('salesAgentCommissions.saving') : t('salesAgentCommissions.saveSettings')}
                </Button>
            </div>
        </form>
    )
}
