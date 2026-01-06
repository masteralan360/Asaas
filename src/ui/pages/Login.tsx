import { useState } from 'react'
import { useLocation } from 'wouter'
import { useAuth } from '@/auth'
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/components'
import { Boxes, Mail, Lock, Loader2 } from 'lucide-react'

export function Login() {
    const [, setLocation] = useLocation()
    const { signIn, isSupabaseConfigured } = useAuth()
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
            setError('An unexpected error occurred')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
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
                        <CardTitle>Welcome back</CardTitle>
                        <CardDescription>Sign in to your account</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {!isSupabaseConfigured && (
                            <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                <p className="text-sm text-amber-500">
                                    Supabase is not configured. Using demo mode with local-only data.
                                </p>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
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
                                <Label htmlFor="password">Password</Label>
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
                                        Signing in...
                                    </>
                                ) : (
                                    'Sign in'
                                )}
                            </Button>
                        </form>

                        <div className="mt-4 text-center">
                            <button
                                onClick={() => setLocation('/register')}
                                className="text-sm text-primary hover:underline"
                            >
                                Don't have an account? Sign up
                            </button>
                        </div>
                    </CardContent>
                </Card>

                <p className="text-xs text-center text-muted-foreground">
                    Data is stored locally first and synced when online
                </p>
            </div>
        </div>
    )
}
