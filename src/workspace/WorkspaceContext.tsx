import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '@/auth/supabase'
import { useAuth } from '@/auth'

export interface WorkspaceFeatures {
    allow_pos: boolean
    allow_customers: boolean
    allow_orders: boolean
    allow_invoices: boolean
    is_configured: boolean
}

interface WorkspaceContextType {
    features: WorkspaceFeatures
    isLoading: boolean
    hasFeature: (feature: keyof Omit<WorkspaceFeatures, 'is_configured'>) => boolean
    refreshFeatures: () => Promise<void>
}

const defaultFeatures: WorkspaceFeatures = {
    allow_pos: true,
    allow_customers: true,
    allow_orders: true,
    allow_invoices: true,
    is_configured: true
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated } = useAuth()
    const [features, setFeatures] = useState<WorkspaceFeatures>(defaultFeatures)
    const [isLoading, setIsLoading] = useState(true)

    const fetchFeatures = async () => {
        if (!isSupabaseConfigured || !isAuthenticated || !user?.workspaceId) {
            // Demo mode or not authenticated - enable all features
            setFeatures(defaultFeatures)
            setIsLoading(false)
            return
        }

        try {
            const { data, error } = await supabase.rpc('get_workspace_features')

            if (error) {
                console.error('Error fetching workspace features:', error)
                setFeatures(defaultFeatures)
            } else if (data) {
                setFeatures({
                    allow_pos: data.allow_pos ?? false,
                    allow_customers: data.allow_customers ?? false,
                    allow_orders: data.allow_orders ?? false,
                    allow_invoices: data.allow_invoices ?? false,
                    is_configured: data.is_configured ?? false
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
        if (isAuthenticated && user?.workspaceId) {
            fetchFeatures()
        } else {
            setFeatures(defaultFeatures)
            setIsLoading(false)
        }
    }, [isAuthenticated, user?.workspaceId])

    const hasFeature = (feature: keyof Omit<WorkspaceFeatures, 'is_configured'>): boolean => {
        return features[feature] ?? false
    }

    const refreshFeatures = async () => {
        setIsLoading(true)
        await fetchFeatures()
    }

    return (
        <WorkspaceContext.Provider value={{ features, isLoading, hasFeature, refreshFeatures }}>
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
