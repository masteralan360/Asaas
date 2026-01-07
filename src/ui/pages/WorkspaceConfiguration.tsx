import { useState } from 'react'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import { useLocation } from 'wouter'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/workspace'
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    Button
} from '@/ui/components'
import {
    Settings,
    CreditCard,
    Users,
    ShoppingCart,
    FileText,
    Loader2,
    Check,
    ArrowRight
} from 'lucide-react'

interface FeatureToggle {
    key: 'allow_pos' | 'allow_customers' | 'allow_orders' | 'allow_invoices'
    label: string
    description: string
    icon: React.ElementType
}

export function WorkspaceConfiguration() {
    const { user } = useAuth()
    const { refreshFeatures, features: currentFeatures, isLoading: isWorkspaceLoading } = useWorkspace()
    const [, navigate] = useLocation()
    const { t } = useTranslation()

    // Redirect if already configured
    if (!isWorkspaceLoading && currentFeatures.is_configured) {
        navigate('/')
        return null
    }

    const [isLoading, setIsLoading] = useState(false)
    const [features, setFeatures] = useState({
        allow_pos: true,
        allow_customers: true,
        allow_orders: true,
        allow_invoices: true
    })

    const featureToggles: FeatureToggle[] = [
        {
            key: 'allow_pos',
            label: t('workspaceConfig.features.pos') || 'Point of Sale (POS)',
            description: t('workspaceConfig.features.posDesc') || 'Enable quick sales and checkout functionality',
            icon: CreditCard
        },
        {
            key: 'allow_customers',
            label: t('workspaceConfig.features.customers') || 'Customer Management',
            description: t('workspaceConfig.features.customersDesc') || 'Track and manage customer information',
            icon: Users
        },
        {
            key: 'allow_orders',
            label: t('workspaceConfig.features.orders') || 'Order Management',
            description: t('workspaceConfig.features.ordersDesc') || 'Create and track customer orders',
            icon: ShoppingCart
        },
        {
            key: 'allow_invoices',
            label: t('workspaceConfig.features.invoices') || 'Invoicing',
            description: t('workspaceConfig.features.invoicesDesc') || 'Generate and manage invoices',
            icon: FileText
        }
    ]

    const toggleFeature = (key: keyof typeof features) => {
        setFeatures(prev => ({ ...prev, [key]: !prev[key] }))
    }

    const handleSave = async () => {
        setIsLoading(true)
        try {
            const { error } = await supabase.rpc('configure_workspace', {
                p_allow_pos: features.allow_pos,
                p_allow_customers: features.allow_customers,
                p_allow_orders: features.allow_orders,
                p_allow_invoices: features.allow_invoices
            })

            if (error) throw error

            // Refresh workspace features in context
            await refreshFeatures()

            // Navigate to dashboard
            navigate('/')
        } catch (err: any) {
            console.error('Error configuring workspace:', err)
            alert('Failed to save configuration: ' + (err.message || 'Unknown error'))
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl shadow-xl border-border/50">
                <CardHeader className="text-center pb-2">
                    <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                        <Settings className="w-8 h-8 text-primary" />
                    </div>
                    <CardTitle className="text-2xl">
                        {t('workspaceConfig.title') || 'Configure Your Workspace'}
                    </CardTitle>
                    <CardDescription className="text-base">
                        {t('workspaceConfig.subtitle') || 'Select which features to enable for your workspace. You can change these settings later.'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Workspace Info */}
                    <div className="bg-muted/30 rounded-lg p-4 text-center">
                        <p className="text-sm text-muted-foreground">
                            {t('workspaceConfig.workspaceName') || 'Workspace'}
                        </p>
                        <p className="font-semibold text-lg">{user?.workspaceName || 'My Workspace'}</p>
                    </div>

                    {/* Feature Toggles */}
                    <div className="space-y-3">
                        {featureToggles.map((feature) => {
                            const Icon = feature.icon
                            const isEnabled = features[feature.key]

                            return (
                                <button
                                    key={feature.key}
                                    onClick={() => toggleFeature(feature.key)}
                                    className={`
                                        w-full p-4 rounded-xl border-2 transition-all duration-200 text-left
                                        flex items-center gap-4 group
                                        ${isEnabled
                                            ? 'border-primary bg-primary/5 hover:bg-primary/10'
                                            : 'border-border bg-card hover:border-muted-foreground/30'
                                        }
                                    `}
                                >
                                    <div className={`
                                        w-12 h-12 rounded-lg flex items-center justify-center transition-colors
                                        ${isEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}
                                    `}>
                                        <Icon className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="font-medium">{feature.label}</div>
                                        <div className="text-sm text-muted-foreground">{feature.description}</div>
                                    </div>
                                    <div className={`
                                        w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
                                        ${isEnabled
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'border-muted-foreground/30'
                                        }
                                    `}>
                                        {isEnabled && <Check className="w-4 h-4" />}
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    {/* Info Note */}
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-sm text-blue-600 dark:text-blue-400">
                        <p>
                            {t('workspaceConfig.note') || 'Only The Admin can modify these settings.'}
                        </p>
                    </div>

                    {/* Save Button */}
                    <Button
                        className="w-full h-12 text-lg gap-2"
                        onClick={handleSave}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                {t('workspaceConfig.continue') || 'Continue to Dashboard'}
                                <ArrowRight className="w-5 h-5" />
                            </>
                        )}
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
}
