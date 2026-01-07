import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import type { User, Session } from '@supabase/supabase-js'
import type { UserRole } from '@/local-db/models'

interface AuthUser {
    id: string
    email: string
    name: string
    role: UserRole
    workspaceId: string
    workspaceCode: string
    workspaceName?: string
    avatarUrl?: string
    isConfigured?: boolean
}

interface AuthContextType {
    user: AuthUser | null
    session: Session | null
    isLoading: boolean
    isAuthenticated: boolean
    isKicked: boolean
    isSupabaseConfigured: boolean
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>
    signUp: (params: {
        email: string;
        password: string;
        name: string;
        role: UserRole;
        passkey: string;
        workspaceName?: string;
        workspaceCode?: string;
    }) => Promise<{ error: Error | null }>
    signOut: () => Promise<void>
    hasRole: (roles: UserRole[]) => boolean
    refreshUser: () => Promise<void>
    updateUser: (updates: Partial<AuthUser>) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Demo user for offline/non-configured mode
const DEMO_USER: AuthUser = {
    id: 'demo-user',
    email: 'demo@erp-system.local',
    name: 'Demo User',
    role: 'admin',
    workspaceId: 'demo-workspace',
    workspaceCode: 'DEMO-1234',
    workspaceName: 'Demo Workspace',
    avatarUrl: undefined
}

function parseUserFromSupabase(user: User): AuthUser {
    return {
        id: user.id,
        email: user.email ?? '',
        name: user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User',
        role: (user.user_metadata?.role as UserRole) ?? 'viewer',
        workspaceId: user.user_metadata?.workspace_id ?? '',
        workspaceCode: user.user_metadata?.workspace_code ?? '',
        workspaceName: user.user_metadata?.workspace_name,
        avatarUrl: user.user_metadata?.avatar_url,
        isConfigured: user.user_metadata?.is_configured
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null)
    const [session, setSession] = useState<Session | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        if (!isSupabaseConfigured) {
            // If Supabase is not configured, use demo user
            setUser(DEMO_USER)
            setIsLoading(false)
            return
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
            const parsedUser = session?.user ? parseUserFromSupabase(session.user) : null

            // If we have a user but no workspaceCode, fetch it
            if (parsedUser && parsedUser.workspaceId && !parsedUser.workspaceCode) {
                supabase
                    .from('workspaces')
                    .select('code, is_configured')
                    .eq('id', parsedUser.workspaceId)
                    .single()
                    .then(({ data }) => {
                        if (data) {
                            parsedUser.workspaceCode = data.code
                            parsedUser.isConfigured = data.is_configured
                            setUser({ ...parsedUser })
                        } else {
                            setUser(parsedUser)
                        }
                    })
            } else {
                setUser(parsedUser)
            }
            setIsLoading(false)
        })

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
            const parsedUser = session?.user ? parseUserFromSupabase(session.user) : null

            if (parsedUser && parsedUser.workspaceId && !parsedUser.workspaceCode) {
                supabase
                    .from('workspaces')
                    .select('code, is_configured')
                    .eq('id', parsedUser.workspaceId)
                    .single()
                    .then(({ data }) => {
                        if (data) {
                            parsedUser.workspaceCode = data.code
                            parsedUser.isConfigured = data.is_configured
                            setUser({ ...parsedUser })
                        } else {
                            setUser(parsedUser)
                        }
                    })
            } else {
                setUser(parsedUser)
            }
        })

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    const signIn = async (email: string, password: string) => {
        if (!isSupabaseConfigured) {
            setUser(DEMO_USER)
            return { error: null }
        }

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password
        })
        return { error: error as Error | null }
    }

    const signUp = async ({ email, password, name, role = 'viewer', passkey, workspaceName, workspaceCode }: {
        email: string;
        password: string;
        name: string;
        role: UserRole;
        passkey: string;
        workspaceName?: string;
        workspaceCode?: string;
    }) => {
        if (!isSupabaseConfigured) {
            setUser({ ...DEMO_USER, email, name, role, workspaceName: workspaceName || 'Local Workspace' })
            return { error: null }
        }

        let workspaceId = ''
        let resolvedWorkspaceName = workspaceName

        try {
            if (role === 'admin') {
                if (!workspaceName) throw new Error('Workspace name is required for Admins')

                // Create workspace via RPC
                const { data: wsData, error: wsError } = await supabase.rpc('create_workspace', { w_name: workspaceName })
                if (wsError) throw wsError

                workspaceId = wsData.id
                resolvedWorkspaceName = wsData.name // Should be same as workspaceName
            } else {
                if (!workspaceCode) throw new Error('Workspace code is required to join')

                // Find workspace by code
                const { data: wsData, error: wsError } = await supabase
                    .from('workspaces')
                    .select('id, name')
                    .eq('code', workspaceCode.toUpperCase())
                    .single()

                if (wsError || !wsData) throw new Error('Invalid workspace code')

                workspaceId = wsData.id
                resolvedWorkspaceName = wsData.name
            }

            // We need to get the workspaceCode if we don't have it (admin case who just created it)
            let resolvedWorkspaceCode = workspaceCode
            if (role === 'admin' && !resolvedWorkspaceCode) {
                const { data: wsData } = await supabase.from('workspaces').select('code').eq('id', workspaceId).single()
                if (wsData) resolvedWorkspaceCode = wsData.code
            }

            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        name,
                        role,
                        passkey,
                        workspace_id: workspaceId,
                        workspace_code: resolvedWorkspaceCode,
                        workspace_name: resolvedWorkspaceName
                    }
                }
            })
            return { error: error as Error | null }
        } catch (err: any) {
            return { error: err as Error }
        }
    }

    const signOut = async () => {
        if (!isSupabaseConfigured) {
            setUser(null)
            return
        }

        await supabase.auth.signOut()
        setUser(null)
        setSession(null)
    }

    const hasRole = (roles: UserRole[]): boolean => {
        if (!user) return false
        return roles.includes(user.role)
    }

    const refreshUser = async () => {
        if (!isSupabaseConfigured) return

        // Force a session refresh to get the latest token with updated metadata
        const { data: { session }, error } = await supabase.auth.refreshSession()

        if (error) {
            console.error('Error refreshing session:', error)
            return
        }

        if (session?.user) {
            // Update state with new session and user
            setSession(session)

            const parsedUser = parseUserFromSupabase(session.user)

            // Fetch workspace code if we have workspace_id
            if (parsedUser.workspaceId && !parsedUser.workspaceCode) {
                const { data: wsData } = await supabase
                    .from('workspaces')
                    .select('code, name')
                    .eq('id', parsedUser.workspaceId)
                    .single()
                if (wsData) {
                    parsedUser.workspaceCode = wsData.code
                    parsedUser.workspaceName = wsData.name
                }
            }

            setUser(parsedUser)
        }
    }

    const updateUser = (updates: Partial<AuthUser>) => {
        if (!user) return
        setUser({ ...user, ...updates })
    }

    // User is kicked if authenticated but has no workspace
    const isKicked = !!user && !user.workspaceId

    return (
        <AuthContext.Provider
            value={{
                user,
                session,
                isLoading,
                isAuthenticated: !!user,
                isKicked,
                isSupabaseConfigured,
                signIn,
                signUp,
                signOut,
                hasRole,
                refreshUser,
                updateUser
            }}
        >
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
