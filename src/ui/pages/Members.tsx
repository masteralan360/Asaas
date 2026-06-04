import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
    Select,
    SelectContent,
    SelectGroup,
    SelectLabel,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch
} from '@/ui/components'
import { UsersRound, UserMinus, Loader2, Shield, Eye, Briefcase, UserRound, KeyRound, ShieldCheck } from 'lucide-react'
import { ProfileCardModal } from '@/ui/components/ProfileCardModal'
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/lib/utils'
import { platformService } from '@/services/platformService'
import { getRetriableActionToast, isRetriableWebRequestError, normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import { invokeWorkspaceAccess } from '@/lib/workspaceAccess'
import { useWorkspace } from '@/workspace'
import {
    WORKSPACE_PERMISSION_DEFINITIONS,
    getWorkspacePermissionModule,
    isSupportedWorkspacePermissionKey,
    type WorkspacePermissionKey
} from '@/permissions'
import { launcherSections, launcherSectionOrder } from '@/ui/navigation/navigationMeta'
import type { PlanModuleKey } from '@/plans/workspacePlans'

interface Member {
    id: string
    name: string
    role: string
    profile_url?: string
    created_at: string
}

interface WorkspacePermission {
    id: string
    workspace_id: string
    user_uuid: string
    key: string
    module: string
}

const roleIcons: Record<string, typeof Shield> = {
    admin: Shield,
    staff: Briefcase,
    viewer: Eye
}

const roleColors: Record<string, string> = {
    admin: 'bg-purple-500/10 text-purple-500',
    staff: 'bg-blue-500/10 text-blue-500',
    viewer: 'bg-slate-500/10 text-slate-500'
}

type WorkspacePermissionDefinition = typeof WORKSPACE_PERMISSION_DEFINITIONS[number]
type WorkspacePermissionModule = WorkspacePermissionDefinition['module']

const PERMISSION_MODULE_PLAN_MODULES: Partial<Record<WorkspacePermissionModule, PlanModuleKey>> = {
    payment: 'payments',
    directTransaction: 'direct_transactions',
    businessPartners: 'business_partners',
    customers: 'customers',
    suppliers: 'suppliers',
    orders: 'orders',
    ecommerce: 'ecommerce',
    accounting: 'accounting',
    invoiceHistory: 'invoice_history',
    loans: 'loans',
    realEstate: 'real_estate',
    currencyExchange: 'currency_exchange',
    currencyExchangeFeeRules: 'currency_exchange',
    travelAgency: 'travel_agency',
    installments: 'installments',
    ledger: 'ledger',
    stockAdjustments: 'stock_adjustments',
    inventoryTransactions: 'inventory_transactions',
    inventoryTransfer: 'inventory_transfer',
    storages: 'storages',
    discounts: 'discounts',
    revenueAnalytics: 'revenue_analytics',
    teamPerformance: 'team_performance',
    hr: 'hr'
}

export function Members() {
    const { user, session } = useAuth()
    const { hasCapability, planCapabilities } = useWorkspace()
    const { t } = useTranslation()
    const [members, setMembers] = useState<Member[]>([])
    const [permissions, setPermissions] = useState<WorkspacePermission[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [permissionsLoading, setPermissionsLoading] = useState(false)
    const [kickingMemberId, setKickingMemberId] = useState<string | null>(null)
    const [permissionMutationKey, setPermissionMutationKey] = useState<string | null>(null)
    const [memberToKick, setMemberToKick] = useState<Member | null>(null)
    const [permissionMember, setPermissionMember] = useState<Member | null>(null)
    const [selectedPermissionModule, setSelectedPermissionModule] = useState<string>('global')
    const [profileUserId, setProfileUserId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const canManageWorkspacePermissions = hasCapability('workspaceManagementPermissions')

    const getErrorMessage = (err: unknown) => {
        const normalized = normalizeSupabaseActionError(err)
        if (isRetriableWebRequestError(normalized)) {
            return getRetriableActionToast(normalized).description
        }
        return normalized.message || t('common.error')
    }

    const fetchPermissions = async () => {
        if (user?.role !== 'admin' || !user?.workspaceId || !canManageWorkspacePermissions) {
            setPermissions([])
            return
        }

        setPermissionsLoading(true)
        try {
            const { data, error } = await runSupabaseAction('members.permissions.fetch', () =>
                supabase
                    .from('workspace_permissions')
                    .select('id, workspace_id, user_uuid, key, module')
                    .eq('workspace_id', user.workspaceId)
                    .order('module', { ascending: true })
            )

            if (error) throw normalizeSupabaseActionError(error)
            setPermissions((data || []) as WorkspacePermission[])
        } catch (err) {
            console.error('Error fetching member permissions:', err)
            setError(getErrorMessage(err))
        } finally {
            setPermissionsLoading(false)
        }
    }

    const fetchMembers = async () => {
        if (!user?.workspaceId) return

        setIsLoading(true)
        setError(null)
        try {
            const { data, error } = await runSupabaseAction('members.fetch', () =>
                supabase
                    .from('profiles')
                    .select('id, name, role, created_at, profile_url')
                    .eq('workspace_id', user.workspaceId)
                    .order('created_at', { ascending: true })
            )

            if (error) throw normalizeSupabaseActionError(error)
            setMembers(data || [])
            if (user.role === 'admin') {
                await fetchPermissions()
            } else {
                setPermissions([])
            }
        } catch (err) {
            console.error('Error fetching members:', err)
            setError(getErrorMessage(err))
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchMembers()
    }, [canManageWorkspacePermissions, user?.workspaceId, user?.role])

    const permissionsByUserId = useMemo(() => {
        const next = new Map<string, Set<WorkspacePermissionKey>>()

        permissions.forEach((permission) => {
            if (!isSupportedWorkspacePermissionKey(permission.key)) {
                return
            }

            const existing = next.get(permission.user_uuid) || new Set<WorkspacePermissionKey>()
            existing.add(permission.key)
            next.set(permission.user_uuid, existing)
        })

        return next
    }, [permissions])

    const handlePermissionToggle = async (
        member: Member,
        permissionKey: WorkspacePermissionKey,
        shouldGrant: boolean
    ) => {
        if (user?.role !== 'admin' || !user.workspaceId || member.role === 'admin' || !canManageWorkspacePermissions) {
            return
        }

        const mutationKey = `${member.id}:${permissionKey}`
        setPermissionMutationKey(mutationKey)
        setError(null)

        try {
            if (shouldGrant) {
                const payload = {
                    workspace_id: user.workspaceId,
                    user_uuid: member.id,
                    key: permissionKey,
                    module: getWorkspacePermissionModule(permissionKey)
                }

                const { error } = await runSupabaseAction('members.permissions.grant', () =>
                    supabase
                        .from('workspace_permissions')
                        .upsert(payload, { onConflict: 'workspace_id,user_uuid,key' })
                )

                if (error) throw normalizeSupabaseActionError(error)
            } else {
                const { error } = await runSupabaseAction('members.permissions.revoke', () =>
                    supabase
                        .from('workspace_permissions')
                        .delete()
                        .eq('workspace_id', user.workspaceId)
                        .eq('user_uuid', member.id)
                        .eq('key', permissionKey)
                )

                if (error) throw normalizeSupabaseActionError(error)
            }

            await fetchPermissions()
            window.dispatchEvent(new CustomEvent('workspace-permissions:changed'))
        } catch (err) {
            console.error('Error updating member permission:', err)
            setError(getErrorMessage(err))
        } finally {
            setPermissionMutationKey(null)
        }
    }

    const visiblePermissionDefinitions = useMemo(() => {
        const availableModules = new Set(planCapabilities.modules)
        return WORKSPACE_PERMISSION_DEFINITIONS.filter((permission) => {
            if (permission.module === 'global') return true
            if (permission.module === 'installments' && availableModules.has('real_estate')) return true
            const planModule = PERMISSION_MODULE_PLAN_MODULES[permission.module]
            return planModule ? availableModules.has(planModule) : false
        })
    }, [planCapabilities.modules])

    const selectedModulePermissions = useMemo(() => (
        visiblePermissionDefinitions.filter((permission) => permission.module === selectedPermissionModule)
    ), [selectedPermissionModule, visiblePermissionDefinitions])

    const selectedMemberPermissionKeys = permissionMember
        ? permissionsByUserId.get(permissionMember.id) || new Set<WorkspacePermissionKey>()
        : new Set<WorkspacePermissionKey>()

    const groupedPermissions = useMemo(() => {
        const groups: Record<string, typeof WORKSPACE_PERMISSION_DEFINITIONS[number][]> = {}
        visiblePermissionDefinitions.forEach((permission) => {
            const section = permission.section || 'other'
            if (!groups[section]) groups[section] = []
            groups[section].push(permission)
        })
        return groups
    }, [visiblePermissionDefinitions])

    useEffect(() => {
        if (!permissionMember) return
        if (visiblePermissionDefinitions.some((permission) => permission.module === selectedPermissionModule)) return
        setSelectedPermissionModule('global')
    }, [permissionMember, selectedPermissionModule, visiblePermissionDefinitions])

    const openPermissionModal = (member: Member) => {
        if (member.role === 'admin' || !canManageWorkspacePermissions) return
        setSelectedPermissionModule('global')
        setPermissionMember(member)
    }

    const handleKick = async () => {
        if (!memberToKick) return

        setKickingMemberId(memberToKick.id)
        setError(null)

        try {
            const { error } = await invokeWorkspaceAccess({
                label: 'members.kick',
                fallbackAccessToken: session?.access_token,
                timeoutMs: 12000,
                body: {
                    action: 'kick',
                    targetUserId: memberToKick.id
                }
            })

            if (error) throw normalizeSupabaseActionError(error)

            // Remove member from local state
            setMembers(prev => prev.filter(m => m.id !== memberToKick.id))
            setMemberToKick(null)
        } catch (err: any) {
            console.error('Error kicking member:', err)
            setError(getErrorMessage(err))
        } finally {
            setKickingMemberId(null)
        }
    }

    const canKick = (member: Member) => {
        // Can't kick yourself
        if (member.id === user?.id) return false
        // Can't kick admins
        if (member.role === 'admin') return false
        // Only admins can kick
        return user?.role === 'admin'
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <UsersRound className="w-6 h-6 text-primary" />
                        {t('members.title')}
                    </h1>
                    <p className="text-muted-foreground">
                        {members.length} {t('members.subtitle')}
                    </p>
                </div>
            </div>

            {/* Error Alert */}
            {error && (
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
                    {error}
                </div>
            )}

            {/* Members Table */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('members.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : members.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {t('common.noData')}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-start">{t('members.table.name')}</TableHead>
                                    <TableHead className="text-start">{t('members.table.role')}</TableHead>
                                    <TableHead className="text-start">{t('members.table.joinedAt')}</TableHead>
                                    {user?.role === 'admin' && (
                                        <TableHead className="text-end">{t('common.actions')}</TableHead>
                                    )}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {members.map((member) => {
                                    const RoleIcon = roleIcons[member.role] || Eye
                                    return (
                                        <TableRow key={member.id}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-sm font-bold text-white overflow-hidden shadow-sm">
                                                        {member.profile_url ? (
                                                            <img
                                                                src={member.profile_url.startsWith('http') ? member.profile_url : platformService.convertFileSrc(member.profile_url)}
                                                                alt={member.name}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            member.name?.charAt(0).toUpperCase() || 'M'
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <div>
                                                            <p className="font-medium">
                                                                {member.name}
                                                                {member.id === user?.id && (
                                                                    <span className="ms-2 text-xs text-muted-foreground">
                                                                        ({t('members.you')})
                                                                    </span>
                                                                )}
                                                            </p>
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                            onClick={() => setProfileUserId(member.id)}
                                                            aria-label={t('profileCard.viewProfile')}
                                                        >
                                                            <UserRound className="h-3.5 w-3.5" />
                                                        </Button>
                                                        {canManageWorkspacePermissions && user?.role === 'admin' && member.role !== 'admin' && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                                onClick={() => openPermissionModal(member)}
                                                                aria-label={t('members.permissions.manage', { defaultValue: 'Manage permissions' })}
                                                            >
                                                                <KeyRound className="h-3.5 w-3.5" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${roleColors[member.role]}`}>
                                                    <RoleIcon className="w-3 h-3" />
                                                    {t(`auth.roles.${member.role}`)}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-start">
                                                {formatDate(member.created_at)}
                                            </TableCell>
                                            {user?.role === 'admin' && (
                                                <TableCell className="text-end">
                                                    {canKick(member) ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => setMemberToKick(member)}
                                                            disabled={kickingMemberId === member.id}
                                                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                        >
                                                            {kickingMemberId === member.id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <>
                                                                    <UserMinus className="w-4 h-4 mr-1" />
                                                                    {t('members.kick')}
                                                                </>
                                                            )}
                                                        </Button>
                                                    ) : member.role === 'admin' && member.id !== user?.id ? (
                                                        <span className="text-xs text-muted-foreground">
                                                            {t('members.cannotKickAdmin')}
                                                        </span>
                                                    ) : null}
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card >

            <Dialog open={!!permissionMember} onOpenChange={(open) => { if (!open) setPermissionMember(null) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <KeyRound className="h-5 w-5 text-primary" />
                            {t('members.permissions.manageTitle', { defaultValue: 'Manage Permissions' })}
                        </DialogTitle>
                        <DialogDescription>
                            {t('members.permissions.manageDescription', {
                                name: permissionMember?.name,
                                defaultValue: 'Choose a module and grant the available permissions for this member.'
                            })}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="w-full max-w-[260px]">
                            <Select value={selectedPermissionModule} onValueChange={setSelectedPermissionModule}>
                                <SelectTrigger>
                                    <div className="flex items-center gap-2">
                                        {selectedModulePermissions[0] && (
                                            (() => {
                                                const Icon = selectedModulePermissions[0].icon
                                                return <Icon className="h-4 w-4 text-primary" />
                                            })()
                                        )}
                                        <SelectValue placeholder={t('members.permissions.selectModule', { defaultValue: 'Select module' })} />
                                    </div>
                                </SelectTrigger>
                                <SelectContent>
                                    {/* Global module explicitly at the top and sectionless */}
                                    {(() => {
                                        const globalModule = visiblePermissionDefinitions.find(p => p.module === 'global')
                                        if (!globalModule) return null
                                        const GlobalIcon = globalModule.icon
                                        return (
                                            <SelectItem value="global">
                                                <div className="flex items-center gap-2">
                                                    <GlobalIcon className="h-4 w-4 text-muted-foreground" />
                                                    {t('members.permissions.global', { defaultValue: 'Global' })}
                                                </div>
                                            </SelectItem>
                                        )
                                    })()}

                                    {launcherSectionOrder.map((sectionKey) => {
                                        if (sectionKey === 'global') return null
                                        const group = groupedPermissions[sectionKey]
                                        if (!group || group.length === 0) return null
                                        const sectionInfo = launcherSections[sectionKey]
                                        const SectionIcon = sectionInfo.icon

                                        return (
                                            <SelectGroup key={sectionKey}>
                                                <SelectLabel className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 rounded-sm mb-1 mt-2 first:mt-0">
                                                    {SectionIcon && <SectionIcon className="h-3 w-3" />}
                                                    {sectionInfo.title}
                                                </SelectLabel>
                                                {group.map((permission) => {
                                                    if (permission.module === 'global') return null
                                                    const PermissionIcon = permission.icon
                                                    return (
                                                        <SelectItem key={permission.module} value={permission.module}>
                                                            <div className="flex items-center gap-2">
                                                                <PermissionIcon className="h-4 w-4 text-muted-foreground" />
                                                                {t(permission.labelKey, { defaultValue: permission.defaultLabel })}
                                                            </div>
                                                        </SelectItem>
                                                    )
                                                })}
                                            </SelectGroup>
                                        )
                                    })}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-4">
                            {permissionMember && selectedModulePermissions.map((permission) => {
                                const PermissionIcon = permission.icon
                                return (
                                    <div key={permission.key} className="rounded-lg border border-border/60 bg-background/60 p-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    {permission.module === 'global' ? (
                                                        <PermissionIcon className="h-4 w-4 text-primary" />
                                                    ) : (
                                                        <ShieldCheck className="h-4 w-4 text-primary" />
                                                    )}
                                                    <p className="font-medium">
                                                        {permission.key.endsWith('.access')
                                                            ? t('permissions.access', { defaultValue: 'Access' })
                                                            : t(permission.labelKey, { defaultValue: permission.defaultLabel })}
                                                    </p>
                                                </div>
                                                <p className="mt-1 text-sm text-muted-foreground">
                                                    {t(permission.descriptionKey, {
                                                        defaultValue: permission.defaultDescription
                                                    })}
                                                </p>
                                                <p className="mt-1 text-[11px] text-muted-foreground">{permission.key}</p>
                                            </div>
                                            <Switch
                                                checked={permission.key === 'global.NOprint' ? !selectedMemberPermissionKeys.has(permission.key) : selectedMemberPermissionKeys.has(permission.key)}
                                                disabled={permissionMutationKey === `${permissionMember.id}:${permission.key}` || permissionsLoading}
                                                onCheckedChange={(value) => {
                                                    const shouldGrant = permission.key === 'global.NOprint' ? !value : value
                                                    handlePermissionToggle(permissionMember, permission.key, shouldGrant)
                                                }}
                                                aria-label={t(permission.labelKey, { defaultValue: permission.defaultLabel })}
                                            />
                                        </div>
                                        {permissionMutationKey === `${permissionMember.id}:${permission.key}` && (
                                            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                {t('common.saving', { defaultValue: 'Saving...' })}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Kick Confirmation Dialog */}
            <Dialog open={!!memberToKick} onOpenChange={() => setMemberToKick(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('members.kickTitle')}</DialogTitle>
                        <DialogDescription>
                            {t('members.kickConfirm', { name: memberToKick?.name })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="text-sm text-muted-foreground">
                            {t('members.kickWarning')}
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMemberToKick(null)}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleKick}
                            disabled={!!kickingMemberId}
                        >
                            {kickingMemberId ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <>
                                    <UserMinus className="w-4 h-4 mr-1" />
                                    {t('members.kick')}
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Profile Card Modal */}
            <ProfileCardModal
                open={!!profileUserId}
                onOpenChange={(open) => { if (!open) setProfileUserId(null) }}
                userId={profileUserId}
            />
        </div >
    )
}
