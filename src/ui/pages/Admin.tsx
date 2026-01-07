import React, { useState, useEffect } from 'react'
import {
    Trash2,
    LogOut,
    RefreshCw,
    ShieldCheck,
    Clock,
    User as UserIcon,
    Mail,
    Calendar
} from 'lucide-react'
import { Button } from '@/ui/components/button'
import { supabase, isSupabaseConfigured } from '@/auth/supabase'
import { useLocation } from 'wouter'

const SESSION_DURATION = 60 // seconds

interface AdminUser {
    id: string
    name: string
    role: string
    created_at: string
    email?: string
}

export function Admin() {
    const [,] = useLocation()
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [passkey, setPasskey] = useState('')
    const [error, setError] = useState('')
    const [users, setUsers] = useState<AdminUser[]>([])
    const [timeLeft, setTimeLeft] = useState(SESSION_DURATION)
    const [isLoading, setIsLoading] = useState(false)

    // Handle session timeout
    useEffect(() => {
        if (!isAuthenticated) return

        if (timeLeft <= 0) {
            handleLogout()
            return
        }

        const timer = setInterval(() => {
            setTimeLeft(prev => prev - 1)
        }, 1000)

        return () => clearInterval(timer)
    }, [isAuthenticated, timeLeft])

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setError('')
        try {
            const { data: isValid, error: rpcError } = await supabase.rpc('verify_admin_passkey', { provided_key: passkey })

            if (rpcError) throw rpcError

            if (isValid) {
                setIsAuthenticated(true)
                setTimeLeft(SESSION_DURATION)
                fetchUsers()
            } else {
                setError('Invalid passkey. Access denied.')
            }
        } catch (err: any) {
            setError('Verification failed: ' + err.message)
        } finally {
            setIsLoading(false)
        }
    }

    const handleLogout = () => {
        setIsAuthenticated(false)
        setPasskey('')
        setUsers([])
    }

    const fetchUsers = async () => {
        if (!isSupabaseConfigured) {
            console.warn('[Admin] fetchUsers: Supabase is NOT configured. Showing demo empty list.')
            setUsers([])
            return
        }

        setIsLoading(true)
        console.log('[Admin] Fetching all users...')
        try {
            const { data, error: rpcError } = await supabase.rpc('get_all_users', { provided_key: passkey })

            if (rpcError) {
                console.error('[Admin] RPC Error:', rpcError)
                throw rpcError
            }

            console.log(`[Admin] Received ${data?.length || 0} users from RPC`)
            setUsers(data as AdminUser[])
        } catch (err: any) {
            console.error('[Admin] fetchUsers FAILED:', err)
            setError('Failed to fetch users: ' + (err.message || JSON.stringify(err)))
        } finally {
            setIsLoading(false)
        }
    }

    const handleDeleteUser = async (id: string) => {
        if (!confirm('Are you sure you want to delete this user account? This cannot be undone.')) return

        try {
            const { error } = await supabase.rpc('delete_user_account', { target_user_id: id })
            if (error) throw error

            setUsers(users.filter(u => u.id !== id))
        } catch (err: any) {
            alert('Failed to delete user: ' + err.message)
        }
    }

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <div className="w-full max-w-sm bg-card rounded-2xl border border-border p-8 shadow-xl">
                    <div className="flex justify-center mb-6">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                            <ShieldCheck className="w-6 h-6" />
                        </div>
                    </div>
                    <div className="text-center mb-8">
                        <h1 className="text-2xl font-bold mb-2">Admin Access</h1>
                        <p className="text-sm text-muted-foreground">Please enter the admin passkey to continue.</p>
                    </div>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <input
                                type="password"
                                placeholder="Enter passkey"
                                value={passkey}
                                onChange={(e) => setPasskey(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-mono"
                                autoFocus
                            />
                        </div>
                        {error && <p className="text-xs text-destructive text-center mb-4">{error}</p>}
                        {!isSupabaseConfigured && (
                            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-4">
                                <p className="text-xs text-amber-500 text-center">
                                    Supabase is not configured. Admin features require a live Supabase connection.
                                </p>
                            </div>
                        )}
                        <Button
                            type="submit"
                            className="w-full py-6 rounded-xl text-md font-semibold"
                            disabled={isLoading || !isSupabaseConfigured}
                        >
                            {isLoading ? 'Verifying...' : 'Submit'}
                        </Button>
                    </form>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background text-foreground p-4 lg:p-8">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                            <ShieldCheck className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>Manage users and system settings.</span>
                                <span className="flex items-center gap-1 text-primary animate-pulse">
                                    <Clock className="w-3 h-3" />
                                    Session expires in {timeLeft}s.
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Button variant="outline" onClick={fetchUsers} disabled={isLoading} className="rounded-xl">
                            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                            Refresh Users
                        </Button>
                        <Button variant="outline" onClick={handleLogout} className="rounded-xl border-destructive/20 text-destructive hover:bg-destructive/5">
                            <LogOut className="w-4 h-4 mr-2" />
                            Logout
                        </Button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-border bg-muted/5">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            Registered Users
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            A total of {users.length} users are currently registered.
                        </p>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="bg-muted/30">
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Username</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Joined</th>
                                    <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {users.map((user) => (
                                    <tr key={user.id} className="hover:bg-muted/10 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-sm font-bold border border-border overflow-hidden">
                                                    {user.name?.charAt(0).toUpperCase() || <UserIcon className="w-5 h-5" />}
                                                </div>
                                                <div>
                                                    <div className="font-medium">{user.name}</div>
                                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Mail className="w-3 h-3" />
                                                        {user.email}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 rounded bg-muted text-xs font-mono">
                                                @{user.name?.toLowerCase().replace(/\s+/g, '')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm flex items-center gap-1.5 text-muted-foreground">
                                                <Calendar className="w-3.5 h-3.5" />
                                                {new Date(user.created_at).toLocaleDateString()}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => handleDeleteUser(user.id)}
                                                className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                title="Delete User"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {users.length === 0 && !isLoading && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                                            No users found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    )
}
