import { useAuth } from '@/auth'
import { useSyncStatus, clearQueue } from '@/sync'
import { clearDatabase } from '@/local-db'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Label, LanguageSwitcher, Input, CurrencySelector, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTrigger, TabsContent, Switch } from '@/ui/components'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/workspace'
import { Coins } from 'lucide-react'
import type { IQDDisplayPreference } from '@/local-db/models'
import { Settings as SettingsIcon, Database, Cloud, Trash2, RefreshCw, User, Copy, Check, CreditCard, Globe } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { useTheme } from '@/ui/components/theme-provider'
import { Moon, Sun, Monitor, Unlock, Server } from 'lucide-react'
import { useState, useEffect } from 'react'
import { getAppSettingSync, setAppSetting } from '@/local-db/settings'

export function Settings() {
    const { user, signOut, isSupabaseConfigured } = useAuth()
    const { syncState, pendingCount, lastSyncTime, sync, isSyncing, isOnline } = useSyncStatus()
    const { theme, setTheme } = useTheme()
    const { features, updateSettings } = useWorkspace()
    const { t } = useTranslation()
    const [copied, setCopied] = useState(false)
    const [posHotkey, setPosHotkey] = useState(localStorage.getItem('pos_hotkey') || 'p')
    const [barcodeHotkey, setBarcodeHotkey] = useState(localStorage.getItem('barcode_hotkey') || 'k')
    const [exchangeRateSource, setExchangeRateSource] = useState(localStorage.getItem('primary_exchange_rate_source') || 'xeiqd')
    const [eurExchangeRateSource, setEurExchangeRateSource] = useState(localStorage.getItem('primary_eur_exchange_rate_source') || 'forexfy')
    const [tryExchangeRateSource, setTryExchangeRateSource] = useState(localStorage.getItem('primary_try_exchange_rate_source') || 'forexfy')

    // Connection Settings State
    const [isElectron, setIsElectron] = useState(false)
    const [isConnectionSettingsUnlocked, setIsConnectionSettingsUnlocked] = useState(false)
    const [passkey, setPasskey] = useState('')
    const [customUrl, setCustomUrl] = useState(getAppSettingSync('supabase_url') || '')
    const [customKey, setCustomKey] = useState(getAppSettingSync('supabase_anon_key') || '')

    useEffect(() => {
        window.electronAPI?.isElectron().then(setIsElectron).catch(() => setIsElectron(false))
    }, [])

    const handleHotkeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.slice(0, 1).toLowerCase()
        setPosHotkey(val)
        localStorage.setItem('pos_hotkey', val)
    }

    const handleBarcodeHotkeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.slice(0, 1).toLowerCase()
        setBarcodeHotkey(val)
        localStorage.setItem('barcode_hotkey', val)
    }

    const handleExchangeRateSourceChange = (val: string) => {
        setExchangeRateSource(val)
        localStorage.setItem('primary_exchange_rate_source', val)
        // Notify the indicator to refresh instantly
        window.dispatchEvent(new CustomEvent('exchange-rate-refresh'))
    }

    const handleEurExchangeRateSourceChange = (val: string) => {
        setEurExchangeRateSource(val)
        localStorage.setItem('primary_eur_exchange_rate_source', val)
        window.dispatchEvent(new CustomEvent('exchange-rate-refresh'))
    }

    const handleTryExchangeRateSourceChange = (val: string) => {
        setTryExchangeRateSource(val)
        localStorage.setItem('primary_try_exchange_rate_source', val)
        window.dispatchEvent(new CustomEvent('exchange-rate-refresh'))
    }

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

    const handleUnlockConnection = () => {
        if (passkey === "Q9FZ7bM4K8xYtH6PVa5R2CJDW") {
            setIsConnectionSettingsUnlocked(true)
        } else {
            alert("Invalid Passkey")
        }
    }

    const handleSaveConnection = async () => {
        if (confirm("Changing connection settings will reload the app. Continue?")) {
            await setAppSetting('supabase_url', customUrl)
            await setAppSetting('supabase_anon_key', customKey)
            window.location.reload()
        }
    }

    const handleResetConnection = async () => {
        if (confirm("Reset to default system settings? This will reload the app.")) {
            await setAppSetting('supabase_url', '')
            await setAppSetting('supabase_anon_key', '')
            window.location.reload()
        }
    }

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Header */}
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <SettingsIcon className="w-6 h-6 text-primary" />
                    {t('settings.title')}
                </h1>
                <p className="text-muted-foreground">{t('settings.subtitle')}</p>
            </div>

            <Tabs defaultValue="general" className="w-full space-y-6">
                <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
                    <TabsTrigger value="general">{t('settings.tabs.general') || 'General Settings'}</TabsTrigger>
                    <TabsTrigger value="advanced">{t('settings.tabs.advanced') || 'Advanced Settings'}</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-6 mt-0">
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

                    {/* Currency Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Coins className="w-5 h-5" />
                                {t('settings.currency.title') || 'Currency Settings'}
                            </CardTitle>
                            <CardDescription>
                                {t('settings.currency.desc') || 'Configure default currency and display preferences for your workspace.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-6 md:grid-cols-2">
                                <CurrencySelector
                                    label={t('settings.currency.default') || 'Default Currency'}
                                    value={features.default_currency}
                                    onChange={(val) => updateSettings({ default_currency: val })}
                                    iqdDisplayPreference={features.iqd_display_preference}
                                />

                                {features.default_currency === 'iqd' && (
                                    <div className="space-y-2">
                                        <Label>{t('settings.currency.iqdPreference') || 'IQD Display Preference'}</Label>
                                        <Select
                                            value={features.iqd_display_preference}
                                            onValueChange={(val) => updateSettings({ iqd_display_preference: val as IQDDisplayPreference })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="IQD">IQD (English)</SelectItem>
                                                <SelectItem value="د.ع">د.ع (Arabic)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Exchange Rate Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Globe className="w-5 h-5" />
                                {t('settings.exchangeRate.title') || 'Exchange Rate Source'}
                            </CardTitle>
                            <CardDescription>
                                {t('settings.exchangeRate.primaryDesc') || 'Select which website to use for live market rates.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4 max-w-md">
                                <div className="space-y-2">
                                    <Label>{t('settings.exchangeRate.primary') || 'Primary Source'}</Label>
                                    <Select value={exchangeRateSource} onValueChange={handleExchangeRateSourceChange}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="xeiqd">
                                                {t('settings.exchangeRate.xeiqd') || 'xeiqd.com / Sulaymaniyah'}
                                            </SelectItem>
                                            <SelectItem value="forexfy">
                                                {t('settings.exchangeRate.forexfy') || 'Forexfy.app / Black Market'}
                                            </SelectItem>
                                            <SelectItem value="dolardinar">
                                                {t('settings.exchangeRate.dolardinar') || 'DolarDinar.com / Market Sheet'}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="pt-2 space-y-4 border-t border-border/50">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-base">{t('settings.exchangeRate.eurEnable') || 'Enable Euro Support'}</Label>
                                            <p className="text-sm text-muted-foreground">
                                                {t('settings.exchangeRate.eurEnableDesc') || 'Allow POS to handle EUR products and conversions.'}
                                            </p>
                                        </div>
                                        <Switch
                                            checked={features.eur_conversion_enabled}
                                            onCheckedChange={(val: boolean) => updateSettings({ eur_conversion_enabled: val })}
                                            disabled={user?.role !== 'admin'}
                                        />
                                    </div>

                                    {features.eur_conversion_enabled && (
                                        <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                                            <Label>{t('settings.exchangeRate.eurSource') || 'Euro Exchange Source'}</Label>
                                            <Select value={eurExchangeRateSource} onValueChange={handleEurExchangeRateSourceChange}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="forexfy">
                                                        {t('settings.exchangeRate.forexfy_eur') || 'Forexfy EUR/IQD (Faster & More Reliable)'}
                                                    </SelectItem>
                                                    <SelectItem value="dolardinar">
                                                        {t('settings.exchangeRate.dolardinar_eur') || 'DolarDinar.com EUR/IQD (Market Sheet)'}
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <p className="text-[11px] text-muted-foreground italic">
                                                {t('settings.exchangeRate.eurSourceAdminOnly') || 'Forexfy and DolarDinar are currently the supported sources for Euro rates.'}
                                            </p>
                                        </div>
                                    )}

                                    <div className="pt-2 space-y-4 border-t border-border/50">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <Label className="text-base">{t('settings.exchangeRate.tryEnable') || 'Enable TRY Support'}</Label>
                                                <p className="text-sm text-muted-foreground">
                                                    {t('settings.exchangeRate.tryEnableDesc') || 'Allow POS to handle TRY products and conversions.'}
                                                </p>
                                            </div>
                                            <Switch
                                                checked={features.try_conversion_enabled}
                                                onCheckedChange={(val: boolean) => updateSettings({ try_conversion_enabled: val })}
                                                disabled={user?.role !== 'admin'}
                                            />
                                        </div>

                                        {features.try_conversion_enabled && (
                                            <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                                                <Label>{t('settings.exchangeRate.trySource') || 'TRY Exchange Source'}</Label>
                                                <Select value={tryExchangeRateSource} onValueChange={handleTryExchangeRateSourceChange}>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="forexfy">
                                                            {t('settings.exchangeRate.forexfy_try') || 'Forexfy TRY/IQD (Black Market)'}
                                                        </SelectItem>
                                                        <SelectItem value="dolardinar">
                                                            {t('settings.exchangeRate.dolardinar_try') || 'DolarDinar.com TRY/IQD (Market Sheet)'}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
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

                    {/* POS Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <CreditCard className="w-5 h-5" />
                                {t('settings.pos.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                                <Label>{t('settings.pos.hotkey')}</Label>
                                <Input
                                    value={posHotkey}
                                    onChange={handleHotkeyChange}
                                    maxLength={1}
                                    className="w-20 text-center font-mono uppercase"
                                />
                                <p className="text-sm text-muted-foreground">
                                    {t('settings.pos.hotkeyDesc')}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>{t('settings.pos.barcodeHotkey')}</Label>
                                <Input
                                    value={barcodeHotkey}
                                    onChange={handleBarcodeHotkeyChange}
                                    maxLength={1}
                                    className="w-20 text-center font-mono uppercase"
                                />
                                <p className="text-sm text-muted-foreground">
                                    {t('settings.pos.barcodeHotkeyDesc')}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                </TabsContent>

                <TabsContent value="advanced" className="space-y-6 mt-0">
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

                    {/* Connection Settings (Electron Only) */}
                    {isElectron && (
                        <Card className="border-primary/20 bg-primary/5">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Server className="w-5 h-5 text-primary" />
                                    Connection Settings
                                </CardTitle>
                                <CardDescription>
                                    Override the default Supabase instance. Requires master passkey.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {!isConnectionSettingsUnlocked ? (
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>Master Passkey</Label>
                                            <div className="flex gap-2">
                                                <Input
                                                    type="password"
                                                    value={passkey}
                                                    onChange={(e) => setPasskey(e.target.value)}
                                                    placeholder="Enter passkey to unlock..."
                                                    className="max-w-xs"
                                                />
                                                <Button onClick={handleUnlockConnection}>
                                                    <Unlock className="w-4 h-4 mr-2" />
                                                    Unlock
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                        <div className="grid gap-4">
                                            <div className="space-y-2">
                                                <Label>Supabase URL</Label>
                                                <Input
                                                    value={customUrl}
                                                    onChange={(e) => setCustomUrl(e.target.value)}
                                                    placeholder="https://your-project.supabase.co"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Supabase Anon Key</Label>
                                                <Input
                                                    type="password"
                                                    value={customKey}
                                                    onChange={(e) => setCustomKey(e.target.value)}
                                                    placeholder="your-anon-key"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex gap-2 pt-2">
                                            <Button onClick={handleSaveConnection}>
                                                Save & Reconnect
                                            </Button>
                                            <Button variant="outline" onClick={handleResetConnection}>
                                                Reset to Default
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    )
}
