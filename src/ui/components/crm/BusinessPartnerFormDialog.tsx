import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth'
import {
    REAL_ESTATE_BUSINESS_PARTNER_ROLES,
    isAgentBusinessPartnerRole,
    isRealEstateBusinessPartnerRole,
    useAgent,
    useAgentExcludedCategories,
    useAgents,
    useCategories,
    usePriceBooks,
    useWorkspaceUsers,
    replaceAgentExcludedCategories,
    type Agent,
    type AgentFacetInput,
    type AgentStatus,
    type AgentType,
    type BusinessPartner,
    type BusinessPartnerRole,
    type CurrencyCode
} from '@/local-db'
import {
    Button,
    Checkbox,
    CurrencySelector,
    Dialog,
    DialogBody,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Textarea,
    useToast
} from '@/ui/components'
import { useWorkspace } from '@/workspace'
import { PartnerLocationField } from '@/ui/components/crm/PartnerLocationField'

type BusinessPartnerFormState = {
    name: string
    contactName: string
    email: string
    phone: string
    address: string
    city: string
    country: string
    defaultCurrency: CurrencyCode
    notes: string
    latitude: number | null
    longitude: number | null
    receivableCreditLimit: string
    payableCreditLimit: string
    priceBookId: string
    role: BusinessPartnerRole
    agentZone: string
    agentType: AgentType
    agentCarModel: string
    agentPlateNumber: string
    agentLinkedUserId: string
    agentStatus: AgentStatus
}

const DEFAULT_ROLE: BusinessPartnerRole = 'both'

function createEmptyState(defaultCurrency: CurrencyCode, role: BusinessPartnerRole): BusinessPartnerFormState {
    return {
        name: '',
        contactName: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        country: '',
        defaultCurrency,
        notes: '',
        latitude: null,
        longitude: null,
        receivableCreditLimit: '',
        payableCreditLimit: '',
        priceBookId: '',
        role,
        agentZone: '',
        agentType: 'field_agent',
        agentCarModel: '',
        agentPlateNumber: '',
        agentLinkedUserId: '',
        agentStatus: 'active'
    }
}

function mapPartnerToState(partner: BusinessPartner, agent?: Agent): BusinessPartnerFormState {
    return {
        name: partner.name,
        contactName: partner.contactName || '',
        email: partner.email || '',
        phone: partner.phone || '',
        address: partner.address || '',
        city: partner.city || '',
        country: partner.country || '',
        defaultCurrency: partner.defaultCurrency,
        notes: partner.notes || '',
        latitude: partner.latitude ?? null,
        longitude: partner.longitude ?? null,
        receivableCreditLimit: partner.receivableCreditLimit === null || partner.receivableCreditLimit === undefined
            ? ''
            : String(partner.receivableCreditLimit),
        payableCreditLimit: partner.payableCreditLimit === null || partner.payableCreditLimit === undefined
            ? ''
            : String(partner.payableCreditLimit),
        priceBookId: partner.priceBookId || '',
        role: partner.role,
        agentZone: agent?.zone || '',
        agentType: agent?.agentType || 'field_agent',
        agentCarModel: agent?.carModel || '',
        agentPlateNumber: agent?.plateNumber || '',
        agentLinkedUserId: agent?.linkedUserId || '',
        agentStatus: agent?.status || 'active'
    }
}

export interface BusinessPartnerFormPayload {
    name: string
    contactName?: string
    email?: string
    phone?: string
    address?: string
    city?: string
    country?: string
    defaultCurrency: CurrencyCode
    notes?: string
    latitude: number | null
    longitude: number | null
    creditLimit: number
    receivableCreditLimit: number | null
    payableCreditLimit: number | null
    priceBookId?: string | null
    role: BusinessPartnerRole
    agent?: AgentFacetInput
}

interface BusinessPartnerFormDialogProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    partner?: BusinessPartner | null
    defaultCurrency: CurrencyCode
    availableCurrencies: CurrencyCode[]
    initialRole?: BusinessPartnerRole
    lockedRole?: BusinessPartnerRole
    enableRealEstateRoles?: boolean
    enableAgentRole?: boolean
    workspaceId?: string
    isSaving?: boolean
    title?: string
    submitLabel?: string
    onSubmit: (payload: BusinessPartnerFormPayload) => void | Promise<void>
}

export function BusinessPartnerFormDialog({
    isOpen,
    onOpenChange,
    partner,
    defaultCurrency,
    availableCurrencies,
    initialRole = DEFAULT_ROLE,
    lockedRole,
    enableRealEstateRoles = false,
    enableAgentRole = false,
    workspaceId,
    isSaving = false,
    title,
    submitLabel,
    onSubmit
}: BusinessPartnerFormDialogProps) {
    const { t } = useTranslation()
    const { user } = useAuth()
    const { features, hasCapability } = useWorkspace()
    const priceBooksEnabled = hasCapability('priceBooks')
    const effectiveWorkspaceId = workspaceId || user?.workspaceId
    const priceBooks = usePriceBooks(effectiveWorkspaceId, { enabled: priceBooksEnabled && isOpen })
    const [formState, setFormState] = useState<BusinessPartnerFormState>(() => createEmptyState(defaultCurrency, lockedRole ?? initialRole))
    const agent = useAgent(partner?.agentFacetId)
    const agents = useAgents(workspaceId)
    const workspaceUsers = useWorkspaceUsers(workspaceId)
    const linkedUserIds = useMemo(
        () => new Set(
            agents
                .filter((candidate) =>
                    candidate.id !== agent?.id
                    && candidate.businessPartnerId !== partner?.id
                    && Boolean(candidate.linkedUserId)
                )
                .map((candidate) => candidate.linkedUserId as string)
        ),
        [agent?.id, agents, partner?.id]
    )
    const sortedPriceBooks = useMemo(
        () => [...priceBooks].sort((left, right) => left.name.localeCompare(right.name)),
        [priceBooks]
    )
    const roleOptions = useMemo<Array<{ value: BusinessPartnerRole; label: string }>>(() => {
        const options: Array<{ value: BusinessPartnerRole; label: string }> = [
            { value: 'both', label: t('businessPartners.roles.both') || 'Both' },
            { value: 'customer', label: t('businessPartners.roles.customer') || 'Customer' },
            { value: 'supplier', label: t('businessPartners.roles.supplier') || 'Supplier' }
        ]

        if (enableRealEstateRoles) {
            const labels = {
                buyer: t('businessPartners.roles.RealEstateBuyer', { defaultValue: 'Buyer' }),
                seller: t('businessPartners.roles.RealEstateSeller', { defaultValue: 'Seller' })
            } satisfies Record<(typeof REAL_ESTATE_BUSINESS_PARTNER_ROLES)[number], string>
            options.push(...REAL_ESTATE_BUSINESS_PARTNER_ROLES.map((role) => ({
                value: role,
                label: labels[role]
            })))
        }

        if (enableAgentRole) {
            options.push({
                value: 'agent',
                label: t('businessPartners.roles.agent', { defaultValue: 'Agent' })
            })
        }

        return options
    }, [enableAgentRole, enableRealEstateRoles, t])

    useEffect(() => {
        if (!isOpen) {
            return
        }

        const nextState =
            partner
                ? mapPartnerToState(partner, agent)
                : createEmptyState(defaultCurrency, initialRole)
        const hasAllowedRole = (enableRealEstateRoles || !isRealEstateBusinessPartnerRole(nextState.role))
            && (enableAgentRole || !isAgentBusinessPartnerRole(nextState.role))

        setFormState({
            ...nextState,
            role: lockedRole ?? (hasAllowedRole ? nextState.role : DEFAULT_ROLE)
        })
    }, [agent, defaultCurrency, enableAgentRole, enableRealEstateRoles, initialRole, isOpen, lockedRole, partner])

    async function handleSubmit(event: FormEvent) {
        event.preventDefault()
        const effectiveRole = lockedRole ?? formState.role
        const isAgent = isAgentBusinessPartnerRole(effectiveRole)
        const receivableCreditLimit = formState.receivableCreditLimit.trim() === ''
            ? null
            : Number(formState.receivableCreditLimit)
        const payableCreditLimit = formState.payableCreditLimit.trim() === ''
            ? null
            : Number(formState.payableCreditLimit)
        await onSubmit({
            name: formState.name.trim(),
            contactName: formState.contactName.trim() || undefined,
            email: formState.email.trim() || undefined,
            phone: formState.phone.trim(),
            address: formState.address.trim(),
            city: formState.city.trim() || undefined,
            country: formState.country.trim() || undefined,
            defaultCurrency: formState.defaultCurrency,
            notes: formState.notes.trim() || undefined,
            latitude: formState.latitude,
            longitude: formState.longitude,
            creditLimit: receivableCreditLimit ?? payableCreditLimit ?? 0,
            receivableCreditLimit,
            payableCreditLimit,
            ...(priceBooksEnabled ? { priceBookId: formState.priceBookId || null } : {}),
            role: effectiveRole,
            agent: isAgent ? {
                zone: formState.agentZone.trim(),
                agentType: formState.agentType,
                carModel: formState.agentType === 'driver' ? formState.agentCarModel.trim() : null,
                plateNumber: formState.agentType === 'driver' ? formState.agentPlateNumber.trim() : null,
                linkedUserId: formState.agentLinkedUserId || null,
                status: formState.agentStatus
            } : undefined
        })
    }

    const isAgentRole = isAgentBusinessPartnerRole(formState.role)
    const lockedRoleLabel = lockedRole
        ? roleOptions.find((role) => role.value === lockedRole)?.label || lockedRole
        : null

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent layout="structured" className="max-w-2xl">
                <DialogHeader layout="structured">
                    <DialogTitle className="text-xl">
                        {title || (partner
                            ? (t('businessPartners.editPartner') || 'Edit Business Partner')
                            : (t('businessPartners.addPartner') || 'Add Business Partner'))}
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <DialogBody>
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="business-partner-name">
                                    {isAgentRole
                                        ? t('businessPartners.agent.name', { defaultValue: 'Agent Name' })
                                        : (t('suppliers.form.name') || 'Company Name')}{' '}
                                    <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    data-tour-id="tutorial-business-partner-name"
                                    id="business-partner-name"
                                    value={formState.name}
                                    onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="business-partner-contact">{t('suppliers.form.contactName') || 'Contact Name'}</Label>
                                <Input
                                    id="business-partner-contact"
                                    value={formState.contactName}
                                    onChange={(event) => setFormState((current) => ({ ...current, contactName: event.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="business-partner-email">{t('customers.form.email') || 'Email'}</Label>
                                <Input
                                    id="business-partner-email"
                                    type="email"
                                    value={formState.email}
                                    onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="business-partner-phone">{t('customers.form.phone') || 'Phone'} <span className="text-destructive">*</span></Label>
                                <Input
                                    data-tour-id="tutorial-business-partner-phone"
                                    id="business-partner-phone"
                                    value={formState.phone}
                                    onChange={(event) => setFormState((current) => ({ ...current, phone: event.target.value }))}
                                    required
                                />
                            </div>
                            {!lockedRole ? (
                                <div className="space-y-2">
                                    <Label>{t('businessPartners.form.role') || 'Role'}</Label>
                                    <Select value={formState.role} onValueChange={(value) => setFormState((current) => ({ ...current, role: value as BusinessPartnerRole }))}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {roleOptions.map((role) => (
                                                <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : (
                                <div className="space-y-2" data-tour-id="tutorial-business-partner-role-locked">
                                    <Label>{t('businessPartners.form.role') || 'Role'}</Label>
                                    <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-bold text-primary">
                                        {lockedRoleLabel}
                                    </div>
                                </div>
                            )}
                            {priceBooksEnabled ? (
                                <div className="space-y-2">
                                    <Label>{t('priceBooks.partnerField', { defaultValue: 'Price Book' })}</Label>
                                    <Select
                                        value={formState.priceBookId || 'none'}
                                        onValueChange={(value) => setFormState((current) => ({
                                            ...current,
                                            priceBookId: value === 'none' ? '' : value
                                        }))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder={t('priceBooks.partnerPlaceholder', { defaultValue: 'No Price Book' })} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">
                                                {t('priceBooks.none', { defaultValue: 'No Price Book' })}
                                            </SelectItem>
                                            {formState.priceBookId && !sortedPriceBooks.some((priceBook) => priceBook.id === formState.priceBookId) ? (
                                                <SelectItem value={formState.priceBookId} disabled>
                                                    {t('priceBooks.unavailable', { defaultValue: 'Unavailable Price Book' })}
                                                </SelectItem>
                                            ) : null}
                                            {sortedPriceBooks.map((priceBook) => (
                                                <SelectItem key={priceBook.id} value={priceBook.id}>
                                                    {priceBook.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        {sortedPriceBooks.length > 0
                                            ? t('priceBooks.partnerHint', {
                                                defaultValue: 'New order lines for this partner will use matching custom product prices.'
                                            })
                                            : t('priceBooks.partnerEmptyHint', {
                                                defaultValue: 'No Price Books are available yet. Create one from Products.'
                                            })}
                                    </p>
                                </div>
                            ) : null}
                            {isAgentRole ? (
                                <>
                                    <div className="space-y-2">
                                        <Label htmlFor="business-partner-agent-zone">
                                            {t('businessPartners.agent.zone', { defaultValue: 'Operational Territory' })}{' '}
                                            <span className="text-destructive">*</span>
                                        </Label>
                                        <Input
                                            id="business-partner-agent-zone"
                                            value={formState.agentZone}
                                            onChange={(event) => setFormState((current) => ({ ...current, agentZone: event.target.value }))}
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t('businessPartners.agent.type', { defaultValue: 'Agent Type' })}</Label>
                                        <Select value={formState.agentType} onValueChange={(value) => setFormState((current) => ({ ...current, agentType: value as AgentType }))}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="driver">{t('businessPartners.agent.types.driver', { defaultValue: 'Driver' })}</SelectItem>
                                                <SelectItem value="field_agent">{t('businessPartners.agent.types.fieldAgent', { defaultValue: 'Field Agent' })}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {formState.agentType === 'driver' ? (
                                        <>
                                            <div className="space-y-2">
                                                <Label htmlFor="business-partner-agent-car-model">
                                                    {t('businessPartners.agent.carModel', { defaultValue: 'Car Model' })}{' '}
                                                    <span className="text-destructive">*</span>
                                                </Label>
                                                <Input
                                                    id="business-partner-agent-car-model"
                                                    value={formState.agentCarModel}
                                                    onChange={(event) => setFormState((current) => ({ ...current, agentCarModel: event.target.value }))}
                                                    required
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="business-partner-agent-plate-number">
                                                    {t('businessPartners.agent.plateNumber', { defaultValue: 'Plate Number' })}{' '}
                                                    <span className="text-destructive">*</span>
                                                </Label>
                                                <Input
                                                    id="business-partner-agent-plate-number"
                                                    value={formState.agentPlateNumber}
                                                    onChange={(event) => setFormState((current) => ({ ...current, agentPlateNumber: event.target.value }))}
                                                    required
                                                />
                                            </div>
                                        </>
                                    ) : null}
                                    <div className="space-y-2">
                                        <Label>{t('businessPartners.agent.linkedUser', { defaultValue: 'Workspace User' })}</Label>
                                        <Select
                                            value={formState.agentLinkedUserId || 'unlinked'}
                                            onValueChange={(value) => setFormState((current) => ({
                                                ...current,
                                                agentLinkedUserId: value === 'unlinked' ? '' : value
                                            }))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="unlinked">{t('businessPartners.agent.noLinkedUser', { defaultValue: 'Not linked' })}</SelectItem>
                                                {workspaceUsers.map((workspaceUser) => {
                                                    const isLinkedElsewhere = linkedUserIds.has(workspaceUser.id)
                                                    return (
                                                        <SelectItem
                                                            key={workspaceUser.id}
                                                            value={workspaceUser.id}
                                                            disabled={isLinkedElsewhere}
                                                        >
                                                            {workspaceUser.name || workspaceUser.email || workspaceUser.id}
                                                            {isLinkedElsewhere
                                                                ? ` (${t('businessPartners.agent.alreadyLinked', { defaultValue: 'Already linked' })})`
                                                                : ''}
                                                        </SelectItem>
                                                    )
                                                })}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t('businessPartners.agent.status', { defaultValue: 'Operational Status' })}</Label>
                                        <Select value={formState.agentStatus} onValueChange={(value) => setFormState((current) => ({ ...current, agentStatus: value as AgentStatus }))}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="active">{t('businessPartners.agent.statuses.active', { defaultValue: 'Active' })}</SelectItem>
                                                <SelectItem value="inactive">{t('businessPartners.agent.statuses.inactive', { defaultValue: 'Inactive' })}</SelectItem>
                                                <SelectItem value="blocked">{t('businessPartners.agent.statuses.blocked', { defaultValue: 'Blocked' })}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <AgentExcludedCategoriesButton
                                            agent={agent}
                                            workspaceId={effectiveWorkspaceId}
                                        />
                                    </div>
                                </>
                            ) : null}
                            <div className="space-y-2" data-tour-id="tutorial-business-partner-currency">
                                <CurrencySelector
                                    value={formState.defaultCurrency}
                                    onChange={(value) => setFormState((current) => ({ ...current, defaultCurrency: value }))}
                                    label={t('customers.form.defaultCurrency') || 'Default Currency'}
                                    iqdDisplayPreference={features.iqd_display_preference}
                                    allowedCurrencies={availableCurrencies}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="business-partner-city">{t('customers.form.city') || 'City'}</Label>
                                <Input
                                    id="business-partner-city"
                                    value={formState.city}
                                    onChange={(event) => setFormState((current) => ({ ...current, city: event.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="business-partner-country">{t('customers.form.country') || 'Country'}</Label>
                                <Input
                                    id="business-partner-country"
                                    value={formState.country}
                                    onChange={(event) => setFormState((current) => ({ ...current, country: event.target.value }))}
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label htmlFor="business-partner-address">{t('customers.form.address') || 'Address'} <span className="text-destructive">*</span></Label>
                                <Input
                                    data-tour-id="tutorial-business-partner-address"
                                    id="business-partner-address"
                                    value={formState.address}
                                    onChange={(event) => setFormState((current) => ({ ...current, address: event.target.value }))}
                                    required
                                />
                            </div>
                            {formState.role === 'customer' || formState.role === 'both' ? <div className="space-y-2">
                                <Label htmlFor="business-partner-receivable-limit">{t('businessPartners.receivableCreditLimit', { defaultValue: 'Receivable credit limit' })}</Label>
                                <Input
                                    id="business-partner-receivable-limit"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder={t('businessPartners.unlimited', { defaultValue: 'Blank means unlimited' })}
                                    value={formState.receivableCreditLimit}
                                    onChange={(event) => setFormState((current) => ({ ...current, receivableCreditLimit: event.target.value }))}
                                />
                            </div> : null}
                            {formState.role === 'supplier' || formState.role === 'both' ? <div className="space-y-2">
                                <Label htmlFor="business-partner-payable-limit">{t('businessPartners.payableCreditLimit', { defaultValue: 'Payable credit limit' })}</Label>
                                <Input
                                    id="business-partner-payable-limit"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder={t('businessPartners.unlimited', { defaultValue: 'Blank means unlimited' })}
                                    value={formState.payableCreditLimit}
                                    onChange={(event) => setFormState((current) => ({ ...current, payableCreditLimit: event.target.value }))}
                                />
                            </div> : null}
                            <PartnerLocationField
                                latitude={formState.latitude}
                                longitude={formState.longitude}
                                onChange={(latitude, longitude) => setFormState((current) => ({ ...current, latitude, longitude }))}
                            />
                            <div className="space-y-2 md:col-span-2">
                                <Label htmlFor="business-partner-notes">{t('customers.form.notes') || 'Notes'}</Label>
                                <Textarea
                                    id="business-partner-notes"
                                    rows={4}
                                    value={formState.notes}
                                    onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
                                />
                            </div>
                        </div>
                    </DialogBody>

                    <DialogFooter layout="structured">
                        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
                            {t('common.cancel') || 'Cancel'}
                        </Button>
                        <Button type="submit" className="w-full sm:w-auto" disabled={isSaving} data-tour-id="tutorial-business-partner-save">
                            {isSaving
                                ? (t('common.loading') || 'Loading...')
                                : (submitLabel || (partner ? (t('common.save') || 'Save') : (t('common.create') || 'Create')))}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function AgentExcludedCategoriesButton({
    agent,
    workspaceId
}: {
    agent?: Agent
    workspaceId?: string
}) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const categories = useCategories(workspaceId)
    const exclusions = useAgentExcludedCategories(workspaceId, agent?.id)
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set())
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        if (!open) {
            setSearch('')
            return
        }

        setSelectedCategoryIds(new Set(exclusions.map((exclusion) => exclusion.categoryId)))
    }, [exclusions, open])

    const visibleCategories = useMemo(() => {
        const normalizedSearch = search.trim().toLocaleLowerCase()
        return categories
            .filter((category) => !normalizedSearch || category.name.toLocaleLowerCase().includes(normalizedSearch))
            .sort((left, right) => left.name.localeCompare(right.name))
    }, [categories, search])

    const toggleCategory = (categoryId: string, checked: boolean) => {
        setSelectedCategoryIds((current) => {
            const next = new Set(current)
            if (checked) {
                next.add(categoryId)
            } else {
                next.delete(categoryId)
            }
            return next
        })
    }

    const save = async () => {
        if (!agent || !workspaceId) {
            return
        }

        setIsSaving(true)
        try {
            await replaceAgentExcludedCategories(workspaceId, agent.id, [...selectedCategoryIds])
            setOpen(false)
        } catch (error) {
            toast({
                variant: 'destructive',
                title: t('messages.error', { defaultValue: 'Unable to save excluded categories' }),
                description: error instanceof Error ? error.message : String(error)
            })
        } finally {
            setIsSaving(false)
        }
    }

    const exclusionCount = exclusions.length
    const canConfigure = Boolean(agent && workspaceId)

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
                <div className="space-y-0.5">
                    <Label>{t('businessPartners.agent.excludedCategories', { defaultValue: 'Excluded product categories' })}</Label>
                    <p className="text-xs text-muted-foreground">
                        {t('businessPartners.agent.excludedCategoriesDescription', {
                            defaultValue: 'The linked user can view these products but cannot select or sell them.'
                        })}
                    </p>
                </div>
                <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={!canConfigure}>
                    {t('businessPartners.agent.manageExcludedCategories', { defaultValue: 'Excluded categories' })}
                    {exclusionCount > 0 ? ` (${exclusionCount})` : ''}
                </Button>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{t('businessPartners.agent.excludedCategories', { defaultValue: 'Excluded product categories' })}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            {t('businessPartners.agent.excludedCategoriesModalDescription', {
                                defaultValue: 'Select categories this agent\'s linked user cannot select or sell. Products remain visible elsewhere.'
                            })}
                        </p>
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('common.search', { defaultValue: 'Search categories...' })}
                        />
                        <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-2">
                            {visibleCategories.length > 0 ? visibleCategories.map((category) => {
                                const checked = selectedCategoryIds.has(category.id)
                                return (
                                    <label key={category.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/70">
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(nextChecked) => toggleCategory(category.id, Boolean(nextChecked))}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{category.name}</span>
                                    </label>
                                )
                            }) : (
                                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                                    {t('categories.noCategories', { defaultValue: 'No categories found.' })}
                                </p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
                            {t('common.cancel', { defaultValue: 'Cancel' })}
                        </Button>
                        <Button type="button" onClick={() => void save()} disabled={isSaving}>
                            {isSaving ? t('common.loading', { defaultValue: 'Saving...' }) : t('common.save', { defaultValue: 'Save' })}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
