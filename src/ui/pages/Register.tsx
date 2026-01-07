import { useState } from 'react'
import { useLocation } from 'wouter'
import { useAuth } from '@/auth'
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle, CardDescription, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, LanguageSwitcher, ThemeToggle } from '@/ui/components'
import { Boxes, Mail, Lock, User, Loader2, Key } from 'lucide-react'
import type { UserRole } from '@/local-db/models'
import { useTranslation } from 'react-i18next'

export function Register() {
    const [, setLocation] = useLocation()
    const { signUp, isSupabaseConfigured } = useAuth()
    const { t } = useTranslation()
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [passkey, setPasskey] = useState('')
    const [role, setRole] = useState<UserRole>('staff')
    const [workspaceName, setWorkspaceName] = useState('')
    const [workspaceCode, setWorkspaceCode] = useState('')
    const [error, setError] = useState('')
    const [isLoading, setIsLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setIsLoading(true)

        try {
            const { error } = await signUp({
                email,
                password,
                name,
                role,
                passkey,
                workspaceName: role === 'admin' ? workspaceName : undefined,
                workspaceCode: role !== 'admin' ? workspaceCode : undefined
            })
            if (error) {
                // ... same error logic
                // If it's a passkey error from the trigger, it might be genericized by Supabase
                // or contain the custom message. We map both to our localized key.
                if (error.message.includes('Invalid Access Code') || error.message.includes('Database error saving new user')) {
                    setError(t('auth.invalidPasskey'))
                } else {
                    setError(error.message)
                }
            } else {
                setLocation('/')
            }
        } catch (err) {
            setError(t('common.error') || 'An unexpected error occurred')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
            {/* Theme & Language Switchers */}
            <div className="absolute top-4 right-4 flex items-center gap-2">
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
                    <p className="text-sm text-muted-foreground">{t('auth.createAccount')}</p>
                </div>

                <Card className="glass">
                    <CardHeader className="text-center">
                        <CardTitle>{t('auth.getStarted')}</CardTitle>
                        <CardDescription>{t('auth.createAccountSubtitle')}</CardDescription>
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
                                <Label htmlFor="name">{t('auth.fullName')}</Label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <Input
                                        id="name"
                                        type="text"
                                        placeholder="John Doe"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        className="pl-10"
                                        required
                                    />
                                </div>
                            </div>

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
                                        minLength={6}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="passkey">{t('auth.passkey')}</Label>
                                <div className="relative">
                                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <Input
                                        id="passkey"
                                        type="text"
                                        placeholder={t('auth.passkeyPlaceholder')}
                                        value={passkey}
                                        onChange={(e) => setPasskey(e.target.value)}
                                        className="pl-10"
                                        required={isSupabaseConfigured}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="role">{t('auth.role')}</Label>
                                <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('auth.selectRole')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="admin">{t('auth.roles.admin')}</SelectItem>
                                        <SelectItem value="staff">{t('auth.roles.staff')}</SelectItem>
                                        <SelectItem value="viewer">{t('auth.roles.viewer')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {role === 'admin' ? (
                                <div className="space-y-2">
                                    <Label htmlFor="workspaceName">{t('auth.workspaceName')}</Label>
                                    <div className="relative">
                                        <Boxes className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                        <Input
                                            id="workspaceName"
                                            type="text"
                                            placeholder="e.g. My Awesome Corp"
                                            value={workspaceName}
                                            onChange={(e) => setWorkspaceName(e.target.value)}
                                            className="pl-10"
                                            required
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label htmlFor="workspaceCode">{t('auth.workspaceCode')}</Label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                        <Input
                                            id="workspaceCode"
                                            type="text"
                                            placeholder="ABCD-1234"
                                            value={workspaceCode}
                                            onChange={(e) => setWorkspaceCode(e.target.value)}
                                            className="pl-10"
                                            required
                                        />
                                    </div>
                                </div>
                            )}

                            {error && (
                                <p className="text-sm text-destructive">{error}</p>
                            )}

                            <Button type="submit" className="w-full" disabled={isLoading}>
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {t('auth.creatingAccount')}
                                    </>
                                ) : (
                                    t('auth.createAccountBtn')
                                )}
                            </Button>
                        </form>

                        <div className="mt-4 text-center">
                            <button
                                onClick={() => setLocation('/login')}
                                className="text-sm text-primary hover:underline"
                            >
                                {t('auth.hasAccount')}
                            </button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
