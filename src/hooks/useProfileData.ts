import { useState, useEffect } from 'react'
import { supabase } from '@/auth/supabase'
import { runSupabaseAction, normalizeSupabaseActionError } from '@/lib/supabaseRequest'
import { useAuth } from '@/auth'

export interface ProfileData {
    id: string
    name: string
    role: string
    profile_url?: string
    created_at: string
    workspace_id?: string
}

interface UseProfileDataResult {
    profile: ProfileData | null
    isLoading: boolean
    error: string | null
    isCurrentUser: boolean
}

export function useProfileData(userId: string | null): UseProfileDataResult {
    const { user } = useAuth()
    const [profile, setProfile] = useState<ProfileData | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!userId) {
            setProfile(null)
            setIsLoading(false)
            setError(null)
            return
        }

        let cancelled = false

        const fetchProfile = async () => {
            setIsLoading(true)
            setError(null)

            try {
                const { data, error } = await runSupabaseAction('profileCard.fetch', () =>
                    supabase
                        .from('profiles')
                        .select('id, name, role, created_at, profile_url, workspace_id')
                        .eq('id', userId)
                        .maybeSingle()
                )

                if (cancelled) return

                if (error) throw normalizeSupabaseActionError(error)

                if (!data) {
                    setError('User not found')
                    setProfile(null)
                    return
                }

                setProfile(data as ProfileData)
            } catch (err) {
                if (!cancelled) {
                    console.error('Error fetching profile:', err)
                    setError(err instanceof Error ? err.message : 'Failed to load profile')
                }
            } finally {
                if (!cancelled) setIsLoading(false)
            }
        }

        fetchProfile()

        return () => { cancelled = true }
    }, [userId])

    return {
        profile,
        isLoading,
        error,
        isCurrentUser: !!(profile && user && profile.id === user.id)
    }
}
