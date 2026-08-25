import { useEffect, useMemo, useState } from 'react'
import { BadgePercent, ShieldCheck, Truck } from 'lucide-react'
import { formatLocalDateValue, parseLocalDateValue } from '@/lib/utils'

import {
    createAgentCommissionPlan,
    setAgentCommissionMembership,
    updateAgentCommissionPlan,
    type AgentCommissionPlan,
    type CommissionCalculationBasis,
    type CommissionPlanLevel
} from '@/local-db'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogDescription,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
    Badge,
    Button,
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
import {
    COMMISSION_LEVELS,
    getCommissionLevelLabel,
    getCurrentCommissionPlanRevision
} from './agentCommissionPresentation'
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

const DEFAULT_RATES: Record<CommissionPlanLevel, number> = {
    level_1: 5,
    level_2: 7.5,
    level_3: 10
}

function dateInputValue(value?: string | null) {
    return formatLocalDateValue(value)
}

function createPlanDraft(level: CommissionPlanLevel, plan?: AgentCommissionPlan): PlanDraft {
    return {
        id: plan?.id,
        level,
        name: plan?.name || getCommissionLevelLabel(level),
        ratePercent: String(plan?.ratePercent ?? DEFAULT_RATES[level]),
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
    return draft.id || `new:${draft.level}`
}

interface AgentCommissionSettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    userId?: string | null
}

export function AgentCommissionSettingsDialog({
    open,
    onOpenChange,
    workspaceId,
    userId
}: AgentCommissionSettingsDialogProps) {
    const { toast } = useToast()
    const directory = useCommissionAgentDirectory(open ? workspaceId : undefined)
    const [planDrafts, setPlanDrafts] = useState<PlanDraft[]>(() => COMMISSION_LEVELS.map((level) => createPlanDraft(level)))
    const [membershipSelections, setMembershipSelections] = useState<Record<string, string>>({})
    const [isSaving, setIsSaving] = useState(false)
    const fieldAgents = useMemo(
        () => directory.agents.filter((entry) => entry.agent.agentType === 'field_agent'),
        [directory.agents]
    )

    useEffect(() => {
        if (!open) return
        const nextDrafts = COMMISSION_LEVELS.map((level) => createPlanDraft(
            level,
            getCurrentCommissionPlanRevision(directory.plans, level)
        ))
        setPlanDrafts(nextDrafts)
        setMembershipSelections(Object.fromEntries(fieldAgents.map((entry) => [
            entry.agent.id,
            entry.membership?.planId || NO_PLAN_VALUE
        ])))
    }, [directory.plans, fieldAgents, open])

    function updateDraft(level: CommissionPlanLevel, patch: Partial<PlanDraft>) {
        setPlanDrafts((current) => current.map((draft) => draft.level === level ? { ...draft, ...patch } : draft))
    }

    async function handleSave() {
        const invalidDraft = planDrafts.find((draft) => !draft.name.trim() || !Number.isFinite(Number(draft.ratePercent)) || Number(draft.ratePercent) < 0 || Number(draft.ratePercent) > 100)
        if (invalidDraft) {
            toast({
                title: 'Check commission plans',
                description: `${getCommissionLevelLabel(invalidDraft.level)} needs a name and a rate between 0% and 100%.`,
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

            toast({ title: 'Commission settings saved' })
            onOpenChange(false)
        } catch (error: any) {
            toast({
                title: 'Could not save commission settings',
                description: error?.message || 'Try again.',
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
            <AppDialogContent className="max-w-5xl">
                <AppDialogHeader>
                    <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-violet-500/10 p-2 text-violet-700 dark:text-violet-300">
                            <BadgePercent className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                            <AppDialogTitle>Sales agent commission settings</AppDialogTitle>
                            <AppDialogDescription>
                                Configure three workspace-only plans, then optionally assign a plan to each field agent.
                            </AppDialogDescription>
                        </div>
                    </div>
                </AppDialogHeader>

                <AppDialogBody className="space-y-6">
                    <section className="space-y-3" aria-labelledby="commission-plans-heading">
                        <div>
                            <h3 id="commission-plans-heading" className="font-semibold">Commission plans</h3>
                            <p className="text-sm text-muted-foreground">
                                Rates are examples until you save them. Net profit excludes tax and delivery unless explicitly included.
                                Once a plan has been used, financial or effective-date changes create a new effective-dated revision.
                                Prior revisions and accrued ledger amounts stay frozen; changes apply only to future or otherwise unaccrued orders.
                            </p>
                        </div>
                        <div className="grid gap-4 xl:grid-cols-3">
                            {planDrafts.map((draft) => (
                                <div key={draft.level} className="space-y-4 rounded-2xl border bg-muted/15 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                                            {getCommissionLevelLabel(draft.level)}
                                        </Badge>
                                        <div className="flex items-center gap-2">
                                            <Label htmlFor={`commission-active-${draft.level}`} className="text-xs">Active</Label>
                                            <Switch
                                                id={`commission-active-${draft.level}`}
                                                checked={draft.isActive}
                                                onCheckedChange={(isActive) => updateDraft(draft.level, { isActive })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor={`commission-name-${draft.level}`}>Plan name</Label>
                                        <Input
                                            id={`commission-name-${draft.level}`}
                                            value={draft.name}
                                            onChange={(event) => updateDraft(draft.level, { name: event.target.value })}
                                            disabled={isSaving}
                                        />
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor={`commission-rate-${draft.level}`}>Rate %</Label>
                                            <Input
                                                id={`commission-rate-${draft.level}`}
                                                type="number"
                                                min="0"
                                                max="100"
                                                step="0.01"
                                                inputMode="decimal"
                                                value={draft.ratePercent}
                                                onChange={(event) => updateDraft(draft.level, { ratePercent: event.target.value })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Basis</Label>
                                            <Select
                                                value={draft.calculationBasis}
                                                onValueChange={(calculationBasis) => updateDraft(draft.level, { calculationBasis: calculationBasis as CommissionCalculationBasis })}
                                                disabled={isSaving}
                                            >
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="net_profit">Net profit</SelectItem>
                                                    <SelectItem value="net_revenue">Net revenue</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor={`commission-start-${draft.level}`}>Effective from</Label>
                                            <DateTimePicker
                                                id={`commission-start-${draft.level}`}
                                                mode="date"
                                                date={parseLocalDateValue(draft.effectiveFrom)}
                                                setDate={(date) => date && updateDraft(draft.level, { effectiveFrom: formatLocalDateValue(date) })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor={`commission-end-${draft.level}`}>Effective to</Label>
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
                                            <Label htmlFor={`commission-tax-${draft.level}`} className="text-sm">Include tax</Label>
                                            <Switch
                                                id={`commission-tax-${draft.level}`}
                                                checked={draft.includeTax}
                                                onCheckedChange={(includeTax) => updateDraft(draft.level, { includeTax })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <Label htmlFor={`commission-delivery-${draft.level}`} className="text-sm">Include customer delivery charge</Label>
                                            <Switch
                                                id={`commission-delivery-${draft.level}`}
                                                checked={draft.includeDeliveryCharge}
                                                onCheckedChange={(includeDeliveryCharge) => updateDraft(draft.level, { includeDeliveryCharge })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor={`commission-notes-${draft.level}`}>Notes</Label>
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
                        </div>
                    </section>

                    <section className="space-y-3" aria-labelledby="commission-memberships-heading">
                        <div>
                            <h3 id="commission-memberships-heading" className="font-semibold">Field-agent memberships</h3>
                            <p className="text-sm text-muted-foreground">
                                Commission level is optional and does not create a new agent type.
                            </p>
                        </div>
                        {fieldAgents.length === 0 ? (
                            <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                Add a field agent to assign a commission plan.
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
                                                    {entry.agent.status}
                                                </Badge>
                                            </div>
                                            <div className="mt-1 text-xs text-muted-foreground">{entry.agent.zone}</div>
                                        </div>
                                        <Select
                                            value={membershipSelections[entry.agent.id] || NO_PLAN_VALUE}
                                            onValueChange={(planId) => setMembershipSelections((current) => ({ ...current, [entry.agent.id]: planId }))}
                                            disabled={isSaving}
                                        >
                                            <SelectTrigger><SelectValue placeholder="No commission plan" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value={NO_PLAN_VALUE}>No commission plan</SelectItem>
                                                {planDrafts.map((draft) => (
                                                    <SelectItem key={draft.level} value={planToken(draft)} disabled={!draft.isActive}>
                                                        {draft.name || getCommissionLevelLabel(draft.level)} · {Number(draft.ratePercent) || 0}%
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
                                <div className="font-semibold">Workspace-only feature</div>
                                <p className="mt-1 text-muted-foreground">When access is disabled, orders and agents keep their existing behavior.</p>
                            </div>
                        </div>
                        <div className="flex gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-4 text-sm">
                            <Truck className="mt-0.5 h-5 w-5 shrink-0 text-sky-700 dark:text-sky-300" />
                            <div>
                                <div className="font-semibold">Post Service is optional</div>
                                <p className="mt-1 text-muted-foreground">Sales-agent credit and customer delivery snapshots work directly from Sales Orders.</p>
                            </div>
                        </div>
                    </div>
                </AppDialogBody>

                <AppDialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
                        {isSaving ? 'Saving…' : 'Save commission settings'}
                    </Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}
