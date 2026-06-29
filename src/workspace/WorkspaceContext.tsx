import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '@/auth/supabase'
import { useAuth } from '@/auth/AuthContext'
import type {
    CurrencyCode,
    IQDDisplayPreference,
    Workspace,
    WorkspaceDataMode
} from '@/local-db/models'
import { db } from '@/local-db/database'
import { hasCurrencyExchangeAccountingData } from '@/local-db/currencyExchange'
import { addToOfflineMutations } from '@/local-db/hooks'
import { hydrateLocalModeCacheFromSqlite, clearWorkspaceSqliteData, seedWorkspaceFromDexie } from '@/local-db/localModeSqlite'
import { fetchCachedCustomTemplates } from '@/lib/cachedCustomTemplates'
import { isMobile } from '@/lib/platform'
import { connectionManager } from '@/lib/connectionManager'
import {
    clearWorkspaceCache,
    readWorkspaceCache,
    writeWorkspaceCache,
    type WorkspaceCacheSnapshot
} from './workspaceCache'
import {
    normalizeWorkspaceDataMode,
    writeWorkspaceModeSnapshot
} from './workspaceMode'
import { runSupabaseAction, normalizeSupabaseActionError } from '@/lib/supabaseRequest'
import {
    applyWorkspaceOverrides,
    getPlanCapabilities,
    getPrimaryCurrencyForPlan,
    normalizeWorkspacePlan,
    planHasWorkspaceFeature,
    WORKSPACE_FEATURE_MODULE_MAP,
    type PlanCapabilityKey,
    type ResolvedWorkspacePlan,
    type WorkspaceAccessOverride,
    type WorkspaceFeatureKey,
    type WorkspacePlan
} from '@/plans/workspacePlans'

export type ModuleFeatureKey = WorkspaceFeatureKey

export interface WorkspaceFeatures {
    plan: WorkspacePlan
    data_mode: WorkspaceDataMode
    // Module toggles
    pos: boolean
    instant_pos: boolean
    sales_history: boolean
    crm: boolean
    agents: boolean
    ecommerce: boolean
    travel_agency: boolean
    real_estate: boolean
    currency_exchange: boolean
    clinical_appointments: boolean
    loans: boolean
    installments: boolean
    net_revenue: boolean
    budget: boolean
    monthly_comparison: boolean
    team_performance: boolean
    products: boolean
    discounts: boolean
    storages: boolean
    inventory_transfer: boolean
    inventory_transactions: boolean
    stock_adjustments: boolean
    invoices_history: boolean
    hr: boolean
    // Other settings
    is_configured: boolean
    default_currency: CurrencyCode
    iqd_display_preference: IQDDisplayPreference
    allowed_currencies: CurrencyCode[]
    locked_workspace: boolean
    logo_url: string | null
    coordination: string | null
    max_discount_percent: number
    allow_whatsapp: boolean
    kds_enabled: boolean
    print_lang: 'auto' | 'en' | 'ar' | 'ku'
    print_qr: boolean
    receipt_template: 'primary' | 'modern'
    a4_template: 'primary' | 'modern' | 'professional'
    print_quality: 'high'
    thermal_printing: boolean
    subscription_expires_at: string | null
    upload_limit_mb: number | null
    visibility: 'private' | 'public'
    store_slug: string | null
    store_description: string | null
}

export interface UpdateInfo {
    version: string
    date?: string
    body?: string
}

export interface BranchInfo {
    isBranch: boolean
    relationId?: string
    branchName?: string
    sourceWorkspaceId?: string
    sourceWorkspaceName?: string
}

interface WorkspaceContextType {
    features: WorkspaceFeatures
    plan: WorkspacePlan
    planCapabilities: ResolvedWorkspacePlan
    workspaceName: string | null
    branchInfo: BranchInfo | null
    isLoading: boolean
    pendingUpdate: UpdateInfo | null
    setPendingUpdate: (update: UpdateInfo | null) => void
    isFullscreen: boolean
    isLocked: boolean
    isLocalMode: boolean
    isDemoMode: boolean
    isCloudMode: boolean
    isHybridMode: boolean
    hasFeature: (feature: ModuleFeatureKey) => boolean
    hasCapability: (capability: PlanCapabilityKey) => boolean
    refreshFeatures: () => Promise<void>
    updateSettings: (settings: Partial<Pick<WorkspaceFeatures, 'default_currency' | 'iqd_display_preference' | 'allow_whatsapp' | 'kds_enabled' | 'instant_pos' | 'logo_url' | 'coordination' | 'print_lang' | 'print_qr' | 'receipt_template' | 'a4_template' | 'thermal_printing' | 'visibility' | 'store_slug' | 'store_description' | 'upload_limit_mb' | 'data_mode' | 'plan' | 'is_configured'>> & { name?: string }) => Promise<void>
    switchDataMode: (newMode: 'cloud' | 'hybrid') => Promise<{ error: string | null }>
    activeWorkspace: { id: string } | undefined
}

const PLAN_DERIVED_FEATURE_KEYS: ModuleFeatureKey[] = [
    'pos',
    'instant_pos',
    'sales_history',
    'crm',
    'agents',
    'ecommerce',
    'travel_agency',
    'real_estate',
    'currency_exchange',
    'clinical_appointments',
    'loans',
    'installments',
    'net_revenue',
    'budget',
    'monthly_comparison',
    'team_performance',
    'products',
    'discounts',
    'storages',
    'inventory_transfer',
    'inventory_transactions',
    'stock_adjustments',
    'invoices_history',
    'hr',
    'allow_whatsapp'
]

function getPlanFeatureFlags(plan: WorkspacePlan) {
    return PLAN_DERIVED_FEATURE_KEYS.reduce((flags, key) => {
        flags[key] = planHasWorkspaceFeature(plan, key)
        return flags
    }, {} as Record<ModuleFeatureKey, boolean>)
}

function getResolvedFeatureFlags(resolved: ResolvedWorkspacePlan) {
    const moduleSet = new Set(resolved.modules)
    const capabilitySet = new Set(resolved.capabilities)
    return PLAN_DERIVED_FEATURE_KEYS.reduce((flags, key) => {
        switch (key) {
            case 'monthly_comparison':
                flags[key] = moduleSet.has('revenue_analytics')
                break
            case 'allow_whatsapp':
                flags[key] = capabilitySet.has('whatsappIntegration')
                break
            case 'crm':
                flags[key] = moduleSet.has('customers')
                break
            default: {
                const mappedModule = WORKSPACE_FEATURE_MODULE_MAP[key]
                flags[key] = mappedModule ? moduleSet.has(mappedModule) : moduleSet.has(key as any)
                break
            }
        }
        return flags
    }, {} as Record<ModuleFeatureKey, boolean>)
}

const defaultPlan = normalizeWorkspacePlan('basic')

const PLAN_CONTROLLED_SETTINGS = new Set<string>([
    ...PLAN_DERIVED_FEATURE_KEYS.filter(k => k !== 'instant_pos'),
    'allow_whatsapp',
    'upload_limit_mb'
])

const defaultFeatures: WorkspaceFeatures = {
    plan: defaultPlan,
    data_mode: 'cloud',
    ...getPlanFeatureFlags(defaultPlan),
    is_configured: true,
    default_currency: 'usd',
    iqd_display_preference: 'IQD',
    allowed_currencies: ['usd', 'iqd'],
    locked_workspace: false,
    logo_url: null,
    coordination: null,
    max_discount_percent: 100,
    allow_whatsapp: false,
    travel_agency: false,
    real_estate: false,
    currency_exchange: false,
    agents: false,
    clinical_appointments: false,
    kds_enabled: false,
    print_lang: 'auto',
    print_qr: false,
    receipt_template: 'primary',
    a4_template: 'primary',
    print_quality: 'high' as const,
    thermal_printing: false,
    subscription_expires_at: null,
    upload_limit_mb: null,
    visibility: 'private',
    store_slug: null,
    store_description: null
}

const WORKSPACE_FEATURE_COLUMNS = [
    'name',
    'plan',
    'data_mode',
    'instant_pos',
    'travel_agency',
    'real_estate',
    'is_configured',
    'default_currency',
    'iqd_display_preference',
    'locked_workspace',
    'logo_url',
    'coordination',
    'max_discount_percent',
    'allow_whatsapp',
    'kds_enabled',
    'print_lang',
    'print_qr',
    'receipt_template',
    'a4_template',
    'subscription_expires_at',
    'upload_limit_mb',
    'visibility',
    'store_slug',
    'store_description'
].join(', ')

function mergeWorkspaceFeatures(
    features?: Partial<WorkspaceFeatures> | null,
    overrides?: WorkspaceAccessOverride[] | null
): WorkspaceFeatures {
    const plan = normalizeWorkspacePlan(features?.plan ?? defaultFeatures.plan)
    const planCapabilities = getPlanCapabilities(plan)
    const resolvedCapabilities = overrides?.length
        ? applyWorkspaceOverrides(planCapabilities, overrides)
        : planCapabilities
    const allowedCurrencies = resolvedCapabilities.allowedCurrencies
    const requestedCurrency = String(features?.default_currency ?? defaultFeatures.default_currency).toLowerCase()
    const defaultCurrency = allowedCurrencies.includes(requestedCurrency as CurrencyCode)
        ? requestedCurrency as CurrencyCode
        : getPrimaryCurrencyForPlan(plan) as CurrencyCode
    const supportsUploads = resolvedCapabilities.capabilities.includes('workspaceStorageUploads' as PlanCapabilityKey)

    const capSet = new Set(resolvedCapabilities.capabilities)

    return {
        ...defaultFeatures,
        ...(features ?? {}),
        ...getResolvedFeatureFlags(resolvedCapabilities),
        plan,
        data_mode: normalizeWorkspaceDataMode(features?.data_mode),
        default_currency: defaultCurrency,
        allowed_currencies: allowedCurrencies,
        allow_whatsapp: capSet.has('whatsappIntegration')
            ? features?.allow_whatsapp ?? false
            : false,
        upload_limit_mb: supportsUploads
            ? features?.upload_limit_mb ?? resolvedCapabilities.limits.maxUploadSizeMb
            : null,
        visibility: capSet.has('marketplaceStorefronts')
            ? features?.visibility ?? defaultFeatures.visibility
            : 'private',
        store_slug: capSet.has('marketplaceStorefronts')
            ? features?.store_slug ?? defaultFeatures.store_slug
            : null,
        store_description: capSet.has('marketplaceStorefronts')
            ? features?.store_description ?? defaultFeatures.store_description
            : null,
        thermal_printing: capSet.has('thermalPrinter')
            ? features?.thermal_printing ?? defaultFeatures.thermal_printing
            : false,
        print_quality: 'high' as const,
        instant_pos: resolvedCapabilities.modules.includes('instant_pos')
            ? features?.instant_pos ?? defaultFeatures.instant_pos
            : false,
        kds_enabled: capSet.has('kds') && features?.instant_pos !== false
            ? features?.kds_enabled ?? defaultFeatures.kds_enabled
            : false
    }
}

function isWorkspaceCurrentlyLocked(
    features: Pick<WorkspaceFeatures, 'locked_workspace' | 'subscription_expires_at'>
) {
    return features.locked_workspace
        || (features.subscription_expires_at ? new Date(features.subscription_expires_at) < new Date() : false)
}

function getFeaturesFromLocalWorkspace(localWorkspace: Workspace): WorkspaceFeatures | null {
    if (typeof localWorkspace.is_configured !== 'boolean') {
        return null
    }

    return mergeWorkspaceFeatures({
        plan: normalizeWorkspacePlan(localWorkspace.plan),
        data_mode: localWorkspace.data_mode ?? 'cloud',
        instant_pos: localWorkspace.instant_pos ?? true,
        travel_agency: localWorkspace.travel_agency ?? true,
        real_estate: localWorkspace.real_estate ?? true,
        currency_exchange: localWorkspace.currency_exchange ?? false,
        agents: localWorkspace.agents ?? false,
        clinical_appointments: localWorkspace.clinical_appointments ?? false,
        is_configured: localWorkspace.is_configured,
        default_currency: localWorkspace.default_currency,
        iqd_display_preference: localWorkspace.iqd_display_preference,
        locked_workspace: localWorkspace.locked_workspace ?? false,
        logo_url: localWorkspace.logo_url ?? null,
        coordination: localWorkspace.coordination ?? null,
        max_discount_percent: localWorkspace.max_discount_percent ?? 100,
        allow_whatsapp: localWorkspace.allow_whatsapp ?? false,
        kds_enabled: localWorkspace.kds_enabled ?? false,
        print_lang: localWorkspace.print_lang ?? 'auto',
        print_qr: localWorkspace.print_qr ?? false,
        receipt_template: localWorkspace.receipt_template ?? 'primary',
        a4_template: localWorkspace.a4_template ?? 'primary',
        print_quality: 'high' as const,
        thermal_printing: localWorkspace.thermal_printing ?? false,
        subscription_expires_at: localWorkspace.subscription_expires_at ?? null,
        upload_limit_mb: localWorkspace.upload_limit_mb ?? null,
        visibility: localWorkspace.visibility ?? 'private',
        store_slug: localWorkspace.store_slug ?? null,
        store_description: localWorkspace.store_description ?? null
    })
}

function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated, isLoading: authLoading, updateUser } = useAuth()

    const [features, setFeatures] = useState<WorkspaceFeatures>(defaultFeatures)
    const [workspaceName, setWorkspaceName] = useState<string | null>(null)
    const [branchInfo, setBranchInfo] = useState<BranchInfo | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [overrides, setOverrides] = useState<WorkspaceAccessOverride[]>([])
    const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
    const currentWorkspaceIdRef = useRef<string | null>(null)
    const fetchRequestRef = useRef(0)
    const branchFetchRequestRef = useRef(0)
    const featuresRef = useRef(defaultFeatures)
    const overridesRef = useRef<WorkspaceAccessOverride[]>([])
    const workspaceNameRef = useRef<string | null>(null)

    useEffect(() => {
        featuresRef.current = features
    }, [features])

    useEffect(() => {
        overridesRef.current = overrides
    }, [overrides])

    useEffect(() => {
        workspaceNameRef.current = workspaceName
    }, [workspaceName])

    useEffect(() => {
        // @ts-ignore
        const isTauri = !!window.__TAURI_INTERNALS__
        if (!isTauri) return

        const updateFSState = async () => {
            try {
                const { getCurrentWindow } = await import('@tauri-apps/api/window')
                const win = getCurrentWindow()
                const fs = await win.isFullscreen()
                setIsFullscreen(fs)

                if (fs && !isMobile()) {
                    document.documentElement.setAttribute('data-fullscreen', 'true')
                } else {
                    document.documentElement.removeAttribute('data-fullscreen')
                }
            } catch (e) {
                console.error('[Tauri] FS Update Error:', e)
            }
        }

        updateFSState()

        let unlisten: (() => void) | undefined
        const setup = async () => {
            const { getCurrentWindow } = await import('@tauri-apps/api/window')
            unlisten = await getCurrentWindow().onResized(updateFSState)
        }

        void setup()

        return () => unlisten?.()
    }, [])

    const isCurrentWorkspaceRequest = (workspaceId: string, requestId: number) => {
        return currentWorkspaceIdRef.current === workspaceId && fetchRequestRef.current === requestId
    }

    const isCurrentBranchWorkspaceRequest = (workspaceId: string, requestId: number) => {
        return currentWorkspaceIdRef.current === workspaceId && branchFetchRequestRef.current === requestId
    }

    const persistWorkspaceState = async (
        workspaceId: string,
        nextFeatures: WorkspaceFeatures,
        nextWorkspaceName: string | null
    ) => {
        const existing = await db.workspaces.get(workspaceId)
        const timestamp = new Date().toISOString()

        await db.workspaces.put({
            id: workspaceId,
            workspaceId,
            name: nextWorkspaceName || existing?.name || user?.workspaceName || 'My Workspace',
            code: existing?.code || user?.workspaceCode || 'LOADED',
            plan: nextFeatures.plan,
            data_mode: nextFeatures.data_mode,
            is_configured: nextFeatures.is_configured,
            pos: nextFeatures.pos,
            instant_pos: nextFeatures.instant_pos,
            sales_history: nextFeatures.sales_history,
            crm: nextFeatures.crm,
            ecommerce: nextFeatures.ecommerce,
            travel_agency: nextFeatures.travel_agency,
            real_estate: nextFeatures.real_estate,
            currency_exchange: nextFeatures.currency_exchange,
            agents: nextFeatures.agents,
            clinical_appointments: nextFeatures.clinical_appointments,
            loans: nextFeatures.loans,
            net_revenue: nextFeatures.net_revenue,
            budget: nextFeatures.budget,
            monthly_comparison: nextFeatures.monthly_comparison,
            team_performance: nextFeatures.team_performance,
            products: nextFeatures.products,
            discounts: nextFeatures.discounts,
            storages: nextFeatures.storages,
            inventory_transfer: nextFeatures.inventory_transfer,
            inventory_transactions: nextFeatures.inventory_transactions,
            stock_adjustments: nextFeatures.stock_adjustments,
            invoices_history: nextFeatures.invoices_history,
            hr: nextFeatures.hr,
            default_currency: nextFeatures.default_currency,
            iqd_display_preference: nextFeatures.iqd_display_preference,
            locked_workspace: nextFeatures.locked_workspace,
            allow_whatsapp: nextFeatures.allow_whatsapp,
            kds_enabled: nextFeatures.kds_enabled,
            logo_url: nextFeatures.logo_url,
            coordination: nextFeatures.coordination,
            max_discount_percent: nextFeatures.max_discount_percent,
            print_lang: nextFeatures.print_lang,
            print_qr: nextFeatures.print_qr,
            receipt_template: nextFeatures.receipt_template,
            a4_template: nextFeatures.a4_template,
            thermal_printing: nextFeatures.thermal_printing,
            subscription_expires_at: nextFeatures.subscription_expires_at,
            upload_limit_mb: nextFeatures.upload_limit_mb,
            visibility: nextFeatures.visibility,
            store_slug: nextFeatures.store_slug,
            store_description: nextFeatures.store_description,
            syncStatus: 'synced',
            lastSyncedAt: timestamp,
            version: existing?.version ?? 1,
            isDeleted: existing?.isDeleted ?? false,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp
        })

        // Important: If we are in local/hybrid mode, we MUST keep our local logo_url
        // as the source of truth, even if fetchFeatures later tries to sync from Supabase.
        if (nextFeatures.data_mode === 'local' || nextFeatures.data_mode === 'hybrid') {
            await hydrateLocalModeCacheFromSqlite(db, workspaceId)
        }
    }

    const resolveTrustedFallback = async (
        workspaceId: string,
        cachedSnapshot?: WorkspaceCacheSnapshot<WorkspaceFeatures> | null
    ) => {
        if (cachedSnapshot) {
            return {
                features: mergeWorkspaceFeatures(cachedSnapshot.features),
                workspaceName: cachedSnapshot.workspaceName
            }
        }

        const localWorkspace = await db.workspaces.get(workspaceId)
        if (!localWorkspace) {
            return null
        }

        const localFeatures = getFeaturesFromLocalWorkspace(localWorkspace)
        if (!localFeatures) {
            return null
        }

        return {
            features: localFeatures,
            workspaceName: localWorkspace.name || null
        }
    }

    const fetchFeatures = async (
        silent = false,
        options?: {
            workspaceId?: string
            cachedSnapshot?: WorkspaceCacheSnapshot<WorkspaceFeatures> | null
        }
    ) => {
        const workspaceId = options?.workspaceId ?? user?.workspaceId

        if (!isSupabaseConfigured || !isAuthenticated || !workspaceId) {
            setFeatures(defaultFeatures)
            setWorkspaceName(null)
            if (!silent) setIsLoading(false)
            return
        }

        const requestId = ++fetchRequestRef.current
        const cachedSnapshot = options?.cachedSnapshot ?? readWorkspaceCache<WorkspaceFeatures>(workspaceId)

        const applyFallback = async () => {
            const fallback = await resolveTrustedFallback(workspaceId, cachedSnapshot)

            if (!isCurrentWorkspaceRequest(workspaceId, requestId)) {
                return
            }

            if (fallback) {
                setFeatures(fallback.features)
                setWorkspaceName(fallback.workspaceName)
                if (cachedSnapshot?.overrides) {
                    setOverrides(cachedSnapshot.overrides)
                }
            } else if (!silent) {
                setFeatures(defaultFeatures)
                setWorkspaceName(user?.workspaceName ?? null)
            }
        }

        // Demo workspaces use local DB exclusively — skip Supabase queries
        if (user?.workspaceMode === 'demo') {
            await applyFallback()
            if (!silent && isCurrentWorkspaceRequest(workspaceId, requestId)) {
                setIsLoading(false)
            }
            return
        }

        if (isOffline()) {
            await applyFallback()
            if (!silent && isCurrentWorkspaceRequest(workspaceId, requestId)) {
                setIsLoading(false)
            }
            return
        }

        try {
            const [workspaceResult, overridesResult] = await Promise.all([
                runSupabaseAction(
                    'workspace.getFeatures',
                    () => supabase.from('workspaces').select(WORKSPACE_FEATURE_COLUMNS).eq('id', workspaceId).maybeSingle(),
                    { timeoutMs: 12000, platform: 'all' }
                ),
                supabase
                    .from('workspace_access_overrides')
                    .select('id, workspace_id, type, key, value, created_by, created_at')
                    .eq('workspace_id', workspaceId)
            ]) as any

            const { data, error } = workspaceResult

            if (error) {
                throw error
            }

            if (!data) {
                if (isCurrentWorkspaceRequest(workspaceId, requestId)) {
                    clearWorkspaceCache(workspaceId)
                    setFeatures(defaultFeatures)
                    setWorkspaceName(null)
                    updateUser({
                        workspaceId: '',
                        workspaceCode: '',
                        workspaceName: undefined,
                        isConfigured: undefined,
                        workspaceMode: 'cloud'
                    })
                }
                return
            }

            const workspaceRow = data as any
            const fetchedOverrides = (overridesResult?.data ?? []) as WorkspaceAccessOverride[]
            const currentFeatures = featuresRef.current
            const localThermalPrinting = cachedSnapshot?.features?.thermal_printing
                ?? (await db.workspaces.get(workspaceId))?.thermal_printing
                ?? currentFeatures.thermal_printing
                ?? false
            const fetchedFeatures = mergeWorkspaceFeatures({
                plan: normalizeWorkspacePlan(workspaceRow.plan),
                data_mode: workspaceRow.data_mode ?? currentFeatures.data_mode,
                instant_pos: workspaceRow.instant_pos ?? currentFeatures.instant_pos,
                travel_agency: workspaceRow.travel_agency ?? currentFeatures.travel_agency,
                real_estate: workspaceRow.real_estate ?? currentFeatures.real_estate,
                currency_exchange: currentFeatures.currency_exchange,
                agents: currentFeatures.agents,
                clinical_appointments: currentFeatures.clinical_appointments,
                is_configured: workspaceRow.is_configured ?? currentFeatures.is_configured,
                default_currency: workspaceRow.default_currency ?? currentFeatures.default_currency,
                iqd_display_preference: workspaceRow.iqd_display_preference ?? currentFeatures.iqd_display_preference,
                locked_workspace: workspaceRow.locked_workspace ?? currentFeatures.locked_workspace,
                logo_url: (workspaceRow.data_mode === 'local' || workspaceRow.data_mode === 'hybrid')
                    ? (cachedSnapshot?.features?.logo_url ?? currentFeatures.logo_url ?? workspaceRow.logo_url ?? null)
                    : (workspaceRow.logo_url ?? null),
                coordination: workspaceRow.coordination ?? null,
                max_discount_percent: workspaceRow.max_discount_percent ?? currentFeatures.max_discount_percent,
                allow_whatsapp: workspaceRow.allow_whatsapp ?? currentFeatures.allow_whatsapp,
                kds_enabled: workspaceRow.kds_enabled ?? false,
                print_lang: workspaceRow.print_lang ?? currentFeatures.print_lang,
                print_qr: workspaceRow.print_qr ?? currentFeatures.print_qr,
                receipt_template: workspaceRow.receipt_template ?? currentFeatures.receipt_template,
                a4_template: workspaceRow.a4_template ?? currentFeatures.a4_template,
                print_quality: 'high' as const,
                thermal_printing: localThermalPrinting,
                subscription_expires_at: workspaceRow.subscription_expires_at ?? currentFeatures.subscription_expires_at,
                upload_limit_mb: workspaceRow.upload_limit_mb ?? null,
                visibility: workspaceRow.visibility ?? currentFeatures.visibility,
                store_slug: workspaceRow.store_slug ?? currentFeatures.store_slug,
                store_description: workspaceRow.store_description ?? currentFeatures.store_description
            }, fetchedOverrides)
            const nextWorkspaceName = workspaceRow.name || user?.workspaceName || 'My Workspace'

            if (!isCurrentWorkspaceRequest(workspaceId, requestId)) {
                return
            }

            setOverrides(fetchedOverrides)
            setFeatures(fetchedFeatures)
            setWorkspaceName(nextWorkspaceName)
            writeWorkspaceCache({
                workspaceId,
                features: fetchedFeatures,
                workspaceName: nextWorkspaceName,
                overrides: fetchedOverrides
            })
            await persistWorkspaceState(workspaceId, fetchedFeatures, nextWorkspaceName)
        } catch (err) {
            console.error('Error fetching workspace features:', err)
            await applyFallback()
        } finally {
            if (!silent && isCurrentWorkspaceRequest(workspaceId, requestId)) {
                setIsLoading(false)
            }
        }
    }

    const fetchBranchInfo = async (workspaceId: string, requestId: number) => {
        if (!isSupabaseConfigured || !isAuthenticated || !workspaceId) {
            setBranchInfo(null)
            return
        }

        if (isOffline()) {
            if (isCurrentBranchWorkspaceRequest(workspaceId, requestId)) {
                setBranchInfo(null)
            }
            return
        }

        try {
            const { data, error } = await runSupabaseAction(
                'workspace.getBranchInfo',
                () => supabase
                    .from('workspace_branches')
                    .select('id, name, source_workspace_id')
                    .eq('branch_workspace_id', workspaceId)
                    .is('archived_at', null)
                    .maybeSingle(),
                { timeoutMs: 8000, platform: 'all' }
            ) as {
                data: { id: string; name?: string | null; source_workspace_id?: string | null } | null
                error?: unknown
            }

            if (!isCurrentBranchWorkspaceRequest(workspaceId, requestId)) {
                return
            }

            if (error) {
                throw error
            }

            if (!data?.source_workspace_id) {
                setBranchInfo(null)
                return
            }

            const { data: sourceWorkspace, error: sourceWorkspaceError } = await runSupabaseAction(
                'workspace.getBranchSourceWorkspace',
                () => supabase
                    .from('workspaces')
                    .select('id, name')
                    .eq('id', data.source_workspace_id)
                    .maybeSingle(),
                { timeoutMs: 8000, platform: 'all' }
            ) as {
                data: { id: string; name?: string | null } | null
                error?: unknown
            }

            if (!isCurrentBranchWorkspaceRequest(workspaceId, requestId)) {
                return
            }

            if (sourceWorkspaceError) {
                throw sourceWorkspaceError
            }

            setBranchInfo({
                isBranch: true,
                relationId: data.id,
                branchName: data.name ?? undefined,
                sourceWorkspaceId: data.source_workspace_id,
                sourceWorkspaceName: sourceWorkspace?.name ?? undefined
            })
        } catch (error) {
            console.error('[Workspace] Failed to fetch branch info:', error)
            if (isCurrentBranchWorkspaceRequest(workspaceId, requestId)) {
                setBranchInfo(null)
            }
        }
    }

    useEffect(() => {
        if (authLoading) return

        const workspaceId = isAuthenticated ? user?.workspaceId ?? null : null
        currentWorkspaceIdRef.current = workspaceId
        fetchRequestRef.current += 1
        branchFetchRequestRef.current += 1

        if (!workspaceId) {
            setFeatures(defaultFeatures)
            setWorkspaceName(null)
            setBranchInfo(null)
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        setFeatures(defaultFeatures)
        setWorkspaceName(null)
        setBranchInfo(null)

        const cachedSnapshot = readWorkspaceCache<WorkspaceFeatures>(workspaceId)
        if (cachedSnapshot) {
            setFeatures(mergeWorkspaceFeatures(cachedSnapshot.features))
            setWorkspaceName(cachedSnapshot.workspaceName)
            if (cachedSnapshot.overrides) {
                setOverrides(cachedSnapshot.overrides)
            }
        }

        void fetchFeatures(false, { workspaceId, cachedSnapshot })
        void fetchBranchInfo(workspaceId, branchFetchRequestRef.current)
    }, [authLoading, isAuthenticated, user?.workspaceId])

    useEffect(() => {
        if (!isSupabaseConfigured || !isAuthenticated || !user?.workspaceId) return

        const channel = supabase
            .channel(`workspace-live-${user.workspaceId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'workspaces',
                    filter: `id=eq.${user.workspaceId}`
                },
                async (payload) => {
                    try {
                        const data = payload.new as any
                        const currentFeatures = featuresRef.current
                        const updatedFeatures = mergeWorkspaceFeatures({
                            ...currentFeatures,
                            plan: normalizeWorkspacePlan(data.plan ?? currentFeatures.plan),
                            data_mode: data.data_mode ?? currentFeatures.data_mode,
                            instant_pos: data.instant_pos ?? currentFeatures.instant_pos,
                            travel_agency: data.travel_agency ?? currentFeatures.travel_agency,
                            real_estate: data.real_estate ?? currentFeatures.real_estate,
                            currency_exchange: currentFeatures.currency_exchange,
                            agents: currentFeatures.agents,
                            clinical_appointments: currentFeatures.clinical_appointments,
                            is_configured: data.is_configured ?? currentFeatures.is_configured,
                            default_currency: data.default_currency || currentFeatures.default_currency,
                            iqd_display_preference: data.iqd_display_preference || currentFeatures.iqd_display_preference,
                            locked_workspace: data.locked_workspace ?? currentFeatures.locked_workspace,
                            logo_url: data.logo_url ?? currentFeatures.logo_url,
                            coordination: data.coordination ?? currentFeatures.coordination,
                            max_discount_percent: data.max_discount_percent ?? currentFeatures.max_discount_percent,
                            allow_whatsapp: data.allow_whatsapp ?? currentFeatures.allow_whatsapp,
                            kds_enabled: data.kds_enabled ?? currentFeatures.kds_enabled,
                            print_lang: data.print_lang ?? currentFeatures.print_lang,
                            print_qr: data.print_qr ?? currentFeatures.print_qr,
                            receipt_template: data.receipt_template ?? currentFeatures.receipt_template,
                            a4_template: data.a4_template ?? currentFeatures.a4_template,
                            print_quality: 'high' as const,
                            thermal_printing: currentFeatures.thermal_printing,
                            subscription_expires_at: data.subscription_expires_at ?? currentFeatures.subscription_expires_at,
                            visibility: data.visibility ?? currentFeatures.visibility,
                            store_slug: data.store_slug ?? currentFeatures.store_slug,
                            store_description: data.store_description ?? currentFeatures.store_description
                        }, overridesRef.current)
                        const nextWorkspaceName = data.name || workspaceNameRef.current || user.workspaceName || 'My Workspace'

                        setFeatures(updatedFeatures)
                        setWorkspaceName(nextWorkspaceName)
                        writeWorkspaceCache({
                            workspaceId: user.workspaceId,
                            features: updatedFeatures,
                            workspaceName: nextWorkspaceName,
                            overrides: overridesRef.current
                        })
                        await persistWorkspaceState(user.workspaceId, updatedFeatures, nextWorkspaceName)
                    } catch (error) {
                        console.error('[Workspace] Failed to apply realtime update:', error)
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'workspace_access_overrides',
                    filter: `workspace_id=eq.${user.workspaceId}`
                },
                async () => {
                    try {
                        const { data: freshOverrides } = await supabase
                            .from('workspace_access_overrides')
                            .select('id, workspace_id, type, key, value, created_by, created_at')
                            .eq('workspace_id', user.workspaceId)

                        const nextOverrides = (freshOverrides ?? []) as WorkspaceAccessOverride[]
                        setOverrides(nextOverrides)

                        const currentFeatures = featuresRef.current
                        const updatedFeatures = mergeWorkspaceFeatures(currentFeatures, nextOverrides)
                        setFeatures(updatedFeatures)
                        writeWorkspaceCache({
                            workspaceId: user.workspaceId,
                            features: updatedFeatures,
                            workspaceName: workspaceNameRef.current ?? user.workspaceName ?? 'My Workspace',
                            overrides: nextOverrides
                        })
                        await persistWorkspaceState(user.workspaceId, updatedFeatures, workspaceNameRef.current ?? user.workspaceName ?? 'My Workspace')
                    } catch (error) {
                        console.error('[Workspace] Failed to apply override change:', error)
                    }
                }
            )
            .subscribe((status) => {
                console.log(`[Workspace] Realtime subscription: ${status}`)
            })

        realtimeChannelRef.current = channel

        return () => {
            supabase.removeChannel(channel)
            realtimeChannelRef.current = null
        }
    }, [isAuthenticated, user?.workspaceId, user?.workspaceName])

    useEffect(() => {
        if (!isSupabaseConfigured || !isAuthenticated || !user?.workspaceId) return

        const unsubscribe = connectionManager.subscribe((event) => {
            const shouldRefresh =
                event === 'wake'
                || event === 'online'
                || (event === 'heartbeat' && isWorkspaceCurrentlyLocked(featuresRef.current))

            if (shouldRefresh) {
                console.log(`[Workspace] ${event} event - re-fetching features silently`)
                void fetchFeatures(true, { workspaceId: user.workspaceId })
            }
        })

        return unsubscribe
    }, [isAuthenticated, user?.workspaceId])

    const hasFeature = (feature: ModuleFeatureKey): boolean => {
        if (feature === 'ecommerce') {
            return features.data_mode !== 'local'
                && features.data_mode !== 'demo'
                && planCapabilities.modules.includes('ecommerce')
        }
        if (feature === 'travel_agency') {
            return features[feature]
        }
        if (feature === 'allow_whatsapp') {
            return features.allow_whatsapp
                && planCapabilities.capabilities.includes('whatsappIntegration')
                && planCapabilities.modules.includes('whatsapp')
        }
        if (feature === 'manual_entry') {
            return (features.data_mode === 'local' || features.data_mode === 'demo')
                && planCapabilities.modules.includes('manual_entry')
        }
        const mappedModule = WORKSPACE_FEATURE_MODULE_MAP[feature]
        if (mappedModule) {
            return planCapabilities.modules.includes(mappedModule)
        }
        return planCapabilities.modules.includes(feature as any)
    }

    const hasCapability = (capability: PlanCapabilityKey): boolean => {
        return planCapabilities.capabilities.includes(capability)
    }

    const refreshFeatures = async () => {
        const workspaceId = user?.workspaceId
        if (!workspaceId) return

        setIsLoading(true)
        const branchRequestId = ++branchFetchRequestRef.current
        await Promise.all([
            fetchFeatures(false, { workspaceId }),
            fetchBranchInfo(workspaceId, branchRequestId)
        ])
    }

    const updateSettings = async (
        settings: Partial<Pick<WorkspaceFeatures, 'default_currency' | 'iqd_display_preference' | 'allow_whatsapp' | 'kds_enabled' | 'instant_pos' | 'logo_url' | 'coordination' | 'print_lang' | 'print_qr' | 'receipt_template' | 'a4_template' | 'thermal_printing' | 'visibility' | 'store_slug' | 'store_description' | 'upload_limit_mb' | 'data_mode' | 'plan' | 'is_configured'>> & { name?: string }
    ) => {
        const workspaceId = user?.workspaceId
        if (!workspaceId) return

        const { name, ...rawFeatureSettings } = settings
        const featureSettings = Object.fromEntries(
            Object.entries(rawFeatureSettings).filter(([key]) => !PLAN_CONTROLLED_SETTINGS.has(key))
        ) as typeof rawFeatureSettings
        const currentFeatures = featuresRef.current
        const currentBranchInfo = branchInfo
        const nextWorkspaceName = name ?? workspaceNameRef.current ?? user?.workspaceName ?? 'My Workspace'
        if (
            featureSettings.default_currency
            && featureSettings.default_currency !== currentFeatures.default_currency
            && await hasCurrencyExchangeAccountingData(workspaceId)
        ) {
            throw new Error('Workspace currency is locked because Currency Exchange has safes or transactions. This protects historical balances and profit reports.')
        }

        const newFeatures = mergeWorkspaceFeatures({ ...currentFeatures, ...featureSettings }, overridesRef.current)
        const now = new Date().toISOString()

        if (name) {
            setWorkspaceName(name)
            updateUser({ workspaceName: name })
            if (currentBranchInfo?.isBranch) {
                setBranchInfo({
                    ...currentBranchInfo,
                    branchName: name
                })
            }
        }

        setFeatures(newFeatures)
        writeWorkspaceCache({
            workspaceId,
            features: newFeatures,
            workspaceName: nextWorkspaceName,
            overrides: overridesRef.current
        })

        const existing = await db.workspaces.get(workspaceId)
        const usesCloudBusinessData = newFeatures.data_mode === 'cloud'
            || newFeatures.data_mode === 'hybrid'
        const supabaseUpdate: Record<string, unknown> = { ...featureSettings }
        delete supabaseUpdate.thermal_printing
        if (newFeatures.data_mode === 'local' || newFeatures.data_mode === 'demo') {
            delete supabaseUpdate.logo_url
        }
        if (name !== undefined) {
            supabaseUpdate.name = name
        }
        const shouldSync = usesCloudBusinessData && Object.keys(supabaseUpdate).length > 0

        const localUpdateData = {
            ...featureSettings,
            ...(name !== undefined && { name }),
            is_configured: newFeatures.is_configured,
            crm: newFeatures.crm,
            updatedAt: now,
            ...(shouldSync ? { syncStatus: 'pending' as const } : {})
        }

        if (existing) {
            await db.workspaces.update(workspaceId, localUpdateData)
        } else {
            await db.workspaces.put({
                id: workspaceId,
                workspaceId,
                name: nextWorkspaceName,
                code: user?.workspaceCode || 'LOCAL',
                plan: newFeatures.plan,
                data_mode: newFeatures.data_mode,
                is_configured: newFeatures.is_configured,
                instant_pos: newFeatures.instant_pos,
                travel_agency: newFeatures.travel_agency,
                real_estate: newFeatures.real_estate,
                currency_exchange: newFeatures.currency_exchange,
                agents: newFeatures.agents,
                clinical_appointments: newFeatures.clinical_appointments,
                default_currency: newFeatures.default_currency,
                iqd_display_preference: newFeatures.iqd_display_preference,
                locked_workspace: newFeatures.locked_workspace,
                allow_whatsapp: newFeatures.allow_whatsapp,
                kds_enabled: newFeatures.kds_enabled,
                logo_url: newFeatures.logo_url,
                coordination: newFeatures.coordination,
                max_discount_percent: newFeatures.max_discount_percent,
                print_lang: newFeatures.print_lang,
                print_qr: newFeatures.print_qr,
                receipt_template: newFeatures.receipt_template,
                a4_template: newFeatures.a4_template,
                thermal_printing: newFeatures.thermal_printing,
                subscription_expires_at: newFeatures.subscription_expires_at,
                upload_limit_mb: newFeatures.upload_limit_mb,
                visibility: newFeatures.visibility,
                store_slug: newFeatures.store_slug,
                store_description: newFeatures.store_description,
                syncStatus: shouldSync ? 'pending' : 'synced',
                lastSyncedAt: shouldSync ? null : new Date().toISOString(),
                version: 1,
                isDeleted: false,
                createdAt: now,
                updatedAt: now
            })
        }

        if (!shouldSync) {
            return
        }

        if (navigator.onLine) {
            const { data: updatedRow, error } = await supabase
                .from('workspaces')
                .update(supabaseUpdate)
                .eq('id', workspaceId)
                .select('kds_enabled, instant_pos')
                .maybeSingle()

            if (error) {
                console.error('Error updating workspace settings on Supabase:', error)
                await addToOfflineMutations('workspaces', workspaceId, 'update', supabaseUpdate, workspaceId)
                if (name !== undefined && currentBranchInfo?.isBranch && currentBranchInfo.relationId) {
                    await addToOfflineMutations(
                        'workspace_branches',
                        currentBranchInfo.relationId,
                        'update',
                        {
                            id: currentBranchInfo.relationId,
                            name
                        },
                        workspaceId
                    )
                }
            } else {
                if (name !== undefined && currentBranchInfo?.isBranch && currentBranchInfo.relationId) {
                    const branchUpdatePayload = {
                        id: currentBranchInfo.relationId,
                        name
                    }

                    const { error: branchError } = await supabase
                        .from('workspace_branches')
                        .update({ name })
                        .eq('id', currentBranchInfo.relationId)

                    if (branchError) {
                        console.error('Error updating branch settings on Supabase:', branchError)
                        await addToOfflineMutations('workspace_branches', currentBranchInfo.relationId, 'update', branchUpdatePayload, workspaceId)
                    }
                }

                if (updatedRow) {
                    const patched: Record<string, unknown> = {}
                    if ('instant_pos' in supabaseUpdate && typeof updatedRow.instant_pos === 'boolean') {
                        patched.instant_pos = updatedRow.instant_pos
                    }
                    if ('kds_enabled' in supabaseUpdate && typeof updatedRow.kds_enabled === 'boolean') {
                        patched.kds_enabled = updatedRow.kds_enabled
                    }
                    if (Object.keys(patched).length > 0) {
                        const corrected = mergeWorkspaceFeatures({ ...featuresRef.current, ...patched }, overridesRef.current)
                        setFeatures(corrected)
                        writeWorkspaceCache({
                            workspaceId,
                            features: corrected,
                            workspaceName: workspaceNameRef.current || nextWorkspaceName,
                            overrides: overridesRef.current
                        })
                    }
                }

                await db.workspaces.update(workspaceId, {
                    syncStatus: 'synced',
                    lastSyncedAt: new Date().toISOString()
                })
            }
        } else {
            await addToOfflineMutations('workspaces', workspaceId, 'update', supabaseUpdate, workspaceId)
            if (name !== undefined && currentBranchInfo?.isBranch && currentBranchInfo.relationId) {
                await addToOfflineMutations(
                    'workspace_branches',
                    currentBranchInfo.relationId,
                    'update',
                    {
                        id: currentBranchInfo.relationId,
                        name
                    },
                    workspaceId
                )
            }
        }
    }

    const switchDataMode = async (newMode: 'cloud' | 'hybrid'): Promise<{ error: string | null }> => {
        const workspaceId = user?.workspaceId
        if (!workspaceId) return { error: 'No workspace' }

        const currentMode = featuresRef.current.data_mode
        if (currentMode === 'local') return { error: 'Cannot switch from local mode' }
        if (currentMode === newMode) return { error: null }

        try {
            const { error: updateError } = await runSupabaseAction(
                'workspace.switchDataMode',
                () => supabase
                    .from('workspaces')
                    .update({ data_mode: newMode })
                    .eq('id', workspaceId),
                { timeoutMs: 12000, platform: 'all' }
            ) as any

            if (updateError) {
                const normalized = normalizeSupabaseActionError(updateError)
                return { error: normalized.message }
            }

            const { error: authError } = await runSupabaseAction(
                'auth.updateWorkspaceMode',
                () => supabase.auth.updateUser({
                    data: {
                        data_mode: newMode
                    }
                }),
                { timeoutMs: 8000, platform: 'all' }
            ) as any

            if (authError) {
                console.warn('[Workspace] Failed to persist workspace mode in auth metadata:', authError)
            }

            // Update local state
            const updatedFeatures = mergeWorkspaceFeatures({ ...featuresRef.current, data_mode: newMode }, overridesRef.current)
            setFeatures(updatedFeatures)
            writeWorkspaceCache({
                workspaceId,
                features: updatedFeatures,
                workspaceName: workspaceNameRef.current ?? user?.workspaceName ?? 'My Workspace',
                overrides: overridesRef.current
            })

            // Update workspace mode snapshot
            writeWorkspaceModeSnapshot({
                workspaceId,
                dataMode: newMode
            })

            // Update Dexie workspace record
            await db.workspaces.update(workspaceId, { data_mode: newMode })

            // Update auth user mode
            updateUser({ workspaceMode: newMode })

            if (newMode === 'hybrid') {
                // Cloud → Hybrid: seed SQLite from Dexie cache, then hydrate
                await seedWorkspaceFromDexie(db, workspaceId)
                await hydrateLocalModeCacheFromSqlite(db, workspaceId)

                try {
                    await fetchCachedCustomTemplates(workspaceId)
                } catch (customTemplateSeedError) {
                    console.warn(
                        '[Workspace] Custom templates will be mirrored on the next successful refresh:',
                        customTemplateSeedError
                    )
                }
            } else {
                // Hybrid → Cloud: abandon SQLite data
                await clearWorkspaceSqliteData(workspaceId)
            }

            return { error: null }
        } catch (err) {
            const normalized = normalizeSupabaseActionError(err)
            return { error: normalized.message }
        }
    }

    useEffect(() => {
        if (!user?.workspaceId) {
            return
        }

        writeWorkspaceModeSnapshot({
            workspaceId: user.workspaceId,
            dataMode: features.data_mode
        })
    }, [
        features.data_mode,
        user?.workspaceId
    ])

    const isLocalMode = features.data_mode === 'local' || features.data_mode === 'demo'
    const isDemoMode = features.data_mode === 'demo'
    const isCloudMode = features.data_mode === 'cloud'
    const isHybridMode = features.data_mode === 'hybrid'
    const isLocked = isWorkspaceCurrentlyLocked(features)
    const planCapabilities = overrides.length
        ? applyWorkspaceOverrides(getPlanCapabilities(features.plan), overrides)
        : getPlanCapabilities(features.plan)

    return (
        <WorkspaceContext.Provider value={{
            features,
            plan: features.plan,
            planCapabilities,
            workspaceName,
            branchInfo,
            isLoading,
            pendingUpdate,
            setPendingUpdate,
            isLocked,
            isLocalMode,
            isDemoMode,
            isCloudMode,
            isHybridMode,
            hasFeature,
            hasCapability,
            isFullscreen,
            refreshFeatures,
            updateSettings,
            switchDataMode,
            activeWorkspace: user?.workspaceId ? { id: user.workspaceId } : undefined
        }}>
            {children}
        </WorkspaceContext.Provider>
    )
}

export function useWorkspace() {
    const context = useContext(WorkspaceContext)
    if (context === undefined) {
        throw new Error('useWorkspace must be used within a WorkspaceProvider')
    }
    return context
}
