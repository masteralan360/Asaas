import { useState, useEffect } from 'react'
import { supabase } from '@/auth/supabase'
import { runSupabaseAction, normalizeSupabaseActionError } from '@/lib/supabaseRequest'
import { useAuth } from '@/auth'
import { db } from '@/local-db'

export interface ProfileData {
    id: string
    name: string
    role: string
    profile_url?: string
    created_at: string
    workspace_id?: string
    current_workspace?: string
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
    const [isLoading, setIsLoading] = useState(() => Boolean(userId))
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

            // Profiles are warmed into Dexie with the workspace data. Use that
            // value immediately, then refresh it from Supabase in the background.
            // This prevents callers from having to temporarily show a UUID.
            void db.profiles.get(userId).then((cachedProfile) => {
                if (cancelled || !cachedProfile?.name?.trim()) return
                setProfile({
                    id: cachedProfile.id,
                    name: cachedProfile.name,
                    role: cachedProfile.role || '',
                    profile_url: cachedProfile.profile_url ?? undefined,
                    created_at: cachedProfile.created_at || '',
                    workspace_id: cachedProfile.workspaceId,
                    current_workspace: cachedProfile.currentWorkspaceId
                })
            }).catch((cacheError) => {
                console.warn('Unable to read cached profile:', cacheError)
            })

            try {
                const { data, error } = await runSupabaseAction('profileCard.fetch', () =>
                    supabase
                        .from('profiles')
                        .select('id, name, role, created_at, profile_url, workspace_id, current_workspace')
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
                db.profiles.put({
                    id: data.id,
                    workspaceId: data.workspace_id || '',
                    currentWorkspaceId: data.current_workspace || data.workspace_id || '',
                    name: data.name,
                    role: data.role || '',
                    profile_url: data.profile_url,
                    created_at: data.created_at,
                }).catch(console.error)
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
