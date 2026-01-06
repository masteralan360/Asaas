import { useAuth } from '@/auth'
import { useSyncStatus, clearQueue } from '@/sync'
import { clearDatabase } from '@/local-db'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Label } from '@/ui/components'
import { Settings as SettingsIcon, Database, Cloud, Trash2, RefreshCw, User } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { useTheme } from '@/ui/components/theme-provider'
import { Moon, Sun, Monitor } from 'lucide-react'

export function Settings() {
    const { user, signOut, isSupabaseConfigured } = useAuth()
    const { syncState, pendingCount, lastSyncTime, sync, isSyncing, isOnline } = useSyncStatus()
    const { theme, setTheme } = useTheme()

    const handleClearSyncQueue = async () => {
        if (confirm('Clear all pending sync items? This cannot be undone.')) {
            await clearQueue()
        }
    }

    const handleClearLocalData = async () => {
        if (confirm('This will delete ALL local data including products, customers, orders, and invoices. Are you sure?')) {
            await clearDatabase()
            window.location.reload()
        }
    }

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <SettingsIcon className="w-6 h-6 text-primary" />
                    Settings
                </h1>
                <p className="text-muted-foreground">Manage your account and application settings</p>
            </div>

            {/* Theme Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Monitor className="w-5 h-5" />
                        Appearance
                    </CardTitle>
                    <CardDescription>Customize the look and feel of the application</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-2">
                        <Label>Theme</Label>
                        <div className="grid grid-cols-3 gap-2 max-w-md">
                            <Button
                                variant={theme === 'light' ? 'default' : 'outline'}
                                className="flex items-center gap-2 justify-center"
                                onClick={() => setTheme('light')}
                            >
                                <Sun className="w-4 h-4" />
                                Light
                            </Button>
                            <Button
                                variant={theme === 'dark' ? 'default' : 'outline'}
                                className="flex items-center gap-2 justify-center"
                                onClick={() => setTheme('dark')}
                            >
                                <Moon className="w-4 h-4" />
                                Dark
                            </Button>
                            <Button
                                variant={theme === 'system' ? 'default' : 'outline'}
                                className="flex items-center gap-2 justify-center"
                                onClick={() => setTheme('system')}
                            >
                                <Monitor className="w-4 h-4" />
                                System
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* User Info */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <User className="w-5 h-5" />
                        Account
                    </CardTitle>
                    <CardDescription>Your account information</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <Label className="text-muted-foreground">Name</Label>
                            <p className="font-medium">{user?.name}</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">Email</Label>
                            <p className="font-medium">{user?.email}</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">Role</Label>
                            <p className="font-medium capitalize">{user?.role}</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">Auth Mode</Label>
                            <p className="font-medium">{isSupabaseConfigured ? 'Supabase' : 'Demo (Local Only)'}</p>
                        </div>
                    </div>
                    <Button variant="destructive" onClick={signOut}>
                        Sign Out
                    </Button>
                </CardContent>
            </Card>

            {/* Sync Status */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Cloud className="w-5 h-5" />
                        Sync Status
                    </CardTitle>
                    <CardDescription>Cloud synchronization information</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <Label className="text-muted-foreground">Connection</Label>
                            <p className={`font-medium ${isOnline ? 'text-emerald-500' : 'text-red-500'}`}>
                                {isOnline ? 'Online' : 'Offline'}
                            </p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">Sync State</Label>
                            <p className="font-medium capitalize">{syncState}</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">Pending Changes</Label>
                            <p className="font-medium">{pendingCount} items</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">Last Synced</Label>
                            <p className="font-medium">
                                {lastSyncTime ? formatDateTime(lastSyncTime) : 'Never'}
                            </p>
                        </div>
                    </div>

                    {!isSupabaseConfigured && (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                            <p className="text-sm text-amber-500">
                                Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable cloud sync.
                            </p>
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button onClick={sync} disabled={isSyncing || !isOnline || !isSupabaseConfigured}>
                            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                            {isSyncing ? 'Syncing...' : 'Sync Now'}
                        </Button>
                        {pendingCount > 0 && (
                            <Button variant="outline" onClick={handleClearSyncQueue}>
                                Clear Queue
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Data Management */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Database className="w-5 h-5" />
                        Local Data
                    </CardTitle>
                    <CardDescription>Manage your local database</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        All your data is stored locally in IndexedDB and works offline. Use the options below to manage your local data.
                    </p>
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <div className="flex items-start gap-3">
                            <Trash2 className="w-5 h-5 text-destructive mt-0.5" />
                            <div>
                                <p className="font-medium text-destructive">Danger Zone</p>
                                <p className="text-sm text-muted-foreground mb-3">
                                    Clearing local data will permanently delete all your products, customers, orders, and invoices.
                                </p>
                                <Button variant="destructive" onClick={handleClearLocalData}>
                                    Clear All Local Data
                                </Button>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* About */}
            <Card>
                <CardHeader>
                    <CardTitle>About</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2 text-sm text-muted-foreground">
                        <p><strong>ERP System</strong> - Offline-First Enterprise Resource Planning</p>
                        <p>Version 1.0.0</p>
                        <p>Built with React, Vite, Dexie.js, and Supabase</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
