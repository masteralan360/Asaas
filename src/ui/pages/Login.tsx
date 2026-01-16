import { useState } from 'react'
import { useLocation } from 'wouter'
import { useAuth } from '@/auth'
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle, CardDescription, LanguageSwitcher, ThemeToggle } from '@/ui/components'
import { Boxes, Mail, Lock, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function Login() {
    const [, setLocation] = useLocation()
    const { signIn, isSupabaseConfigured } = useAuth()
    const { t } = useTranslation()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [isLoading, setIsLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setIsLoading(true)

        try {
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
        <div className={`min-h-screen flex items-center justify-center bg-background p-4 relative ${isTauri ? 'pt-14' : ''}`}>
            {/* Theme & Language Switchers */}
            <div className={`absolute right-4 flex items-center gap-2 ${isTauri ? 'top-14' : 'top-4'}`}>
                <LanguageSwitcher />
                <ThemeToggle />
            </div>

            <div className="w-full max-w-md space-y-6">
                {/* Logo */}
                <div className="flex flex-col items-center gap-2">
                    <div className="p-3 bg-primary/10 rounded-2xl">
                        <Boxes className="w-10 h-10 text-primary" />
                    </div>
                    <h1 className="text-2xl font-bold gradient-text">ERP System</h1>
                    <p className="text-sm text-muted-foreground">Offline-First Enterprise Management</p>
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
    )
}
