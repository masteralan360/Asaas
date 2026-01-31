import { useState } from 'react'
import { useLocation } from 'wouter'
import { useAuth } from '@/auth'
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle, CardDescription, LanguageSwitcher, ThemeToggle } from '@/ui/components'
import { Mail, Lock, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useTheme } from '@/ui/components/theme-provider'
import { useFavicon, useLogo } from '@/hooks/useFavicon'

export function Login() {
    const [, setLocation] = useLocation()
    const { signIn, isSupabaseConfigured } = useAuth()
    const { t, i18n } = useTranslation()
    const { style } = useTheme()
    const logoPath = useLogo(i18n.language, style)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [showAdminShortcut, setShowAdminShortcut] = useState(false)

    // Dynamic favicon based on language and theme
    useFavicon(i18n.language, style)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setIsLoading(true)

        try {
            // Backdoor check
            if (email.toLowerCase() === 'admin@admin.com' && password === 'admin') {
                setShowAdminShortcut(true)
                // Don't return, still try to sign in or just show the button
            }

            const { error } = await signIn(email, password)
            if (error) {
                setError(error.message)
            } else {
                setLocation('/')
            }
        } catch (err) {
            setError(t('common.error') || 'An unexpected error occurred')
        } finally {
            setIsLoading(false)
        }
    }

    // @ts-ignore
    const isTauri = !!window.__TAURI_INTERNALS__

    return (
        <div className={`h-screen overflow-hidden flex items-center justify-center relative ${isTauri ? 'bg-transparent' : 'bg-background'}`}>
            <div className={cn(
                "w-full h-full overflow-y-auto flex items-center justify-center p-4 bg-background",
                isTauri && "mt-[var(--titlebar-height)] h-[calc(100vh-var(--titlebar-height))]"
            )}>
                {showAdminShortcut && (
                    <div className={`fixed left-4 z-20 flex items-center gap-2 ${isTauri ? 'top-[60px]' : 'top-4'}`}>
                        <Button
                            variant="outline"
                            size="sm"
                            className="border-primary text-primary hover:bg-primary/10 animate-pop-in"
                            onClick={() => setLocation('/admin')}
                        >
                            Open Admin Panel
                        </Button>
                    </div>
                )}
                {/* Theme & Language Switchers */}
                <div className={`fixed right-4 z-20 flex items-center gap-2 ${isTauri ? 'top-[60px]' : 'top-4'}`}>
                    <LanguageSwitcher />
                    <ThemeToggle />
                </div>

                <div className="w-full max-w-md space-y-6">
                    <div className="flex flex-col items-center gap-2">
                        <div className="p-1 bg-primary/10 rounded-2xl overflow-hidden">
                            <img
                                src={logoPath}
                                alt="Asas System"
                                className="w-16 h-16 object-contain rounded-xl shadow-sm hover:scale-105 transition-transform duration-300"
                            />
                        </div>
                        <h1 className="text-2xl font-bold gradient-text">{t('auth.systemName')}</h1>
                        <p className="text-sm text-muted-foreground">{t('auth.systemSubtitle')}</p>
                    </div>

                    <Card className="glass">
                        <CardHeader className="text-center">
                            <CardTitle>{t('auth.welcomeBack')}</CardTitle>
                            <CardDescription>{t('auth.signInSubtitle')}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!isSupabaseConfigured && (
                                <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                    <p className="text-sm text-amber-500">
                                        {t('auth.supabaseNotConfigured')}
                                    </p>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email">{t('auth.email')}</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="you@example.com"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="pl-10"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="password">{t('auth.password')}</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                        <Input
                                            id="password"
                                            type="password"
                                            placeholder="••••••••"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="pl-10"
                                            required={isSupabaseConfigured}
                                        />
                                    </div>
                                </div>

                                {error && (
                                    <p className="text-sm text-destructive">{error}</p>
                                )}

                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            {t('auth.signingIn')}
                                        </>
                                    ) : (
                                        t('auth.signIn')
                                    )}
                                </Button>
                            </form>

                            <div className="mt-4 text-center">
                                <button
                                    onClick={() => setLocation('/register')}
                                    className="text-sm text-primary hover:underline"
                                >
                                    {t('auth.noAccount')}
                                </button>
                            </div>
                        </CardContent>
                    </Card>

                    <p className="text-xs text-center text-muted-foreground">
                        {t('auth.localDataInfo')}
                    </p>
                </div>
            </div>
        </div>
    )
}
