import { ArrowLeft, BadgePercent } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import { useAuth } from '@/auth'
import { hasEffectiveSalesAgentCommissionPermission, useWorkspacePermissions } from '@/permissions'
import { Button } from '@/ui/components'
import { AgentCommissionSettingsForm } from '@/ui/components/commissions/AgentCommissionSettingsDialog'
import { CommissionFeatureBoundary } from '@/ui/components/commissions/useCommissionAgentDirectory'
import { useWorkspace } from '@/workspace'

export function AgentCommissionSettings() {
    const { t } = useTranslation()
    const { user } = useAuth()
    const { hasFeature } = useWorkspace()
    const { permissionKeys } = useWorkspacePermissions()
    const [, navigate] = useLocation()
    const canManageCommissionPlans = hasFeature('sales_agent_commissions')
        && hasEffectiveSalesAgentCommissionPermission(user?.role, permissionKeys, 'salesAgentCommissions.managePlans')

    if (!user?.workspaceId || !canManageCommissionPlans) return null

    return (
        <CommissionFeatureBoundary enabled={true} workspaceId={user.workspaceId}>
            <div className="mx-auto w-full max-w-6xl space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-violet-500/10 p-2 text-violet-700 dark:text-violet-300">
                            <BadgePercent className="h-6 w-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">{t('salesAgentCommissions.settingsTitle')}</h1>
                            <p className="mt-1 text-muted-foreground">{t('salesAgentCommissions.settingsDescription')}</p>
                        </div>
                    </div>
                    <Button type="button" variant="outline" className="gap-2 self-start" onClick={() => navigate('/agents')}>
                        <ArrowLeft className="h-4 w-4" />
                        {t('common.back', { defaultValue: 'Back' })}
                    </Button>
                </div>

                <AgentCommissionSettingsForm
                    workspaceId={user.workspaceId}
                    userId={user.id}
                    onCancel={() => navigate('/agents')}
                />
            </div>
        </CommissionFeatureBoundary>
    )
}
