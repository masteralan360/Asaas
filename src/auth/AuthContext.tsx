import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import type { User, Session } from '@supabase/supabase-js'
import type { UserRole } from '@/local-db/models'

interface AuthUser {
    id: string
    email: string
    name: string
    role: UserRole
    avatarUrl?: string
}

interface AuthContextType {
    user: AuthUser | null
    session: Session | null
    isLoading: boolean
    isAuthenticated: boolean
    isSupabaseConfigured: boolean
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>
    signUp: (email: string, password: string, name: string, role?: UserRole, passkey?: string) => Promise<{ error: Error | null }>
    signOut: () => Promise<void>
    hasRole: (roles: UserRole[]) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Demo user for offline/non-configured mode
const DEMO_USER: AuthUser = {
    id: 'demo-user',
    email: 'demo@erp-system.local',
    name: 'Demo User',
    role: 'admin',
    avatarUrl: undefined
}

function parseUserFromSupabase(user: User): AuthUser {
    return {
        id: user.id,
        email: user.email ?? '',
        name: user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User',
        role: (user.user_metadata?.role as UserRole) ?? 'viewer',
        avatarUrl: user.user_metadata?.avatar_url
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
            setUser(session?.user ? parseUserFromSupabase(session.user) : null)
            setIsLoading(false)
        })

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
            setUser(session?.user ? parseUserFromSupabase(session.user) : null)
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

    const signUp = async (email: string, password: string, name: string, role: UserRole = 'viewer', passkey?: string) => {
        if (!isSupabaseConfigured) {
            setUser({ ...DEMO_USER, email, name, role })
            return { error: null }
        }

        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    name,
                    role,
                    passkey // This will be checked by the database trigger
                }
            }
        })
        return { error: error as Error | null }
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

    return (
        <AuthContext.Provider
            value={{
                user,
                session,
                isLoading,
                isAuthenticated: !!user,
                isSupabaseConfigured,
                signIn,
                signUp,
                signOut,
                hasRole
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
