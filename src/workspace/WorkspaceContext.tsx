import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '@/auth/supabase'
import { useAuth } from '@/auth/AuthContext'
import type { CurrencyCode, IQDDisplayPreference } from '@/local-db/models'
import { db } from '@/local-db/database'
import { addToOfflineMutations } from '@/local-db/hooks'
import { isMobile } from '@/lib/platform'

export interface WorkspaceFeatures {
    allow_pos: boolean
    allow_customers: boolean
    allow_orders: boolean
    allow_invoices: boolean
    is_configured: boolean
    default_currency: CurrencyCode
    iqd_display_preference: IQDDisplayPreference
    eur_conversion_enabled: boolean
    try_conversion_enabled: boolean
    locked_workspace: boolean
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
    hasFeature: (feature: 'allow_pos' | 'allow_customers' | 'allow_orders' | 'allow_invoices') => boolean
    refreshFeatures: () => Promise<void>
    updateSettings: (settings: Partial<Pick<WorkspaceFeatures, 'default_currency' | 'iqd_display_preference' | 'eur_conversion_enabled' | 'try_conversion_enabled'>>) => Promise<void>
}

const defaultFeatures: WorkspaceFeatures = {
    allow_pos: true,
    allow_customers: true,
    allow_orders: true,
    allow_invoices: true,
    is_configured: true,
    default_currency: 'usd',
    iqd_display_preference: 'IQD',
    eur_conversion_enabled: false,
    try_conversion_enabled: false,
    locked_workspace: false
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth()
    const [features, setFeatures] = useState<WorkspaceFeatures>(defaultFeatures)
    const [workspaceName, setWorkspaceName] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)

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

    const fetchFeatures = async () => {
        if (!isSupabaseConfigured || !isAuthenticated || !user?.workspaceId) {
            // Demo mode or not authenticated - enable all features
            setFeatures(defaultFeatures)
            setIsLoading(false)
            return
        }

        try {
            const { data, error } = await supabase.rpc('get_workspace_features').single()
            if (error) {
                console.error('Error fetching workspace features from Supabase:', error)
                // Try to load from local DB if Supabase fails
                const localWorkspace = await db.workspaces.get(user.workspaceId)
                if (localWorkspace) {
                    setFeatures({
                        allow_pos: localWorkspace.allow_pos ?? true,
                        allow_customers: localWorkspace.allow_customers ?? true,
                        allow_orders: localWorkspace.allow_orders ?? true,
                        allow_invoices: localWorkspace.allow_invoices ?? true,
                        is_configured: true,
                        default_currency: localWorkspace.default_currency,
                        iqd_display_preference: localWorkspace.iqd_display_preference,
                        eur_conversion_enabled: (localWorkspace as any).eur_conversion_enabled ?? false,
                        try_conversion_enabled: (localWorkspace as any).try_conversion_enabled ?? false,
                        locked_workspace: (localWorkspace as any).locked_workspace ?? false
                    })
                } else {
                    setFeatures(defaultFeatures)
                }
            } else if (data) {
                const featureData = data as any
                const fetchedFeatures: WorkspaceFeatures = {
                    allow_pos: featureData.allow_pos ?? false,
                    allow_customers: featureData.allow_customers ?? false,
                    allow_orders: featureData.allow_orders ?? false,
                    allow_invoices: featureData.allow_invoices ?? false,
                    is_configured: featureData.is_configured ?? false,
                    default_currency: featureData.default_currency || 'usd',
                    iqd_display_preference: featureData.iqd_display_preference || 'IQD',
                    eur_conversion_enabled: featureData.eur_conversion_enabled ?? false,
                    try_conversion_enabled: featureData.try_conversion_enabled ?? false,
                    locked_workspace: featureData.locked_workspace ?? false
                }
                setFeatures(fetchedFeatures)
                setWorkspaceName(featureData.workspace_name || 'My Workspace')

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
                    allow_orders: fetchedFeatures.allow_orders,
                    allow_invoices: fetchedFeatures.allow_invoices,
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
            setFeatures(defaultFeatures)
        } finally {
            setIsLoading(false)
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

    const hasFeature = (feature: 'allow_pos' | 'allow_customers' | 'allow_orders' | 'allow_invoices'): boolean => {
        return features[feature] === true
    }

    const refreshFeatures = async () => {
        setIsLoading(true)
        await fetchFeatures()
    }

    const updateSettings = async (settings: Partial<Pick<WorkspaceFeatures, 'default_currency' | 'iqd_display_preference' | 'eur_conversion_enabled' | 'try_conversion_enabled'>>) => {
        const workspaceId = user?.workspaceId
        if (!workspaceId) return

        // Optimistically update local state
        setFeatures(prev => ({ ...prev, ...settings }))

        // Update local DB cache
        const existing = await db.workspaces.get(workspaceId)
        if (existing) {
            await db.workspaces.update(workspaceId, {
                ...settings,
                updatedAt: new Date().toISOString()
            })
        } else {
            // If doesn't exist locally, create it
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
            // OFFLINE: Add to mutation queue
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
            updateSettings
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
