import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
    REAL_ESTATE_BUSINESS_PARTNER_ROLES,
    isAgentBusinessPartnerRole,
    isRealEstateBusinessPartnerRole,
    useAgent,
    useAgents,
    useWorkspaceUsers,
    type Agent,
    type AgentFacetInput,
    type AgentStatus,
    type AgentType,
    type BusinessPartner,
    type BusinessPartnerRole,
    type CurrencyCode
} from '@/local-db'
import { platformService } from '@/services/platformService'
import {
    Button,
    CurrencySelector,
    Dialog,
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
    Textarea
} from '@/ui/components'
import { useWorkspace } from '@/workspace'

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
    receivableCreditLimit: string
    payableCreditLimit: string
    role: BusinessPartnerRole
    agentImageUrl: string
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
        receivableCreditLimit: '',
        payableCreditLimit: '',
        role,
        agentImageUrl: '',
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
        receivableCreditLimit: partner.receivableCreditLimit === null || partner.receivableCreditLimit === undefined
            ? ''
            : String(partner.receivableCreditLimit),
        payableCreditLimit: partner.payableCreditLimit === null || partner.payableCreditLimit === undefined
            ? ''
            : String(partner.payableCreditLimit),
        role: partner.role,
        agentImageUrl: agent?.imageUrl || '',
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
    creditLimit: number
    receivableCreditLimit: number | null
    payableCreditLimit: number | null
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
    const { features } = useWorkspace()
    const [formState, setFormState] = useState<BusinessPartnerFormState>(() => createEmptyState(defaultCurrency, lockedRole ?? initialRole))
    const [isUploadingAgentImage, setIsUploadingAgentImage] = useState(false)
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
    const roleOptions = useMemo<Array<{ value: BusinessPartnerRole; label: string }>>(() => {
        const options: Array<{ value: BusinessPartnerRole; label: string }> = [
            { value: 'both', label: t('businessPartners.roles.both') || 'Both' },
            { value: 'customer', label: t('customers.title') || 'Customer' },
            { value: 'supplier', label: t('suppliers.title') || 'Supplier' }
        ]

        if (enableRealEstateRoles) {
            const labels = {
                buyer: t('businessPartners.roles.buyer', { defaultValue: 'Buyer' }),
                seller: t('businessPartners.roles.seller', { defaultValue: 'Seller' })
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

    async function handleAgentImageUpload() {
        if (!workspaceId || isUploadingAgentImage) {
            return
        }

        setIsUploadingAgentImage(true)
        try {
            const imageUrl = await platformService.pickAndSaveImage(workspaceId, 'agents-images')
            if (imageUrl) {
                setFormState((current) => ({ ...current, agentImageUrl: imageUrl }))
            }
        } finally {
            setIsUploadingAgentImage(false)
        }
    }

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
            creditLimit: receivableCreditLimit ?? payableCreditLimit ?? 0,
            receivableCreditLimit,
            payableCreditLimit,
            role: effectiveRole,
            agent: isAgent ? {
                imageUrl: formState.agentImageUrl.trim() || null,
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
            <DialogContent className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)] flex max-h-[calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-0.75rem)] w-[calc(100vw-0.75rem)] max-w-2xl flex-col overflow-hidden rounded-[1.25rem] border-border/60 p-0 sm:w-full sm:max-h-[min(calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-2rem),820px)] sm:rounded-[1.75rem]">
                <DialogHeader className="border-b bg-muted/30 px-4 py-4 pr-14 text-start sm:px-6 sm:py-5">
                    <DialogTitle className="text-xl">
                        {title || (partner
                            ? (t('businessPartners.editPartner') || 'Edit Business Partner')
                            : (t('businessPartners.addPartner') || 'Add Business Partner'))}
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
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
                            {isAgentRole ? (
                                <>
                                    <div className="space-y-2 md:col-span-2">
                                        <Label>{t('businessPartners.agent.image', { defaultValue: 'Profile Picture' })}</Label>
                                        <div className="flex flex-col gap-4 rounded-2xl border bg-muted/20 p-4 sm:flex-row sm:items-center">
                                            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-background">
                                                {formState.agentImageUrl ? (
                                                    <img
                                                        src={platformService.convertFileSrc(formState.agentImageUrl)}
                                                        alt={formState.name || t('businessPartners.agent.image', { defaultValue: 'Agent profile' })}
                                                        className="h-full w-full object-cover"
                                                    />
                                                ) : (
                                                    <ImagePlus className="h-8 w-8 text-muted-foreground" />
                                                )}
                                            </div>
                                            <div className="flex flex-1 flex-wrap gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleAgentImageUpload}
                                                    disabled={!workspaceId || isUploadingAgentImage}
                                                    className="gap-2"
                                                >
                                                    <ImagePlus className="h-4 w-4" />
                                                    {isUploadingAgentImage
                                                        ? t('common.loading', { defaultValue: 'Loading...' })
                                                        : t('businessPartners.agent.uploadImage', { defaultValue: 'Upload Image' })}
                                                </Button>
                                                {formState.agentImageUrl ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        onClick={() => setFormState((current) => ({ ...current, agentImageUrl: '' }))}
                                                        className="gap-2 text-destructive"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                        {t('common.delete', { defaultValue: 'Remove' })}
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
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
                    </div>

                    <DialogFooter className="border-t bg-muted/20 px-4 py-4 pb-[calc(1rem+var(--safe-area-bottom))] sm:justify-between sm:px-6">
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
