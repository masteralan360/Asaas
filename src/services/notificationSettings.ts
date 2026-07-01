import { supabase } from '@/auth/supabase'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'
import { isWorkspaceNotificationType, type WorkspaceNotificationType } from '@/lib/notificationTypes'

type DisabledNotificationTypeRow = { notification_type: string }

export async function listDisabledWorkspaceNotificationTypes(workspaceId: string) {
    if (!workspaceId || isLocalWorkspaceMode(workspaceId)) {
        return { data: [] as WorkspaceNotificationType[], error: null }
    }

    const { data, error } = await supabase.rpc('list_workspace_disabled_notification_types')

    return {
        data: ((data ?? []) as DisabledNotificationTypeRow[])
            .map((row) => row.notification_type)
            .filter(isWorkspaceNotificationType),
        error,
    }
}

export async function setWorkspaceNotificationTypeDisabled(
    workspaceId: string,
    notificationType: WorkspaceNotificationType,
    disabled: boolean,
) {
    if (!workspaceId || isLocalWorkspaceMode(workspaceId)) {
        return { error: null }
    }

    if (disabled) {
        const { error } = await supabase.rpc('set_workspace_notification_type_disabled', {
            p_notification_type: notificationType,
            p_disabled: true,
        })

        return { error }
    }

    const { error } = await supabase.rpc('set_workspace_notification_type_disabled', {
        p_notification_type: notificationType,
        p_disabled: false,
    })

    return { error }
}
