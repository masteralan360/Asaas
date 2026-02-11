import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '@/auth/supabase'
import { useAuth } from '@/auth/AuthContext'
import type { CurrencyCode, IQDDisplayPreference } from '@/local-db/models'
import { db } from '@/local-db/database'
import { addToOfflineMutations } from '@/local-db/hooks'
import { isMobile } from '@/lib/platform'
import { connectionManager } from '@/lib/connectionManager'

export interface WorkspaceFeatures {
    allow_pos: boolean
    allow_customers: boolean
    allow_suppliers: boolean
    allow_orders: boolean
    allow_invoices: boolean
    is_configured: boolean
    default_currency: CurrencyCode
    iqd_display_preference: IQDDisplayPreference
    eur_conversion_enabled: boolean
    try_conversion_enabled: boolean
    locked_workspace: boolean
    logo_url: string | null
    // Negotiated price limit (0-100 percentage, default 100 = no limit)
    max_discount_percent: number
    allow_whatsapp: boolean
}

export interface UpdateInfo {
    version: string
    date?: string
    body?: string
}

interface WorkspaceContextType {
    features: WorkspaceFeatures
    workspaceName: string | null
    isLoading: boolean
    pendingUpdate: UpdateInfo | null
    setPendingUpdate: (update: UpdateInfo | null) => void
    isFullscreen: boolean
    hasFeature: (feature: 'allow_pos' | 'allow_customers' | 'allow_suppliers' | 'allow_orders' | 'allow_invoices' | 'allow_whatsapp') => boolean
    refreshFeatures: () => Promise<void>
    updateSettings: (settings: Partial<Pick<WorkspaceFeatures, 'default_currency' | 'iqd_display_preference' | 'eur_conversion_enabled' | 'try_conversion_enabled' | 'allow_whatsapp' | 'logo_url'>>) => Promise<void>
    activeWorkspace: { id: string } | undefined
}

const defaultFeatures: WorkspaceFeatures = {
    allow_pos: true,
    allow_customers: true,
    allow_suppliers: true,
    allow_orders: true,
    allow_invoices: true,
    is_configured: true,
    default_currency: 'usd',
    iqd_display_preference: 'IQD',
    eur_conversion_enabled: false,
    try_conversion_enabled: false,
    locked_workspace: false,
    logo_url: null,
    max_discount_percent: 100,
    allow_whatsapp: false
}

const WORKSPACE_CACHE_KEY = 'asaas_workspace_cache'

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth()

    // Initialize state from LocalStorage for instant hydration
    const [features, setFeatures] = useState<WorkspaceFeatures>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem(WORKSPACE_CACHE_KEY)
            if (cached) {
                try {
                    const parsed = JSON.parse(cached)
                    return { ...defaultFeatures, ...parsed.features }
                } catch (e) {
                    return defaultFeatures
                }
            }
        }
        return defaultFeatures
    })

    const [workspaceName, setWorkspaceName] = useState<string | null>(() => {
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem(WORKSPACE_CACHE_KEY)
            if (cached) {
                try {
                    return JSON.parse(cached).workspaceName || null
                } catch (e) {
                    return null
                }
            }
        }
        return null
    })

    // If cache exists, we start as "not loading" to avoid flashes
    const [isLoading, setIsLoading] = useState(() => {
        if (typeof window !== 'undefined') {
            return !localStorage.getItem(WORKSPACE_CACHE_KEY)
        }
        return true
    })
    const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

    // Tauri-only: Track Fullscreen State
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

        let unlisten: () => void
        const setup = async () => {
            const { getCurrentWindow } = await import('@tauri-apps/api/window')
            unlisten = await getCurrentWindow().onResized(updateFSState)
        }
        setup()

        return () => unlisten?.()
    }, [])

    const fetchFeatures = async (silent = false) => {
        if (!isSupabaseConfigured || !isAuthenticated || !user?.workspaceId) {
            setFeatures(defaultFeatures)
            if (!silent) setIsLoading(false)
            return
        }

        try {
            const rpcPromise = supabase.rpc('get_workspace_features').single()
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Workspace features fetch timed out')), 5000)
            )

            const { data, error } = await Promise.race([rpcPromise, timeoutPromise]) as any

            if (error) {
                console.error('Error fetching workspace features from Supabase:', error)
                // Try to load from local DB if Supabase fails
                const localWorkspace = await db.workspaces.get(user.workspaceId)
                if (localWorkspace) {
                    setFeatures({
                        allow_pos: localWorkspace.allow_pos ?? true,
                        allow_customers: localWorkspace.allow_customers ?? true,
                        allow_suppliers: localWorkspace.allow_suppliers ?? true,
                        allow_orders: localWorkspace.allow_orders ?? true,
                        allow_invoices: localWorkspace.allow_invoices ?? true,
                        is_configured: true,
                        default_currency: localWorkspace.default_currency,
                        iqd_display_preference: localWorkspace.iqd_display_preference,
                        eur_conversion_enabled: (localWorkspace as any).eur_conversion_enabled ?? false,
                        try_conversion_enabled: (localWorkspace as any).try_conversion_enabled ?? false,
                        locked_workspace: (localWorkspace as any).locked_workspace ?? false,
                        logo_url: (localWorkspace as any).logo_url ?? null,
                        max_discount_percent: (localWorkspace as any).max_discount_percent ?? 100,
                        allow_whatsapp: (localWorkspace as any).allow_whatsapp ?? false
                    })
                } else {
                    setFeatures(defaultFeatures)
                }
            } else if (data) {
                const featureData = data as any
                const fetchedFeatures: WorkspaceFeatures = {
                    allow_pos: featureData.allow_pos ?? true,
                    allow_customers: featureData.allow_customers ?? true,
                    allow_suppliers: featureData.allow_suppliers ?? true,
                    allow_orders: featureData.allow_orders ?? true,
                    allow_invoices: featureData.allow_invoices ?? true,
                    is_configured: featureData.is_configured ?? true,
                    default_currency: featureData.default_currency || 'usd',
                    iqd_display_preference: featureData.iqd_display_preference || 'IQD',
                    eur_conversion_enabled: featureData.eur_conversion_enabled ?? false,
                    try_conversion_enabled: featureData.try_conversion_enabled ?? false,
                    locked_workspace: featureData.locked_workspace ?? false,
                    logo_url: featureData.logo_url ?? null,
                    max_discount_percent: featureData.max_discount_percent ?? 100,
                    allow_whatsapp: featureData.allow_whatsapp ?? false
                }
                setFeatures(fetchedFeatures)
                setWorkspaceName(featureData.workspace_name || 'My Workspace')

                // Update Local Cache for next refresh
                localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify({
                    features: fetchedFeatures,
                    workspaceName: featureData.workspace_name || 'My Workspace'
                }))

                // Cache in local DB for offline access
                await db.workspaces.put({
                    id: user.workspaceId,
                    workspaceId: user.workspaceId,
                    name: featureData.workspace_name || 'My Workspace',
                    code: 'LOADED',
                    default_currency: fetchedFeatures.default_currency,
                    iqd_display_preference: fetchedFeatures.iqd_display_preference,
                    eur_conversion_enabled: fetchedFeatures.eur_conversion_enabled,
                    try_conversion_enabled: fetchedFeatures.try_conversion_enabled,
                    locked_workspace: fetchedFeatures.locked_workspace,
                    allow_pos: fetchedFeatures.allow_pos,
                    allow_customers: fetchedFeatures.allow_customers,
                    allow_suppliers: fetchedFeatures.allow_suppliers,
                    allow_orders: fetchedFeatures.allow_orders,
                    allow_invoices: fetchedFeatures.allow_invoices,
                    allow_whatsapp: fetchedFeatures.allow_whatsapp,
                    logo_url: fetchedFeatures.logo_url,
                    syncStatus: 'synced',
                    lastSyncedAt: new Date().toISOString(),
                    version: 1,
                    isDeleted: false,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                })
            }
        } catch (err) {
            console.error('Error fetching workspace features:', err)
            if (!silent) setFeatures(defaultFeatures)
        } finally {
            if (!silent) setIsLoading(false)
        }
    }

    useEffect(() => {
        if (authLoading) return

        if (isAuthenticated && user?.workspaceId) {
            fetchFeatures()
        } else {
            setFeatures(defaultFeatures)
            setIsLoading(false)
        }
    }, [isAuthenticated, user?.workspaceId, authLoading])

    // ───────────────────────────────────────────────────────
    // RESILIENCE: Supabase Realtime subscription for live workspace changes
    // ───────────────────────────────────────────────────────
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
                (payload) => {
                    console.log('[Workspace] Realtime update received:', payload.new)
                    const data = payload.new as any

                    const updatedFeatures: WorkspaceFeatures = {
                        allow_pos: data.allow_pos ?? features.allow_pos,
                        allow_customers: data.allow_customers ?? features.allow_customers,
                        allow_suppliers: data.allow_suppliers ?? features.allow_suppliers,
                        allow_orders: data.allow_orders ?? features.allow_orders,
                        allow_invoices: data.allow_invoices ?? features.allow_invoices,
                        is_configured: data.is_configured ?? features.is_configured,
                        default_currency: data.default_currency || features.default_currency,
                        iqd_display_preference: data.iqd_display_preference || features.iqd_display_preference,
                        eur_conversion_enabled: data.eur_conversion_enabled ?? features.eur_conversion_enabled,
                        try_conversion_enabled: data.try_conversion_enabled ?? features.try_conversion_enabled,
                        locked_workspace: data.locked_workspace ?? features.locked_workspace,
                        logo_url: data.logo_url ?? features.logo_url,
                        max_discount_percent: data.max_discount_percent ?? features.max_discount_percent,
                        allow_whatsapp: data.allow_whatsapp ?? features.allow_whatsapp
                    }

                    setFeatures(updatedFeatures)
                    setWorkspaceName(data.name || workspaceName)

                    // Update cache
                    localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify({
                        features: updatedFeatures,
                        workspaceName: data.name || workspaceName
                    }))
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
    }, [isAuthenticated, user?.workspaceId])

    // ───────────────────────────────────────────────────────
    // RESILIENCE: Re-fetch on wake (backup for Realtime failures)
    // ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!isSupabaseConfigured || !isAuthenticated || !user?.workspaceId) return

        const unsubscribe = connectionManager.subscribe((event) => {
            if (event === 'wake') {
                console.log('[Workspace] Wake event — re-fetching features silently')
                fetchFeatures(true) // silent = true, no loading state change
            }
        })

        return unsubscribe
    }, [isAuthenticated, user?.workspaceId])

    const hasFeature = (feature: 'allow_pos' | 'allow_customers' | 'allow_suppliers' | 'allow_orders' | 'allow_invoices' | 'allow_whatsapp'): boolean => {
        return features[feature] === true
    }

    const refreshFeatures = async () => {
        setIsLoading(true)
        await fetchFeatures()
    }

    const updateSettings = async (settings: Partial<Pick<WorkspaceFeatures, 'default_currency' | 'iqd_display_preference' | 'eur_conversion_enabled' | 'try_conversion_enabled' | 'allow_whatsapp' | 'logo_url'>>) => {
        const workspaceId = user?.workspaceId
        if (!workspaceId) return

        // Optimistically update local state
        const newFeatures = { ...features, ...settings }
        setFeatures(newFeatures)

        // Update Local Cache
        localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify({
            features: newFeatures,
            workspaceName
        }))

        // Update local DB cache
        const existing = await db.workspaces.get(workspaceId)
        if (existing) {
            await db.workspaces.update(workspaceId, {
                ...settings,
                updatedAt: new Date().toISOString()
            })
        } else {
            await db.workspaces.put({
                id: workspaceId,
                workspaceId,
                name: 'My Workspace',
                code: 'LOCAL',
                default_currency: settings.default_currency || 'usd',
                iqd_display_preference: settings.iqd_display_preference || 'IQD',
                locked_workspace: false,
                allow_pos: true,
                allow_customers: true,
                allow_suppliers: true,
                allow_orders: true,
                allow_invoices: true,
                syncStatus: 'pending',
                lastSyncedAt: null,
                version: 1,
                isDeleted: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            })
        }

        if (navigator.onLine) {
            const { error } = await supabase
                .from('workspaces')
                .update(settings)
                .eq('id', workspaceId)

            if (error) {
                console.error('Error updating workspace settings on Supabase:', error)
                await addToOfflineMutations('workspaces', workspaceId, 'update', settings as Record<string, unknown>, workspaceId)
            }
        } else {
            await addToOfflineMutations('workspaces', workspaceId, 'update', settings as Record<string, unknown>, workspaceId)
        }
    }

    return (
        <WorkspaceContext.Provider value={{
            features,
            workspaceName,
            isLoading,
            pendingUpdate,
            setPendingUpdate,
            isFullscreen,
            hasFeature,
            refreshFeatures,
            updateSettings,
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
