import { useAuth } from '@/auth'
import { useSyncStatus, clearQueue } from '@/sync'
import { clearDatabase } from '@/local-db'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Label, LanguageSwitcher } from '@/ui/components'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, Database, Cloud, Trash2, RefreshCw, User, Copy, Check } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { useTheme } from '@/ui/components/theme-provider'
import { Moon, Sun, Monitor } from 'lucide-react'
import { useState } from 'react'

export function Settings() {
    const { user, signOut, isSupabaseConfigured } = useAuth()
    const { syncState, pendingCount, lastSyncTime, sync, isSyncing, isOnline } = useSyncStatus()
    const { theme, setTheme } = useTheme()
    const { t } = useTranslation()
    const [copied, setCopied] = useState(false)

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const handleClearSyncQueue = async () => {
        if (confirm(t('settings.messages.clearQueueConfirm'))) {
            await clearQueue()
        }
    }

    const handleClearLocalData = async () => {
        if (confirm(t('settings.messages.clearDataConfirm'))) {
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
                    {t('settings.title')}
                </h1>
                <p className="text-muted-foreground">{t('settings.subtitle')}</p>
            </div>

            {/* Theme Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Monitor className="w-5 h-5" />
                        {t('settings.appearance')}
                    </CardTitle>
                    <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div className="flex flex-col gap-2">
                            <Label>{t('settings.theme.title')}</Label>
                            <div className="grid grid-cols-3 gap-2 max-w-md">
                                <Button
                                    variant={theme === 'light' ? 'default' : 'outline'}
                                    className="flex items-center gap-2 justify-center"
                                    onClick={() => setTheme('light')}
                                >
                                    <Sun className="w-4 h-4" />
                                    {t('settings.theme.light')}
                                </Button>
                                <Button
                                    variant={theme === 'dark' ? 'default' : 'outline'}
                                    className="flex items-center gap-2 justify-center"
                                    onClick={() => setTheme('dark')}
                                >
                                    <Moon className="w-4 h-4" />
                                    {t('settings.theme.dark')}
                                </Button>
                                <Button
                                    variant={theme === 'system' ? 'default' : 'outline'}
                                    className="flex items-center gap-2 justify-center"
                                    onClick={() => setTheme('system')}
                                >
                                    <Monitor className="w-4 h-4" />
                                    {t('settings.theme.system')}
                                </Button>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label>{t('settings.language')}</Label>
                            <div className="flex items-center gap-2">
                                <LanguageSwitcher />
                                <span className="text-sm text-muted-foreground">
                                    {t('settings.languageDesc')}
                                </span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* User Info */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <User className="w-5 h-5" />
                        {t('settings.account')}
                    </CardTitle>
                    <CardDescription>{t('settings.accountDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <Label className="text-muted-foreground">{t('auth.name') || 'Name'}</Label>
                            <p className="font-medium">{user?.name}</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">{t('auth.email')}</Label>
                            <p className="font-medium">{user?.email}</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">{t('settings.role')}</Label>
                            <p className="font-medium capitalize">{user?.role}</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">{t('settings.authMode')}</Label>
                            <p className="font-medium">{isSupabaseConfigured ? 'Supabase' : t('settings.demo')}</p>
                        </div>
                        <div className="md:col-span-2">
                            <Label className="text-muted-foreground">{t('auth.workspaceCode')}</Label>
                            <div
                                className="flex items-center gap-3 mt-1 p-3 bg-secondary/30 rounded-lg border border-border group hover:border-primary/50 transition-all cursor-pointer w-full max-w-sm"
                                onClick={() => user?.workspaceCode && copyToClipboard(user.workspaceCode)}
                            >
                                <span className="font-mono font-bold tracking-wider flex-1">{user?.workspaceCode}</span>
                                {copied ? (
                                    <span className="flex items-center gap-1.5 text-emerald-500 text-sm font-medium animate-in fade-in slide-in-from-right-2">
                                        <Check className="w-4 h-4" />
                                        {t('auth.copied')}
                                    </span>
                                ) : (
                                    <Button variant="ghost" size="sm" className="h-8 gap-2 group-hover:bg-primary/10 group-hover:text-primary">
                                        <Copy className="w-4 h-4" />
                                        {t('auth.copyCode')}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                    <Button variant="destructive" onClick={signOut}>
                        {t('auth.signOut')}
                    </Button>
                </CardContent>
            </Card>

            {/* Sync Status */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Cloud className="w-5 h-5" />
                        {t('settings.syncStatus')}
                    </CardTitle>
                    <CardDescription>{t('settings.syncDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <Label className="text-muted-foreground">{t('settings.connection')}</Label>
                            <p className={`font-medium ${isOnline ? 'text-emerald-500' : 'text-red-500'}`}>
                                {isOnline ? t('settings.online') : t('settings.offline')}
                            </p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">{t('settings.syncState')}</Label>
                            <p className="font-medium capitalize">{syncState}</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">{t('settings.pendingChanges')}</Label>
                            <p className="font-medium">{pendingCount} items</p>
                        </div>
                        <div>
                            <Label className="text-muted-foreground">{t('settings.lastSynced')}</Label>
                            <p className="font-medium">
                                {lastSyncTime ? formatDateTime(lastSyncTime) : t('settings.never')}
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
                            {isSyncing ? t('settings.syncing') : t('settings.syncNow')}
                        </Button>
                        {pendingCount > 0 && (
                            <Button variant="outline" onClick={handleClearSyncQueue}>
                                {t('settings.clearQueue')}
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
                        {t('settings.localData')}
                    </CardTitle>
                    <CardDescription>{t('settings.localDataDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        {t('settings.localDataInfo')}
                    </p>
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <div className="flex items-start gap-3">
                            <Trash2 className="w-5 h-5 text-destructive mt-0.5" />
                            <div>
                                <p className="font-medium text-destructive">{t('settings.dangerZone')}</p>
                                <p className="text-sm text-muted-foreground mb-3">
                                    {t('settings.clearDataWarning')}
                                </p>
                                <Button variant="destructive" onClick={handleClearLocalData}>
                                    {t('settings.clearData')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* About */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('settings.about')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2 text-sm text-muted-foreground">
                        <p><strong>ERP System</strong> - Offline-First Enterprise Resource Planning</p>
                        <p>Version 1.0.0</p>
                        <p>{t('settings.builtWith')}</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
