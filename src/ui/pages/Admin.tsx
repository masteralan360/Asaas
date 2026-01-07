import React, { useState, useEffect } from 'react'
import {
    Trash2,
    LogOut,
    RefreshCw,
    ShieldCheck,
    Clock,
    User as UserIcon,
    Mail,
    Calendar,
    Building2,
    CheckCircle2,
    XCircle
} from 'lucide-react'
import {
    Button,
    LanguageSwitcher,
    ThemeToggle,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    Switch,
    useToast
} from '@/ui/components'
import { supabase, isSupabaseConfigured } from '@/auth/supabase'
import { useLocation } from 'wouter'

const SESSION_DURATION = 60 // seconds

interface AdminUser {
    id: string
    name: string
    role: string
    created_at: string
    email?: string
    workspace_name?: string
}

interface AdminWorkspace {
    id: string
    name: string
    code: string
    created_at: string
    allow_pos: boolean
    allow_customers: boolean
    allow_orders: boolean
    allow_invoices: boolean
    is_configured: boolean
    deleted_at?: string | null
}

export function Admin() {
    const [,] = useLocation()
    const { toast } = useToast()
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [passkey, setPasskey] = useState('')
    const [error, setError] = useState('')

    // Data State
    const [users, setUsers] = useState<AdminUser[]>([])
    const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([])

    // UI State
    const [timeLeft, setTimeLeft] = useState(SESSION_DURATION)
    const [isLoading, setIsLoading] = useState(false)
    const [activeTab, setActiveTab] = useState('users')
    const [showDeleted, setShowDeleted] = useState(false)

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
                fetchData()
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
        setWorkspaces([])
        setShowDeleted(false)
    }

    const fetchData = async () => {
        if (!isSupabaseConfigured) {
            console.warn('[Admin] Supabase is NOT configured. Showing demo empty list.')
            setUsers([])
            setWorkspaces([])
            return
        }

        setIsLoading(true)
        // Fetch both users and workspaces
        try {
            // 1. Fetch Users
            const { data: userData, error: userError } = await supabase.rpc('get_all_users', { provided_key: passkey })
            if (userError) throw userError
            setUsers(userData as AdminUser[])

            // 2. Fetch Workspaces
            const { data: wsData, error: wsError } = await supabase.rpc('get_all_workspaces', { provided_key: passkey })
            if (wsError) throw wsError
            setWorkspaces(wsData as AdminWorkspace[])

        } catch (err: any) {
            console.error('[Admin] fetchData FAILED:', err)
            setError('Failed to fetch data: ' + (err.message || JSON.stringify(err)))
            toast({
                variant: "destructive",
                title: "Error fetching data",
                description: err.message
            })
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
            // Refresh logic might be needed if workspace deletion happened implicitly
            // But let's assume user wants to see immediate update. 
            // Ideally we re-fetch to see deleted workspace status update
            fetchData()

            toast({ title: "User deleted successfully" })
        } catch (err: any) {
            alert('Failed to delete user: ' + err.message)
        }
    }

    const handleToggleWorkspaceFeature = async (workspaceId: string, feature: keyof AdminWorkspace, currentValue: boolean) => {
        // Optimistic update
        setWorkspaces(prev => prev.map(ws =>
            ws.id === workspaceId ? { ...ws, [feature]: !currentValue } : ws
        ))

        const workspace = workspaces.find(w => w.id === workspaceId)
        if (!workspace) return

        // Prepare new values (toggling the specific feature)
        const newValues = {
            allow_pos: feature === 'allow_pos' ? !workspace.allow_pos : workspace.allow_pos,
            allow_customers: feature === 'allow_customers' ? !workspace.allow_customers : workspace.allow_customers,
            allow_orders: feature === 'allow_orders' ? !workspace.allow_orders : workspace.allow_orders,
            allow_invoices: feature === 'allow_invoices' ? !workspace.allow_invoices : workspace.allow_invoices,
        }

        try {
            const { error } = await supabase.rpc('admin_update_workspace_features', {
                provided_key: passkey,
                target_workspace_id: workspaceId,
                new_allow_pos: newValues.allow_pos,
                new_allow_customers: newValues.allow_customers,
                new_allow_orders: newValues.allow_orders,
                new_allow_invoices: newValues.allow_invoices
            })

            if (error) throw error

            // Success toast optional to avoid spamming, but good for confirmation
            // toast({ title: "Workspace updated" })
        } catch (err: any) {
            console.error('Failed to update workspace:', err)
            // Revert on failure
            setWorkspaces(prev => prev.map(ws =>
                ws.id === workspaceId ? { ...ws, [feature]: currentValue } : ws
            ))
            toast({
                variant: "destructive",
                title: "Update failed",
                description: err.message
            })
        }
    }

    // Filter workspaces based on showDeleted toggle
    const filteredWorkspaces = workspaces.filter(ws => showDeleted ? true : !ws.deleted_at)

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
                <div className="absolute top-4 right-4 flex items-center gap-2">
                    <LanguageSwitcher />
                    <ThemeToggle />
                </div>
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
                                <span>Manage users and workspace configurations.</span>
                                <span className="flex items-center gap-1 text-primary animate-pulse">
                                    <Clock className="w-3 h-3" />
                                    Session expires in {timeLeft}s.
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <LanguageSwitcher />
                        <ThemeToggle />
                        <Button variant="outline" onClick={fetchData} disabled={isLoading} className="rounded-xl">
                            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                            Refresh Data
                        </Button>
                        <Button variant="outline" onClick={handleLogout} className="rounded-xl border-destructive/20 text-destructive hover:bg-destructive/5">
                            <LogOut className="w-4 h-4 mr-2" />
                            Logout
                        </Button>
                    </div>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                    <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
                        <TabsTrigger value="users">Registered Users</TabsTrigger>
                        <TabsTrigger value="workspaces">Workspace Configuration</TabsTrigger>
                    </TabsList>

                    {/* USERS TAB */}
                    <TabsContent value="users" className="space-y-4">
                        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                            <div className="p-6 border-b border-border bg-muted/5">
                                <h2 className="text-lg font-semibold flex items-center gap-2">
                                    <UserIcon className="w-5 h-5" />
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
                                            <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</th>
                                            <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Workspace</th>
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
                                                    <span className="capitalize text-sm font-medium">
                                                        {user.role}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {user.workspace_name ? (
                                                        <span className="px-2 py-1 rounded bg-primary/10 text-primary text-xs font-medium">
                                                            {user.workspace_name}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground italic">No Workspace</span>
                                                    )}
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
                                                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                                                    No users found.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </TabsContent>

                    {/* WORKSPACES TAB */}
                    <TabsContent value="workspaces" className="space-y-4">
                        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                            <div className="p-6 border-b border-border bg-muted/5 flex items-center justify-between">
                                <div>
                                    <h2 className="text-lg font-semibold flex items-center gap-2">
                                        <Building2 className="w-5 h-5" />
                                        Workspace Configuration
                                    </h2>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Manage feature access for each workspace.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Show Deleted</span>
                                    <Switch
                                        checked={showDeleted}
                                        onCheckedChange={setShowDeleted}
                                    />
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr className="bg-muted/30">
                                            <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[30%]">Workspace</th>
                                            <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">POS</th>
                                            <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customers</th>
                                            <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Orders</th>
                                            <th className="px-6 py-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Invoices</th>
                                            <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configured</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {filteredWorkspaces.map((ws) => (
                                            <tr key={ws.id} className={`hover:bg-muted/10 transition-colors ${ws.deleted_at ? 'opacity-50 grayscale' : ''}`}>
                                                <td className="px-6 py-4">
                                                    <div>
                                                        <div className="font-medium flex items-center gap-2">
                                                            {ws.name}
                                                            <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground border border-border">
                                                                {ws.code}
                                                            </span>
                                                            {ws.deleted_at && (
                                                                <span className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive text-[10px] font-bold uppercase border border-destructive/20">
                                                                    Deleted
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                                            <Calendar className="w-3 h-3" />
                                                            {new Date(ws.created_at).toLocaleDateString()}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex justify-center">
                                                        <Switch
                                                            checked={ws.allow_pos}
                                                            onCheckedChange={() => handleToggleWorkspaceFeature(ws.id, 'allow_pos', ws.allow_pos)}
                                                            disabled={!!ws.deleted_at}
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex justify-center">
                                                        <Switch
                                                            checked={ws.allow_customers}
                                                            onCheckedChange={() => handleToggleWorkspaceFeature(ws.id, 'allow_customers', ws.allow_customers)}
                                                            disabled={!!ws.deleted_at}
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex justify-center">
                                                        <Switch
                                                            checked={ws.allow_orders}
                                                            onCheckedChange={() => handleToggleWorkspaceFeature(ws.id, 'allow_orders', ws.allow_orders)}
                                                            disabled={!!ws.deleted_at}
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex justify-center">
                                                        <Switch
                                                            checked={ws.allow_invoices}
                                                            onCheckedChange={() => handleToggleWorkspaceFeature(ws.id, 'allow_invoices', ws.allow_invoices)}
                                                            disabled={!!ws.deleted_at}
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex justify-end pr-2">
                                                        {ws.is_configured ? (
                                                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                                                        ) : (
                                                            <XCircle className="w-4 h-4 text-amber-500" />
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {filteredWorkspaces.length === 0 && !isLoading && (
                                            <tr>
                                                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                                                    {showDeleted ? 'No workspaces found.' : 'No active workspaces found.'}
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    )
}
